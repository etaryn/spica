import { afterAll, beforeEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { loadCandidateInputs, loadGateInputs } from "@/mind/process/outreach/inputs";
import { insertFact } from "@/db/repos/user/facts";
import { insertLifeDay } from "@/db/repos/world/life-day";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertReachOutLog } from "@/db/repos/user/reach-out";
import { insertThread } from "@/db/repos/user/threads";
import { insertTurn } from "@/db/repos/user/session-log";
import { relationship, conversation_state, user } from "@/db/schema";
import { closeTestDb, createTestUser, resetDb, vec, seedStageFor } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const H = 3_600_000;
const now = new Date("2026-01-10T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * H);
const fact = (o: Partial<Parameters<typeof insertFact>[2]>) => ({
  subject: "user" as const,
  kind: "event" as const,
  content: "x",
  embedding: vec(),
  created_at: ago(100),
  status: "open" as const,
  salience: 0.6,
  valence: 0,
  confidence: 1,
  source: "turn" as const,
  ...o,
});

async function setup(overrides: unknown = {}) {
  const deps = makeTestDeps({
    life: { timezone: "UTC" },
    ...(overrides as object),
  });
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, ago(200), deps.config.relationship);
  return { deps, u };
}

test("user events: passed within the lookback, open, not recalled since, sensitivity carried", async () => {
  const { deps, u } = await setup();
  const hit = await insertFact(
    deps.db,
    u,
    fact({ content: "The user ran a race.", occurred_at: ago(10) }),
  );
  await insertFact(
    deps.db,
    u,
    fact({ content: "future", occurred_at: new Date(now.getTime() + H) }),
  );
  await insertFact(deps.db, u, fact({ content: "too old", occurred_at: ago(80) }));
  await insertFact(
    deps.db,
    u,
    fact({ content: "talked about", occurred_at: ago(10), last_recalled_at: ago(5) }),
  );
  await insertFact(deps.db, u, fact({ content: "a trait", kind: "trait", occurred_at: ago(10) }));
  const sens = await insertFact(
    deps.db,
    u,
    fact({ content: "hospital", occurred_at: ago(3), payload: { sensitive: true } }),
  );
  const i = await loadCandidateInputs(deps, u, now);
  expect(i.userEvents.map((e) => [e.id, e.sensitive]).sort()).toEqual(
    [
      [hit.id, false],
      [sens.id, true],
    ].sort(),
  );
});

test("user events: a fact attached to a thread is left to the thread", async () => {
  const { deps, u } = await setup();
  const t = await insertThread(
    deps.db,
    u,
    {
      title: "interview",
      subject: "user",
      stakes: "high",
      next_checkpoint: new Date(now.getTime() + 4 * H),
    },
    ago(50),
  );
  await insertFact(
    deps.db,
    u,
    fact({ content: "The user had an interview at Canva.", occurred_at: ago(2), thread_id: t.id }),
  );
  const free = await insertFact(
    deps.db,
    u,
    fact({ content: "The user ran a race.", occurred_at: ago(2) }),
  );
  const i = await loadCandidateInputs(deps, u, now);
  expect(i.userEvents.map((e) => e.id)).toEqual([free.id]);
});

test("her day: her core episodes within the lookback, plus her preoccupation; never sensitive", async () => {
  const { deps, u } = await setup();
  const episode = (content: string, occurred_at: Date, status: "open" | "resolved" = "resolved") =>
    deps.core.memory.insert({
      kind: "episode",
      content,
      embedding: vec(),
      occurred_at,
      created_at: occurred_at,
      status,
      salience: 0.6,
      valence: 0.2,
      confidence: 1,
      source: "world",
      source_ref: null,
    });
  const ev = await episode("Spica finished Solaris.", ago(2));
  await episode("too old", ago(80));
  await episode("later", new Date(now.getTime() + H));
  const pre = await episode("Spica keeps thinking about Alcor.", ago(100), "open");
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  await deps.core.state.update({ preoccupation: pre, preoccupation_since: ago(100) });
  // A user's own self fact is never her day: her day comes only from her core memory.
  await insertFact(
    deps.db,
    u,
    fact({ subject: "self", content: "Spica told them about a film.", occurred_at: ago(1) }),
  );
  const herDay = (await loadCandidateInputs(deps, u, now)).herDay;
  expect(herDay.map((f) => f.id).sort()).toEqual([ev, pre].sort());
  expect(herDay.every((f) => !f.sensitive)).toBe(true);
});

test("her day: open intentions within the lookback are news; resolved or old ones aren't", async () => {
  const { deps, u } = await setup();
  const intention = (content: string, created_at: Date, status: "open" | "resolved") =>
    deps.core.memory.insert({
      kind: "intention",
      content,
      embedding: vec(),
      occurred_at: created_at,
      created_at,
      status,
      salience: 0.4,
      valence: 0.6,
      confidence: 1,
      source: "world",
      source_ref: null,
    });
  const open = await intention("Spica is dreading the call with Alcor.", ago(3), "open");
  await intention("Spica was thinking of Solaris.", ago(2), "resolved");
  await intention("Spica meant to go stargazing.", ago(80), "open");
  const done = await intention("Spica is counting down to the images.", ago(100), "resolved");
  await deps.core.state.ensure(deps.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  // A plan that has happened stays out even as her preoccupation.
  await deps.core.state.update({ preoccupation: done, preoccupation_since: ago(100) });
  const herDay = (await loadCandidateInputs(deps, u, now)).herDay;
  expect(herDay.map((f) => f.id)).toEqual([open]);
});

test("core thoughts and live user ideas feed the candidates; a stale idea is absent", async () => {
  const { deps, u } = await setup();
  const idea = await insertFact(
    deps.db,
    u,
    fact({ kind: "idea", content: "Ask about the audition.", created_at: ago(2) }),
  );
  await insertFact(deps.db, u, fact({ kind: "idea", content: "stale", created_at: ago(24 * 30) }));
  const thought = await deps.core.memory.insert({
    kind: "thought",
    content: "Spica keeps thinking about tides.",
    embedding: vec(),
    occurred_at: ago(3),
    created_at: ago(3),
    status: "open",
    salience: 0.4,
    valence: 0,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
  const got = await loadCandidateInputs(deps, u, now);
  expect(got.userIdeas.map((x) => x.id)).toEqual([idea.id]);
  expect(got.coreThoughts.map((x) => x.id)).toEqual([thought]);
});

test("due threads carry stakes and the latest fact's sensitivity; make-up carries faded hurt and cause", async () => {
  const { deps, u } = await setup();
  const t = await insertThread(
    deps.db,
    u,
    { title: "interview", subject: "user", stakes: "high", next_checkpoint: ago(1) },
    ago(50),
  );
  await insertFact(
    deps.db,
    u,
    fact({ content: "interview at Canva", thread_id: t.id, payload: { sensitive: true } }),
  );
  const cause = await insertFact(
    deps.db,
    u,
    fact({
      subject: "self",
      kind: "feeling",
      content: "They called her useless.",
      source: "inferred",
    }),
  );
  await deps.db
    .update(relationship)
    .set({ make_up_state: "due", hurt_cause_fact: cause.id, last_hurt_at: ago(2) })
    .where(eq(relationship.user_id, u));
  const i = await loadCandidateInputs(deps, u, now);
  expect(i.dueThreads).toMatchObject([{ id: t.id, stakes: "high", sensitive: true }]);
  expect(i.makeUp).toMatchObject({
    due: true,
    causeFactId: cause.id,
    causeText: "They called her useless.",
  });
});

test("check-in inputs and used topics", async () => {
  const { deps, u } = await setup();
  await deps.db
    .update(relationship)
    .set({
      last_contact: ago(30),
      cadence: { msgs_24h: 0, msgs_7d: 0, median_gap_hours: 12, active_hours: [] },
    })
    .where(eq(relationship.user_id, u));
  await insertReachOutLog(deps.db, u, {
    candidates: [],
    winner: null,
    gate_results: [],
    status: "sent",
    topic: "fact:a",
    send_at: ago(40),
    created_at: ago(40),
  });
  const i = await loadCandidateInputs(deps, u, now);
  expect(i.checkIn).toEqual({ lastContact: ago(30), medianGapHours: 12 });
  expect(i.usedTopics).toEqual(["fact:a"]);
});

test("gate inputs: her block on her clock, sent times, in-progress, crisis, unanswered", async () => {
  const { deps, u } = await setup();
  await insertLifeDay(deps.db, {
    date: "2026-01-10",
    source: "scripted",
    model: "none",
    prompt_version: "scripted",
    generated_at: ago(12),
    plan: { blocks: [{ start: "11:00", end: "13:00", kind: "busy", busy: 0.8, label: "film" }] },
  });
  await deps.db
    .update(relationship)
    .set({ unanswered_reach_outs: 1, crisis_quiet_until: ago(-1) })
    .where(eq(relationship.user_id, u));
  await insertReachOutLog(deps.db, u, {
    candidates: [],
    winner: null,
    gate_results: [],
    status: "sent",
    topic: "x",
    send_at: ago(30),
    created_at: ago(30),
  });
  await deps.db.insert(conversation_state).values({
    user_id: u,
    updated_at: now,
    buffer_turn_ids: ["00000000-0000-0000-0000-000000000001"],
  });
  const g = await loadGateInputs(deps, u, now);
  expect(g).toMatchObject({
    status: "active",
    unanswered: 1,
    inProgress: true,
    herBlock: { block: "busy", label: "film" },
    sentAt: [ago(30)],
  });
  expect(g!.crisisQuietUntil).toEqual(ago(-1));
});

test("I2: a safety-flagged turn inside crisis_quiet_hours opens the crisis window before the cold path sets it", async () => {
  const { deps, u } = await setup();
  const hours = deps.config.relationship.crisis_quiet_hours;
  const flag = { flagged: true, category: "self_harm" as const, source: "classifier" as const };
  const turn = (at: Date, safety_flag: typeof flag | null) =>
    insertTurn(deps.db, u, {
      id: randomUUID(),
      session_id: randomUUID(),
      role: "companion",
      text: "x",
      created_at: at,
      safety_flag,
    });
  await turn(ago(hours + 1), flag); // too old: outside the window
  await turn(ago(0.5), null); // unflagged
  expect((await loadGateInputs(deps, u, now))!.crisisQuietUntil).toBeNull();

  await turn(ago(2), flag);
  expect((await loadGateInputs(deps, u, now))!.crisisQuietUntil).toEqual(
    new Date(ago(2).getTime() + hours * H),
  );
  // The later of the stored value and the flagged turn's window wins.
  await deps.db
    .update(relationship)
    .set({ crisis_quiet_until: ago(-hours) })
    .where(eq(relationship.user_id, u));
  expect((await loadGateInputs(deps, u, now))!.crisisQuietUntil).toEqual(ago(-hours));
  await deps.db
    .update(relationship)
    .set({ crisis_quiet_until: ago(-1) })
    .where(eq(relationship.user_id, u));
  expect((await loadGateInputs(deps, u, now))!.crisisQuietUntil).toEqual(
    new Date(ago(2).getTime() + hours * H),
  );
});

test("gate inputs are null without a relationship row", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  expect(await loadGateInputs(deps, u, now)).toBeNull();
});

test("her depth limit for writing first is her usual one: a stranger 1, a close friend 3", async () => {
  const deps = makeTestDeps();
  const stranger = await createTestUser();
  expect((await loadCandidateInputs(deps, stranger, now)).depthLimit).toBe(1);
  const close = await createTestUser();
  await ensureRelationship(deps.db, close, now, deps.config.relationship);
  await deps.db.execute(
    sql`UPDATE relationship_param SET value = 0.8 WHERE user_id = ${close} AND name IN ('closeness', 'user_disclosure')`,
  );
  await seedStageFor(deps.db, close, 0.8);
  expect((await loadCandidateInputs(deps, close, now)).depthLimit).toBe(3);
});

test("no make-up reach-out while their ending is pending: she lets go, she doesn't chase", async () => {
  const { deps, u } = await setup();
  await deps.db
    .update(relationship)
    .set({ make_up_state: "due", last_hurt_at: ago(2), end_pending_since: ago(2) })
    .where(eq(relationship.user_id, u));
  expect((await loadCandidateInputs(deps, u, now)).makeUp.due).toBe(false);
});

async function herEpisode(
  deps: ReturnType<typeof makeTestDeps>,
  o: { content: string; depth: number; source_ref: string | null; kind?: "episode" | "intention" },
) {
  return deps.core.memory.insert({
    kind: o.kind ?? "episode",
    content: o.content,
    embedding: vec(),
    occurred_at: ago(2),
    created_at: ago(2),
    status: o.kind === "intention" ? "open" : "resolved",
    salience: 0.4,
    valence: 0.3,
    confidence: 1,
    source: "world",
    source_ref: o.source_ref,
    depth: o.depth,
  });
}

test("a too-deep episode from a world event falls back to the plain event at depth 1", async () => {
  const { deps, u } = await setup();
  const wid = await deps.core.world.recordEvent({
    at: ago(2),
    kind: "planned",
    content: "Spica went to the film club screening of Stalker.",
    valence: 0.5,
    stakes: "low",
    agents: [],
    life_day: "2026-01-10",
    created_at: ago(30),
  });
  const id = await herEpisode(deps, {
    content: "Spica watched Stalker and felt something loosen in her chest.",
    depth: 2,
    source_ref: `world_event:${wid}`,
  });
  const inputs = await loadCandidateInputs(deps, u, now);
  expect(inputs.depthLimit).toBe(1);
  expect(inputs.herDay).toEqual([
    {
      id,
      content: "Spica went to the film club screening of Stalker.",
      salience: 0.4,
      depth: 1,
      sensitive: false,
      at: ago(2),
    },
  ]);
});

test("a too-deep loop memory with no world event stays too deep", async () => {
  const { deps, u } = await setup();
  const id = await herEpisode(deps, {
    content: "Spica wants to stop hiding how lonely the nights get.",
    depth: 2,
    source_ref: "core_reflect:x",
    kind: "intention",
  });
  const [m] = (await loadCandidateInputs(deps, u, now)).herDay;
  expect(m).toMatchObject({
    id,
    content: "Spica wants to stop hiding how lonely the nights get.",
    depth: 2,
  });
});

test("their hour is read in their timezone, UTC when they have none or a bad one", async () => {
  const { deps, u } = await setup();
  expect((await loadGateInputs(deps, u, now))!.theirHour).toBe(12); // null timezone → UTC
  await deps.db.update(user).set({ timezone: "America/New_York" }).where(eq(user.id, u));
  expect((await loadGateInputs(deps, u, now))!.theirHour).toBe(7);
  await deps.db.update(user).set({ timezone: "Mars/Olympus" }).where(eq(user.id, u));
  expect((await loadGateInputs(deps, u, now))!.theirHour).toBe(12);
});
