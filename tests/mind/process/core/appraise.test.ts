/**
 * Appraisal: an event becomes an episode in her core memory, moves her mood, and a strong one
 * takes over her mind.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { appraiseEvent } from "@/mind/process/core/appraise";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T09:00:00Z");
const base = {
  worldEventId: "00000000-0000-0000-0000-000000000001",
  content: "Spica got the telescope images.",
  at: now,
  embedding: vec(0.01),
  agents: [],
};

async function setup() {
  const deps = makeTestDeps();
  await deps.core.state.ensure(deps.config.core.state.baseline);
  const wid = await deps.core.world.recordEvent({
    at: now,
    kind: "planned",
    content: base.content,
    valence: 0.8,
    stakes: "high",
    agents: [],
    life_day: "2026-01-05",
    created_at: now,
  });
  return { deps, event: { ...base, worldEventId: wid } };
}

test("a strong event becomes an open episode, lifts her mood and takes her mind", async () => {
  const { deps, event } = await setup();
  const before = (await deps.core.state.get())!;
  const id = await deps.core.transaction((tx) =>
    appraiseEvent(tx, deps, { ...event, valence: 0.8, stakes: "high" }, now),
  );
  const episode = (await deps.core.memory.get(id))!;
  expect(episode).toMatchObject({
    kind: "episode",
    valence: 0.8,
    status: "open",
    source: "world",
    source_ref: `world_event:${event.worldEventId}`,
  });
  const after = (await deps.core.state.get())!;
  expect(after.mood_valence).toBeGreaterThan(before.mood_valence);
  expect(after.preoccupation).toBe(id);
});

test("a mild low-stakes event is a resolved episode and leaves her preoccupation alone", async () => {
  const { deps, event } = await setup();
  const id = await deps.core.transaction((tx) =>
    appraiseEvent(tx, deps, { ...event, valence: 0.1, stakes: "low" }, now),
  );
  expect((await deps.core.memory.get(id))!.status).toBe("resolved");
  expect((await deps.core.state.get())!.preoccupation).toBeNull();
});
