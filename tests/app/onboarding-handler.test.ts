import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { createOnboardingHandler } from "@/app/api/onboarding/handler";
import { getOnboarding } from "@/db/repos/user/onboarding";
import { fact } from "@/db/schema";
import { ScriptedEmbedder } from "@/mind/platform/embedder/scripted";
import { loadQuiz } from "@/mind/process/onboarding/quiz";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const quiz = loadQuiz("v1", path.join(process.cwd(), "prompts"));

/** A complete, valid set of answers: option 0 everywhere, the given words for open questions. */
function fullAnswers(words = ["chess", "jazz", "tea"]) {
  let w = 0;
  return Object.fromEntries(
    quiz.questions.map((q) => [q.id, q.kind === "choice" ? 0 : words[w++]!]),
  );
}

const post = (body: unknown) =>
  new Request("http://x/api/onboarding", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

function setup() {
  const deps = { ...makeTestDeps(), embedder: new ScriptedEmbedder(1024) };
  return deps;
}
const handlerFor = (deps: ReturnType<typeof setup>, user: { id: string; name: string } | null) =>
  createOnboardingHandler({ getUser: async () => user, getDeps: () => deps });
const factCount = async (u: string) =>
  (await getTestDb().select().from(fact).where(eq(fact.user_id, u))).length;

test("401 without a session; 400 on bad JSON or bad answers", async () => {
  const deps = setup();
  expect((await handlerFor(deps, null)(post({}))).status).toBe(401);
  const u = { id: await createTestUser(), name: "Sam" };
  const h = handlerFor(deps, u);
  expect((await h(post("{not json"))).status).toBe(400);
  expect((await h(post({ quiz_version: "v1", answers: {} }))).status).toBe(400);
  for (const bad of ["   ", "one two three", "a".repeat(41)]) {
    const answers = { ...fullAnswers(), hours_topic: bad };
    expect((await h(post({ quiz_version: "v1", answers }))).status).toBe(400);
  }
  expect(await getOnboarding(deps.db, u.id)).toBeNull();
  expect(await factCount(u.id)).toBe(0);
});

test("201 stores the card with normalized answers and the card facts", async () => {
  const deps = setup();
  const u = { id: await createTestUser(), name: "Sam" };
  const answers = { ...fullAnswers(), hours_topic: "  Star   Gazing " };
  const res = await handlerFor(deps, u)(post({ quiz_version: "v1", answers }));
  expect(res.status).toBe(201);
  const row = await getOnboarding(deps.db, u.id);
  expect(row?.answers.hours_topic).toBe("Star Gazing");
  expect(row?.completed_at).toEqual(deps.clock.now());
  expect(await factCount(u.id)).toBeGreaterThan(quiz.dimensions.length);
});

test("review focus 1: a second submit is 409 and writes nothing more", async () => {
  const deps = setup();
  const u = { id: await createTestUser(), name: "Sam" };
  const h = handlerFor(deps, u);
  const body = { quiz_version: "v1", answers: fullAnswers() };
  const [a, b] = await Promise.all([h(post(body)), h(post(body))]);
  expect([a.status, b.status].sort()).toEqual([201, 409]);
  const n = await factCount(u.id);
  expect((await h(post(body))).status).toBe(409);
  expect(await factCount(u.id)).toBe(n);
});

test("review focus 2: an embedder failure is 503, writes nothing, and a retry succeeds", async () => {
  const deps = setup();
  deps.embedder.failNext = true;
  const u = { id: await createTestUser(), name: "Sam" };
  const h = handlerFor(deps, u);
  const body = { quiz_version: "v1", answers: fullAnswers() };
  expect((await h(post(body))).status).toBe(503);
  expect(await getOnboarding(deps.db, u.id)).toBeNull();
  expect(await factCount(u.id)).toBe(0);
  expect((await h(post(body))).status).toBe(201);
});

test("review focus 3: a stale quiz version is 409 stale_quiz and writes nothing", async () => {
  const deps = setup();
  const u = { id: await createTestUser(), name: "Sam" };
  const res = await handlerFor(deps, u)(post({ quiz_version: "v0", answers: fullAnswers() }));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "stale_quiz" });
  expect(await getOnboarding(deps.db, u.id)).toBeNull();
});
