import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { eq, sql } from "drizzle-orm";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import { relationship } from "@/db/schema";
import { USER_MIND_RUN_QUEUE } from "@/mind/platform/jobs";
import { recordBigEvents } from "@/mind/process/user/run";
import { userMindTick } from "@/mind/process/user/tick";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const now = new Date("2026-01-05T15:25:00Z");
const MIN = 60_000;

async function setup() {
  const deps = makeTestDeps({
    user_mind: { triggers: { long_conversation: { min_user_turns: 3, quiet_minutes: 30 } } },
  });
  deps.clock.set(now);
  const u = await createTestUser();
  await ensureRelationship(deps.db, u, now, deps.config.relationship);
  return { deps, u };
}

/** A session of `userTurns` answered user turns, its last turn `endedMinutesAgo`. */
async function session(u: string, userTurns: number, endedMinutesAgo: number) {
  const sessionId = randomUUID();
  const end = now.getTime() - endedMinutesAgo * MIN;
  for (let i = 0; i < userTurns; i++) {
    const at = end - (userTurns - 1 - i) * 2 * MIN - MIN;
    for (const [role, offset] of [
      ["user", 0],
      ["companion", MIN],
    ] as const)
      await insertTurn(getTestDb(), u, {
        id: randomUUID(),
        session_id: sessionId,
        role,
        text: `${role} ${i}`,
        created_at: new Date(at + offset),
      });
  }
  return sessionId;
}
const runs = async () =>
  (
    await getTestDb().execute(
      sql`SELECT source_ref, status, triggers FROM user_mind_run ORDER BY created_at, source_ref`,
    )
  ).rows;
const setQuietUntil = (u: string, at: Date) =>
  getTestDb()
    .update(relationship)
    .set({ crisis_quiet_until: at })
    .where(eq(relationship.user_id, u));

test("a long conversation that has gone quiet fires once, even when the tick reruns", async () => {
  const { deps, u } = await setup();
  const sid = await session(u, 3, 45);
  expect(await userMindTick(deps, now)).toEqual({ recorded: 1, failed: 0 });
  expect(await userMindTick(deps, now)).toEqual({ recorded: 0, failed: 0 });
  expect(await runs()).toEqual([
    {
      source_ref: `long_conversation:${sid}`,
      status: "pending",
      triggers: [{ kind: "long_conversation", session_id: sid, user_turns: 3 }],
    },
  ]);
  expect(deps.queue.jobs.filter((j) => j.name === USER_MIND_RUN_QUEUE)).toHaveLength(1);
});

test("short, still-going, or too-old conversations fire nothing", async () => {
  const { deps, u } = await setup();
  await session(u, 2, 45); // too short
  await session(u, 3, 10); // not quiet yet
  await session(u, 3, 25 * 60); // ended before the lookback
  expect(await userMindTick(deps, now)).toEqual({ recorded: 0, failed: 0 });
});

test("an ended relationship fires nothing", async () => {
  const { deps, u } = await setup();
  await session(u, 3, 45);
  await setQuietUntil(u, new Date(now.getTime() - 10 * MIN));
  await getTestDb()
    .update(relationship)
    .set({ status: "ended_by_user" })
    .where(eq(relationship.user_id, u));
  expect((await userMindTick(deps, now)).recorded).toBe(0);
});

test("a long conversation inside a crisis window waits; once it ends, the talk and the crisis each fire once", async () => {
  const { deps, u } = await setup();
  const sid = await session(u, 3, 45);
  const quietUntil = new Date(now.getTime() + 60 * MIN);
  await setQuietUntil(u, quietUntil);
  expect((await userMindTick(deps, now)).recorded).toBe(0);

  const later = new Date(quietUntil.getTime() + 10 * MIN);
  deps.clock.set(later);
  expect(await userMindTick(deps, later)).toEqual({ recorded: 2, failed: 0 });
  expect(await userMindTick(deps, later)).toEqual({ recorded: 0, failed: 0 });
  expect((await runs()).map((r) => r.source_ref).sort()).toEqual(
    [`crisis_passed:${quietUntil.toISOString()}`, `long_conversation:${sid}`].sort(),
  );
});

test("a crisis that ended before the lookback fires nothing", async () => {
  const { deps, u } = await setup();
  await setQuietUntil(u, new Date(now.getTime() - 25 * 60 * MIN));
  expect((await userMindTick(deps, now)).recorded).toBe(0);
});

test("the tick re-queues pending runs whose job was lost", async () => {
  const { deps, u } = await setup();
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", [
    { kind: "make_up_done" },
  ]))!;
  await userMindTick(deps, new Date(now.getTime() + 11 * MIN));
  expect(deps.queue.jobs).toContainEqual({ name: USER_MIND_RUN_QUEUE, data: { runId } });
});
