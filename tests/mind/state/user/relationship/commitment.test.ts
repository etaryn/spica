/** How much she wants this to last: how good it has been, and what they have put in. */
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { applyCommitment, commitmentFor } from "@/mind/state/user/relationship/commitment";
import { PARAM_NAMES, type ParamName, type Params } from "@/mind/state/user/relationship/types";

const cfg = loadConfig().relationship;
const at = new Date("2026-01-05T09:00:00Z");
const params = (v: Partial<Record<ParamName, number>> = {}): Params =>
  Object.fromEntries(
    PARAM_NAMES.map((n) => [
      n,
      {
        value: v[n] ?? cfg.initial[n],
        baseline: cfg.initial[n],
        variance: cfg.initial_variance[n],
        updated_at: at,
      },
    ]),
  ) as Params;
const none = { ledgerDepth: 0, maxOpenDepth: 0, idiolect: 0, episodes: 0 };

test("satisfaction reads the good minus the bad; investment saturates with history", () => {
  const good = commitmentFor(
    params({ warmth: 1, trust: 1, affect_valence: 1 }),
    0,
    none,
    cfg.commitment,
  );
  const sore = commitmentFor(
    params({ warmth: 1, trust: 1, affect_valence: 1, hurt: 1, tension: 1 }),
    0,
    none,
    cfg.commitment,
  );
  expect(good.satisfaction).toBe(1);
  expect(sore.satisfaction).toBeCloseTo(0.2);
  expect(good.investment).toBe(0);

  const h = cfg.commitment.investment;
  const half = commitmentFor(
    params(),
    h.hours,
    { ledgerDepth: h.ledger_depth, maxOpenDepth: 2, idiolect: h.idiolect, episodes: h.episodes },
    cfg.commitment,
  );
  expect(half.investment).toBeCloseTo(0.5);
  expect(half.commitment).toBeCloseTo(
    cfg.commitment.weights.satisfaction * half.satisfaction +
      cfg.commitment.weights.investment * 0.5,
  );
});

test("applying it sets the param and logs both parts", () => {
  const out = applyCommitment(params({ warmth: 1 }), 10, none, cfg);
  expect(out.params.commitment.value).toBeGreaterThan(0);
  expect(out.events).toEqual([
    expect.objectContaining({
      param: "commitment",
      cause: "commitment",
      detail: { satisfaction: expect.any(Number), investment: expect.any(Number) },
    }),
  ]);
});
