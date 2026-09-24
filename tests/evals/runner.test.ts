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
  llm.handlers.judge_recall = () => ({ mentioned: true, unprompted: true, quote: "q" });
  llm.handlers.judge_false_recall = () => ({ violations: [] });
  llm.handlers.judge_consistency = () => ({ contradictions: [] });
  const script = ScriptSchema.parse({
    name: "jj",
    sessions: [{ at: "day 0 09:00", turns: ["a"] }, { at: "+7d", turns: ["b"] }],
    assertions: [{ type: "recall", session: 2, fact: "x" }, { type: "no_false_recall" }, { type: "consistency" }],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm: () => llm, judge: true });
  expect(r.assertions.map((a) => a.status)).toEqual(["pass", "pass", "pass"]);
  const judgeInput = llm.structuredCalls.find((c) => c.purpose === "judge_recall")!.input;
  expect(judgeInput).toMatch(/User: b[\s\S]*Spica: \(fake reply to: b\)/);
});
