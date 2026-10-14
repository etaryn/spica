/**
 * Once per occasion: her one dry remark about an absence belongs to that absence, her one
 * pointed callback to that hurt. Code decides the occasion from the transcript and the
 * relationship; the guard is only told what is already used.
 */
import { getRelationshipRow, type Cadence } from "@/db/repos/user/relationship";
import { lastReturnAt, lastUserTurn, pointedSince } from "@/db/repos/user/session-log";
import type { Deps } from "@/mind/platform/deps";
import { POINTED, type Pointed } from "./categories";
import type { GuardKind } from "./guard";

export async function usedOnOccasion(
  deps: Pick<Deps, "db" | "config">,
  userId: string,
  kind: GuardKind,
): Promise<Pointed[]> {
  const { db, config } = deps;
  const settings = config.relationship;
  const row = await getRelationshipRow(db, userId);
  const cadence = (row?.cadence ?? {}) as Partial<Cadence>;
  const gapHours =
    settings.absence_grace_factor * (cadence.median_gap_hours ?? settings.default_median_gap_hours);

  // A reach-out speaks into the absence still going on, so only her earlier reach-outs in it count;
  // a reply she sent before the silence belonged to the last occasion. A reply follows their latest
  // return.
  const reachOut = kind === "reach_out";
  const absenceSince = reachOut
    ? ((await lastUserTurn(db, userId))?.created_at ?? null)
    : await lastReturnAt(db, userId, gapHours);
  const since: Record<Pointed, Date | null> = {
    absence_remark: absenceSince,
    callback: row?.last_hurt_at ?? null,
  };

  const used: Pointed[] = [];
  for (const p of POINTED) {
    const from = since[p];
    const onlyReachOuts = reachOut && p === "absence_remark";
    if (from && (await pointedSince(db, userId, from, onlyReachOuts)).includes(p)) used.push(p);
  }
  return used;
}
