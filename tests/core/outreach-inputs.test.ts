import { afterAll, beforeEach, expect, test } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { loadCandidateInputs, loadGateInputs } from "@/core/outreach/inputs";
import { insertFact } from "@/db/repos/facts";
import { insertLifeDay } from "@/db/repos/life-day";
import { ensureRelationship } from "@/db/repos/relationship";
import { insertReachOutLog } from "@/db/repos/reach-out";
import { insertThread } from "@/db/repos/threads";
import { insertTurn } from "@/db/repos/session-log";
import { ensureIdentity, updateIdentity } from "@/db/repos/identity";
import { relationship, conversation_state } from "@/db/schema";
import { lifeTickUser } from "@/core/life/tick";
import { closeTestDb, createTestUser, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const H = 3_600_000;
const now = new Date("2026-01-10T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * H);
const fact = (o: Partial<Parameters<typeof insertFact>[2]>) => ({
  subject: "user" as const, kind: "event" as const, content: "x", embedding: vec(), created_at: ago(100),
  status: "open" as const, salience: 0.6, valence: 0, confidence: 1, source: "turn" as const, ...o,
});

async function setup(overrides: unknown = {}) {
  const deps = makeTestDeps({ life: { timezone: "UTC", events_per_day_max: 0 }, ...(overrides as object) });
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, ago(200), deps.config.relationship);
  return { deps, u };
}

test("user events: passed within the lookback, open, not recalled since, sensitivity carried", async () => {
  const { deps, u } = await setup();
  const hit = await insertFact(deps.db, u, fact({ content: "The user ran a race.", occurred_at: ago(10) }));
  await insertFact(deps.db, u, fact({ content: "future", occurred_at: new Date(now.getTime() + H) }));
  await insertFact(deps.db, u, fact({ content: "too old", occurred_at: ago(80) }));
  await insertFact(deps.db, u, fact({ content: "talked about", occurred_at: ago(10), last_recalled_at: ago(5) }));
  await insertFact(deps.db, u, fact({ content: "a trait", kind: "trait", occurred_at: ago(10) }));
  const sens = await insertFact(deps.db, u, fact({ content: "hospital", occurred_at: ago(3), payload: { sensitive: true } }));
  const i = await loadCandidateInputs(deps, u, now);
  expect(i.userEvents.map((e) => [e.id, e.sensitive]).sort()).toEqual([[hit.id, false], [sens.id, true]].sort());
});

test("user events: a fact attached to a thread is left to the thread (R10)", async () => {
  const { deps, u } = await setup();
  const t = await insertThread(deps.db, u, { title: "interview", subject: "user", stakes: "high", next_checkpoint: new Date(now.getTime() + 4 * H) }, ago(50));
  await insertFact(deps.db, u, fact({ content: "The user had an interview at Canva.", occurred_at: ago(2), thread_id: t.id }));
  const free = await insertFact(deps.db, u, fact({ content: "The user ran a race.", occurred_at: ago(2) }));
  const i = await loadCandidateInputs(deps, u, now);
  expect(i.userEvents.map((e) => e.id)).toEqual([free.id]);
});

test("her day: generated non-block self events that have happened, plus the preoccupation", async () => {
  const { deps, u } = await setup();
  const ev = await insertFact(deps.db, u, fact({ subject: "self", source: "generated", content: "Spica finished Solaris.", occurred_at: ago(2), payload: null }));
  await insertFact(deps.db, u, fact({ subject: "self", source: "generated", content: "Spica's morning: film.", occurred_at: ago(2), payload: { block: "busy" } }));
  await insertFact(deps.db, u, fact({ subject: "self", source: "generated", content: "later", occurred_at: new Date(now.getTime() + H) }));
  const pre = await insertFact(deps.db, u, fact({ subject: "self", source: "turn", content: "Spica keeps thinking about Alcor.", occurred_at: null }));
  await ensureIdentity(deps.db, u, deps.config.ego.baseline);
  await updateIdentity(deps.db, u, { preoccupation: pre.id });
  const ids = (await loadCandidateInputs(deps, u, now)).herDay.map((f) => f.id).sort();
  expect(ids).toEqual([ev.id, pre.id].sort());
});

test("due threads carry stakes and the latest fact's sensitivity; make-up carries faded hurt and cause", async () => {
  const { deps, u } = await setup();
  const t = await insertThread(deps.db, u, { title: "interview", subject: "user", stakes: "high", next_checkpoint: ago(1) }, ago(50));
  await insertFact(deps.db, u, fact({ content: "interview at Canva", thread_id: t.id, payload: { sensitive: true } }));
  const cause = await insertFact(deps.db, u, fact({ subject: "self", kind: "feeling", content: "They called her useless.", source: "inferred" }));
  await deps.db.update(relationship).set({ make_up_state: "due", hurt_cause_fact: cause.id, last_hurt_at: ago(2) }).where(eq(relationship.user_id, u));
  const i = await loadCandidateInputs(deps, u, now);
  expect(i.dueThreads).toMatchObject([{ id: t.id, stakes: "high", sensitive: true }]);
  expect(i.makeUp).toMatchObject({ due: true, causeFactId: cause.id, causeText: "They called her useless." });
});

test("check-in inputs and used topics", async () => {
  const { deps, u } = await setup();
  await deps.db.update(relationship).set({ last_contact: ago(30), cadence: { msgs_24h: 0, msgs_7d: 0, median_gap_hours: 12, active_hours: [] } }).where(eq(relationship.user_id, u));
  await insertReachOutLog(deps.db, u, { candidates: [], winner: null, gate_results: [], status: "sent", topic: "fact:a", send_at: ago(40), created_at: ago(40) });
  const i = await loadCandidateInputs(deps, u, now);
  expect(i.checkIn).toEqual({ lastContact: ago(30), medianGapHours: 12 });
  expect(i.usedTopics).toEqual(["fact:a"]);
});

test("gate inputs: her block on her clock, sent times, in-progress, crisis, unanswered", async () => {
  const { deps, u } = await setup();
  await insertLifeDay(deps.db, { date: "2026-01-10", source: "scripted", model: "none", prompt_version: "scripted", generated_at: ago(12),
    plan: { blocks: [{ start: "11:00", end: "13:00", kind: "busy", busy: 0.8, label: "film" }] } });
  await lifeTickUser(deps, u, ago(7)); // copies the blocks into her facts (UTC life zone, 05:00, after tick_local_hour 4)
  await deps.db.update(relationship).set({ unanswered_reach_outs: 1, crisis_quiet_until: ago(-1) }).where(eq(relationship.user_id, u));
  await insertReachOutLog(deps.db, u, { candidates: [], winner: null, gate_results: [], status: "sent", topic: "x", send_at: ago(30), created_at: ago(30) });
  await deps.db.insert(conversation_state).values({ user_id: u, updated_at: now, buffer_turn_ids: ["00000000-0000-0000-0000-000000000001"] });
  const g = await loadGateInputs(deps, u, now);
  expect(g).toMatchObject({ status: "active", unanswered: 1, inProgress: true, herBlock: { block: "busy", label: "film" }, sentAt: [ago(30)] });
  expect(g!.crisisQuietUntil).toEqual(ago(-1));
});

test("I2: a safety-flagged turn inside crisis_quiet_hours opens the crisis window before the cold path sets it", async () => {
  const { deps, u } = await setup();
  const hours = deps.config.relationship.crisis_quiet_hours;
  const flag = { flagged: true, category: "self_harm" as const, source: "classifier" as const };
  const turn = (at: Date, safety_flag: typeof flag | null) =>
    insertTurn(deps.db, u, { id: randomUUID(), session_id: randomUUID(), role: "companion", text: "x", created_at: at, safety_flag });
  await turn(ago(hours + 1), flag); // too old: outside the window
  await turn(ago(0.5), null); // unflagged
  expect((await loadGateInputs(deps, u, now))!.crisisQuietUntil).toBeNull();

  await turn(ago(2), flag);
  expect((await loadGateInputs(deps, u, now))!.crisisQuietUntil).toEqual(new Date(ago(2).getTime() + hours * H));
  // The later of the stored value and the flagged turn's window wins.
  await deps.db.update(relationship).set({ crisis_quiet_until: ago(-hours) }).where(eq(relationship.user_id, u));
  expect((await loadGateInputs(deps, u, now))!.crisisQuietUntil).toEqual(ago(-hours));
  await deps.db.update(relationship).set({ crisis_quiet_until: ago(-1) }).where(eq(relationship.user_id, u));
  expect((await loadGateInputs(deps, u, now))!.crisisQuietUntil).toEqual(new Date(ago(2).getTime() + hours * H));
});

test("gate inputs are null without a relationship row", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  expect(await loadGateInputs(deps, u, now)).toBeNull();
});
