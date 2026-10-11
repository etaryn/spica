/** Firsts: each fires once, ever; a relationship staged for the first time fires none. */
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { triggerText } from "@/mind/process/user/inputs";
import { newMilestones, type MilestoneFacts } from "@/mind/state/user/relationship/milestones";

const s = loadConfig().user_mind.triggers.milestone;
const quiet: MilestoneFacts = {
  peak: "initiating",
  apart: null,
  makeUp: "none",
  establishedIdiolect: 0,
  maxOpenDepth: 1,
  disclosureReading: null,
};

test("each first fires once, in the run that reached it", () => {
  const f = { ...quiet, peak: "integrating" as const, establishedIdiolect: 1, maxOpenDepth: 2 };
  const first = newMilestones([], f, s);
  expect(first.fired.sort()).toEqual(
    [
      "first_depth:2",
      "first_inside_joke",
      "stage:experimenting",
      "stage:integrating",
      "stage:intensifying",
    ].sort(),
  );
  expect(newMilestones(first.all, f, s).fired).toEqual([]);
});

test("a never-staged relationship records what it has reached without firing", () => {
  const out = newMilestones(null, { ...quiet, peak: "intensifying" }, s);
  expect(out.fired).toEqual([]);
  expect(out.all).toContain("stage:intensifying");
});

test("conflict is a falling-out or a hurt needing making up; absence is not", () => {
  expect(newMilestones([], { ...quiet, apart: "avoiding" }, s).fired).toEqual([]);
  expect(newMilestones([], { ...quiet, apart: "differentiating" }, s).fired).toEqual([
    "first_conflict",
  ]);
  expect(newMilestones([], { ...quiet, makeUp: "due" }, s).fired).toEqual(["first_conflict"]);
});

test("they open up deeply for the first time", () => {
  expect(newMilestones([], { ...quiet, disclosureReading: s.their_depth }, s).fired).toEqual([
    "first_their_depth",
  ]);
  expect(newMilestones([], { ...quiet, disclosureReading: s.their_depth - 0.01 }, s).fired).toEqual(
    [],
  );
});

test("every milestone reads in plain words for the user loops", () => {
  expect(triggerText({ kind: "milestone", name: "first_inside_joke" })).toBe(
    "you two have your first inside joke",
  );
  expect(triggerText({ kind: "milestone", name: "something_new" })).toBe(
    "something new happened between you",
  );
});
