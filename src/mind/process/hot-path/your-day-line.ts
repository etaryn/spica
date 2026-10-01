/**
 * The "Your day" section of her reply prompt: what she's doing right now, what's next, and,
 * when the reply was deferred, that they wrote while she was busy.
 */
import type { Deps } from "@/mind/platform/deps";
import { blockAt, blockByKey, todaysBlocks, type WorldBlock } from "@/mind/world/blocks";

/** Null when she has no blocks today and the reply wasn't deferred. */
export function yourDayLines(
  blocks: WorldBlock[],
  now: Date,
  deferredLabel: string | null,
): string | null {
  if (blocks.length === 0 && !deferredLabel) return null;

  const lines: string[] = [];

  const current = blockAt(blocks, now);
  lines.push(
    current
      ? `Right now you're ${current.label}${current.block === "busy" ? " (busy)" : ""}.`
      : "Right now you're free.",
  );

  const next = blocks.find((b) => b.start.getTime() > now.getTime());
  if (next) lines.push(`Later: ${next.label}.`);

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
  return yourDayLines(blocks, now, deferred?.label ?? null);
}
