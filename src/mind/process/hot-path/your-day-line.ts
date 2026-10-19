/**
 * The "Your day" section of her reply prompt: what she's doing right now, what's next, what
 * already happened today, and, when the reply was deferred, that they wrote while she was busy.
 */
import type { Deps } from "@/mind/platform/deps";
import { blockAt, blockByKey, todaysBlocks, type WorldBlock } from "@/mind/world/blocks";
import { localTime } from "@/mind/platform/timezone";
import { lifeDate, lifeTimezone } from "@/mind/world/her-clock";

/** Null when she has no blocks today, nothing happened yet and the reply wasn't deferred. */
export function yourDayLines(
  blocks: WorldBlock[],
  now: Date,
  deferredLabel: string | null,
  happened: string[],
  tz: string,
): string | null {
  if (blocks.length === 0 && !deferredLabel && happened.length === 0) return null;

  const lines: string[] = [];

  const current = blockAt(blocks, now);
  lines.push(
    current
      ? `Right now you're ${current.label}${current.block === "busy" ? " (busy)" : ""}.`
      : "Right now you're free.",
  );

  const next = blocks.find((b) => b.start.getTime() > now.getTime());
  // The time keeps "later" from reading as now.
  if (next) lines.push(`Later, from ${localTime(next.start, tz)}: ${next.label}.`);
  lines.push(...happened.map((h) => `Earlier today: ${h}`));

  if (deferredLabel) {
    lines.push(`They wrote while you were ${deferredLabel}; you're only getting to it now.`);
  }
  return lines.join("\n");
}

/** Read-only. The caller puts a deadline on it and treats a failure as no section. */
export async function loadYourDayLine(
  deps: Pick<Deps, "core" | "config">,
  now: Date,
  deferredBlock: string | null,
): Promise<string | null> {
  const blocks = await todaysBlocks(deps, now);
  const deferred = deferredBlock ? await blockByKey(deps, deferredBlock) : null;
  // Plain events are surface, like the plan; the guard counts this section as her own context.
  const happened = (await deps.core.world.events(lifeDate(deps.config.life, now)))
    .filter((e) => e.outcome !== "fell_through" && e.at.getTime() <= now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(-deps.config.life.your_day_events)
    .map((e) => e.content);
  return yourDayLines(
    blocks,
    now,
    deferred?.label ?? null,
    happened,
    lifeTimezone(deps.config.life, now),
  );
}
