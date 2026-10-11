/**
 * Commitment: how much she wants this relationship to last. How good it has been lately, and what
 * the two of them have put in that can't be taken back. Set once a day; its slow baseline is the
 * commitment that has lasted.
 */
import type { RelationshipHistory } from "@/db/repos/user/relationship";
import { clamp } from "@/mind/platform/math";
import { deviationOf } from "./params";
import type { Params, RelationshipConfig, RelationshipEvent } from "./types";

const saturating = (x: number, half: number) => x / (x + half);

export function commitmentFor(
  params: Params,
  hours: number,
  h: RelationshipHistory,
  s: RelationshipConfig["commitment"],
): { commitment: number; satisfaction: number; investment: number } {
  const w = s.satisfaction;
  const satisfaction = clamp(
    w.warmth * params.warmth.value +
      w.trust * params.trust.value +
      w.affect_valence * params.affect_valence.value -
      w.hurt * params.hurt.value -
      w.tension * params.tension.value,
    0,
    1,
  );
  const half = s.investment;
  const investment =
    (saturating(hours, half.hours) +
      saturating(h.ledgerDepth, half.ledger_depth) +
      saturating(h.idiolect, half.idiolect) +
      saturating(h.episodes, half.episodes)) /
    4;
  const commitment = clamp(
    s.weights.satisfaction * satisfaction + s.weights.investment * investment,
    0,
    1,
  );
  return { commitment, satisfaction, investment };
}

export function applyCommitment(
  params: Params,
  hours: number,
  h: RelationshipHistory,
  settings: RelationshipConfig,
): { params: Params; events: RelationshipEvent[] } {
  const { commitment, satisfaction, investment } = commitmentFor(
    params,
    hours,
    h,
    settings.commitment,
  );
  const before = params.commitment.value;
  if (commitment === before) return { params, events: [] };
  const next = { ...params, commitment: { ...params.commitment, value: commitment } };
  return {
    params: next,
    events: [
      {
        param: "commitment",
        before,
        after: commitment,
        cause: "commitment",
        deviation: deviationOf(next.commitment, settings.variance_epsilon),
        detail: { satisfaction, investment },
      },
    ],
  };
}
