/**
 * Appraisal at the event's time: it becomes an episode in her core memory, moves her mood, a strong
 * one takes over her mind, the plan it fulfils is resolved, and the event is marked as landed.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { appraiseEvent } from "@/mind/process/core/appraise";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T09:00:00Z");
const earlier = new Date("2026-01-05T01:00:00Z");
const base = {
  worldEventId: "00000000-0000-0000-0000-000000000001",
  content: "Spica got the telescope images.",
  at: now,
  embedding: vec(0.01),
  agents: [],
};

async function setup() {
  const deps = makeTestDeps();
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  const wid = await deps.core.world.recordEvent({
    at: now,
    kind: "planned",
    content: base.content,
    valence: 0.8,
    stakes: "high",
    agents: [],
    life_day: "2026-01-05",
    created_at: earlier,
  });
  return { deps, event: { ...base, worldEventId: wid } };
}

async function addIntention(deps: ReturnType<typeof makeTestDeps>, worldEventId: string | null) {
  return deps.core.memory.insert({
    kind: "intention",
    content: "Spica is counting the hours until the telescope images.",
    payload: { event_at: now.toISOString() },
    embedding: vec(0.02),
    occurred_at: earlier,
    created_at: earlier,
    status: "open",
    salience: 0.4,
    valence: 0.8,
    confidence: 1,
    source: "world",
    source_ref: worldEventId ? `world_event:${worldEventId}` : null,
  });
}

test("a strong event becomes an open episode, lifts her mood and takes her mind", async () => {
  const { deps, event } = await setup();
  const before = (await deps.core.state.get())!;
  const out = await deps.core.transaction((tx) =>
    appraiseEvent(tx, deps, { ...event, valence: 0.8, stakes: "high" }, now),
  );
  const episode = (await deps.core.memory.get(out.episodeId))!;
  expect(episode).toMatchObject({
    kind: "episode",
    valence: 0.8,
    status: "open",
    source: "world",
    source_ref: `world_event:${event.worldEventId}`,
  });
  const after = (await deps.core.state.get())!;
  expect(after.mood_valence).toBeGreaterThan(before.mood_valence);
  expect(after.preoccupation).toBe(out.episodeId);
  expect(out.intentionId).toBeNull();
});

test("the episode is dated at the event; the event is marked as appraised", async () => {
  const { deps, event } = await setup();
  const at = new Date(now.getTime() - 3_600_000);
  const out = await deps.core.transaction((tx) =>
    appraiseEvent(tx, deps, { ...event, at, valence: 0.1, stakes: "low" }, now),
  );
  const episode = (await deps.core.memory.get(out.episodeId))!;
  expect(episode.occurred_at?.getTime()).toBe(at.getTime());
  expect(episode.created_at.getTime()).toBe(now.getTime());
  const [stored] = await deps.core.world.events("2026-01-05");
  expect(stored!.appraised_at?.getTime()).toBe(now.getTime());
  expect(await deps.core.world.dueUnappraised(now)).toEqual([]);
});

test("a mild low-stakes event is a resolved episode and leaves her preoccupation alone", async () => {
  const { deps, event } = await setup();
  const other = await addIntention(deps, null);
  await deps.core.state.update({ preoccupation: other, preoccupation_since: earlier });
  const out = await deps.core.transaction((tx) =>
    appraiseEvent(tx, deps, { ...event, valence: 0.1, stakes: "low" }, now),
  );
  expect((await deps.core.memory.get(out.episodeId))!.status).toBe("resolved");
  expect((await deps.core.state.get())!.preoccupation).toBe(other);
});

test("the plan it fulfils is resolved", async () => {
  const { deps, event } = await setup();
  const intention = await addIntention(deps, event.worldEventId);
  const out = await deps.core.transaction((tx) =>
    appraiseEvent(tx, deps, { ...event, valence: 0.1, stakes: "low" }, now),
  );
  expect(out.intentionId).toBe(intention);
  expect((await deps.core.memory.get(intention))!.status).toBe("resolved");
});

test("a preoccupation on the plan moves to a strong episode", async () => {
  const { deps, event } = await setup();
  const intention = await addIntention(deps, event.worldEventId);
  await deps.core.state.update({ preoccupation: intention, preoccupation_since: earlier });
  const out = await deps.core.transaction((tx) =>
    appraiseEvent(tx, deps, { ...event, valence: 0.8, stakes: "high" }, now),
  );
  const state = (await deps.core.state.get())!;
  expect(state.preoccupation).toBe(out.episodeId);
  expect(state.preoccupation_since?.getTime()).toBe(now.getTime());
});

test("a preoccupation on the plan is let go when the episode itself is mild", async () => {
  const { deps, event } = await setup();
  const intention = await addIntention(deps, event.worldEventId);
  await deps.core.state.update({ preoccupation: intention, preoccupation_since: earlier });
  await deps.core.transaction((tx) =>
    appraiseEvent(tx, deps, { ...event, valence: 0.1, stakes: "low" }, now),
  );
  const state = (await deps.core.state.get())!;
  expect(state.preoccupation).toBeNull();
  expect(state.preoccupation_since).toBeNull();
});
