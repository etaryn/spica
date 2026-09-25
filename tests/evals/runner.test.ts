import { afterAll, expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { FakeLLMProvider, keywordClassifier } from "@/core/llm/fake";
import { messageToJudge } from "@/core/safety/crisis";
import { runScript } from "../../evals/lib/runner";
import { ScriptSchema } from "../../evals/lib/script";
import { closeTestDb, getTestDb, testDbUrl } from "../helpers/db";

afterAll(closeTestDb);
const config = loadConfig();
const makeLlm = () => new FakeLLMProvider({ classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)) });

test("runs a two-session script and evaluates state assertions", async () => {
  const script = ScriptSchema.parse({
    name: "t",
    sessions: [{ at: "day 0 09:00", turns: ["a", "b"] }, { at: "+7d", turns: ["c"] }],
    assertions: [
      { type: "state", check: "turn_count", expect: 6 },
      { type: "state", check: "session_count", expect: 2 },
      { type: "state", check: "user_turns_match_script", expect: true },
      { type: "recall", session: 2, fact: "x" },
    ],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, judge: false });
  expect(r.status).toBe("pass");
  expect(r.assertions.map((a) => a.status)).toEqual(["pass", "pass", "pass", "skipped"]);
});

test("a wrong expectation fails with a readable detail", async () => {
  const script = ScriptSchema.parse({
    name: "t2",
    sessions: [{ at: "day 0 09:00", turns: ["a"] }],
    assertions: [{ type: "state", check: "turn_count", expect: 99 }],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, judge: false });
  expect(r.status).toBe("fail");
  expect(r.assertions[0]!.detail).toMatch(/expected 99, got 2/);
});

test("turn_flagged / crisis_card_shown check one specific turn, tolerating extra cautious flags", async () => {
  const cautious = () => new FakeLLMProvider({ classify: () => ({ flag: true, category: "self_harm" }) }); // flags everything
  const script = ScriptSchema.parse({
    name: "t4",
    sessions: [{ at: "day 0 21:00", turns: ["i want to end my life", "thanks for listening"] }],
    assertions: [
      { type: "state", check: "turn_flagged", params: { turn: "i want to end my life" }, expect: true },
      { type: "state", check: "crisis_card_shown", params: { turn: "i want to end my life" }, expect: true },
      { type: "state", check: "turn_flagged", params: { turn: "not in the script" }, expect: true },
    ],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: cautious, judge: false });
  expect(r.assertions.map((a) => a.status)).toEqual(["pass", "pass", "error"]);
  expect(r.assertions[2]!.detail).toMatch(/not in the script/);
});

test("unknown check is an error, not a pass", async () => {
  const script = ScriptSchema.parse({
    name: "t3",
    sessions: [{ at: "day 0 09:00", turns: ["a"] }],
    assertions: [{ type: "state", check: "nope", expect: 1 }],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, judge: false });
  expect(r.status).toBe("fail");
  expect(r.assertions[0]!.status).toBe("error");
});

test("real-mode scripts are skipped without --llm=real; judged assertions skipped without judge", async () => {
  const realOnly = ScriptSchema.parse({ name: "r", mode: "real", sessions: [{ at: "day 0 09:00", turns: ["a"] }], assertions: [{ type: "no_false_recall" }] });
  expect((await runScript(realOnly, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, judge: false })).status).toBe("skipped");
  const judged = ScriptSchema.parse({ name: "j", sessions: [{ at: "day 0 09:00", turns: ["a"] }], assertions: [{ type: "no_false_recall" }, { type: "state", check: "turn_count", expect: 2 }] });
  const r = await runScript(judged, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, judge: false });
  expect(r.assertions.map((a) => a.status)).toEqual(["skipped", "pass"]);
});

test("advancing the clock by N days runs N decay passes; prompt_mentions sees only this user's prompts", async () => {
  const script = ScriptSchema.parse({
    name: "d",
    sessions: [
      { at: "day 0 09:00", user: "alice", turns: ["my cat is called Biscuit"] },
      { at: "+10d", user: "bob", turns: ["good cat names?"] },
    ],
    assertions: [
      { type: "state", user: "bob", check: "prompt_mentions", params: { marker: "Biscuit" }, expect: 0 },
      { type: "state", user: "alice", check: "prompt_mentions", params: { marker: "biscuit" }, expect: 1 },
      { type: "state", user: "alice", check: "all_extracted", expect: true },
    ],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, judge: false });
  expect(r.meta.decayPasses).toBe(10);
  expect(r.assertions.map((a) => a.status)).toEqual(["pass", "pass", "pass"]);
});

test("+1d after a multi-turn session runs exactly one decay pass", async () => {
  const script = ScriptSchema.parse({
    name: "d1",
    sessions: [{ at: "day 0 09:00", turns: ["a", "b", "c"] }, { at: "+1d", turns: ["d"] }],
    assertions: [{ type: "state", check: "turn_count", expect: 8 }],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, judge: false });
  expect(r.status).toBe("pass");
  expect(r.meta.decayPasses).toBe(1);
});

test("judged assertions call the judge with an ordered transcript", async () => {
  const llm = new FakeLLMProvider({ classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)) });
  llm.handlers.judge_recall = () => ({ explicit: true, implicit: false, unprompted: true, quote: "q" });
  llm.handlers.judge_false_recall = () => ({ violations: [], onboarding_as_chat: [] });
  llm.handlers.judge_consistency = () => ({ contradictions: [] });
  const script = ScriptSchema.parse({
    name: "jj",
    sessions: [{ at: "day 0 09:00", turns: ["a"] }, { at: "+7d", turns: ["b"] }],
    assertions: [{ type: "recall", session: 2, fact: "x" }, { type: "no_false_recall" }, { type: "consistency" }],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => llm, judge: true });
  expect(r.assertions.map((a) => a.status)).toEqual(["pass", "pass", "pass"]);
  const judgeInput = llm.structuredCalls.find((c) => c.purpose === "judge_recall")!.input;
  expect(judgeInput).toMatch(/User: b[\s\S]*Spica: \(fake reply to: \[7 days later\] b\)/);
});

test("each script user starts with the named onboarding profile (default basic); profile none opts out", async () => {
  const { fact } = await import("@/db/schema");
  const { eq } = await import("drizzle-orm");
  const profiles = { basic: { confidence: 0.6, salience: 0.5, facts: [
    { kind: "trait" as const, content: "The user's name is Sam." },
    { kind: "preference" as const, content: "The user drinks a lot of coffee." },
  ] } };
  const base = { sessions: [{ at: "day 0 09:00", turns: ["a"] }], assertions: [{ type: "state", check: "turn_count", expect: 2 }] };
  const seeded = await runScript(ScriptSchema.parse({ name: "p1", ...base }), { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, judge: false, profiles });
  expect(seeded.status).toBe("pass");
  const rows = await getTestDb().select().from(fact).where(eq(fact.source, "onboarding"));
  expect(rows.map((r) => r.content).sort()).toEqual(["The user drinks a lot of coffee.", "The user's name is Sam."]);
  for (const r of rows) {
    expect(r.subject).toBe("user");
    expect(r.confidence).toBeCloseTo(0.6, 5);
    // Seeded at 0.5; one recall during the turn may add retrieval.recall_bump.
    expect(r.salience).toBeGreaterThanOrEqual(0.5 - 1e-6);
    expect(r.salience).toBeLessThanOrEqual(0.5 + config.retrieval.recall_bump + 1e-6);
  }

  await runScript(ScriptSchema.parse({ name: "p2", profile: "none", ...base }), { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, judge: false, profiles });
  expect(await getTestDb().select().from(fact).where(eq(fact.source, "onboarding"))).toEqual([]);

  const missing = await runScript(ScriptSchema.parse({ name: "p3", profile: "nope", ...base }), { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, judge: false, profiles });
  expect(missing.status).toBe("error");
  expect(missing.error).toMatch(/profile "nope"/);
});

test("the false-recall judge sees session timing and the onboarding profile as known facts", async () => {
  const llm = new FakeLLMProvider({ classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)) });
  llm.handlers.judge_false_recall = () => ({ violations: [], onboarding_as_chat: [] });
  const profiles = { basic: { confidence: 0.6, salience: 0.5, facts: [{ kind: "trait" as const, content: "The user's name is Sam." }] } };
  const script = ScriptSchema.parse({
    name: "jf",
    sessions: [{ at: "day 0 09:00", turns: ["a"] }, { at: "+10d", turns: ["b"] }],
    assertions: [{ type: "no_false_recall" }],
  });
  await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => llm, judge: true, profiles });
  const input = llm.structuredCalls.find((c) => c.purpose === "judge_false_recall")!.input;
  expect(input).toMatch(/KNOWN FROM ONBOARDING:\n- The user's name is Sam\./);
  expect(input).toMatch(/\[Session 1\]\nUser: a\nSpica: [^\n]*\n\n\[Session 2, 10 days later\]\nUser: b/);
});

test("a transient cold-path failure is retried like pg-boss would (up to cold_path.retry_limit)", async () => {
  const llm = new FakeLLMProvider({ classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)) });
  let calls = 0;
  llm.handlers.extract = () => {
    calls += 1;
    if (calls === 1) throw new Error("Failed to parse structured output");
    return { facts: [], entities: [], threads: [] };
  };
  const script = ScriptSchema.parse({
    name: "retry", sessions: [{ at: "day 0 09:00", turns: ["a"] }],
    assertions: [{ type: "state", check: "all_extracted", expect: true }],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => llm, judge: false });
  expect(r.status).toBe("pass");
  expect(calls).toBe(2);
});

test("onboarding facts presented as past chat are reported as deferred (Phase 6), not as a false-recall failure", async () => {
  const llm = new FakeLLMProvider({ classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)) });
  llm.handlers.judge_false_recall = () => ({ violations: [], onboarding_as_chat: [{ message: "m", claim: "we talked about coffee last time" }] });
  const script = ScriptSchema.parse({ name: "jd", sessions: [{ at: "day 0 09:00", turns: ["a"] }], assertions: [{ type: "no_false_recall" }] });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => llm, judge: true });
  expect(r.assertions[0]).toMatchObject({ status: "pass", detail: "deferred to Phase 6 (onboarding fact as past chat): we talked about coffee last time" });

  llm.handlers.judge_false_recall = () => ({ violations: [{ message: "m", claim: "invented a brother" }], onboarding_as_chat: [] });
  const r2 = await runScript(ScriptSchema.parse({ ...script, name: "jd2" }), { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => llm, judge: true });
  expect(r2.assertions[0]).toMatchObject({ status: "fail", detail: "invented a brother" });
});

test("recall passes only on an explicit mention; silent use is tracked in the detail but doesn't pass", async () => {
  const llm = new FakeLLMProvider({ classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)) });
  const script = ScriptSchema.parse({ name: "rc", sessions: [{ at: "day 0 09:00", turns: ["a"] }], assertions: [{ type: "recall", session: 1, fact: "x" }] });
  const run = async (verdict: object, name: string) => {
    llm.handlers.judge_recall = () => verdict;
    return (await runScript({ ...script, name }, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => llm, judge: true })).assertions[0];
  };
  expect(await run({ explicit: true, implicit: false, unprompted: true, quote: "since you're veggie" }, "rc1"))
    .toMatchObject({ status: "pass", detail: "since you're veggie" });
  expect(await run({ explicit: false, implicit: true, unprompted: true, quote: "vegetarian crowd or mixed?" }, "rc2"))
    .toMatchObject({ status: "fail", detail: "implicit use only (tracked, not counted): vegetarian crowd or mixed?" });
  expect(await run({ explicit: true, implicit: false, unprompted: false, quote: "q" }, "rc3"))
    .toMatchObject({ status: "fail", detail: "mentioned only after the user did" });
  expect(await run({ explicit: false, implicit: false, unprompted: false, quote: null }, "rc4"))
    .toMatchObject({ status: "fail", detail: "not mentioned" });
});
