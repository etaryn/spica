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
      { type: "recall", session: 2 },
    ],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm });
  expect(r.status).toBe("pass");
  expect(r.assertions.map((a) => a.status)).toEqual(["pass", "pass", "pass", "skipped"]);
});

test("a wrong expectation fails with a readable detail", async () => {
  const script = ScriptSchema.parse({
    name: "t2",
    sessions: [{ at: "day 0 09:00", turns: ["a"] }],
    assertions: [{ type: "state", check: "turn_count", expect: 99 }],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm });
  expect(r.status).toBe("fail");
  expect(r.assertions[0]!.detail).toMatch(/expected 99, got 2/);
});

test("unknown check is an error, not a pass", async () => {
  const script = ScriptSchema.parse({
    name: "t3",
    sessions: [{ at: "day 0 09:00", turns: ["a"] }],
    assertions: [{ type: "state", check: "nope", expect: 1 }],
  });
  const r = await runScript(script, { db: getTestDb(), dbUrl: testDbUrl, config, makeLlm });
  expect(r.status).toBe("fail");
  expect(r.assertions[0]!.status).toBe("error");
});
