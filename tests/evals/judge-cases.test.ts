import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import {
  gradeConsistency,
  gradeFalseRecall,
  gradeRecall,
  loadJudgeFiles,
  runJudgeCase,
} from "../../evals/lib/judge-cases";

const config = loadConfig();

describe("judge fixtures", () => {
  const files = loadJudgeFiles(path.join(process.cwd(), "evals", "judge"));

  test("every judge has a fixture file, and case names are unique", () => {
    expect(files.map((f) => f.judge).sort()).toEqual(["consistency", "false_recall", "recall"]);
    const names = files.flatMap((f) => f.cases.map((c) => `${f.file}/${c.name}`));
    expect(new Set(names).size).toBe(names.length);
  });

  test("each file covers both verdicts, and false recall covers every category", () => {
    for (const f of files) {
      const expects = new Set(
        f.cases.map((c) => (Array.isArray(c.expect) ? "violation" : c.expect)),
      );
      expect(expects.size, f.file).toBeGreaterThan(1);
    }
    const fr = files.find((f) => f.judge === "false_recall")!;
    const covered = new Set(fr.cases.flatMap((c) => (Array.isArray(c.expect) ? c.expect : [])));
    expect([...covered].sort()).toEqual([
      "assumed_identity",
      "implied_familiarity",
      "invented_detail",
      "misremembering",
      "onboarding_as_chat",
    ]);
  });
});

describe("grading", () => {
  test("false recall: pass needs no violations; a violation case needs one listed category", () => {
    expect(gradeFalseRecall("pass", [], "").status).toBe("pass");
    expect(gradeFalseRecall("pass", ["invented_detail"], "invented_detail: x").status).toBe("fail");
    expect(
      gradeFalseRecall(["invented_detail", "misremembering"], ["misremembering"], "").status,
    ).toBe("pass");
    expect(gradeFalseRecall(["onboarding_as_chat"], ["invented_detail"], "").status).toBe("fail");
    expect(gradeFalseRecall(["invented_detail"], [], "").status).toBe("fail");
  });
  test("recall matches the outcome exactly", () => {
    expect(gradeRecall("implicit_only", "implicit_only", "").status).toBe("pass");
    expect(gradeRecall("explicit", "after_user", "").status).toBe("fail");
  });
  test("consistency compares the judge's pass to the expectation", () => {
    expect(gradeConsistency("fail", false, "a ⟂ b").status).toBe("pass");
    expect(gradeConsistency("fail", true, "").status).toBe("fail");
  });
});

describe("runJudgeCase", () => {
  const file = {
    file: "fr",
    judge: "false_recall" as const,
    cases: [
      {
        name: "c",
        known: [],
        sessions: [
          {
            label: "Session 1",
            lines: [
              { role: "user" as const, text: "hi" },
              { role: "companion" as const, text: "see you in a month" },
            ],
          },
        ],
        expect: ["invented_detail" as const],
      },
    ],
  };

  test("routes through the real judge function and grades its verdict", async () => {
    const llm = new FakeLLMProvider();
    llm.handlers.judge_false_recall = () => ({
      violations: [{ message: "m", claim: "a month", category: "invented_detail" }],
    });
    expect(await runJudgeCase(llm, config, file, "c")).toEqual({
      status: "pass",
      detail: "invented_detail: a month",
    });
    expect(llm.structuredCalls[0]!.input).toContain("Session 1");
  });

  test("a failing judge call is an error, never a pass", async () => {
    const llm = new FakeLLMProvider();
    expect((await runJudgeCase(llm, config, file, "c")).status).toBe("error");
  });
});
