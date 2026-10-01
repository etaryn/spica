/**
 * The daily decay pass over every user's memories: weights fade and memories go `stale`. One
 * cross-user statement, run by the `decay_pass` job.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";

/** System job, unscoped by design: one day of decay across all users. */
export async function adminDecayFacts(
  db: Db,
  now: Date,
  cfg: { grace_days: number; rate: number; stale_floor: number; dormant_after_days: number },
): Promise<{ decayed: number; staled: number; dormant: number }> {
  const decayed = await db.execute(sql`
    UPDATE fact SET salience = salience * (1 - ${cfg.rate}::real * (1 - salience))
    WHERE scope = 'private' AND status NOT IN ('superseded', 'stale')
      AND GREATEST(created_at, COALESCE(last_recalled_at, created_at)) < ${now}::timestamptz - make_interval(days => ${cfg.grace_days})`);
  const staled = await db.execute(sql`
    UPDATE fact SET status = 'stale'
    WHERE scope = 'private' AND status NOT IN ('superseded', 'stale') AND salience < ${cfg.stale_floor}::real`);
  const dormant = await db.execute(sql`
    UPDATE thread SET status = 'dormant'
    WHERE status = 'open' AND next_checkpoint IS NOT NULL
      AND next_checkpoint < ${now}::timestamptz - make_interval(days => ${cfg.dormant_after_days})
      AND last_touched < next_checkpoint`);
  return {
    decayed: decayed.rowCount ?? 0,
    staled: staled.rowCount ?? 0,
    dormant: dormant.rowCount ?? 0,
  };
}
