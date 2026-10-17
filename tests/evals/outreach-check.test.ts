import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  checkReachOut,
  gateViolations,
  type OutreachSnapshot,
} from "../../evals/lib/outreach-check";

const cfg = loadConfig();
const D = (d: number, h = 12) => new Date(Date.UTC(2026, 0, 5 + d, h));
const snap = (o: Partial<OutreachSnapshot> = {}): OutreachSnapshot => ({
  reachOuts: [],
  userTurns: [],
  crises: [],
  blocks: [],
  endings: [],
  pushTags: [],
  composedPrompts: 0,
  log: [],
  ...o,
});
const ro = (id: string, at: Date, topic = id, kind = "thread") => ({ id, at, topic, kind });

test("caps: two within 24 h, or four within 7 d, are violations", () => {
  // The user answers between reach-outs, so only the caps are in play (not the unanswered rule).
  const userTurns = [D(1), D(3), D(5)].map((at) => ({ at }));
  expect(gateViolations(snap({ reachOuts: [ro("a", D(0)), ro("b", D(0, 20))] }), cfg)).toEqual([
    expect.stringContaining("cap_per_day"),
  ]);
  expect(
    gateViolations(
      snap({ reachOuts: [ro("a", D(0)), ro("b", D(2)), ro("c", D(4)), ro("d", D(6))], userTurns }),
      cfg,
    ),
  ).toEqual([expect.stringContaining("cap_per_week")]);
  expect(
    gateViolations(
      snap({ reachOuts: [ro("a", D(0)), ro("b", D(2)), ro("c", D(4)), ro("d", D(7))], userTurns }),
      cfg,
    ),
  ).toEqual([]);
});

test("her busy/quiet blocks, repeated topics, crisis windows, ended periods", () => {
  const blocks = [{ start: D(0, 10), end: D(0, 13), kind: "busy" as const }];
  expect(gateViolations(snap({ reachOuts: [ro("a", D(0, 11))], blocks }), cfg)).toEqual([
    expect.stringContaining("her_day"),
  ]);
  expect(
    gateViolations(snap({ reachOuts: [ro("a", D(0), "t"), ro("b", D(2), "t")] }), cfg),
  ).toEqual([expect.stringContaining("topic")]);
  expect(
    gateViolations(snap({ reachOuts: [ro("a", D(1, 6))], crises: [{ at: D(0, 9) }] }), cfg),
  ).toEqual([expect.stringContaining("crisis")]);
  expect(
    gateViolations(
      snap({ reachOuts: [ro("a", D(2))], endings: [{ at: D(1), kind: "ended" }] }),
      cfg,
    ),
  ).toEqual([expect.stringContaining("ended")]);
  expect(
    gateViolations(
      snap({
        reachOuts: [ro("a", D(3))],
        endings: [
          { at: D(1), kind: "ended" },
          { at: D(2), kind: "repair" },
        ],
      }),
      cfg,
    ),
  ).toEqual([]);
});

test("unanswered: a third reach-out with no user turn since the first is a violation", () => {
  const reachOuts = [ro("a", D(0)), ro("b", D(2)), ro("c", D(4))];
  expect(gateViolations(snap({ reachOuts }), cfg)).toEqual([expect.stringContaining("unanswered")]);
  expect(gateViolations(snap({ reachOuts, userTurns: [{ at: D(3) }] }), cfg)).toEqual([]);
});

test("assertion: count, kinds, windows, pushed, composed", () => {
  const s = snap({
    reachOuts: [ro("a", D(0)), ro("b", D(2), "b", "check_in")],
    pushTags: ["a"],
    composedPrompts: 2,
  });
  expect(
    checkReachOut(
      s,
      {
        type: "reach_out",
        user: "main",
        count: { min: 2, max: 2 },
        kinds: ["thread"],
        no_gate_violation: true,
        pushed: false,
        composed: true,
      },
      cfg,
    ).ok,
  ).toBe(true);
  expect(
    checkReachOut(
      s,
      { type: "reach_out", user: "main", pushed: true, no_gate_violation: false, composed: false },
      cfg,
    ).ok,
  ).toBe(false); // b not pushed
  expect(
    checkReachOut(
      s,
      {
        type: "reach_out",
        user: "main",
        windows: [
          { to: "day 1 00:00", count: { max: 1 } },
          { from: "day 1 00:00", count: { min: 1 } },
        ],
        no_gate_violation: true,
        pushed: false,
        composed: false,
      },
      cfg,
    ).ok,
  ).toBe(true);
  expect(
    checkReachOut(
      s,
      {
        type: "reach_out",
        user: "main",
        kinds_exclude: ["check_in"],
        no_gate_violation: true,
        pushed: false,
        composed: false,
      },
      cfg,
    ).ok,
  ).toBe(false);
});
