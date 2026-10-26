/**
 * Phase 17b exit, all fake (labels scripted, fake reply, fake guard), real DB: the cold path
 * labels each exchange and keeps its labels apart from the words; a memory is its line (label,
 * date token, the words it rests on); a later exchange sees what is already labelled and can
 * update a memory by id; older messages are glossed from their time labels; a thread line keeps
 * the event apart from the check-in; a bad label value drops only itself. A's labels never reach
 * another user, and A's exchange leaves core unchanged.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import { listOpenThreads, touchThread } from "@/db/repos/user/threads";
import * as s from "@/db/schema";
import { scriptedLabels, type LabelScript } from "@/mind/platform/llm/fake-labels";
import { withTimeRendering } from "@/mind/platform/llm/render-net";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { composeReply } from "@/mind/process/hot-path/compose";
import { threadLines } from "@/mind/process/user/inputs";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { CapturingLLM } from "../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);

const MIN = 60_000;
const THURSDAY = {
  words: "thursday",
  unit: "weekday" as const,
  shift: 1,
  weekday: "thursday" as const,
};
const FRIDAY = { words: "friday", unit: "weekday" as const, shift: 1, weekday: "friday" as const };

function setup() {
  const base = makeTestDeps({ life: { timezone: "UTC" } });
  // Every prompt renders its date tokens, as in production.
  const d = { ...base, llm: withTimeRendering(base.llm, base.clock, 6) };
  const script = (labels: LabelScript) => Object.assign(base.llm.handlers, scriptedLabels(labels));
  return { d, fake: base.llm, script };
}
type D = ReturnType<typeof setup>["d"];

/** Their messages, then her reply, in one conversation; then the cold path on them. */
async function exchange(d: D, u: string, session: string, texts: string[], reply = "oh nice") {
  d.clock.advance(5 * MIN);
  const turns = [];
  for (const text of texts) {
    turns.push(
      await insertTurn(d.db, u, {
        id: randomUUID(),
        session_id: session,
        role: "user",
        text,
        created_at: d.clock.now(),
      }),
    );
  }
  const ct = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: reply,
    created_at: d.clock.now(),
    reply_to: turns.at(-1)!.id,
  });
  const out = await runColdPath(d, {
    userId: u,
    turnIds: [...turns.map((t) => t.id), ct.id],
    replyTurnId: ct.id,
    recalled: [],
  });
  expect(out.status).toBe("done");
}

const factsOf = (u: string) => getTestDb().select().from(s.fact).where(eq(s.fact.user_id, u));
const labelsOf = (u: string) =>
  getTestDb().select().from(s.annotation).where(eq(s.annotation.user_id, u));

/** Monday: the interview is Thursday; five minutes later, they say it moved to Friday. */
async function interviewMoved() {
  const { d, fake, script } = setup();
  const u = await createTestUser("sam");
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  const session = randomUUID();
  script({
    memories: [
      {
        id: "p-int",
        said: "interview thursday",
        label: "job interview",
        status: "planned",
        time: THURSDAY,
      },
    ],
    threads: [{ action: "open", title: "job interview", stakes: "high", propositions: ["p-int"] }],
  });
  await exchange(d, u, session, ["i have an interview thursday"]);
  script({
    memories: [
      {
        id: "p-moved",
        said: "moved it",
        label: "job interview",
        status: "planned",
        updates: "p-int",
        time: FRIDAY,
      },
    ],
  });
  await exchange(d, u, session, ["so they moved it to friday"]);
  return { d, fake, u, session };
}

test("1: a conversation's second exchange sees what the first labelled", async () => {
  const { fake, u } = await interviewMoved();
  const meaning = fake.structuredCalls.filter((c) => c.purpose === "labels_meaning");
  expect(meaning).toHaveLength(2);
  expect(meaning[0]!.input).not.toContain("p-int");
  expect(meaning[1]!.input).toContain('p-int user event "job interview" planned');
  const labels = await labelsOf(u);
  expect(new Set(labels.map((l) => l.layer))).toEqual(new Set(["move", "time", "proposition"]));
  const memories = labels.filter((l) => l.layer === "proposition");
  expect(memories.map((l) => l.local_id).sort()).toEqual(["p-int", "p-moved"]);
  expect(memories.every((l) => l.fact_id !== null)).toBe(true);
});

test("2: 'they moved it to friday' supersedes the interview by id, with no reconcile call", async () => {
  const { fake, u } = await interviewMoved();
  const facts = await factsOf(u);
  const thursday = facts.find((f) => f.content.includes("interview thursday"))!;
  const friday = facts.find((f) => f.content.includes("moved it to friday"))!;
  expect(thursday).toMatchObject({ status: "superseded", superseded_by: friday.id });
  expect(friday.content).toBe(
    'job interview, planned ⟦2026-01-09|day|UTC⟧ — the user said "so they moved it to friday"',
  );
  expect(friday.occurred_at?.toISOString()).toBe("2026-01-09T12:00:00.000Z");
  // The first exchange's memory had no neighbour to ask about; the second never asked.
  expect(fake.structuredCalls.filter((c) => c.purpose === "reconcile")).toHaveLength(0);
});

test("3 and 4: on a later day the reply reads the memory's line and older messages' dates", async () => {
  const { d, fake, u, session } = await interviewMoved();
  d.clock.set(new Date("2026-01-07T09:00:00Z")); // Wednesday
  const turn = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text: "morning!",
    created_at: d.clock.now(),
  });
  await composeReply(d, u, { turns: [turn], openQuestions: [], flag: null });
  const call = fake.calls.at(-1)!;
  // The memory: its label, its date read on the day, and the words it rests on.
  expect(call.system).toContain("job interview, planned");
  expect(call.system).toContain('the user said "so they moved it to friday"');
  expect(call.system).toContain("Friday 9 January");
  // Their Monday message keeps its words and says what "friday" means now.
  const older = call.messages.map((m) => m.content).join("\n");
  expect(older).toMatch(/so they moved it to friday \(that's [^)]*Friday 9 January\)/);
  // No raw token reaches the model.
  expect(call.system + older).not.toContain("⟦");
});

test("5: a thread line keeps the event's day apart from when to ask", async () => {
  const { d, u } = await interviewMoved();
  const [thread] = await listOpenThreads(d.db, u, 5);
  await touchThread(d.db, u, thread!.id, d.clock.now(), new Date("2026-01-10T09:00:00Z"));
  expect(threadLines(await listOpenThreads(d.db, u, 5), "UTC")).toEqual([
    "job interview (on ⟦2026-01-09|day|UTC⟧; ask after ⟦2026-01-10|day|UTC⟧)",
  ]);
});

test("6: a value outside its list drops one label, never the exchange", async () => {
  const { d, script } = setup();
  const u = await createTestUser("sam");
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  const info = vi.spyOn(d.log, "info");
  script({
    memories: [
      { said: "puppy", label: "new puppy", act: "shrugs" },
      { said: "new job", label: "new job", status: "planned" },
    ],
  });
  await exchange(d, u, randomUUID(), ["i got a puppy", "and i start a new job monday"]);
  const facts = await factsOf(u);
  expect(facts.map((f) => f.content)).toEqual([
    'new job, planned — the user said "and i start a new job monday"',
  ]);
  expect(info).toHaveBeenCalledWith(
    "labels dropped",
    expect.objectContaining({
      userId: u,
      drops: expect.arrayContaining([expect.objectContaining({ reason: "bad_value" })]),
    }),
  );
});

const TOKEN = "CANARY-17b9c4";
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

test("7: leak canary: A's labels never reach B; A's exchange leaves core unchanged", async () => {
  const base = makeTestDeps({ life: { timezone: "UTC" } });
  const llm = new CapturingLLM();
  const d = { ...base, llm };
  const a = await createTestUser("alice");
  const b = await createTestUser("bob");
  for (const u of [a, b]) await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  const before = await coreDump();

  await exchange(d, a, randomUUID(), [`my code word is ${TOKEN}`]);
  // The canary reached A's labels and memory, so a leak would be visible.
  expect(JSON.stringify(await labelsOf(a))).toContain(TOKEN);
  expect((await factsOf(a)).some((f) => f.content.includes(TOKEN))).toBe(true);
  expect(await coreDump()).toBe(before);

  const seen = llm.seen.length;
  await exchange(d, b, randomUUID(), ["what's new with you?"]);
  const turn = await insertTurn(d.db, b, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "hey",
    created_at: d.clock.now(),
  });
  await composeReply(d, b, { turns: [turn], openQuestions: [], flag: null });
  const bCalls = llm.seen.slice(seen);
  expect(bCalls.some((c) => c.purpose === "labels_read")).toBe(true);
  expect(bCalls.some((c) => c.kind === "reply")).toBe(true);
  for (const c of bCalls) expect(c.text).not.toContain(TOKEN);
  expect(JSON.stringify(await labelsOf(b))).not.toContain(TOKEN);
  expect(await coreDump()).toBe(before);
});
