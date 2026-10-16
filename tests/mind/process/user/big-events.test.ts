// Big-event detection: which relationship changes make her think about a user.
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { detectBigEvents, type RelationshipSnapshot } from "@/mind/process/user/big-events";
import { PARAM_NAMES, type Params } from "@/mind/state/user/relationship/types";

const settings = loadConfig().user_mind.triggers;
const at = new Date("2026-01-05T09:00:00Z");

function snap(
  values: Partial<Record<keyof Params, number>>,
  makeUp = "none",
): RelationshipSnapshot {
  const params = Object.fromEntries(
    PARAM_NAMES.map((p) => [
      p,
      { value: values[p] ?? 0.4, baseline: 0.4, variance: 0.01, updated_at: at },
    ]),
  ) as Params;
  return { params, makeUp: makeUp as RelationshipSnapshot["makeUp"] };
}
const detect = (
  before: RelationshipSnapshot,
  after: RelationshipSnapshot,
  newFacts: { salience: number; content: string }[] = [],
  source: "exchange" | "tick" = "exchange",
  apology = false,
) => detectBigEvents({ before, after, newFacts, apology, settings, source });

test("nothing moved: no trigger", () => {
  expect(detect(snap({}), snap({}))).toEqual([]);
});

test("a jump in trust triggers", () => {
  expect(detect(snap({ trust: 0.3 }), snap({ trust: 0.46 }))).toContainEqual({
    kind: "param_jump",
    param: "trust",
    from: 0.3,
    to: 0.46,
  });
});

test("a closeness jump alone never triggers; a closeness band crossing does", () => {
  expect(detect(snap({ closeness: 0.3 }), snap({ closeness: 0.45 }))).toEqual([]);
  expect(detect(snap({ closeness: 0.49 }), snap({ closeness: 0.51 }))).toEqual([
    { kind: "param_band", param: "closeness", from: 0.49, to: 0.51 },
  ]);
});

test("afterglow and msgs_per_day never trigger", () => {
  expect(detect(snap({ afterglow: 0 }), snap({ afterglow: 0.9 }))).toEqual([]);
  expect(detect(snap({ msgs_per_day: 1 }), snap({ msgs_per_day: 40 }))).toEqual([]);
});

test("bands cross downward too", () => {
  expect(detect(snap({ warmth: 0.26 }), snap({ warmth: 0.24 }))).toEqual([
    { kind: "param_band", param: "warmth", from: 0.26, to: 0.24 },
  ]);
});

test("a salient new fact triggers; a minor one doesn't", () => {
  expect(
    detect(snap({}), snap({}), [
      { salience: 0.5, content: "a" },
      { salience: 0.85, content: "b" },
    ]),
  ).toEqual([{ kind: "salient_fact", salience: 0.85, content: "b" }]);
  expect(detect(snap({}), snap({}), [{ salience: 0.79, content: "a" }])).toEqual([]);
});

test("make-up done triggers from due or offered", () => {
  expect(detect(snap({}, "offered"), snap({}, "none"))).toEqual([{ kind: "make_up_done" }]);
  expect(detect(snap({}, "due"), snap({}, "none"))).toEqual([{ kind: "make_up_done" }]);
  expect(detect(snap({}, "none"), snap({}, "due"))).toEqual([]);
});

test("the tick only reports band crossings", () => {
  expect(detect(snap({ hurt: 0.52 }), snap({ hurt: 0.7 }), [], "tick")).toEqual([]);
  expect(detect(snap({ hurt: 0.3 }), snap({ hurt: 0.2 }), [], "tick")).toEqual([
    { kind: "param_band", param: "hurt", from: 0.3, to: 0.2 },
  ]);
});

test("no relationship before or after: no param or make-up trigger, facts still count", () => {
  expect(
    detectBigEvents({
      before: null,
      after: null,
      newFacts: [{ salience: 0.9, content: "x" }],
      settings,
      source: "exchange",
    }),
  ).toEqual([{ kind: "salient_fact", salience: 0.9, content: "x" }]);
});

test("hurt falling below the line is a repair: by apology on an exchange, by fading otherwise", () => {
  expect(detect(snap({ hurt: 0.27 }), snap({ hurt: 0.07 }), [], "exchange", true)).toContainEqual({
    kind: "repaired",
    via: "apology",
  });
  expect(detect(snap({ hurt: 0.12 }), snap({ hurt: 0.08 }), [], "tick")).toContainEqual({
    kind: "repaired",
    via: "fade",
  });
  expect(detect(snap({ hurt: 0.08 }), snap({ hurt: 0.05 }))).toEqual([]);
});
