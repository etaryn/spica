/**
 * Records what she actually told this user about herself: every claim of hers that core backs
 * becomes a ledger row, open or only a hint by the limits her reply was written under. A crisis
 * records nothing.
 */
import type { Db } from "@/db/client";
import { disclosureLevels, insertDisclosures } from "@/db/repos/user/disclosure";
import type { Turn } from "@/db/repos/user/session-log";
import { levelFor } from "@/mind/state/user/relationship/depth";
import type { PlannedFact } from "./encode";

export async function recordDisclosures(
  tx: Db,
  input: {
    userId: string;
    planned: PlannedFact[];
    /** One per planned fact: the row it became, or the one it merged into. */
    factIds: (string | null)[];
    turns: Turn[];
    crisis: boolean;
    now: Date;
  },
): Promise<number> {
  if (input.crisis) return 0;
  const told = input.planned.flatMap((p, i) =>
    p.groundRef ? [{ ref: p.groundRef, factId: input.factIds[i] ?? null }] : [],
  );
  if (!told.length) return 0;

  const replies = input.turns.filter((t) => t.role === "companion");
  // A reply from before limits were stored had none: everything in it counts as told openly.
  const open = Math.max(1, ...replies.map((t) => t.depth?.open ?? 3));
  const ledger = await disclosureLevels(
    tx,
    input.userId,
    told.map((t) => t.ref.id),
  );
  await insertDisclosures(
    tx,
    input.userId,
    told.map(({ ref, factId }) => ({
      ref_kind: ref.kind,
      ref_id: ref.id,
      depth: ref.depth,
      level: levelFor(ref.depth, open, ledger.get(ref.id)),
      fact_id: factId,
      turn_id: replies.at(-1)?.id ?? null,
      created_at: input.now,
    })),
  );
  return told.length;
}
