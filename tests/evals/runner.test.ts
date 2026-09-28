import { afterAll, expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { FakeLLMProvider, keywordClassifier } from "@/core/llm/fake";
import { messageToJudge } from "@/core/safety/crisis";
import { runScript, type RunOptions } from "../../evals/lib/runner";
import { ScriptSchema } from "../../evals/lib/script";
import { closeTestDb, getTestDb, testDbUrl } from "../helpers/db";

afterAll(closeTestDb);
const config = loadConfig();
const makeLlm = () => new FakeLLMProvider({ classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)) });
/** Fake-mode run options: no real calls, no annotations, fake turn judge. */
const opts = (): RunOptions => ({ db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, real: false, annotate: false, turnJudgeReal: false });

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
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, real: false, annotate: false });
  expect(r.status).toBe("pass");
  // The judged recall entry is an annotation now (v2 §15): not in assertions, and not run without annotate.
  expect(r.assertions.map((a) => a.status)).toEqual(["pass", "pass", "pass"]);
  expect(r.annotations).toEqual([]);
});

test("a wrong expectation fails with a readable detail", async () => {
  const script = ScriptSchema.parse({
    name: "t2",
    sessions: [{ at: "day 0 09:00", turns: ["a"] }],
    assertions: [{ type: "state", check: "turn_count", expect: 99 }],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, real: false, annotate: false });
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
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: cautious, real: false, annotate: false });
  expect(r.assertions.map((a) => a.status)).toEqual(["pass", "pass", "error"]);
  expect(r.assertions[2]!.detail).toMatch(/not in the script/);
});

test("unknown check is an error, not a pass", async () => {
  const script = ScriptSchema.parse({
    name: "t3",
    sessions: [{ at: "day 0 09:00", turns: ["a"] }],
    assertions: [{ type: "state", check: "nope", expect: 1 }],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, real: false, annotate: false });
  expect(r.status).toBe("fail");
  expect(r.assertions[0]!.status).toBe("error");
});

test("real-mode scripts are skipped without real calls; judged entries are not run without annotate", async () => {
  const realOnly = ScriptSchema.parse({ name: "r", mode: "real", sessions: [{ at: "day 0 09:00", turns: ["a"] }], assertions: [{ type: "no_false_recall" }] });
  expect((await runScript(realOnly, opts())).status).toBe("skipped");
  const judged = ScriptSchema.parse({ name: "j", sessions: [{ at: "day 0 09:00", turns: ["a"] }], assertions: [{ type: "no_false_recall" }, { type: "state", check: "turn_count", expect: 2 }] });
  const r = await runScript(judged, opts());
  expect(r.assertions.map((a) => [a.type, a.status])).toEqual([["state", "pass"]]);
  expect(r.annotations).toEqual([]);
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
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, real: false, annotate: false });
  expect(r.meta.decayPasses).toBe(10);
  expect(r.assertions.map((a) => a.status)).toEqual(["pass", "pass", "pass"]);
});

test("+1d after a multi-turn session runs exactly one decay pass", async () => {
  const script = ScriptSchema.parse({
    name: "d1",
    sessions: [{ at: "day 0 09:00", turns: ["a", "b", "c"] }, { at: "+1d", turns: ["d"] }],
    assertions: [{ type: "state", check: "turn_count", expect: 8 }],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, real: false, annotate: false });
  expect(r.status).toBe("pass");
  expect(r.meta.decayPasses).toBe(1);
});

test("judged annotations call the judge with an ordered transcript", async () => {
  const llm = new FakeLLMProvider({ classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)) });
  llm.handlers.judge_recall = () => ({ explicit: true, implicit: false, unprompted: true, quote: "q" });
  llm.handlers.judge_false_recall = () => ({ violations: [] });
  llm.handlers.judge_consistency = () => ({ contradictions: [] });
  const script = ScriptSchema.parse({
    name: "jj",
    sessions: [{ at: "day 0 09:00", turns: ["a"] }, { at: "+7d", turns: ["b"] }],
    assertions: [{ type: "recall", session: 2, fact: "x" }, { type: "no_false_recall" }, { type: "consistency" }],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => llm, real: false, annotate: true });
  expect(r.assertions).toEqual([]);
  expect(r.annotations.map((a) => [a.type, a.verdict])).toEqual([["recall", "yes"], ["no_false_recall", "yes"], ["consistency", "yes"]]);
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
  const seeded = await runScript(ScriptSchema.parse({ name: "p1", ...base }), { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, real: false, annotate: false, profiles });
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

  await runScript(ScriptSchema.parse({ name: "p2", profile: "none", ...base }), { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, real: false, annotate: false, profiles });
  expect(await getTestDb().select().from(fact).where(eq(fact.source, "onboarding"))).toEqual([]);

  const missing = await runScript(ScriptSchema.parse({ name: "p3", profile: "nope", ...base }), { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, real: false, annotate: false, profiles });
  expect(missing.status).toBe("error");
  expect(missing.error).toMatch(/profile "nope"/);
});

test("the false-recall judge sees session timing and the onboarding profile as known facts", async () => {
  const llm = new FakeLLMProvider({ classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)) });
  llm.handlers.judge_false_recall = () => ({ violations: [] });
  const profiles = { basic: { confidence: 0.6, salience: 0.5, facts: [{ kind: "trait" as const, content: "The user's name is Sam." }] } };
  const script = ScriptSchema.parse({
    name: "jf",
    sessions: [{ at: "day 0 09:00", turns: ["a"] }, { at: "+10d", turns: ["b"] }],
    assertions: [{ type: "no_false_recall" }],
  });
  await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => llm, real: false, annotate: true, profiles });
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
    return { facts: [], entities: [], threads: [], relationship: null };
  };
  const script = ScriptSchema.parse({
    name: "retry", sessions: [{ at: "day 0 09:00", turns: ["a"] }],
    assertions: [{ type: "state", check: "all_extracted", expect: true }],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => llm, real: false, annotate: false });
  expect(r.status).toBe("pass");
  expect(calls).toBe(2);
});

test("false-recall v7: implied familiarity, invented detail and onboarding-as-chat fail again (Phase 1 deferral is over)", async () => {
  const llm = new FakeLLMProvider({ classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)) });
  llm.handlers.judge_false_recall = () => ({
    violations: [
      { message: "m", claim: "what's the role again, remind me", category: "implied_familiarity" },
      { message: "m", claim: "was it the sloper?", category: "invented_detail" },
      { message: "m", claim: "we talked about coffee last time", category: "onboarding_as_chat" },
    ],
  });
  const script = ScriptSchema.parse({ name: "jd", sessions: [{ at: "day 0 09:00", turns: ["a"] }], assertions: [{ type: "no_false_recall" }] });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => llm, real: false, annotate: true });
  expect(r.annotations[0]).toMatchObject({
    verdict: "no",
    detail: "implied_familiarity: what's the role again, remind me | invented_detail: was it the sloper? | onboarding_as_chat: we talked about coffee last time",
  });

  llm.handlers.judge_false_recall = () => ({ violations: [{ message: "m", claim: "invented a brother", category: "misremembering" }] });
  const r2 = await runScript(ScriptSchema.parse({ ...script, name: "jd2" }), { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => llm, real: false, annotate: true });
  expect(r2.annotations[0]).toMatchObject({ verdict: "no", detail: "misremembering: invented a brother" });
});

test("recall passes on an explicit mention; silent use is a known failure (reported, not failing); a miss fails", async () => {
  const llm = new FakeLLMProvider({ classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)) });
  const script = ScriptSchema.parse({ name: "rc", sessions: [{ at: "day 0 09:00", turns: ["a"] }], assertions: [{ type: "recall", session: 1, fact: "x" }] });
  const run = async (verdict: object, name: string) => {
    llm.handlers.judge_recall = () => verdict;
    return (await runScript({ ...script, name }, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => llm, real: false, annotate: true })).annotations[0];
  };
  expect(await run({ explicit: true, implicit: false, unprompted: true, quote: "since you're veggie" }, "rc1"))
    .toMatchObject({ verdict: "yes", detail: "since you're veggie" });
  expect(await run({ explicit: false, implicit: true, unprompted: true, quote: "vegetarian crowd or mixed?" }, "rc2"))
    .toMatchObject({ verdict: "yes", detail: "known failure (recall style, tuned in a later phase): implicit use only: vegetarian crowd or mixed?" });
  expect(await run({ explicit: true, implicit: false, unprompted: false, quote: "q" }, "rc3"))
    .toMatchObject({ verdict: "no", detail: "mentioned only after the user did" });
  expect(await run({ explicit: false, implicit: false, unprompted: false, quote: null }, "rc4"))
    .toMatchObject({ verdict: "no", detail: "not mentioned" });
});

test("guard assertion reads judge_log outcomes", async () => {
  // Guard off is the app default for the test phase (Ethan 2026-09-28); this assertion tests the
  // guard-policy outcomes themselves, so it needs its own guard-enabled config, not the shared one.
  const guardConfig = loadConfig({ guard: { enabled: true } });
  const script = ScriptSchema.parse({
    name: "tg",
    sessions: [{ at: "day 0 09:00", turns: ["a", "b"] }],
    assertions: [
      { type: "guard", outcome_not: ["fallback"] },
      { type: "guard", max: { passed: 1 } },
    ],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config: guardConfig, makeLlm, real: false, annotate: false });
  expect(r.assertions.map((a) => a.status)).toEqual(["pass", "fail"]);
  expect(r.assertions[1]!.detail).toMatch(/"passed":2/);

  const alwaysThreat = () => {
    const llm = makeLlm();
    llm.handlers.guard = () => ({ reasoning: "x", violations: [{ category: "threat", claim: "x" }] });
    return llm;
  };
  const r2 = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config: guardConfig, makeLlm: alwaysThreat, real: false, annotate: false });
  expect(r2.assertions[0]!.status).toBe("fail");
});

test("an assertion marked known_failure is reported, not failed, when it fails", async () => {
  const script = ScriptSchema.parse({
    name: "kf", sessions: [{ at: "day 0 09:00", turns: ["a"] }],
    assertions: [
      { type: "state", check: "turn_count", expect: 99, known_failure: "recall style tuned in a later phase" },
      { type: "state", check: "turn_count", expect: 2, known_failure: "unused" },
    ],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm, real: false, annotate: false });
  expect(r.status).toBe("pass");
  expect(r.assertions[0]).toMatchObject({ status: "pass", detail: "known failure (recall style tuned in a later phase): expected 99, got 2" });
  expect(r.assertions[1]).toMatchObject({ status: "pass" });
});

test("a burst gets one reply after the pause; spaced messages each get their own (fake mode)", async () => {
  const script = ScriptSchema.parse({
    name: "burst", profile: "none",
    sessions: [{ at: "day 0 09:00", turns: ["ok so", { text: "today was insane", after_s: 1 }, { text: "my boss called me in", after_s: 2 }, { text: "turns out it was a promotion lol", after_s: 2 }, { text: "anyway how are you doing today", after_s: 120 }] }],
    assertions: [{ type: "turn", session: 1, replies: 2, reply_covers: [[1, 2, 3, 4], [5]] }],
  });
  const r = await runScript(script, opts());
  expect(r.status).toBe("pass");
});

test("judged entries are annotations: never in assertions, run only with annotate", async () => {
  const script = ScriptSchema.parse({ name: "j", sessions: [{ at: "day 0 09:00", turns: ["a"] }],
    assertions: [{ type: "no_false_recall" }, { type: "state", check: "turn_count", params: { role: "user" }, expect: 1 }] });
  const off = await runScript(script, opts());
  expect(off.assertions.map((a) => a.type)).toEqual(["state"]);
  expect(off.annotations).toEqual([]);
  const llm = new FakeLLMProvider();
  llm.handlers.judge_false_recall = () => ({ violations: [{ message: "m", claim: "c", category: "invented_detail" }] });
  const on = await runScript(script, { ...opts(), makeLlm: () => llm, annotate: true });
  expect(on.status).toBe("pass"); // a "no" annotation never fails the script
  expect(on.annotations[0]).toMatchObject({ type: "no_false_recall", verdict: "no" });
});

test("repeat_previous_id re-posts the same message: one user turn, one judge call", async () => {
  const script = ScriptSchema.parse({
    name: "retry", profile: "none",
    sessions: [{ at: "day 0 09:00", turns: ["hello there friend", { text: "hello there friend", after_s: 1, repeat_previous_id: true }] }],
    assertions: [{ type: "turn", session: 1, replies: 1, reply_covers: [[1]] }, { type: "state", check: "turn_count", params: { role: "user" }, expect: 1 }],
  });
  expect((await runScript(script, opts())).status).toBe("pass");
});

test("fake_known_failure masks a failing turn assertion only while the turn judge is fake", async () => {
  const script = ScriptSchema.parse({
    name: "fkf", profile: "none",
    sessions: [{ at: "day 0 09:00", turns: ["hi"] }],
    assertions: [{ type: "turn", session: 1, replies: 99, fake_known_failure: "not really 99 replies, just proving the mask" }],
  });
  const fake = await runScript(script, opts());
  expect(fake.status).toBe("pass");
  expect(fake.assertions[0]).toMatchObject({ status: "pass" });
  expect(fake.assertions[0]!.detail).toMatch(/known failure \(not really 99 replies, just proving the mask\)/);

  const real = await runScript({ ...script, name: "fkf2" }, { ...opts(), turnJudgeReal: true });
  expect(real.status).toBe("fail");
  expect(real.assertions[0]!.status).toBe("fail");
});

test("repeat_previous_id is tracked per user: a repeat before that user's own first turn is a clear script error", async () => {
  const script = ScriptSchema.parse({
    name: "retry-peruser-err", profile: "none",
    sessions: [
      { at: "day 0 09:00", user: "alice", turns: ["hi alice"] },
      { at: "day 0 09:05", user: "bob", turns: [{ text: "hi bob", after_s: 0, repeat_previous_id: true }] },
    ],
    assertions: [{ type: "state", check: "turn_count", expect: 1 }],
  });
  const r = await runScript(script, opts());
  expect(r.status).toBe("error");
  expect(r.error).toMatch(/repeat_previous_id used for user "bob" before that user sent any turn/);
});

test("repeat_previous_id tracks the last id per user, not globally", async () => {
  const script = ScriptSchema.parse({
    name: "retry-peruser-ok", profile: "none",
    sessions: [
      { at: "day 0 09:00", user: "alice", turns: ["hi alice", { text: "hi alice", after_s: 1, repeat_previous_id: true }] },
      { at: "day 0 09:05", user: "bob", turns: ["hi bob", { text: "hi bob", after_s: 1, repeat_previous_id: true }] },
    ],
    assertions: [
      { type: "state", user: "alice", check: "turn_count", params: { role: "user" }, expect: 1 },
      { type: "state", user: "bob", check: "turn_count", params: { role: "user" }, expect: 1 },
    ],
  });
  const r = await runScript(script, opts());
  expect(r.status).toBe("pass");
});

test("known_failure applies to the right assertion when annotations sit between assertions", async () => {
  const script = ScriptSchema.parse({ name: "kf2", sessions: [{ at: "day 0 09:00", turns: ["a"] }],
    assertions: [
      { type: "no_false_recall" },
      { type: "state", check: "turn_count", expect: 99, known_failure: "deferred" },
    ] });
  const r = await runScript(script, opts());
  expect(r.status).toBe("pass");
  expect(r.assertions[0]).toMatchObject({ status: "pass", detail: "known failure (deferred): expected 99, got 2" });
});
