/**
 * Phase 11 exit, all fake: the profile card swap writes both sides' cards as light memories,
 * they reach her reply marked as a first impression, conversation overrides them, their name
 * never fades, the compatibility page comes out of the answers, and nothing reaches core or
 * another user.
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test, vi } from "vitest";
import ChatPage from "@/app/chat/page";
import OnboardingPage from "@/app/onboarding/page";
import { adminDecayFacts } from "@/db/repos/admin/decay";
import { getOnboarding } from "@/db/repos/user/onboarding";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import { ScriptedEmbedder } from "@/mind/platform/embedder/scripted";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { composeReply } from "@/mind/process/hot-path/compose";
import { loadQuiz } from "@/mind/process/onboarding/quiz";
import { cardView } from "@/mind/process/onboarding/score";
import { submitCard } from "@/mind/process/onboarding/submit";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { scriptedLabels } from "@/mind/platform/llm/fake-labels";

// The real pages run with the session and deps swapped for the test user and test deps.
const page = vi.hoisted(() => ({ user: null as unknown, deps: null as unknown }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("redirect"), { to });
  },
}));
vi.mock("@/server/session", () => ({ requireUser: async () => page.user }));
vi.mock("@/server/deps", () => ({ getDeps: () => page.deps, getVapidPublicKey: () => "" }));
const redirectOf = (render: Promise<unknown>) =>
  render.then(
    () => null,
    (e: { to?: string }) => e.to ?? Promise.reject(e),
  );

beforeEach(resetDb);
afterAll(closeTestDb);

const DIM = 1024;
const quiz = loadQuiz("v1", path.join(process.cwd(), "prompts"));
const MARK = "(from their profile card, a first impression)";
const HOMEBODY = "On their profile card they came across as more of a homebody.";

function setup() {
  return { ...makeTestDeps(), embedder: new ScriptedEmbedder(DIM) };
}
type D = ReturnType<typeof setup>;

function answers(pick: number, words: string[]) {
  let w = 0;
  return Object.fromEntries(
    quiz.questions.map((q) => [
      q.id,
      q.kind === "choice" ? Math.min(pick, q.options.length - 1) : words[w++]!,
    ]),
  );
}

async function meet(d: D, name: string, words = ["chess", "jazz", "tea"]) {
  const id = await createTestUser(name);
  await ensureRelationship(d.db, id, d.clock.now(), d.config.relationship);
  const r = await submitCard(
    d,
    { id, name, gender: "unspecified" },
    { quiz_version: "v1", answers: answers(0, words) },
  );
  expect(r.status).toBe(201);
  return id;
}

const cardFactsOf = (u: string) =>
  getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), eq(s.fact.source, "onboarding")));

async function talk(d: D, u: string, text: string) {
  d.clock.advance(60_000);
  const session = randomUUID();
  const ut = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text,
    created_at: d.clock.now(),
    safety_flag: null,
  });
  const r = await composeReply(d, u, { turns: [ut], openQuestions: [], flag: null });
  const ct = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: r.text,
    created_at: d.clock.now(),
    reply_to: ut.id,
  });
  return { system: d.llm.calls.at(-1)!.system, ut, ct };
}

const CORE_TABLES = [
  "core_memory",
  "core_entity",
  "core_state",
  "core_goal",
  "core_snapshot",
  "world_event",
  "life_event_log",
  "core_loop_trace",
  "core_budget_day",
  "life_day",
  "drift_log",
  "core_self_line",
];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(
      sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x`),
    );
    parts.push(...res.rows.map((r) => String(r.j)).sort());
  }
  return parts.join("\n");
}

test("1: a finished quiz writes exactly the expected cards for both sides", async () => {
  const d = setup();
  const u = await meet(d, "Sam");
  const facts = await cardFactsOf(u);
  const theirs = facts.filter((f) => f.subject === "user");
  const hers = facts.filter((f) => f.subject === "self");
  // name + gender + one per dimension + one per open question
  const opens = quiz.questions.filter((q) => q.kind === "open").length;
  expect(theirs).toHaveLength(2 + quiz.dimensions.length + opens);
  expect(hers.map((f) => f.content).sort()).toEqual(
    quiz.questions.flatMap((q) => (q.her_fact ? [q.her_fact] : [])).sort(),
  );
  for (const f of facts) {
    expect(f).toMatchObject({ source: "onboarding", source_ref: "onboarding:v1", confidence: 0.4 });
  }
  expect(theirs.find((f) => f.content === "Their name is Sam.")?.salience).toBe(1);
  expect(theirs.filter((f) => f.salience !== 1).every((f) => f.salience === 0.5)).toBe(true);
});

test("2: card facts reach the reply prompt with the card mark", async () => {
  const d = setup();
  const u = await meet(d, "Sam");
  // Put the homebody impression right next to the message so retrieval picks it.
  d.embedder
    .set(HOMEBODY, ScriptedEmbedder.axis(DIM, 7))
    .set("staying in tonight", ScriptedEmbedder.axis(DIM, 7));
  await getTestDb()
    .update(s.fact)
    .set({ embedding: ScriptedEmbedder.axis(DIM, 7) })
    .where(and(eq(s.fact.user_id, u), eq(s.fact.content, HOMEBODY)));
  const { system } = await talk(d, u, "staying in tonight");
  const line = system.split("\n").find((l) => l.includes(HOMEBODY));
  expect(line).toContain(MARK);
});

test("3: a later conversation fact supersedes a card fact", async () => {
  const d = setup();
  const u = await meet(d, "Sam");
  const [card] = (await cardFactsOf(u)).filter((f) => f.content === HOMEBODY);
  // The memory is embedded as its label and their words; its vector sits on the card fact's.
  d.embedder.set("goes out most nights: honestly i go out most nights", card!.embedding);
  Object.assign(
    d.llm.handlers,
    scriptedLabels({
      memories: [
        { said: "go out most nights", label: "goes out most nights", kind: "trait", salience: 0.6 },
      ],
    }),
  );
  d.llm.handlers.reconcile = () => ({ relation: "contradicts", target_fact_id: card!.id });
  const ex = await talk(d, u, "honestly i go out most nights");
  await runColdPath(d, {
    userId: u,
    turnIds: [ex.ut.id, ex.ct.id],
    replyTurnId: ex.ct.id,
    recalled: [],
  });
  const [after] = await getTestDb().select().from(s.fact).where(eq(s.fact.id, card!.id));
  expect(after?.status).toBe("superseded");
});

test("4: the gate opens only once the card exists", async () => {
  const d = setup();
  const u = await createTestUser("Sam");
  Object.assign(page, { user: { id: u, email: "sam@test.local", name: "Sam" }, deps: d });
  expect(await redirectOf(ChatPage())).toBe("/onboarding");
  expect(await redirectOf(OnboardingPage())).toBeNull();
  await submitCard(
    d,
    { id: u, name: "Sam", gender: "unspecified" },
    { quiz_version: "v1", answers: answers(0, ["a", "b", "c"]) },
  );
  expect(await redirectOf(ChatPage())).toBeNull();
  expect(await redirectOf(OnboardingPage())).toBe("/chat");
});

test("5: the compatibility page comes out of the stored answers", async () => {
  const d = setup();
  const u = await meet(d, "Sam", ["Stargazing", "knitting", "tea"]);
  const row = (await getOnboarding(d.db, u))!;
  expect(row.topics).toEqual([{ yours: "Stargazing", hers: "stargazing" }]);
  const view = cardView(quiz, row.answers, row.topics, d.config.onboarding);
  expect(view.dimensions.map((x) => x.id)).toEqual(quiz.dimensions.map((x) => x.id));
  // Option 0 everywhere: friday -1, after_weekend -1, cancelled 0 -> mean -2/3 -> 17; she sits at 30.
  expect(view.dimensions.find((x) => x.id === "social_energy")).toMatchObject({ you: 17, her: 30 });
  expect(view.noCommon).toBeNull();
  expect(view.yours.map((a) => a.answer)).toEqual(["Stargazing", "knitting", "tea"]);
});

test("6: their name and gender never fade; the rest of the card can go stale", async () => {
  const d = setup();
  const u = await meet(d, "Sam");
  const day = 86_400_000;
  for (let i = 1; i <= 120; i++) {
    await adminDecayFacts(getTestDb(), new Date(d.clock.now().getTime() + i * day), d.config.decay);
  }
  const facts = await cardFactsOf(u);
  const kept = ["Their name is Sam.", "They didn't say their gender; use they/them for them."];
  for (const content of kept) expect(facts.find((f) => f.content === content)?.status).toBe("open");
  expect(facts.filter((f) => !kept.includes(f.content)).every((f) => f.status === "stale")).toBe(
    true,
  );
});

test("7: leak canary and side channel: A's card never reaches core or B's reply", async () => {
  const d = setup();
  const before = await coreDump();
  const token = `CANARY-${randomUUID().slice(0, 8)}`;
  await meet(d, "Ann", [token, "jazz", "tea"]);
  expect(await coreDump()).toBe(before); // A's submit leaves core unchanged
  const b = await meet(d, "Ben");
  const { system } = await talk(d, b, "what do you like?");
  expect(system).not.toContain(token);
  expect(await coreDump()).not.toContain(token);
});
