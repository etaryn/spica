import type { Db } from "@/db/client";
import { listGeneratedBlockRows, type NewFact } from "@/db/repos/facts";
import type { LifeBlock, LifePlan } from "@/db/schema";
import type { Deps } from "../deps";
import { lifeInstant, minutesOf } from "./clock";

export type BlockFact = {
  id: string;
  start: Date;
  end: Date;
  block: "busy" | "quiet";
  busy: number;
  label: string;
};
type BlockPayload = {
  start: string;
  end: string;
  block: "busy" | "quiet";
  busy: number;
  label: string;
  life_day: string;
  shared: true;
};

function partOfDay(start: string): string {
  const h = minutesOf(start) / 60;
  return h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night";
}

/** Self-contained and tense-free, so it reads true whether retrieved before or after the block. */
export function blockContent(b: LifeBlock): string {
  return `Spica's ${partOfDay(b.start)}: ${b.label}.`;
}

/** Builds (and embeds, outside any transaction) the block facts for one day. Downtime is implied by gaps. */
export async function prepareBlockFacts(
  deps: Pick<Deps, "embedder" | "config">,
  day: string,
  plan: LifePlan,
  now: Date,
): Promise<NewFact[]> {
  const cfg = deps.config.life;
  const blocks = plan.blocks.filter(
    (b): b is LifeBlock & { kind: "busy" | "quiet" } => b.kind !== "downtime",
  );
  if (blocks.length === 0) return [];
  const contents = blocks.map(blockContent);
  const vectors = await deps.embedder.embed(contents, "document");
  return blocks.map((b, i) => {
    const start = lifeInstant(cfg, day, b.start);
    const payload: BlockPayload = {
      start: start.toISOString(),
      end: lifeInstant(cfg, day, b.end).toISOString(),
      block: b.kind,
      busy: b.busy,
      label: b.label,
      life_day: day,
      shared: true,
    };
    const embedding = vectors[i];
    if (!embedding) throw new Error("embedder returned fewer vectors than blocks");
    return {
      subject: "self",
      kind: "event",
      content: contents[i]!,
      payload,
      embedding,
      occurred_at: start,
      created_at: now,
      status: "open",
      salience: cfg.block_salience,
      valence: 0,
      confidence: 1,
      source: "generated",
      source_ref: `life_day:${day}`,
    } satisfies NewFact;
  });
}

export async function listLifeBlocks(db: Db, userId: string, day: string): Promise<BlockFact[]> {
  const rows = await listGeneratedBlockRows(db, userId, day);
  return rows
    .map((r) => {
      const p = r.payload as BlockPayload;
      return {
        id: r.id,
        start: new Date(p.start),
        end: new Date(p.end),
        block: p.block,
        busy: p.busy,
        label: p.label,
      };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export const blockAt = (blocks: BlockFact[], at: Date): BlockFact | null =>
  blocks.find((b) => b.start.getTime() <= at.getTime() && at.getTime() < b.end.getTime()) ?? null;
