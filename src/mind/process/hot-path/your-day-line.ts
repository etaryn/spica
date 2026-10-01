/**
 * The "Your day" section of her reply prompt: what she's doing right now, what's next, and,
 * when the reply was deferred, that they wrote while she was busy.
 */
import { getFact } from "@/db/repos/facts";
import type { Deps } from "@/mind/platform/deps";
import { lifeDate } from "@/mind/world/her-clock";
import { blockAt, listLifeBlocks, type BlockFact } from "@/mind/world/legacy-life-tick/blocks";

/** Null when she has no blocks today and the reply wasn't deferred. */
export function yourDayLines(
  blocks: BlockFact[],
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
  deps: Pick<Deps, "db" | "config">,
  userId: string,
  now: Date,
  deferredFact: string | null,
): Promise<string | null> {
  const blocks = await listLifeBlocks(deps.db, userId, lifeDate(deps.config.life, now));
  const deferred = deferredFact ? await getFact(deps.db, userId, deferredFact) : null;
  const label = (deferred?.payload as { label?: unknown } | null)?.label;

  return yourDayLines(blocks, now, typeof label === "string" ? label : null);
}
