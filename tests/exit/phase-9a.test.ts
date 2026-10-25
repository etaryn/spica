/**
 * Phase 9a exit, all fake: a big event becomes exactly one user mind batch, whose summary she
 * reads in her next reply; retries, idle days and the daily cap add nothing; a lost job is swept;
 * a second summary supersedes the first; core is untouched throughout.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { sql } from "drizzle-orm";
import { insertTurn } from "@/db/repos/user/session-log";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { USER_MIND_RUN_QUEUE } from "@/mind/platform/jobs";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { composeReply } from "@/mind/process/hot-path/compose";
import { runUserMind, sweepPendingUserMindRuns } from "@/mind/process/user/run";
import { tickUser } from "@/mind/state/user/relationship/daily-tick";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { newMessages, scriptedLabels } from "@/mind/platform/llm/fake-labels";

beforeEach(resetDb);
afterAll(closeTestDb);

const CORE_TABLES = [
  "core_memory",
  "core_state",
  "core_goal",
  "core_snapshot",
  "core_loop_trace",
  "core_budget_day",
];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(
      sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x ORDER BY 1`),
    );
    parts.push(...res.rows.map((r) => String(r.j)));
  }
  return parts.join("\n");
}
async function count(table: string, where = "true"): Promise<number> {
  const res = await getTestDb().execute(
    sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`),
  );
  return Number(res.rows[0]!.n);
}

/** Scripted labels: "TRUST" raises trust sharply; "BIG" stores a salient fact. */
function deps() {
  const d = makeTestDeps();
  Object.assign(
    d.llm.handlers,
    scriptedLabels((input) => {
      const latest = newMessages(input)
        .filter((m) => m.speaker === "user")
        .map((m) => m.text)
        .join(" ");
      const big = latest.match(/BIG \w+/)?.[0];
      return {
        memories: big ? [{ said: big, label: `big news ${big}`, salience: 0.9, valence: 0.6 }] : [],
        relationship: latest.includes("TRUST") ? { trust: 1 } : null,
      };
    }),
  );
  return d;
}

async function exchange(d: ReturnType<typeof deps>, userId: string, text: string) {
  d.clock.advance(60_000);
  const session = randomUUID();
  const ut = await insertTurn(d.db, userId, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text,
    created_at: d.clock.now(),
  });
  const ct = await insertTurn(d.db, userId, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: "ok",
    created_at: d.clock.now(),
    reply_to: ut.id,
  });
  return { userId, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] };
}

async function drainRuns(d: ReturnType<typeof deps>) {
  for (const job of d.queue.drain((j) => j.name === USER_MIND_RUN_QUEUE))
    if (job.name === USER_MIND_RUN_QUEUE) await runUserMind(d, job.data);
}

test("one big event, one batch, one summary; a retry adds nothing; she reads it next reply", async () => {
  const d = deps();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  const before = await coreDump();
  const job = await exchange(d, u, "TRUST BIG you were right");
  await runColdPath(d, job);
  await getTestDb().execute(sql`UPDATE session_log SET extracted = false`);
  await runColdPath(d, job);
  await drainRuns(d);
  expect(await count("user_mind_run")).toBe(1);
  expect(await count("user_loop_trace", "loop = 'user_summarise' AND status = 'done'")).toBe(1);
  expect(await count("fact", "kind = 'summary'")).toBe(1);
  expect(await coreDump()).toBe(before);

  d.clock.advance(60_000);
  const turn = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "so what do you think?",
    created_at: d.clock.now(),
  });
  await composeReply(d, u, { turns: [turn], openQuestions: [], flag: null });
  expect(d.llm.calls.at(-1)!.system).toContain("## Where things stand with them");
});

test("an idle user over seven days of ticks runs nothing", async () => {
  const d = deps();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  for (let day = 0; day < 7; day++) {
    d.clock.advance(24 * 3_600_000);
    await tickUser(d, u, d.clock.now());
    await drainRuns(d);
  }
  expect(await count("user_mind_run")).toBe(0);
  expect(await count("user_loop_trace")).toBe(0);
});

test("the fourth big event of a day is capped and runs nothing", async () => {
  const d = deps();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  for (let i = 0; i < 4; i++) await runColdPath(d, await exchange(d, u, `BIG n${i}`));
  await drainRuns(d);
  expect(await count("user_mind_run", "status = 'done'")).toBe(3);
  expect(await count("user_mind_run", "status = 'capped'")).toBe(1);
  expect(await count("user_loop_trace", "loop = 'user_summarise'")).toBe(3);
});

test("a lost enqueue is swept and runs once; the second summary supersedes the first", async () => {
  const d = deps();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  await runColdPath(d, await exchange(d, u, "BIG first"));
  await drainRuns(d);
  await runColdPath(d, await exchange(d, u, "BIG second"));
  d.queue.drain((j) => j.name === USER_MIND_RUN_QUEUE); // the job is lost
  d.clock.advance(11 * 60_000);
  expect(await sweepPendingUserMindRuns(d, d.clock.now())).toBe(1);
  await drainRuns(d);
  expect(await sweepPendingUserMindRuns(d, d.clock.now())).toBe(0);
  expect(await count("user_loop_trace", "loop = 'user_summarise'")).toBe(2);
  expect(await count("fact", "kind = 'summary' AND status = 'superseded'")).toBe(1);
  expect(await count("fact", "kind = 'summary' AND status NOT IN ('superseded','stale')")).toBe(1);
});
