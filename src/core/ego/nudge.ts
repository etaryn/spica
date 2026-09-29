import type { Db } from "@/db/client";
import { ensureIdentity, insertEgoTick, lockIdentity, updateIdentity, type IdentityRow } from "@/db/repos/identity";
import type { Config } from "../config";
import { applyEvent, applyExchange, exchangeTone, stateOf } from "./ego";

/** A generated event nudges her mood (design §7.3); a strong one becomes her preoccupation (§6.4). */
export async function nudgeEgoForEvent(tx: Db, config: Config, a: { userId: string; row: IdentityRow; factId: string | null; valence: number; now: Date }): Promise<IdentityRow> {
  const next = applyEvent(stateOf(a.row), a.valence, config.ego);
  const pre = !!a.factId && Math.abs(a.valence) >= config.life.preoccupation_min_valence;
  const patch = { ...next, ...(pre ? { preoccupation: a.factId, preoccupation_since: a.now } : {}) };
  await updateIdentity(tx, a.userId, patch);
  await insertEgoTick(tx, a.userId, { ...next, preoccupation: pre ? a.factId : a.row.preoccupation, reason: "event", created_at: a.now });
  return { ...a.row, ...patch };
}

/** Cold path (v2 §6.3, design §7.3): nudge her mood toward the exchange's tone. No LLM call; skipped on crisis. */
export async function nudgeEgoForExchange(tx: Db, config: Config, a: { userId: string; facts: { valence: number; salience: number }[]; crisis: boolean; now: Date }): Promise<boolean> {
  if (a.crisis) return false;
  const tone = exchangeTone(a.facts);
  if (tone === null) return false;
  await ensureIdentity(tx, a.userId, config.ego.baseline);
  const row = await lockIdentity(tx, a.userId);
  const next = applyExchange(stateOf(row), tone, config.ego);
  await updateIdentity(tx, a.userId, next);
  await insertEgoTick(tx, a.userId, { ...next, preoccupation: row.preoccupation, reason: "exchange", created_at: a.now });
  return true;
}
