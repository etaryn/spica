/**
 * The core data layer against Postgres: memory, people, snapshots, state and world, with no user id
 * anywhere.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { createCoreLayer } from "@/db/repos/core";
import { closeTestDb, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T09:00:00Z");
const core = () => createCoreLayer(getTestDb());

const episode = (content: string, fill: number, at: Date) => ({
  kind: "episode" as const,
  content,
  embedding: vec(fill),
  occurred_at: at,
  created_at: at,
  status: "resolved" as const,
  salience: 0.4,
  valence: 0.2,
  confidence: 1,
  source: "world" as const,
  source_ref: null,
});

test("memory round-trips and ranks candidates", async () => {
  const id = await core().memory.insert(episode("She reread Dune.", 0.01, now));
  expect((await core().memory.get(id))?.content).toBe("She reread Dune.");
  const cands = await core().memory.candidates(vec(0.01), 5);
  expect(cands[0]).toMatchObject({ id, entity_salience: 1 });
  expect(cands[0]!.sim).toBeGreaterThan(0.99);
});

test("near skips superseded memories and respects the threshold", async () => {
  await core().memory.insert({ ...episode("old", 0.01, now), status: "superseded" });
  const live = await core().memory.insert(episode("live", 0.01, now));
  const near = await core().memory.near(vec(0.01), 5, 0.9);
  expect(near.map((n) => n.id)).toEqual([live]);
});

test("recentEpisodes is a half-open window, oldest first", async () => {
  const h = 3_600_000;
  const a = await core().memory.insert(episode("a", 0.01, new Date(now.getTime() - 2 * h)));
  const b = await core().memory.insert(episode("b", 0.01, new Date(now.getTime() - h)));
  await core().memory.insert(episode("future", 0.01, new Date(now.getTime() + h)));
  const got = await core().memory.recentEpisodes(new Date(now.getTime() - 3 * h), now, 10);
  expect(got.map((e) => e.id)).toEqual([a, b]);
});

test("entities are added once and keep their first_seen", async () => {
  const [alcor] = await core().memory.addEntities(["Alcor"], 0.8, now);
  const later = new Date(now.getTime() + 1000);
  const [again, mira] = await core().memory.addEntities(["alcor", "Mira"], 0.5, later);
  expect(again).toBe(alcor);
  expect(mira).not.toBe(alcor);
  expect((await core().memory.latestEntityFirstSeen([]))?.getTime()).toBe(later.getTime());
  expect((await core().memory.latestEntityFirstSeen([" MIRA "]))?.getTime()).toBe(now.getTime());
});

test("snapshots: latest wins, a duplicate version is refused", async () => {
  const s = {
    version: 0,
    content: "seed",
    sections: {},
    source_ids: [],
    rendered_at: now,
    model: "seed",
    prompt_version: "v3",
  };
  expect(await core().memory.insertSnapshot(s)).toBe(true);
  expect(await core().memory.insertSnapshot(s)).toBe(false);
  expect(await core().memory.insertSnapshot({ ...s, version: 1, content: "next" })).toBe(true);
  expect((await core().memory.latestSnapshot())?.content).toBe("next");
});

test("state: ensure, lock and update inside a transaction", async () => {
  const layer = core();
  await layer.state.ensure(
    { mood_valence: 0.2, mood_arousal: 0.4, energy: 0.6 },
    { autonomy: 0.6, competence: 0.6 },
  );
  await layer.state.ensure(
    { mood_valence: -1, mood_arousal: 0, energy: 0 },
    { autonomy: 0.6, competence: 0.6 },
  );
  await layer.transaction(async (tx) => {
    const row = await tx.state.lock();
    expect(row.mood_valence).toBeCloseTo(0.2);
    await tx.state.update({ energy: 0.3, last_event_day: "2026-01-05" });
  });
  expect(await layer.state.get()).toMatchObject({ energy: 0.3, last_event_day: "2026-01-05" });
});

test("a failed transaction writes nothing", async () => {
  const layer = core();
  await expect(
    layer.transaction(async (tx) => {
      await tx.memory.insert(episode("doomed", 0.01, now));
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(await layer.memory.candidates(vec(0.01), 5)).toEqual([]);
});

test("world events and the high-stakes clock", async () => {
  const w = core().world;
  await w.recordEvent({
    at: now,
    kind: "planned",
    content: "x",
    valence: 0.5,
    stakes: "high",
    agents: [],
    life_day: "2026-01-05",
    created_at: now,
  });
  expect((await w.events("2026-01-05")).map((e) => e.content)).toEqual(["x"]);
  expect((await w.lastHighStakesAt())?.getTime()).toBe(now.getTime());
});

const intention = (content: string, status: "open" | "resolved", at: Date, ref: string | null) => ({
  ...episode(content, 0.01, at),
  kind: "intention" as const,
  status,
  source_ref: ref,
});

test("a resolved intention is no ranking candidate; an open one is", async () => {
  const open = await core().memory.insert(intention("thinking of Solaris", "open", now, null));
  await core().memory.insert(intention("dreading the call", "resolved", now, null));
  const ep = await core().memory.insert({ ...episode("done", 0.01, now), status: "resolved" });
  const ids = (await core().memory.candidates(vec(0.01), 10)).map((c) => c.id).sort();
  expect(ids).toEqual([open, ep].sort());
});

test("openIntentions: open intentions created in the window, oldest first", async () => {
  const h = 3_600_000;
  const a = await core().memory.insert(
    intention("a", "open", new Date(now.getTime() - 2 * h), null),
  );
  const b = await core().memory.insert(intention("b", "open", now, null));
  await core().memory.insert(intention("resolved", "resolved", now, null));
  await core().memory.insert(intention("too old", "open", new Date(now.getTime() - 9 * h), null));
  await core().memory.insert(episode("an episode", 0.01, now));
  const got = await core().memory.openIntentions(new Date(now.getTime() - 3 * h), now, 10);
  expect(got.map((m) => m.id)).toEqual([a, b]);
});

test("bySourceRef finds a memory of a kind by its source; setStatus moves it", async () => {
  const id = await core().memory.insert(intention("plan", "open", now, "world_event:abc"));
  await core().memory.insert(episode("other", 0.01, now));
  expect((await core().memory.bySourceRef("intention", "world_event:abc"))?.id).toBe(id);
  expect(await core().memory.bySourceRef("episode", "world_event:abc")).toBeNull();
  await core().memory.setStatus(id, "resolved");
  expect((await core().memory.get(id))?.status).toBe("resolved");
});

test("due unappraised world events: at or before now, oldest first, until marked", async () => {
  const w = core().world;
  const h = 3_600_000;
  const ev = (content: string, at: Date) =>
    w.recordEvent({
      at,
      kind: "surprise",
      content,
      valence: 0.1,
      stakes: "low",
      agents: [],
      life_day: "2026-01-05",
      created_at: new Date(now.getTime() - 9 * h),
    });
  const later = await ev("later", new Date(now.getTime() - h));
  const earlier = await ev("earlier", new Date(now.getTime() - 2 * h));
  await ev("future", new Date(now.getTime() + h));
  const due = await w.dueUnappraised(now);
  expect(due.map((e) => e.id)).toEqual([earlier, later]);
  expect(due[0]!.appraised_at).toBeNull();
  await w.markAppraised(earlier, now);
  expect((await w.dueUnappraised(now)).map((e) => e.id)).toEqual([later]);
  const stored = (await w.events("2026-01-05")).find((e) => e.id === earlier)!;
  expect(stored.appraised_at?.getTime()).toBe(now.getTime());
});

test("the world stores plans and reads the ones before a day, oldest first", async () => {
  const deps = makeTestDeps();
  const plan = { blocks: [] };
  const row = (date: string) => ({
    date,
    plan,
    source: "model" as const,
    model: "m",
    prompt_version: "v1",
    generated_at: new Date("2026-01-01T00:00:00Z"),
  });
  expect(await deps.core.world.insertPlan(row("2026-01-04"))).toBe(true);
  expect(await deps.core.world.insertPlan(row("2026-01-04"))).toBe(false);
  await deps.core.world.insertPlan(row("2026-01-02"));
  await deps.core.world.insertPlan(row("2026-01-03"));
  expect((await deps.core.world.plansBefore("2026-01-04", 2)).map((p) => p.date)).toEqual([
    "2026-01-02",
    "2026-01-03",
  ]);
  expect(await deps.core.world.plansBefore("2026-01-04", 0)).toEqual([]);
});
