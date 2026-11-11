/**
 * Appraisal at the event's time: it becomes an episode in her core memory, moves her mood, a strong
 * one takes over her mind, the plan it fulfils is resolved, and the event is marked as landed.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { applyAppraisal, codeAppraisal, type LandingEvent } from "@/mind/process/core/appraise";
import { baselineNeeds } from "@/mind/state/core/core-state";
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
  agents: [],
  kind: "planned" as const,
  valence: 0.8,
  stakes: "high" as const,
  goalRef: null,
};

async function setup() {
  const deps = makeTestDeps();
  await deps.core.state.ensure(
    deps.config.core.state.baseline,
    baselineNeeds(deps.config.core.state),
  );
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
  return { deps, event: { ...base, worldEventId: wid } satisfies LandingEvent };
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
    applyAppraisal(
      tx,
      deps,
      { ...event, valence: 0.8, stakes: "high" },
      codeAppraisal({ ...event, valence: 0.8, stakes: "high" }, deps.config.core),
      vec(0.01),
      now,
    ),
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
    applyAppraisal(
      tx,
      deps,
      { ...event, at, valence: 0.1, stakes: "low" },
      codeAppraisal({ ...event, at, valence: 0.1, stakes: "low" }, deps.config.core),
      vec(0.01),
      now,
    ),
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
    applyAppraisal(
      tx,
      deps,
      { ...event, valence: 0.1, stakes: "low" },
      codeAppraisal({ ...event, valence: 0.1, stakes: "low" }, deps.config.core),
      vec(0.01),
      now,
    ),
  );
  expect((await deps.core.memory.get(out.episodeId))!.status).toBe("resolved");
  expect((await deps.core.state.get())!.preoccupation).toBe(other);
});

test("the plan it fulfils is resolved", async () => {
  const { deps, event } = await setup();
  const intention = await addIntention(deps, event.worldEventId);
  const out = await deps.core.transaction((tx) =>
    applyAppraisal(
      tx,
      deps,
      { ...event, valence: 0.1, stakes: "low" },
      codeAppraisal({ ...event, valence: 0.1, stakes: "low" }, deps.config.core),
      vec(0.01),
      now,
    ),
  );
  expect(out.intentionId).toBe(intention);
  expect((await deps.core.memory.get(intention))!.status).toBe("resolved");
});

test("a preoccupation on the plan moves to a strong episode", async () => {
  const { deps, event } = await setup();
  const intention = await addIntention(deps, event.worldEventId);
  await deps.core.state.update({ preoccupation: intention, preoccupation_since: earlier });
  const out = await deps.core.transaction((tx) =>
    applyAppraisal(
      tx,
      deps,
      { ...event, valence: 0.8, stakes: "high" },
      codeAppraisal({ ...event, valence: 0.8, stakes: "high" }, deps.config.core),
      vec(0.01),
      now,
    ),
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
    applyAppraisal(
      tx,
      deps,
      { ...event, valence: 0.1, stakes: "low" },
      codeAppraisal({ ...event, valence: 0.1, stakes: "low" }, deps.config.core),
      vec(0.01),
      now,
    ),
  );
  const state = (await deps.core.state.get())!;
  expect(state.preoccupation).toBeNull();
  expect(state.preoccupation_since).toBeNull();
});

test("the appraised feeling, needs and goal progress are applied, and a goal at 1 is done", async () => {
  const { deps, event } = await setup();
  const goal = await deps.core.goals.insert({
    title: "Finish the list",
    why: "w",
    status: "active",
    progress: 0.95,
    source: "seed",
    source_ref: null,
    started_at: earlier,
    target_at: null,
    embedding: vec(),
  });
  const appraisal = {
    source: "model" as const,
    episode: "Spica finished the last film on her list and sat with the credits.",
    emotion: { label: "proud", valence: 0.7, arousal: 0.4, phrase: "the list" },
    salience: 0.6,
    goalEffects: [{ goalId: goal, delta: 0.1 }],
    needEffects: { autonomy: 0, competence: 0.15 },
    depth: 2,
  };
  const before = (await deps.core.state.get())!;
  const out = await deps.core.transaction((tx) =>
    applyAppraisal(tx, deps, { ...event, valence: 0.1, stakes: "low" }, appraisal, vec(0.01), now),
  );
  expect((await deps.core.memory.get(out.episodeId))!).toMatchObject({
    content: appraisal.episode,
    valence: 0.7,
    salience: 0.6,
    payload: { appraisal_emotion: appraisal.emotion },
  });
  const state = (await deps.core.state.get())!;
  expect(state.emotion).toEqual({
    label: "proud",
    valence: 0.7,
    arousal: 0.4,
    phrase: "the list",
    about: out.episodeId,
    since: now.toISOString(),
  });
  expect(state.needs.competence).toBeCloseTo(before.needs.competence + 0.15);
  expect(state.preoccupation).toBe(out.episodeId);
  expect(await deps.core.goals.get(goal)).toMatchObject({ progress: 1, status: "done" });
  expect((await deps.core.world.events("2026-01-05"))[0]!.goal_ref).toBe(goal);
});

test("the episode keeps the appraisal's depth", async () => {
  const { deps, event } = await setup();
  const out = await deps.core.transaction((tx) =>
    applyAppraisal(
      tx,
      deps,
      event,
      { ...codeAppraisal(event, deps.config.core), depth: 3 },
      vec(0.01),
      now,
    ),
  );
  expect((await deps.core.memory.get(out.episodeId))!.depth).toBe(3);
});

test("appraisal moves her posts' goal but never completes it", async () => {
  const { deps, event } = await setup();
  const goal = await deps.core.goals.insert({
    title: deps.config.posts.goal,
    why: "w",
    status: "active",
    progress: 0.8,
    source: "seed",
    source_ref: null,
    started_at: earlier,
    target_at: null,
    embedding: vec(),
  });
  await deps.core.transaction((tx) =>
    applyAppraisal(
      tx,
      deps,
      { ...event, valence: 0.1, stakes: "low" },
      {
        source: "model" as const,
        episode: "Spica posted a picture of the Carina Nebula.",
        emotion: { label: "pleased", valence: 0.4, arousal: 0.3, phrase: null },
        salience: 0.4,
        goalEffects: [{ goalId: goal, delta: 0.3 }],
        needEffects: { autonomy: 0, competence: 0 },
        depth: 1,
      },
      vec(0.01),
      now,
    ),
  );
  expect(await deps.core.goals.get(goal)).toMatchObject({ progress: 1, status: "active" });
});

test("an episode keeps what its words cite as lineage", async () => {
  const { deps, event } = await setup();
  const a = { ...codeAppraisal(event, deps.config.core), cites: ["mem-1"] };
  const out = await deps.core.transaction((tx) =>
    applyAppraisal(tx, deps, event, a, vec(0.01), now),
  );
  expect((await deps.core.memory.get(out.episodeId))!.payload).toEqual({
    appraisal_emotion: a.emotion,
    cites: ["mem-1"],
  });
});
