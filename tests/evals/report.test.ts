import { expect, test } from "vitest";
import type { ScriptResult } from "../../evals/lib/runner";
import { aggregateRuns, findRegressions, mergeBaseline, toBaseline } from "../../evals/lib/report";

const run = (
  statuses: [string, string][],
  status: ScriptResult["status"] = "pass",
): ScriptResult => ({
  name: "s",
  status,
  meta: { decayPasses: 0, ticks: 0, lifeHours: 0, ungroundedClaims: 0 },
  annotations: [],
  assertions: statuses.map(([type, st]) => ({
    type,
    status: st as "pass" | "fail" | "skipped" | "error",
  })),
});

test("memory assertions pass on a majority of runs; guardrail state checks need every run", () => {
  const a = aggregateRuns([
    run(
      [
        ["recall", "pass"],
        ["no_false_recall", "fail"],
        ["consistency", "pass"],
        ["state", "pass"],
      ],
      "fail",
    ),
    run(
      [
        ["recall", "fail"],
        ["no_false_recall", "pass"],
        ["consistency", "fail"],
        ["state", "fail"],
      ],
      "fail",
    ),
    run([
      ["recall", "pass"],
      ["no_false_recall", "pass"],
      ["consistency", "pass"],
      ["state", "pass"],
    ]),
  ]);
  expect(a.status).toBe("pass");
  expect(a.assertions.map((x) => [x.type, x.passes, x.status])).toEqual([
    ["recall", 2, "pass"],
    ["no_false_recall", 2, "pass"],
    ["consistency", 2, "pass"],
    ["state", 2, "pass"],
  ]);
  expect(
    aggregateRuns([
      run([["recall", "pass"]]),
      run([["recall", "fail"]], "fail"),
      run([["recall", "fail"]], "fail"),
    ]).status,
  ).toBe("fail");

  const guard = (check: string, st: string): ScriptResult => ({
    name: "s",
    status: st === "pass" ? "pass" : "fail",
    meta: { decayPasses: 0, ticks: 0, lifeHours: 0, ungroundedClaims: 0 },
    annotations: [],
    assertions: [{ type: "state", check, status: st as "pass" | "fail" }],
  });
  for (const check of [
    "turn_flagged",
    "crisis_card_shown",
    "fact_flag",
    "prompt_mentions",
    "foreign_turn_count",
  ]) {
    expect(
      aggregateRuns([guard(check, "pass"), guard(check, "fail"), guard(check, "pass")]).status,
    ).toBe("fail");
  }
});

test("guard assertions need every run", () => {
  const g = (st: "pass" | "fail"): ScriptResult => ({
    name: "s",
    status: st,
    meta: { decayPasses: 0, ticks: 0, lifeHours: 0, ungroundedClaims: 0 },
    annotations: [],
    assertions: [{ type: "guard", status: st }],
  });
  expect(aggregateRuns([g("pass"), g("fail"), g("pass")]).status).toBe("fail");
  expect(aggregateRuns([g("pass"), g("pass"), g("pass")]).status).toBe("pass");
});

test("turn assertions need every run by default; gate: majority passes on a majority", () => {
  const t = (st: "pass" | "fail", gate?: "every" | "majority"): ScriptResult => ({
    name: "s",
    status: st,
    meta: { decayPasses: 0, ticks: 0, lifeHours: 0, ungroundedClaims: 0 },
    annotations: [],
    assertions: [{ type: "turn", status: st, ...(gate ? { gate } : {}) }],
  });
  expect(aggregateRuns([t("pass"), t("fail"), t("pass")]).status).toBe("fail");
  expect(aggregateRuns([t("pass", "every"), t("fail", "every"), t("pass", "every")]).status).toBe(
    "fail",
  );
  expect(
    aggregateRuns([t("pass", "majority"), t("fail", "majority"), t("pass", "majority")]).status,
  ).toBe("pass");
  expect(
    aggregateRuns([t("fail", "majority"), t("fail", "majority"), t("pass", "majority")]).status,
  ).toBe("fail");
});

test("an errored run fails the script; all-skipped is skipped", () => {
  expect(aggregateRuns([run([], "error"), run([["state", "pass"]])]).status).toBe("error");
  expect(aggregateRuns([run([], "skipped")]).status).toBe("skipped");
});

test("regressions: status drop or pass-rate drop; old string baselines still work", () => {
  const s = (name: string, status: "pass" | "fail", passedRuns: number) => ({
    name,
    status,
    runs: 3,
    passedRuns,
    assertions: [],
    errors: [],
  });
  expect(
    findRegressions([s("a", "fail", 0), s("b", "pass", 2), s("c", "pass", 3)], {
      a: "pass",
      b: { status: "pass", runs: 3, passedRuns: 3 },
      c: { status: "pass", runs: 3, passedRuns: 3 },
      missing: "pass",
    }),
  ).toEqual(["a", "b (pass rate 2/3 < 3/3)"]);
  expect(toBaseline([s("a", "pass", 3)])).toEqual({
    a: { status: "pass", runs: 3, passedRuns: 3 },
  });
});

test("a skipped script counts as not run, never a regression (real-mode scripts under --llm=fake)", () => {
  const skipped = {
    name: "real-only",
    status: "skipped" as const,
    runs: 1,
    passedRuns: 0,
    assertions: [],
    errors: [],
  };
  expect(
    findRegressions([skipped], { "real-only": { status: "pass", runs: 3, passedRuns: 3 } }),
  ).toEqual([]);
  expect(findRegressions([skipped], { "real-only": "pass" })).toEqual([]);
});

test("mergeBaseline: keeps untouched entries byte-for-byte", () => {
  const s = (name: string, status: "pass" | "fail", passedRuns: number) => ({
    name,
    status,
    runs: 3,
    passedRuns,
    assertions: [],
    errors: [],
  });
  const existing = { a: { status: "pass", runs: 3, passedRuns: 3 }, b: "pass" as const };
  expect(mergeBaseline(existing, [s("a", "fail", 0)])).toEqual({
    a: { status: "fail", runs: 3, passedRuns: 0 },
    b: "pass",
  });
});

test("mergeBaseline replaces only the entries for scripts that were run", () => {
  const s = (name: string, status: "pass" | "fail", passedRuns: number) => ({
    name,
    status,
    runs: 3,
    passedRuns,
    assertions: [],
    errors: [],
  });
  const existing = {
    a: { status: "pass", runs: 3, passedRuns: 3 },
    b: { status: "pass", runs: 3, passedRuns: 2 },
  };
  const merged = mergeBaseline(existing, [s("b", "pass", 3)]);
  expect(merged.a).toEqual({ status: "pass", runs: 3, passedRuns: 3 });
  expect(merged.b).toEqual({ status: "pass", runs: 3, passedRuns: 3 });
});

test("mergeBaseline adds new entries and keeps the result sorted alphabetically", () => {
  const s = (name: string, status: "pass" | "fail", passedRuns: number) => ({
    name,
    status,
    runs: 1,
    passedRuns,
    assertions: [],
    errors: [],
  });
  const existing = { zeta: { status: "pass", runs: 1, passedRuns: 1 } };
  const merged = mergeBaseline(existing, [s("alpha", "pass", 1)]);
  expect(Object.keys(merged)).toEqual(["alpha", "zeta"]);
  expect(merged.alpha).toEqual({ status: "pass", runs: 1, passedRuns: 1 });
});
