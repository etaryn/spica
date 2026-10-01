import { deviationOf, fadeParams } from "@/mind/state/user/relationship/params";
import {
  PARAM_NAMES,
  type ParamName,
  type Params,
  type RelationshipConfig,
  type RelationshipState,
} from "@/mind/state/user/relationship/types";
import type { Db } from "@/db/client";
import * as rel from "@/db/repos/user/relationship";
import type { RelationshipAssertion } from "./script";

export type RelSnapshot = {
  state: RelationshipState;
  params: Params;
  effects: Record<ParamName, number>;
  events: { cause: string; param: string | null; detail: Record<string, unknown> }[];
};

export async function relationshipSnapshot(
  db: Db,
  userId: string,
  now: Date,
  cfg: RelationshipConfig,
): Promise<RelSnapshot | null> {
  const row = await rel.getRelationshipRow(db, userId);
  if (!row) return null;
  const params = fadeParams(await rel.getParams(db, userId), now, cfg);
  const effects = Object.fromEntries(
    PARAM_NAMES.map((n) => [n, deviationOf(params[n], cfg.variance_epsilon)]),
  ) as Record<ParamName, number>;
  const events = (await rel.listRelationshipEvents(db, userId, 100_000)).map((e) => ({
    cause: e.cause,
    param: e.param,
    detail: e.detail as Record<string, unknown>,
  }));
  return { state: rel.toRelationshipState(row), params, effects, events };
}

export function checkRelationship(
  s: RelSnapshot | null,
  a: RelationshipAssertion,
): { ok: boolean; detail?: string } {
  if (!s) return { ok: false, detail: "no relationship row" };
  const fails: string[] = [];
  const range = (label: string, x: number, r?: { gt?: number; lt?: number }) => {
    if (r?.gt !== undefined && !(x > r.gt)) fails.push(`${label} ${x.toFixed(3)} not > ${r.gt}`);
    if (r?.lt !== undefined && !(x < r.lt)) fails.push(`${label} ${x.toFixed(3)} not < ${r.lt}`);
  };
  if (a.param) {
    const p = s.params[a.param];
    range(`${a.param} value`, p.value, a.value);
    range(`${a.param} baseline`, p.baseline, a.baseline);
    const e = s.effects[a.param];
    if (a.effect?.sign === "pos" && !(e > 0))
      fails.push(`${a.param} effect ${e.toFixed(3)} not positive`);
    if (a.effect?.sign === "neg" && !(e < 0))
      fails.push(`${a.param} effect ${e.toFixed(3)} not negative`);
    if (a.effect?.min_abs !== undefined && !(Math.abs(e) >= a.effect.min_abs))
      fails.push(`${a.param} |effect| ${Math.abs(e).toFixed(3)} < ${a.effect.min_abs}`);
    if (a.effect?.max_abs !== undefined && !(Math.abs(e) <= a.effect.max_abs))
      fails.push(`${a.param} |effect| ${Math.abs(e).toFixed(3)} > ${a.effect.max_abs}`);
  }
  if (a.status && s.state.status !== a.status) fails.push(`status ${s.state.status} ≠ ${a.status}`);
  if (a.make_up_state && s.state.make_up_state !== a.make_up_state)
    fails.push(`make_up_state ${s.state.make_up_state} ≠ ${a.make_up_state}`);
  if (a.end_pending !== undefined && (s.state.end_pending_since !== null) !== a.end_pending)
    fails.push(`end_pending ${s.state.end_pending_since !== null} ≠ ${a.end_pending}`);
  if (a.events) {
    const q = a.events;
    const n = s.events.filter(
      (e) =>
        e.cause === q.cause &&
        (!q.param || e.param === q.param) &&
        Object.entries(q.detail ?? {}).every(([k, v]) => e.detail[k] === v),
    ).length;
    if (q.min !== undefined && n < q.min) fails.push(`${n} ${q.cause} events < ${q.min}`);
    if (q.max !== undefined && n > q.max) fails.push(`${n} ${q.cause} events > ${q.max}`);
  }
  return fails.length ? { ok: false, detail: fails.join("; ") } : { ok: true };
}
