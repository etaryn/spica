/**
 * The core data layer against Postgres: memory, people, snapshots, state and world, with no user id
 * anywhere.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { core_memory, core_snapshot } from "@/db/schema";
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

test("goal terminal transitions compete atomically and later appraisal updates cannot revive a dropped goal", async () => {
  const goals = core().goals;
  const id = await goals.insert({
    title: "Read",
    why: "Learn",
    status: "active",
    progress: 0.2,
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
    embedding: vec(),
  });
  const outcomes = await Promise.all([
    goals.setStatus(id, "done", now),
    goals.setStatus(id, "dropped", now),
  ]);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  const terminal = (await goals.get(id))!.status;
  expect(["done", "dropped"]).toContain(terminal);
  await goals.setProgress(id, 0.9, new Date(now.getTime() + 1000));
  await goals.setStatus(
    id,
    terminal === "done" ? "dropped" : "done",
    new Date(now.getTime() + 1000),
  );
  expect(await goals.get(id)).toMatchObject({ status: terminal, progress: 0.2 });
});

test("near skips superseded memories and respects the threshold", async () => {
  await core().memory.insert({ ...episode("old", 0.01, now), status: "superseded" });
  const live = await core().memory.insert(episode("live", 0.01, now));
  const near = await core().memory.near(vec(0.01), 5, 0.9);
  expect(near.map((n) => n.id)).toEqual([live]);
});

test("recentEpisodes is a half-open window, the newest few, oldest first", async () => {
  const h = 3_600_000;
  const a = await core().memory.insert(episode("a", 0.01, new Date(now.getTime() - 2 * h)));
  const b = await core().memory.insert(episode("b", 0.01, new Date(now.getTime() - h)));
  await core().memory.insert(episode("future", 0.01, new Date(now.getTime() + h)));
  const got = await core().memory.recentEpisodes(new Date(now.getTime() - 3 * h), now, 10);
  expect(got.map((e) => e.id)).toEqual([a, b]);
  const newest = await core().memory.recentEpisodes(new Date(now.getTime() - 3 * h), now, 1);
  expect(newest.map((e) => e.id)).toEqual([b]);
});

test("recentThoughts returns thoughts and ideas in the window, newest first", async () => {
  const h = 3_600_000;
  const at = (n: number) => new Date(now.getTime() - n * h);
  const m = (kind: "thought" | "idea" | "hypothetical" | "episode", n: number) =>
    core().memory.insert({ ...episode(`${kind}${n}`, 0.01, at(n)), kind });
  await m("thought", 5);
  const t = await m("thought", 2);
  const i = await m("idea", 1);
  await m("hypothetical", 1);
  await m("episode", 1);
  const got = await core().memory.recentThoughts(at(3), now, 10);
  expect(got.map((x) => x.id)).toEqual([i, t]);
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
    embedding: vec(),
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

test("nightly state records the claimed local day", async () => {
  const layer = core();
  await layer.state.ensure(
    { mood_valence: 0, mood_arousal: 0.4, energy: 0.6 },
    { autonomy: 0.6, competence: 0.6 },
  );
  expect((await layer.state.get())?.last_nightly_day).toBeNull();
  await layer.transaction(async (tx) => {
    await tx.state.update({ last_nightly_day: "2026-01-05" });
  });
  expect((await layer.state.get())?.last_nightly_day).toBe("2026-01-05");
});

test("reflect and snapshot context filter before deterministic limits", async () => {
  const memory = core().memory;
  await memory.insert({ ...episode("stale", 0.01, now), status: "stale" });
  await memory.insert({ ...episode("excluded", 0.01, now), kind: "hypothetical" });
  const boundary = await memory.insert(episode("boundary", 0.01, atHour(-1)));
  expect(await memory.markReflected([boundary], now)).toBe(1);
  await memory.insert(episode("future", 0.01, atHour(1)));
  const ids: string[] = [];
  for (const kind of ["episode", "thought", "idea"] as const) {
    ids.push(await memory.insert({ ...episode(kind, 0.01, now), kind }));
  }
  expect((await memory.reflectInputs(now, 2)).map((m) => m.id)).toEqual(ids.sort().slice(0, 2));
  expect(
    (await getTestDb().select().from(core_memory).where(eq(core_memory.id, boundary)))[0],
  ).toMatchObject({ reflected_at: now });
  const opinion = await memory.insert({
    ...episode("opinion", 0.01, now),
    kind: "opinion",
    salience: 0.8,
  });
  const interest = await memory.insert({ ...episode("interest", 0.01, now), kind: "interest" });
  await memory.insert({
    ...episode("old opinion", 0.01, now),
    kind: "opinion",
    status: "superseded",
  });
  expect((await memory.nearestActive(vec(), ["opinion", "interest"], 1)).map((m) => m.id)).toEqual(
    [opinion, interest].sort().slice(0, 1),
  );
  expect((await memory.activeByKind("opinion", 1)).map((m) => m.id)).toEqual([opinion]);
  expect(await memory.reflectInputs(now, 0)).toEqual([]);
  expect(await memory.nearestActive(vec(), [], 5)).toEqual([]);
  expect(await memory.latestNarrative()).toBeNull();
  const old = await memory.insert({ ...episode("old story", 0.01, atHour(-1)), kind: "narrative" });
  const next = await memory.insert({ ...episode("new story", 0.01, now), kind: "narrative" });
  expect((await memory.latestNarrative())?.id).toBe(next);
  await memory.supersede(old, next);
  expect(
    (await getTestDb().select().from(core_memory).where(eq(core_memory.id, old)))[0],
  ).toMatchObject({ status: "superseded", superseded_by: next });
  await memory.scaleSalience(opinion, 0.5);
  expect((await memory.get(opinion))?.salience).toBeCloseTo(0.4);
});

test("decay is atomic, inclusive at the stale floor, and only direct active-goal episodes are exempt", async () => {
  const layer = core();
  const old = atHour(-240);
  await layer.state.ensure(
    { mood_valence: 0, mood_arousal: 0.4, energy: 0.6 },
    { autonomy: 0.6, competence: 0.6 },
  );
  const goal = await layer.goals.insert({
    title: "Read",
    why: "curiosity",
    status: "active",
    progress: 0,
    embedding: vec(),
    source: "seed",
    source_ref: null,
    started_at: old,
    target_at: null,
  });
  const event = await layer.world.recordEvent({
    at: old,
    kind: "planned",
    content: "read",
    valence: 0,
    stakes: "low",
    agents: [],
    life_day: "2025-12-26",
    created_at: old,
    goal_ref: goal,
  });
  const preoccupation = await layer.memory.insert(episode("preoccupation", 0.01, old));
  await layer.state.update({ preoccupation });
  const exempt = [
    preoccupation,
    await layer.memory.insert({ ...episode("open", 0.01, old), kind: "intention", status: "open" }),
    await layer.memory.insert({ ...episode("narrative", 0.01, old), kind: "narrative" }),
    await layer.memory.insert({
      ...episode("goal episode", 0.01, old),
      source_ref: `world_event:${event}`,
    }),
  ];
  const indirect = await layer.memory.insert({
    ...episode("thought", 0.01, old),
    kind: "thought",
    source_ref: `world_event:${event}`,
  });
  const malformed = await layer.memory.insert({
    ...episode("bad link", 0.01, old),
    source_ref: "world_event:bad",
  });
  const stale = await layer.memory.insert({ ...episode("floor", 0.01, old), salience: 0.0625 });
  const recent = await layer.memory.insert(episode("recent", 0.01, now));
  const recalled = await layer.memory.insert(episode("recalled", 0.01, old));
  await layer.memory.reinforce(recalled, now, 0, 1);
  const oldNarrative = await layer.memory.insert({
    ...episode("old narrative", 0.01, atHour(-241)),
    kind: "narrative",
  });
  await expect(
    layer.transaction(async (tx) => {
      await tx.memory.decay(atHour(-72), 0.2, 0.0625 * (1 - 0.2 * (1 - 0.0625)));
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect((await layer.memory.get(indirect))?.salience).toBeCloseTo(0.4);
  expect(await layer.memory.decay(atHour(-72), 0.2, 0.0625 * (1 - 0.2 * (1 - 0.0625)))).toBe(4);
  for (const id of exempt) expect((await layer.memory.get(id))?.salience).toBeCloseTo(0.4);
  for (const id of [indirect, malformed, oldNarrative])
    expect((await layer.memory.get(id))?.salience).toBeCloseTo(0.4 * (1 - 0.2 * 0.6));
  expect((await layer.memory.get(stale))?.status).toBe("stale");
  for (const id of [recent, recalled])
    expect((await layer.memory.get(id))?.salience).toBeCloseTo(0.4);
});

test("gist groups follow local weeks, age and status; source damping happens once", async () => {
  const memory = core().memory;
  const early = new Date("2025-12-28T15:59:00Z"); // Sunday in Singapore
  const monday = new Date("2025-12-28T16:00:00Z");
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push(await memory.insert(episode(`week ${i}`, 0.01, monday)));
  await memory.insert(episode("previous week singleton", 0.01, early));
  await memory.insert(episode("age boundary", 0.01, new Date("2026-01-04T16:00:00Z")));
  await memory.insert({ ...episode("open", 0.01, monday), status: "open" });
  await memory.insert({ ...episode("gisted", 0.01, monday), payload: { gisted_into: "already" } });
  const groups = await memory.eligibleGistGroups("2026-01-05", "Asia/Singapore", 3, 1);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.week).toBe("2025-12-29");
  expect(groups[0]!.sources.map((m) => m.id)).toEqual(ids.sort());
  const gistId = await memory.insert({
    ...episode("gist", 0.01, monday),
    status: "recurring",
    payload: { gist_of: ids },
  });
  expect(
    await core().transaction((tx) =>
      tx.memory.gistSources(ids, gistId, 0.5, "2026-01-05", "Asia/Singapore", 3),
    ),
  ).toBe(true);
  expect(
    await core().transaction((tx) =>
      tx.memory.gistSources(ids, gistId, 0.5, "2026-01-05", "Asia/Singapore", 3),
    ),
  ).toBe(false);
  for (const id of ids)
    expect(await memory.get(id)).toMatchObject({
      content: expect.any(String),
      payload: { gisted_into: gistId },
      salience: expect.closeTo(0.2),
    });
  expect(await memory.eligibleGistGroups("2026-01-05", "Asia/Singapore", 3, 1)).toEqual([]);
});

test("snapshot history, self lines and drift share the core transaction and preserve old null embeddings", async () => {
  const layer = core();
  const snapshot = {
    version: 0,
    content: "seed",
    sections: {},
    source_ids: [],
    rendered_at: now,
    model: "seed",
    prompt_version: "v1",
  };
  await getTestDb().insert(core_snapshot).values(snapshot);
  expect((await layer.memory.snapshot(0))?.embedding).toBeNull();
  expect(await layer.memory.snapshot(9)).toBeNull();
  await layer.memory.backfillSnapshotEmbedding(0, vec());
  await layer.memory.backfillSnapshotEmbedding(0, vec(0.02));
  expect((await layer.memory.snapshot(0))?.embedding?.[0]).toBeCloseTo(0.01);
  const write = async (tx: import("@/mind/platform/core").CoreScope) => {
    await tx.memory.insertSnapshot({ ...snapshot, version: 1, embedding: vec() });
    await tx.memory.insertSelfLines([{ version: 1, text: "lately", embedding: vec() }]);
    await tx.drift.insert({
      version: 1,
      check: "diff",
      value: null,
      excerpt: null,
      verdict: null,
      score: null,
      created_at: now,
    });
  };
  await expect(
    layer.transaction(async (tx) => {
      await write(tx);
      throw new Error("rollback");
    }),
  ).rejects.toThrow("rollback");
  expect(await layer.memory.snapshot(1)).toBeNull();
  expect(await layer.memory.selfLines(1)).toEqual([]);
  expect(await layer.drift.forVersion(1)).toEqual([]);
  await layer.transaction(write);
  await layer.memory.insertSelfLines([{ version: null, text: "fixed value", embedding: vec() }]);
  expect(await layer.memory.selfLines(null)).toMatchObject([
    { text: "fixed value", version: null },
  ]);
  expect(await layer.memory.selfLines(1)).toMatchObject([{ text: "lately", version: 1 }]);
  expect(await layer.drift.forVersion(1)).toMatchObject([{ check: "diff", score: null }]);
  await expect(
    layer.memory.insertSelfLines([{ version: 99, text: "missing", embedding: vec() }]),
  ).rejects.toThrow();
  await expect(
    layer.drift.insert({
      version: 99,
      check: "trend",
      value: null,
      excerpt: null,
      verdict: null,
      score: null,
      created_at: now,
    }),
  ).rejects.toThrow();
  await getTestDb().delete(core_snapshot).where(eq(core_snapshot.version, 1));
  expect(await layer.memory.selfLines(1)).toEqual([]);
  expect(await layer.drift.forVersion(1)).toEqual([]);
  expect(await layer.memory.selfLines(null)).toHaveLength(1);
});

test("gist source rechecks refuse partial, mixed-week, duplicate and concurrent damping", async () => {
  const layer = core();
  const at = new Date("2025-12-29T00:00:00Z");
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push(await layer.memory.insert(episode(`source ${i}`, 0.01, at)));
  const other = await layer.memory.insert(
    episode("another week", 0.01, new Date("2025-12-22T00:00:00Z")),
  );
  const gistId = await layer.memory.insert({ ...episode("gist", 0.01, at), status: "recurring" });
  const apply = (sources: string[]) =>
    layer.memory.gistSources(sources, gistId, 0.5, "2026-01-05", "Asia/Singapore", 3);
  expect(await apply([ids[0]!, ids[1]!, other])).toBe(false);
  expect(await apply([ids[0]!, ids[0]!, ids[1]!])).toBe(false);
  await layer.memory.mergePayload(ids[0]!, { gisted_into: "prior", preserved: true });
  expect(await apply(ids)).toBe(false);
  expect((await layer.memory.get(ids[1]!))?.salience).toBeCloseTo(0.4);
  const clean = [ids[1]!, ids[2]!, await layer.memory.insert(episode("third clean", 0.01, at))];
  expect((await Promise.all([apply(clean), apply(clean)])).sort()).toEqual([false, true]);
  for (const id of clean) expect((await layer.memory.get(id))?.salience).toBeCloseTo(0.2);
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

test("resolution metadata round trips and target deletion nulls FK", async () => {
  const layer = core();
  const target = await layer.memory.insert(episode("unfinished", 0.01, now));
  const event = {
    at: now,
    kind: "resolution" as const,
    content: "changed plans",
    valence: -0.2,
    stakes: "low" as const,
    agents: [],
    life_day: "2026-01-05",
    created_at: now,
  };
  const original = await layer.world.recordEvent({ ...event, kind: "planned" });
  const goal = await layer.goals.insert({
    title: "Read",
    why: "Curiosity",
    status: "active",
    progress: 0,
    embedding: vec(),
    source: "seed",
    source_ref: null,
    started_at: now,
    target_at: null,
  });
  const id = await layer.world.recordEvent({
    ...event,
    plan_ref: original,
    goal_ref: goal,
    outcome: "happened",
    fallthrough: false,
    resolves_memory_id: target,
  });
  const metadata = {
    plan_ref: original,
    goal_ref: goal,
    outcome: "happened",
    fallthrough: false,
    resolves_memory_id: target,
  };
  expect((await layer.world.events("2026-01-05")).find((row) => row.id === id)).toMatchObject(
    metadata,
  );
  expect((await layer.world.dueUnappraised(now)).find((row) => row.id === id)).toMatchObject(
    metadata,
  );
  expect(await layer.world.getEvent(id)).toMatchObject(metadata);
  expect(await layer.world.getEvent(original)).toMatchObject({
    plan_ref: null,
    goal_ref: null,
    outcome: null,
    fallthrough: null,
    resolves_memory_id: null,
  });
  await layer.world.setOutcome(original, "fell_through");
  expect((await layer.world.getEvent(original))?.outcome).toBe("fell_through");
  await getTestDb().delete(core_memory).where(eq(core_memory.id, target));
  expect((await layer.world.getEvent(id))?.resolves_memory_id).toBeNull();
  expect(await layer.world.getEvent("00000000-0000-0000-0000-000000000000")).toBeNull();
});

const atHour = (hour: number) => new Date(now.getTime() + hour * 3_600_000);

async function plannedEventRef(at: Date): Promise<string> {
  const id = await core().world.recordEvent({
    at,
    kind: "planned",
    content: "A real upcoming plan",
    valence: 0.2,
    stakes: "low",
    agents: [],
    life_day: "2026-01-05",
    created_at: now,
  });
  return `world_event:${id}`;
}

test("a broken earliest event link does not hide a later valid anticipation", async () => {
  const layer = core();
  const memory = layer.memory;
  await memory.insert({
    ...intention("malformed link", "open", now, "world_event:missing"),
    payload: { event_at: atHour(1).toISOString() },
  });
  await memory.insert({
    ...intention("missing event", "open", now, "world_event:00000000-0000-4000-8000-000000000000"),
    payload: { event_at: atHour(2).toISOString() },
  });
  const valid = await memory.insert({
    ...intention("valid later plan", "open", now, await plannedEventRef(atHour(3))),
    payload: { event_at: atHour(3).toISOString() },
  });
  expect((await memory.anticipationCandidate(now, atHour(12)))?.id).toBe(valid);
});

test("anticipation candidate filters precede limit and timestamp/ID break ties", async () => {
  const memory = core().memory;
  for (const payload of [
    { event_at: now.toISOString() },
    { event_at: atHour(1).toISOString(), anticipated_at: now.toISOString() },
    { event_at: atHour(13).toISOString() },
  ])
    await memory.insert({ ...intention("ineligible", "open", atHour(-1), null), payload });
  await memory.insert({
    ...intention("resolved", "resolved", now, null),
    payload: { event_at: atHour(1).toISOString() },
  });
  const ids = [];
  const tiedEvent = await plannedEventRef(atHour(12));
  for (let i = 0; i < 2; i++)
    ids.push(
      await memory.insert({
        ...intention("next", "open", now, tiedEvent),
        payload: { event_at: atHour(12).toISOString() },
      }),
    );
  ids.sort();
  expect((await memory.anticipationCandidate(now, atHour(12)))?.id).toBe(ids[0]);
  await memory.setStatus(ids[0]!, "resolved");
  expect((await memory.anticipationCandidate(now, atHour(12)))?.id).toBe(ids[1]);
  const sooner = await memory.insert({
    ...intention("sooner", "open", now, await plannedEventRef(atHour(1))),
    payload: { event_at: "2026-01-05T18:00:00+08:00" },
  });
  expect((await memory.anticipationCandidate(now, atHour(12)))?.id).toBe(sooner);
});

test("rumination candidate filters precede limit and uses inclusive landing times", async () => {
  const memory = core().memory;
  for (const item of [
    { created_at: atHour(-25), valence: 0.9 },
    { created_at: atHour(-1), valence: 0.9 },
    { valence: 0.49 },
    { payload: { ruminated: 1 }, valence: 0.9 },
    { status: "stale" as const, valence: 0.9 },
    { status: "superseded" as const, valence: 0.9 },
    { kind: "thought" as const, valence: 0.9 },
  ])
    await memory.insert({ ...episode("ineligible", 0.01, atHour(-24)), ...item });
  const ids = [];
  for (let i = 0; i < 2; i++)
    ids.push(
      await memory.insert({
        ...episode("old landing", 0.01, atHour(-24)),
        occurred_at: atHour(-72),
        valence: -0.5,
      }),
    );
  ids.sort();
  const latest = await memory.insert({
    ...episode("recent landing", 0.01, atHour(-2)),
    valence: 0.5,
    payload: { ruminated: 0 },
  });
  expect((await memory.ruminationCandidate(atHour(-24), atHour(-2), 0.5, 1))?.id).toBe(ids[0]);
  await memory.setStatus(ids[0]!, "stale");
  expect((await memory.ruminationCandidate(atHour(-24), atHour(-2), 0.5, 1))?.id).toBe(ids[1]);
  await memory.setStatus(ids[1]!, "stale");
  expect((await memory.ruminationCandidate(atHour(-24), atHour(-2), 0.5, 1))?.id).toBe(latest);
  expect(await memory.ruminationCandidate(atHour(-24), atHour(-2), 0.5, 0)).toBeNull();
});

test("malformed payload is ineligible", async () => {
  const memory = core().memory;
  for (const payload of [
    null,
    [],
    "bad",
    7,
    {},
    { event_at: 1767607200000 },
    { event_at: [] },
    { event_at: "garbage" },
    { event_at: "2026-02-30T10:00:00Z" },
    { event_at: atHour(1).toISOString(), anticipated_at: null },
  ])
    await memory.insert({ ...intention("bad plan", "open", now, null), payload });
  for (const payload of [
    [],
    "bad",
    7,
    { ruminated: null },
    { ruminated: "0" },
    { ruminated: -1 },
    { ruminated: 0.5 },
    { ruminated: true },
    { ruminated: {} },
  ])
    await memory.insert({ ...episode("bad episode", 0.01, atHour(-3)), valence: 0.9, payload });
  expect(await memory.anticipationCandidate(now, atHour(2000))).toBeNull();
  expect(await memory.ruminationCandidate(atHour(-24), atHour(-2), 0.5, 1)).toBeNull();
});

test("dedupe can see hypotheticals while factual near retains resolved intention history", async () => {
  const memory = core().memory;
  const imagined = await memory.insert({ ...episode("imagined", 0.01, now), kind: "hypothetical" });
  const history = await memory.insert(intention("completed", "resolved", now, null));
  await memory.insert({ ...episode("stale", 0.01, now), status: "stale" });
  await memory.insert({ ...episode("superseded", 0.01, now), status: "superseded" });
  await memory.insert(episode("opposite", -0.01, now));
  expect((await memory.near(vec(), 10, 0.9)).map((m) => m.id)).toEqual([history]);
  const expected = [imagined, history].sort();
  expect((await memory.dedupeNear(vec(), 10, 0.9)).map((m) => m.id)).toEqual(expected);
  expect((await memory.dedupeNear(vec(), 1, 0.9)).map((m) => m.id)).toEqual([expected[0]]);
});

test("payload merges preserve other keys", async () => {
  const memory = core().memory;
  const id = await memory.insert({
    ...episode("payload", 0.01, now),
    payload: { emotion: { label: "joy" }, ruminated: 0 },
  });
  await memory.mergePayload(id, { ruminated: 1, marker: true });
  expect((await memory.get(id))?.payload).toEqual({
    emotion: { label: "joy" },
    ruminated: 1,
    marker: true,
  });
  const empty = await memory.insert(episode("empty", 0.01, now));
  await memory.mergePayload(empty, { ruminated: 1 });
  expect((await memory.get(empty))?.payload).toEqual({ ruminated: 1 });
});

test("reinforcement caps salience and increments recall count/time", async () => {
  const memory = core().memory;
  const id = await memory.insert({ ...episode("reinforce", 0.01, now), salience: 0.94 });
  await memory.reinforce(id, atHour(1), 0.03, 0.95);
  const reinforced = (await memory.get(id))!;
  expect(reinforced.salience).toBe(0.95);
  expect(reinforced.last_recalled_at).toEqual(atHour(1));
  expect(
    (await getTestDb().select().from(core_memory).where(eq(core_memory.id, id)))[0]?.recall_count,
  ).toBe(1);
  await memory.reinforce(id, atHour(2), 0.03, 0.95);
  expect((await memory.get(id))?.salience).toBe(0.95);
  expect(
    (await getTestDb().select().from(core_memory).where(eq(core_memory.id, id)))[0],
  ).toMatchObject({ recall_count: 2, last_recalled_at: atHour(2) });
});

test("appliedSummary excludes failed and race-loser traces in a half-open window", async () => {
  const traces = core().traces;
  expect(await traces.appliedSummary("core_wander", now, atHour(3))).toEqual({
    count: 0,
    latest: null,
  });
  for (const fields of [
    { created_at: atHour(-1) },
    { created_at: now },
    { created_at: atHour(2) },
    { created_at: atHour(3) },
    { status: "failed" as const },
    { status: "fallback" as const },
    { status: "skipped_budget" as const },
    { outputs: { applied: false } },
    { outputs: { applied: "true" } },
    { outputs: {} },
    { loop: "core_ruminate" },
  ])
    await traces.insert({
      loop: "core_wander",
      inputs: {},
      outputs: { applied: true },
      model: null,
      prompt_version: null,
      tokens_in: null,
      tokens_out: null,
      cost: null,
      calls: 0,
      status: "done",
      error: null,
      created_at: atHour(1),
      ...fields,
    });
  expect(await traces.appliedSummary("core_wander", now, atHour(3))).toEqual({
    count: 2,
    latest: atHour(2),
  });
  expect(await traces.appliedSummary("core_wander", atHour(-10), now)).toEqual({
    count: 1,
    latest: atHour(-1),
  });
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

test("candidates carry valence and goal_sim (0 without active goals)", async () => {
  await core().memory.insert({ ...episode("x", 0.01, now), valence: -0.4 });
  const [c] = await core().memory.candidates(vec(0.01), 5);
  expect(c).toMatchObject({ valence: -0.4, goal_sim: 0 });
});

const axis = (i: number) => Array.from({ length: 1024 }, (_, j) => (j === i ? 1 : 0));
const snapshot = (version: number) => ({
  version,
  content: `v${version}`,
  sections: {},
  source_ids: [],
  rendered_at: now,
  model: "m",
  prompt_version: "v1",
  embedding: axis(1),
});

test("groundingMatch: 0 with nothing; counts core values and only the latest snapshot's lines", async () => {
  const [a, b] = [axis(0), axis(1)];
  expect((await core().memory.groundingMatch(a)).similarity).toBe(0);

  await core().memory.insertSnapshot(snapshot(0));
  await core().memory.insertSelfLines([{ version: 0, text: "old line", embedding: a }]);
  expect((await core().memory.groundingMatch(a)).similarity).toBeCloseTo(1);

  await core().memory.insertSnapshot(snapshot(1));
  await core().memory.insertSelfLines([{ version: 1, text: "new line", embedding: b }]);
  // v0's line no longer counts once v1 exists.
  expect((await core().memory.groundingMatch(a)).similarity).toBeCloseTo(0);

  await core().memory.insertSelfLines([{ version: null, text: "a value", embedding: a }]);
  expect((await core().memory.groundingMatch(a)).similarity).toBeCloseTo(1);
});

test("groundingMatch ignores stale, superseded and hypothetical memory", async () => {
  const kinds = [
    ["episode", "stale"],
    ["episode", "superseded"],
    ["hypothetical", "open"],
    ["intention", "resolved"],
  ] as const;
  for (const [kind, status] of kinds)
    await core().memory.insert({ ...episode("x", 0, now), kind, status, embedding: axis(0) });
  expect((await core().memory.groundingMatch(axis(0))).similarity).toBe(0);
});

test("depth round-trips on memories, candidates and self lines; left out, the defaults apply", async () => {
  const deep = await core().memory.insert({
    ...episode("deep", 0.02, now),
    kind: "reflection",
    depth: 3,
  });
  expect((await core().memory.get(deep))!.depth).toBe(3);
  const cands = await core().memory.candidates(vec(0.02), 5);
  expect(cands.find((c) => c.id === deep)!.depth).toBe(3);
  const plain = await core().memory.insert(episode("plain", 0.03, now));
  expect((await core().memory.get(plain))!.depth).toBe(2);
  await core().memory.insertSelfLines([
    { version: null, text: "x", embedding: vec(0.04), depth: 2 },
    { version: null, text: "y", embedding: vec(0.05) },
  ]);
  const lines = await core().memory.selfLines(null);
  expect(lines.find((l) => l.text === "x")!.depth).toBe(2);
  expect(lines.find((l) => l.text === "y")!.depth).toBe(1);
});

test("groundingMatch names what it matched: a memory or a self line, with its depth", async () => {
  expect(await core().memory.groundingMatch(axis(0))).toEqual({ similarity: 0, ref: null });
  const id = await core().memory.insert({
    ...episode("scared", 0, now),
    kind: "reflection",
    status: "recurring",
    embedding: axis(0),
    depth: 3,
  });
  expect(await core().memory.groundingMatch(axis(0))).toEqual({
    similarity: expect.closeTo(1),
    ref: { kind: "memory", id, depth: 3 },
  });
  await core().memory.insertSelfLines([
    { version: null, text: "a value", embedding: axis(1), depth: 1 },
  ]);
  const line = (await core().memory.selfLines(null))[0]!;
  expect((await core().memory.groundingMatch(axis(1))).ref).toEqual({
    kind: "self_line",
    id: line.id,
    depth: 1,
  });
});

test("nearActive finds the closest active goal over the line, never a dropped one", async () => {
  const goals = core().goals;
  const row = (title: string, embedding: number[]) =>
    goals.insert({
      title,
      why: "x",
      status: "active",
      progress: 0,
      source: "reflect",
      source_ref: null,
      started_at: now,
      target_at: null,
      embedding,
    });
  const id = await row("Read", vec());
  expect(await goals.nearActive(vec(), 0.85)).toBe(id);
  const away = Array.from({ length: 1024 }, (_, i) => (i % 2 ? 0.01 : -0.01));
  expect(await goals.nearActive(away, 0.85)).toBeNull();
  await goals.setStatus(id, "dropped", now);
  expect(await goals.nearActive(vec(), 0.85)).toBeNull();
});

test("her memories and snapshots are stored exactly as written", async () => {
  const words = "Clear skies tonight, the screening on tuesday.";
  const id = await core().memory.insert(episode(words, 0.01, now));
  expect((await core().memory.get(id))!.content).toBe(words);
  await core().memory.insertSnapshot({
    version: 0,
    embedding: vec(),
    content: "### Lately\n- Telescope booking tonight.",
    sections: { Lately: "- Telescope booking tonight." },
    source_ids: [],
    rendered_at: now,
    model: "m",
    prompt_version: "v",
  });
  const snap = (await core().memory.latestSnapshot())!;
  expect(snap.content).toBe("### Lately\n- Telescope booking tonight.");
  expect(snap.sections.Lately).toBe("- Telescope booking tonight.");
});
