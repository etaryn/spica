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

test("a warm exchange raises affect and afterglow; a cold one lowers affect only", () => {
  const warm = applyAffect(params(), 1, now, settings).params;
  expect(warm.affect_valence.value).toBeCloseTo(0.5 + settings.affect.exchange_gain * 0.5);
  expect(warm.afterglow.value).toBeGreaterThan(0);

  const cold = applyAffect(params(), -1, now, settings).params;
  expect(cold.affect_valence.value).toBeCloseTo(0.5 - settings.affect.exchange_gain * 0.5);
  expect(cold.afterglow.value).toBe(0);
});

test("afterglow fades by its half-life", () => {
  const p = params();
  p.afterglow = { ...p.afterglow, value: 0.8, updated_at: now };
  const later = new Date(now.getTime() + settings.affect.afterglow_half_life_hours * 3_600_000);
  expect(fadeParams(p, later, settings).afterglow.value).toBeCloseTo(0.4);
});
