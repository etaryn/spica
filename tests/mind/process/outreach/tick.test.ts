import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { outreachTick, outreachTickUser } from "@/mind/process/outreach/tick";
import { REACH_OUT_SEND_QUEUE, USER_MIND_RUN_QUEUE } from "@/mind/platform/jobs";
import { recordBigEvents } from "@/mind/process/user/run";
import { insertFact } from "@/db/repos/user/facts";
import { insertLifeDay } from "@/db/repos/world/life-day";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { reach_out_log, relationship } from "@/db/schema";
import { insertThread } from "@/db/repos/user/threads";
import { insertTurn } from "@/db/repos/user/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T15:20:00Z"); // life zone UTC below; 15:20 is free
async function setup() {
  const deps = makeTestDeps({
    life: { timezone: "UTC" },
    core: { world: { events_per_day_max: 0 } },
  });
  deps.clock.set(now);
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, now, deps.config.relationship);
  return { deps, u };
}
async function dueThread(deps: ReturnType<typeof makeTestDeps>, u: string) {
  const t = await insertThread(
    deps.db,
    u,
    {
      title: "interview",
      subject: "user",
      stakes: "high",
      next_checkpoint: new Date(now.getTime() - 3_600_000),
    },
    new Date(now.getTime() - 86_400_000),
  );
  await insertFact(deps.db, u, {
    subject: "user",
    kind: "event",
    content: "interview at Canva",
    embedding: vec(),
    created_at: now,
    status: "open",
    salience: 0.7,
    valence: 0,
    confidence: 1,
    source: "turn",
    thread_id: t.id,
  });
  return t;
}
const rows = (deps: ReturnType<typeof makeTestDeps>, u: string) =>
  deps.db.select().from(reach_out_log).where(eq(reach_out_log.user_id, u));

test("a winner through an open gate is scheduled with deterministic jitter and a send job", async () => {
  const { deps, u } = await setup();
  const t = await dueThread(deps, u);
  expect(await outreachTickUser(deps, u, now)).toBe("scheduled");
  const [r] = await rows(deps, u);
  expect(r).toMatchObject({
    status: "scheduled",
    topic: expect.stringMatching(`^thread:${t.id}@`),
    sent: false,
  });
  expect((r!.winner as { kind: string }).kind).toBe("thread");
  const job = deps.queue.jobs.find((j) => j.name === REACH_OUT_SEND_QUEUE)!;
  expect(job.data).toEqual({ userId: u, logId: r!.id });
  expect(job.startAfter).toEqual(r!.send_at);
  const delay = r!.send_at!.getTime() - now.getTime();
  expect(delay).toBeGreaterThanOrEqual(0);
  expect(delay).toBeLessThanOrEqual(40 * 60_000);
});

test("her day comes from her core episodes: topic core:<id> and the core memory id", async () => {
  const { deps, u } = await setup();
  const id = await deps.core.memory.insert({
    kind: "episode",
    content: "Spica got the telescope images.",
    embedding: vec(),
    occurred_at: new Date(now.getTime() - 2 * 3_600_000),
    created_at: now,
    status: "resolved",
    salience: 0.8,
    valence: 0.6,
    confidence: 1,
    source: "world",
    source_ref: null,
  });
  expect(await outreachTickUser(deps, u, now)).toBe("scheduled");
  const [r] = await rows(deps, u);
  expect(r!.topic).toBe(`core:${id}`);
  expect(r!.winner).toMatchObject({ kind: "her_day", coreMemoryId: id, factId: null });
});

test("no candidate → a 'none' row and no job", async () => {
  const { deps, u } = await setup();
  expect(await outreachTickUser(deps, u, now)).toBe("none");
  expect((await rows(deps, u)).map((r) => r.status)).toEqual(["none"]);
  expect(deps.queue.jobs).toEqual([]);
});

test("a winner in her busy block → a 'blocked' row with the failing rule, no job", async () => {
  const { deps, u } = await setup();
  await dueThread(deps, u);
  await insertLifeDay(deps.db, {
    date: "2026-01-05",
    source: "scripted",
    model: "none",
    prompt_version: "scripted",
    generated_at: now,
    plan: { blocks: [{ start: "11:00", end: "16:00", kind: "busy", busy: 0.8, label: "film" }] },
  });
  expect(await outreachTickUser(deps, u, now)).toBe("blocked"); // 15:20 is inside 11:00–16:00
  const [r] = await rows(deps, u);
  expect(r!.status).toBe("blocked");
  expect(r!.gate_results).toContainEqual(expect.objectContaining({ rule: "her_day", pass: false }));
  expect(deps.queue.jobs).toEqual([]);
});

test("pre-check skips without a row: ended, unanswered at max, crisis quiet, pending scheduled", async () => {
  const { deps, u } = await setup();
  await dueThread(deps, u);
  for (const patch of [
    { status: "ended_by_user" as const },
    { unanswered_reach_outs: 2 },
    { crisis_quiet_until: new Date(now.getTime() + 1) },
  ]) {
    await deps.db
      .update(relationship)
      .set({ status: "active", unanswered_reach_outs: 0, crisis_quiet_until: null, ...patch })
      .where(eq(relationship.user_id, u));
    expect(await outreachTickUser(deps, u, now)).toBe("skipped");
  }
  await deps.db
    .update(relationship)
    .set({ status: "active", unanswered_reach_outs: 0, crisis_quiet_until: null })
    .where(eq(relationship.user_id, u));
  expect(await outreachTickUser(deps, u, now)).toBe("scheduled");
  expect(await outreachTickUser(deps, u, new Date(now.getTime() + 60_000))).toBe("skipped"); // one already pending
  expect(await rows(deps, u)).toHaveLength(1);
});

test("I2: the pre-check skips while a flagged crisis turn is inside crisis_quiet_hours, even before the cold path", async () => {
  const { deps, u } = await setup();
  await dueThread(deps, u);
  await insertTurn(deps.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "companion",
    text: "I'm here",
    created_at: new Date(now.getTime() - 3_600_000),
    safety_flag: { flagged: true, category: "self_harm", source: "classifier" },
  });
  expect(await outreachTickUser(deps, u, now)).toBe("skipped");
  expect(await rows(deps, u)).toHaveLength(0);
  const later = new Date(now.getTime() + deps.config.relationship.crisis_quiet_hours * 3_600_000);
  deps.clock.set(later);
  expect(await outreachTickUser(deps, u, later)).not.toBe("skipped");
});

test("outreach.enabled false skips everyone; one failing user doesn't stop the batch", async () => {
  const { deps, u } = await setup();
  await dueThread(deps, u);
  const v = await createTestUser("v");
  await ensureRelationship(deps.db, v, now, deps.config.relationship);
  const off = {
    ...deps,
    config: { ...deps.config, outreach: { ...deps.config.outreach, enabled: false } },
  };
  expect((await outreachTick(off, now)).scheduled).toBe(0);
  const spy = vi
    .spyOn(await import("@/mind/process/outreach/inputs"), "loadCandidateInputs")
    .mockRejectedValueOnce(new Error("boom"));
  const res = await outreachTick(deps, now);
  expect(res.failed).toBe(1);
  expect(res.users).toBe(2);
  spy.mockRestore();
});

async function summaryAt(deps: ReturnType<typeof makeTestDeps>, u: string, at: Date) {
  await insertFact(deps.db, u, {
    subject: "shared",
    kind: "summary",
    content: "s",
    embedding: vec(),
    created_at: at,
    status: "open",
    salience: 0.6,
    valence: 0,
    confidence: 0.7,
    source: "generated",
    payload: { where_things_stand: "a", whats_live: "b", how_i_feel: "c" },
  });
}
const mindRuns = async () =>
  (
    await getTestDb().execute(
      sql`SELECT user_id, source_ref, status, triggers FROM user_mind_run ORDER BY created_at, source_ref`,
    )
  ).rows;

test("a stale summary records a run before the send and pushes the send to the lead", async () => {
  const { deps, u } = await setup();
  await dueThread(deps, u);
  await summaryAt(deps, u, new Date(now.getTime() - 73 * 3_600_000));
  expect(await outreachTickUser(deps, u, now)).toBe("scheduled");
  expect(await mindRuns()).toEqual([
    {
      user_id: u,
      source_ref: `stale_summary:${now.toISOString()}`,
      status: "pending",
      triggers: [{ kind: "stale_summary", age_hours: 73 }],
    },
  ]);
  expect(deps.queue.jobs.filter((j) => j.name === USER_MIND_RUN_QUEUE)).toHaveLength(1);
  const [r] = await rows(deps, u);
  expect(r!.send_at!.getTime() - now.getTime()).toBeGreaterThanOrEqual(5 * 60_000);
  const send = deps.queue.jobs.find((j) => j.name === REACH_OUT_SEND_QUEUE)!;
  expect(send.startAfter).toEqual(r!.send_at);
});

test("no summary yet counts as stale; a fresh one records nothing", async () => {
  const { deps, u } = await setup();
  await dueThread(deps, u);
  expect(await outreachTickUser(deps, u, now)).toBe("scheduled");

  const b = await createTestUser("b");
  await ensureRelationship(deps.db, b, now, deps.config.relationship);
  await dueThread(deps, b);
  await summaryAt(deps, b, new Date(now.getTime() - 3_600_000));
  expect(await outreachTickUser(deps, b, now)).toBe("scheduled");

  expect(await mindRuns()).toEqual([
    expect.objectContaining({ user_id: u, triggers: [{ kind: "stale_summary", age_hours: null }] }),
  ]);
});

test("a retried tick with the same time records no second run", async () => {
  const { deps, u } = await setup();
  await dueThread(deps, u);
  expect(await outreachTickUser(deps, u, now)).toBe("scheduled");
  await deps.db.delete(reach_out_log).where(eq(reach_out_log.user_id, u)); // let the retry schedule
  expect(await outreachTickUser(deps, u, now)).toBe("scheduled");
  expect(await mindRuns()).toHaveLength(1);
});

test("a capped stale-summary run enqueues nothing", async () => {
  const deps = makeTestDeps({
    life: { timezone: "UTC" },
    core: { world: { events_per_day_max: 0 } },
    user_mind: { max_triggers_per_day: 1 },
  });
  deps.clock.set(now);
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, now, deps.config.relationship);
  await recordBigEvents(deps, deps.db, u, "exchange:x", [{ kind: "make_up_done" }]);
  await dueThread(deps, u);
  expect(await outreachTickUser(deps, u, now)).toBe("scheduled");
  expect((await mindRuns()).map((r) => r.status)).toEqual(["pending", "capped"]);
  expect(deps.queue.jobs.filter((j) => j.name === USER_MIND_RUN_QUEUE)).toHaveLength(0);
});

test("a tick with no winner records no stale-summary run", async () => {
  const { deps, u } = await setup();
  expect(await outreachTickUser(deps, u, now)).toBe("none");
  expect(await mindRuns()).toHaveLength(0);
});
