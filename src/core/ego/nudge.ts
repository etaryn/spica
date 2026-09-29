import type { Db } from "@/db/client";
import { insertEgoTick, updateIdentity, type IdentityRow } from "@/db/repos/identity";
import type { Config } from "../config";
import { applyEvent, stateOf } from "./ego";

/** A generated event nudges her mood (design §7.3); a strong one becomes her preoccupation (§6.4). */
export async function nudgeEgoForEvent(tx: Db, config: Config, a: { userId: string; row: IdentityRow; factId: string | null; valence: number; now: Date }): Promise<IdentityRow> {
  const next = applyEvent(stateOf(a.row), a.valence, config.ego);
  const pre = !!a.factId && Math.abs(a.valence) >= config.life.preoccupation_min_valence;
  const patch = { ...next, ...(pre ? { preoccupation: a.factId, preoccupation_since: a.now } : {}) };
  await updateIdentity(tx, a.userId, patch);
  await insertEgoTick(tx, a.userId, { ...next, preoccupation: pre ? a.factId : a.row.preoccupation, reason: "event", created_at: a.now });
  return { ...a.row, ...patch };
}
