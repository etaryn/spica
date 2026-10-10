import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { applyAffect, exchangeTone } from "@/mind/state/user/relationship/affect";
import { fadeParams } from "@/mind/state/user/relationship/params";
import { PARAM_NAMES, type Params } from "@/mind/state/user/relationship/types";

const settings = loadConfig().relationship;
const now = new Date("2026-01-05T09:00:00Z");
const params = (): Params =>
  Object.fromEntries(
    PARAM_NAMES.map((n) => [
      n,
      {
        value: settings.initial[n],
        baseline: settings.initial[n],
        variance: 0.01,
        updated_at: now,
      },
    ]),
  ) as Params;

test("tone is the salience-weighted mean of non-zero valences", () => {
  expect(exchangeTone([])).toBeNull();
  expect(exchangeTone([{ valence: 0, salience: 1 }])).toBeNull();
  expect(
    exchangeTone([
      { valence: 1, salience: 0.75 },
      { valence: -1, salience: 0.25 },
    ]),
  ).toBeCloseTo(0.5);
});

test("afterglow follows the session's mean tone; ten warm exchanges equal one", () => {
  const once = applyAffect(params(), 0.8, 0.8, now, settings).params;
  let many = params();
  for (let i = 0; i < 10; i++) many = applyAffect(many, 0.8, 0.8, now, settings).params;
  expect(once.afterglow.value).toBeCloseTo(settings.affect.afterglow_gain * 0.8);
  expect(many.afterglow.value).toBeCloseTo(once.afterglow.value);
  expect(once.affect_valence.value).toBeGreaterThan(0.5);

  const cold = applyAffect(params(), -0.8, -0.8, now, settings).params;
  expect(cold.affect_valence.value).toBeLessThan(0.5);
  expect(cold.afterglow.value).toBe(0);
});

test("a stronger earlier glow is kept, faded, not replaced by a weaker session", () => {
  const p = params();
  p.afterglow = { ...p.afterglow, value: 0.6, updated_at: now };
  const later = new Date(now.getTime() + settings.affect.afterglow_half_life_hours * 3_600_000);
  expect(applyAffect(p, 0.1, 0.1, later, settings).params.afterglow.value).toBeCloseTo(0.3);
});

test("afterglow fades by its half-life", () => {
  const p = params();
  p.afterglow = { ...p.afterglow, value: 0.8, updated_at: now };
  const later = new Date(now.getTime() + settings.affect.afterglow_half_life_hours * 3_600_000);
  expect(fadeParams(p, later, settings).afterglow.value).toBeCloseTo(0.4);
});
