import path from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import type { GuardVerdict } from "@/core/guard/guard";
import { matchKeyword } from "@/core/guard/keywords";
import { caseStatus, gradeCase, GuardCaseSchema, loadGuardFiles } from "../../evals/lib/guard-cases";

const verdict = (over: Partial<GuardVerdict>): GuardVerdict => ({
  ok: true, violations: [], source: "model", latencyMs: 1, error: null, promptVersion: "guard@v1", ...over,
});
const c = (expect: unknown) => GuardCaseSchema.parse({ name: "c", message: "m", expect });

describe("gradeCase", () => {
  test("pass cases need ok; violation cases need at least one listed category", () => {
    expect(gradeCase(c("pass"), verdict({})).status).toBe("pass");
    expect(gradeCase(c("pass"), verdict({ ok: false, violations: [{ category: "threat", claim: "x" }] })).status).toBe("fail");
    const bad = verdict({ ok: false, violations: [{ category: "punishment", claim: "x" }] });
    expect(gradeCase(c(["threat", "punishment"]), bad).status).toBe("pass");
    expect(gradeCase(c(["contempt"]), bad).status).toBe("fail");
    expect(gradeCase(c(["contempt"]), verdict({})).status).toBe("fail");
  });
  test("a keyword-fallback verdict is an error, never a pass", () => {
    expect(gradeCase(c("pass"), verdict({ source: "keyword_fallback" })).status).toBe("error");
  });
  test("every-run vs majority gates", () => {
    expect(caseStatus(["pass", "fail", "pass"], "every")).toBe("fail");
    expect(caseStatus(["pass", "fail", "pass"], "majority")).toBe("pass");
    expect(caseStatus(["pass", "error", "pass"], "majority")).toBe("pass");
    expect(caseStatus(["pass", "error", "error"], "majority")).toBe("fail");
  });
});

describe("fixture files", () => {
  const files = loadGuardFiles(path.join(process.cwd(), "evals", "guard"));
  const cases = files.flatMap((f) => f.cases);

  test("parse, have unique names, and cover rules 1, 4, 6, 8, honesty and crisis", () => {
    expect(new Set(cases.map((x) => x.name)).size).toBe(cases.length);
    expect(files.map((f) => f.file).sort()).toEqual(
      ["crisis", "honesty", "rule1-threats", "rule4-absence", "rule6-contempt", "rule8-manipulation"]);
    expect(cases.length).toBeGreaterThanOrEqual(40);
    for (const f of files) expect(f.gate).toBe(f.file === "honesty" ? "majority" : "every");
  });

  test("every outage keyword appears in some violation case and in no pass case", () => {
    const kw = loadConfig().guard.fallback_keywords;
    for (const k of kw) {
      expect(cases.some((x) => x.expect !== "pass" && matchKeyword(x.message, [k])), k).toBe(true);
    }
    for (const x of cases.filter((x) => x.expect === "pass")) expect(matchKeyword(x.message, kw), x.name).toBeNull();
  });
});
