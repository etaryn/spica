import { expect, test } from "vitest";
import { ALL_PURPOSES, JUDGE_PURPOSES, resolveProfile } from "../../evals/lib/profile";

test("fake by default: nothing real, mode: real scripts stay skipped", () => {
  const p = resolveProfile({ llm: "fake" });
  expect([...p.realPurposes]).toEqual([]);
  expect(p).toMatchObject({ anyReal: false, realScripts: false, realCalls: [] });
  expect(p.fake).toEqual([...ALL_PURPOSES, ...JUDGE_PURPOSES]);
});

test("--real turn_judge (the Phase 3 exit profile) makes real calls but does not unlock mode: real scripts", () => {
  const p = resolveProfile({ llm: "fake", real: "turn_judge" });
  expect([...p.realPurposes]).toEqual(["turn_judge"]);
  expect(p).toMatchObject({ anyReal: true, realScripts: false, realCalls: ["turn_judge"] });
});

test("--annotate adds the judge purposes but does not unlock mode: real scripts", () => {
  const p = resolveProfile({ llm: "fake", annotate: true });
  expect([...p.realPurposes]).toEqual(JUDGE_PURPOSES);
  expect(p).toMatchObject({ anyReal: true, realScripts: false });
});

test("a real reply unlocks mode: real scripts; --llm=real means every purpose", () => {
  expect(resolveProfile({ llm: "fake", real: "reply,extract" }).realScripts).toBe(true);
  const all = resolveProfile({ llm: "real" });
  expect([...all.realPurposes]).toEqual(ALL_PURPOSES);
  expect(all.realScripts).toBe(true);
  expect(all.realCalls).not.toContain("embed");
});

test("rejects unknown purposes, an unknown --llm, and --real combined with --llm=real", () => {
  expect(() => resolveProfile({ llm: "fake", real: "turn_judge,nope" })).toThrow(/unknown purpose nope.*reply, crisis/);
  expect(() => resolveProfile({ llm: "maybe" })).toThrow(/--llm must be fake or real/);
  expect(() => resolveProfile({ llm: "real", real: "turn_judge" })).toThrow(/--real cannot be combined with --llm=real/);
});
