import { expect, test } from "vitest";
import { checkEgo, checkLife, energyAt } from "../../evals/lib/life-check";
import { EgoAssertion, LifeAssertion } from "../../evals/lib/script";

const snap = {
  plans: 15,
  blockDays: 14,
  events: 2,
  logs: [{ content: "Spica hasn't started reading Middlemarch yet.", decision: "contradicts" }],
  facts: ["Spica finished reading Middlemarch last week."],
};

test("checkLife: counts, decisions and not_stored", () => {
  expect(
    checkLife(
      snap,
      LifeAssertion.parse({
        type: "life",
        plans: { min: 14 },
        block_days: { min: 14 },
        events: { min: 1 },
      }),
    ).ok,
  ).toBe(true);
  expect(
    checkLife(
      snap,
      LifeAssertion.parse({
        type: "life",
        decision: { content_includes: "hasn't started", in: ["contradicts", "duplicate"] },
      }),
    ).ok,
  ).toBe(true);
  expect(
    checkLife(
      snap,
      LifeAssertion.parse({
        type: "life",
        decision: { content_includes: "hasn't started", in: ["duplicate"] },
      }),
    ).detail,
  ).toMatch(/expected one of duplicate/);
  expect(
    checkLife(snap, LifeAssertion.parse({ type: "life", not_stored: "hasn't started" })).ok,
  ).toBe(true);
  expect(
    checkLife(snap, LifeAssertion.parse({ type: "life", not_stored: "finished reading" })).ok,
  ).toBe(false);
});

test("checkEgo: energyAt uses the latest tick at or before the time", () => {
  const d = (h: number) => new Date(Date.UTC(2026, 0, 5, h));
  const h = {
    ticks: [
      { at: d(1), energy: 0.6, reason: "tick", preoccupation: null },
      { at: d(25), energy: 0.3, reason: "event", preoccupation: "f" },
    ],
  };
  expect(energyAt(h.ticks, d(2))).toBe(0.6);
  const at = (s: string) => (s === "a" ? d(26) : d(2));
  expect(
    checkEgo(
      h,
      EgoAssertion.parse({
        type: "ego",
        lower_energy: { at: "a", than: "b", by: 0.2 },
        preoccupation_set: true,
      }),
      at,
    ).ok,
  ).toBe(true);
  expect(
    checkEgo(
      h,
      EgoAssertion.parse({ type: "ego", lower_energy: { at: "a", than: "b", by: 0.4 } }),
      at,
    ).ok,
  ).toBe(false);
});
