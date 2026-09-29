import { getFact } from "@/db/repos/facts";
import type { Deps } from "../deps";
import { blockAt, listLifeBlocks, type BlockFact } from "./blocks";
import { lifeDate } from "./clock";

/** Slot 4 (design §7.5). Null when she has no blocks today and the reply wasn't deferred. */
export function lifeStateLines(blocks: BlockFact[], now: Date, deferredLabel: string | null): string | null {
  if (blocks.length === 0 && !deferredLabel) return null;
  const lines: string[] = [];
  const cur = blockAt(blocks, now);
  lines.push(cur ? `Right now you're ${cur.label}${cur.block === "busy" ? " (busy)" : ""}.` : "Right now you're free.");
  const next = blocks.find((b) => b.start.getTime() > now.getTime());
  if (next) lines.push(`Later: ${next.label}.`);
  if (deferredLabel) lines.push(`They wrote while you were ${deferredLabel}; you're only getting to it now.`);
  return lines.join("\n");
}

/** Hot path, read-only: the caller wraps this in `withTimeout` and treats a failure as nothing. */
export async function loadLifeState(deps: Pick<Deps, "db" | "config">, userId: string, now: Date, deferredFact: string | null): Promise<string | null> {
  const blocks = await listLifeBlocks(deps.db, userId, lifeDate(deps.config.life, now));
  const deferred = deferredFact ? await getFact(deps.db, userId, deferredFact) : null;
  const label = (deferred?.payload as { label?: unknown } | null)?.label;
  return lifeStateLines(blocks, now, typeof label === "string" ? label : null);
}
