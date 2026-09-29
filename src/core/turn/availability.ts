import * as rel from "@/db/repos/relationship";
import * as sessionLog from "@/db/repos/session-log";
import type { AvailabilityConfig } from "../config";
import type { Deps } from "../deps";
import { errorName } from "../errors";
import { blockAt, listLifeBlocks, type BlockFact } from "../life/blocks";
import { lifeDate } from "../life/clock";
import { fadeParams } from "../relationship/homeostasis";
import { withTimeout } from "../timeout";
import { seededUnit } from "./pacing";

export type Availability = { delayMs: number; blockFactId: string | null; blockKind: "busy" | "quiet" | null; blockStart: Date | null; note: boolean };
export const NO_DELAY: Availability = { delayMs: 0, blockFactId: null, blockKind: null, blockStart: null, note: false };

/**
 * Design §8.2: how long a message waits because she's busy. Closeness is the value, not the effect (design D7);
 * at or above `override_closeness` she answers as usual. Capped at the block's end.
 */
export function availabilityDelay(block: Pick<BlockFact, "busy" | "block" | "end">, closeness: number, now: Date, u: number, cfg: AvailabilityConfig): number {
  if (closeness >= cfg.override_closeness) return 0;
  const max = block.block === "quiet" ? cfg.quiet_max_delay_ms : cfg.max_delay_ms;
  const raw = block.busy * (1 - closeness / cfg.override_closeness) * max * (1 - cfg.jitter + 2 * cfg.jitter * u);
  return Math.max(0, Math.round(Math.min(raw, block.end.getTime() - now.getTime())));
}

/** Design §8.3 (D6): a mid-closeness friend gets a short note first; a low-closeness one just waits. */
export function wantsNote(delayMs: number, closeness: number, alreadyNoted: boolean, cfg: AvailabilityConfig): boolean {
  return !alreadyNoted && delayMs >= cfg.note_min_delay_ms && closeness >= cfg.note_min_closeness;
}

async function compute(deps: Pick<Deps, "db" | "config">, userId: string, now: Date, seed: string): Promise<Availability> {
  const { db, config } = deps;
  const block = blockAt(await listLifeBlocks(db, userId, lifeDate(config.life, now)), now);
  if (!block) return NO_DELAY;
  const row = await rel.getRelationshipRow(db, userId);
  if (!row) return NO_DELAY;
  if (row.crisis_quiet_until && row.crisis_quiet_until > now) return NO_DELAY; // rule 7
  const closeness = fadeParams(await rel.getParams(db, userId), now, config.relationship).closeness.value;
  const delayMs = availabilityDelay(block, closeness, now, seededUnit(seed), config.availability);
  if (delayMs === 0) return NO_DELAY;
  const noted = await sessionLog.hasTriggerSince(db, userId, "availability", block.start);
  return { delayMs, blockFactId: block.id, blockKind: block.block, blockStart: block.start, note: wantsNote(delayMs, closeness, noted, config.availability) };
}

/**
 * Called once per buffer, for the first message of a non-crisis buffer (design §8.1). Fails open: any error or
 * timeout means no delay, so a DB hiccup never silences her. The crisis path never calls it.
 */
export async function availabilityFor(deps: Pick<Deps, "db" | "config" | "log">, userId: string, now: Date, seed: string): Promise<Availability> {
  try {
    return await withTimeout(Promise.resolve().then(() => compute(deps, userId, now, seed)), deps.config.hot_path.db_timeout_ms);
  } catch (e) {
    deps.log.error("availability unavailable", { userId, error: errorName(e) });
    return NO_DELAY;
  }
}
