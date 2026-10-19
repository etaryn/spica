/**
 * Availability: when a message lands while she's busy or in a quiet block, the reply waits. A
 * quiet block holds it until the block ends; a busy one for as long as how busy she is and how
 * close she is to this user say. A close enough friend gets
 * answered as usual; a mid-closeness one gets a short "busy, later?" note first. It fails open:
 * any error means no delay, and a crisis is never deferred.
 */
import * as relationshipRepo from "@/db/repos/user/relationship";
import * as sessionLog from "@/db/repos/user/session-log";
import type { AvailabilityConfig } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { seededUnit } from "@/mind/platform/seeded-random";
import { withTimeout } from "@/mind/platform/timeout";
import { fadeParams } from "@/mind/state/user/relationship/params";
import { blockAt, todaysBlocks, type WorldBlock } from "@/mind/world/blocks";

export type Availability = {
  delayMs: number;
  blockKey: string | null;
  blockKind: "busy" | "quiet" | null;
  blockStart: Date | null;
  note: boolean;
};

export const NO_DELAY: Availability = {
  delayMs: 0,
  blockKey: null,
  blockKind: null,
  blockStart: null,
  note: false,
};

/**
 * A quiet block holds the reply until it ends: she's offline, so a reply in the middle of it would
 * be a reply from nowhere. A busy block delays by busy × (1 − closeness / override) × max delay,
 * jittered by `unit` (0–1), capped at the block's end. Closeness is the param's value, not its
 * deviation. At or above `override_closeness` there's no delay.
 */
export function availabilityDelay(
  block: Pick<WorldBlock, "busy" | "block" | "end">,
  closeness: number,
  now: Date,
  unit: number,
  settings: AvailabilityConfig,
): number {
  if (closeness >= settings.override_closeness) return 0;
  const untilBlockEnds = Math.max(0, block.end.getTime() - now.getTime());
  if (block.block === "quiet") return untilBlockEnds;

  const distance = 1 - closeness / settings.override_closeness;
  const jitter = 1 - settings.jitter + 2 * settings.jitter * unit;
  const delay = block.busy * distance * settings.max_delay_ms * jitter;
  return Math.max(0, Math.round(Math.min(delay, untilBlockEnds)));
}

/** A mid-closeness friend gets a short note first; a low-closeness one just waits. */
export function wantsNote(
  delayMs: number,
  closeness: number,
  alreadyNoted: boolean,
  settings: AvailabilityConfig,
): boolean {
  if (alreadyNoted) return false;
  return delayMs >= settings.note_min_delay_ms && closeness >= settings.note_min_closeness;
}

async function decideAvailability(
  deps: Pick<Deps, "db" | "core" | "config">,
  userId: string,
  now: Date,
  seed: string,
): Promise<Availability> {
  const { db, config } = deps;

  const block = blockAt(await todaysBlocks(deps, now), now);
  if (!block) return NO_DELAY;

  const relationship = await relationshipRepo.getRelationshipRow(db, userId);
  if (!relationship) return NO_DELAY;
  // Nothing waits while a crisis is still recent.
  if (relationship.crisis_quiet_until && relationship.crisis_quiet_until > now) return NO_DELAY;

  const params = fadeParams(await relationshipRepo.getParams(db, userId), now, config.relationship);
  const closeness = params.closeness.value;

  const delayMs = availabilityDelay(block, closeness, now, seededUnit(seed), config.availability);
  if (delayMs === 0) return NO_DELAY;

  const alreadyNoted = await sessionLog.hasTriggerSince(db, userId, "availability", block.start);
  return {
    delayMs,
    blockKey: block.key,
    blockKind: block.block,
    blockStart: block.start,
    note: wantsNote(delayMs, closeness, alreadyNoted, config.availability),
  };
}

/** Called once, for the first message of a buffer. The crisis path never calls it. */
export async function deferWhileBusy(
  deps: Pick<Deps, "db" | "core" | "config" | "log">,
  userId: string,
  now: Date,
  seed: string,
): Promise<Availability> {
  try {
    return await withTimeout(
      Promise.resolve().then(() => decideAvailability(deps, userId, now, seed)),
      deps.config.hot_path.db_timeout_ms,
    );
  } catch (e) {
    deps.log.error("availability unavailable", { userId, error: errorName(e) });
    return NO_DELAY;
  }
}
