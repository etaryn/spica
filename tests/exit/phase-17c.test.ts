/**
 * Phase 17c exit, all fake (fake judge, scripted labels, fake reply, fake guard), real DB: an open
 * question is the user's own words by coordinate; her reply's move answering it closes it; a
 * judge verdict racing that close never reopens it; a late reply to her bid counts as toward, an
 * unlinked one doesn't. A's question never reaches B, and A's exchange leaves core unchanged.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { getState } from "@/db/repos/user/conversation-state";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import { TURN_TIMER_QUEUE, type TurnTimerJob } from "@/mind/platform/jobs";
import { scriptedLabels } from "@/mind/platform/llm/fake-labels";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { runTurnTimer } from "@/mind/process/turn-taking/commit-and-reply";
import { receiveMessage } from "@/mind/process/turn-taking/receive-message";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { CapturingLLM } from "../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);
type D = ReturnType<typeof makeTestDeps>;
const MIN = 60_000;
const openOf = async (u: string) => (await getState(getTestDb(), u))!.open_questions;

async function ask(d: D, u: string, text: string) {
  const id = randomUUID();
  await receiveMessage(d, u, { clientMessageId: id, text });
  return id;
}

/** Her reply to the last of `to`, stored as the reply path stores it, then the cold path on it. */
async function answer(d: D, u: string, to: string[], text: string) {
  const [last] = await getTestDb()
    .select()
    .from(s.session_log)
    .where(eq(s.session_log.id, to.at(-1)!));
  const reply = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: last!.session_id,
    role: "companion",
    text,
    created_at: d.clock.now(),
    reply_to: last!.id,
  });
  const out = await runColdPath(d, {
    userId: u,
    turnIds: [...to, reply.id],
    replyTurnId: reply.id,
    recalled: [],
  });
  expect(out.status).toBe("done");
}

test("1: an open question is held as their words and closes when her reply answers it", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const id = await ask(d, u, "did you finish the book?");
  expect(await openOf(u)).toEqual([{ coords: [{ turnId: id, start: 0, end: 24 }] }]);

  Object.assign(
    d.llm.handlers,
    scriptedLabels({ replies: [{ said: "yes finally", to: "did you finish the book" }] }),
  );
  await answer(d, u, [id], "yes finally, last night");
  expect(await openOf(u)).toEqual([]);
});

test("2: a reply that answers something else leaves the question open", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const id = await ask(d, u, "did you finish the book?");
  Object.assign(d.llm.handlers, scriptedLabels({}));
  await answer(d, u, [id], "omg wait guess what happened");
  expect(await openOf(u)).toEqual([{ coords: [{ turnId: id, start: 0, end: 24 }] }]);
});

test("3: a judge verdict racing the close never reopens the question", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const id = await ask(d, u, "did you finish the book?");
  Object.assign(
    d.llm.handlers,
    scriptedLabels({ replies: [{ said: "yes finally", to: "did you finish the book" }] }),
  );
  const judge = d.llm.handlers.turn_judge!;
  // The judge reads q1 as open, then her reply's cold path closes it before the verdict lands.
  d.llm.handlers.turn_judge = async (input: string) => {
    const verdict = await judge(input);
    expect(input).toContain("- q1: did you finish the book?");
    await answer(d, u, [id], "yes finally, last night");
    return verdict;
  };
  d.clock.advance(MIN);
  await ask(d, u, "also what are you up to");
  expect(await openOf(u)).toEqual([]);
});

test("4: a late reply to her bid counts as toward; without the link it counts for nothing", async () => {
  for (const linked of [true, false]) {
    const d = makeTestDeps();
    const u = await createTestUser();
    await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
    await insertTurn(d.db, u, {
      id: randomUUID(),
      session_id: randomUUID(),
      role: "companion",
      text: "guess what, I got the part!",
      created_at: d.clock.now(),
      trigger: "reach_out",
    });
    d.clock.advance((d.config.session.idle_gap_minutes + 60) * MIN);
    const theirs = await insertTurn(d.db, u, {
      id: randomUUID(),
      session_id: randomUUID(),
      role: "user",
      text: "wait no way, congrats!!",
      created_at: d.clock.now(),
    });
    Object.assign(
      d.llm.handlers,
      scriptedLabels({
        bid: "toward",
        replies: linked ? [{ said: "congrats", to: "I got the part" }] : [],
      }),
    );
    await answer(d, u, [theirs.id], "thank youuu");
    const events = await getTestDb()
      .select()
      .from(s.relationship_event)
      .where(and(eq(s.relationship_event.user_id, u), eq(s.relationship_event.cause, "bid")));
    expect(events.length > 0).toBe(linked);
  }
});

const TOKEN = "CANARY-17c4e1";
const CORE_TABLES = ["core_memory", "core_state", "core_goal", "core_snapshot", "world_event"];
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
const lastTimer = (d: D) =>
  d.queue.jobs.filter((j) => j.name === TURN_TIMER_QUEUE).at(-1)!.data as TurnTimerJob;

test("5: leak canary: A's open question never reaches B; A's exchange leaves core unchanged", async () => {
  const base = makeTestDeps();
  const llm = new CapturingLLM();
  const d = { ...base, llm };
  const a = await createTestUser("alice");
  const b = await createTestUser("bob");
  const before = await coreDump();

  await ask(d, a, `is ${TOKEN} the password?`);
  await runTurnTimer(d, lastTimer(d));
  // The canary reached A's reply as an open question, so a leak would be visible.
  expect(llm.seen.some((c) => c.kind === "reply" && c.text.includes(TOKEN))).toBe(true);
  expect(await coreDump()).toBe(before);

  const seen = llm.seen.length;
  await ask(d, b, "what are you up to?");
  await runTurnTimer(d, lastTimer(d));
  const bCalls = llm.seen.slice(seen);
  expect(bCalls.some((c) => c.purpose === "turn_judge")).toBe(true);
  expect(bCalls.some((c) => c.kind === "reply")).toBe(true);
  for (const c of bCalls) expect(c.text).not.toContain(TOKEN);
  expect(JSON.stringify(await getState(getTestDb(), b))).not.toContain(TOKEN);
  expect(await coreDump()).toBe(before);
});
