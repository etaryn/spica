/**
 * Her busy blocks, read straight from the shared day plan, plus her offline time when her energy
 * has run out. Downtime is free time, so it isn't a block. A plan block's key is her local date and
 * start time; an offline block's is `offline#<when she logged off>`.
 */
import type { LifePlan } from "@/db/schema";
import type { LifeConfig } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { estimatedBack } from "@/mind/state/core/core-state";
import { lifeDate, lifeInstant } from "./her-clock";

type BlockDeps = Pick<Deps, "config"> & { core: Pick<Deps["core"], "world" | "state"> };

export type WorldBlock = {
  key: string;
  start: Date;
  end: Date;
  block: "busy" | "offline";
  busy: number;
  label: string;
};

const KEY = /^(\d{4}-\d{2}-\d{2})#(\d{2}:\d{2})$/;
const OFFLINE = /^offline#(.+)$/;

/** Busy blocks only: downtime, and a quiet block stored before the night was removed, are free. */
export function blocksForDay(
  settings: LifeConfig,
  day: string,
  plan: LifePlan | null,
): WorldBlock[] {
  if (!plan) return [];
  return plan.blocks
    .filter((b) => b.kind === "busy")
    .map((b) => ({
      key: `${day}#${b.start}`,
      start: lifeInstant(settings, day, b.start),
      end: lifeInstant(settings, day, b.end),
      block: "busy" as const,
      busy: b.busy,
      label: b.label,
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export const blockAt = (blocks: WorldBlock[], at: Date): WorldBlock | null =>
  blocks.find((b) => b.start.getTime() <= at.getTime() && at.getTime() < b.end.getTime()) ?? null;

/** Her blocks now: offline first while she's logged off (it wins over her plan), then the plan's. */
export async function todaysBlocks(deps: BlockDeps, now: Date): Promise<WorldBlock[]> {
  const day = lifeDate(deps.config.life, now);
  const [plan, state] = await Promise.all([deps.core.world.plan(day), deps.core.state.get()]);
  const planned = blocksForDay(deps.config.life, day, plan);
  if (!state?.offline_since) return planned;
  const cfg = deps.config.core.state;
  const offline: WorldBlock = {
    key: `offline#${state.offline_since.toISOString()}`,
    start: state.offline_since,
    end: estimatedBack(state, cfg),
    block: "offline",
    busy: cfg.offline.busy,
    label: cfg.offline.label,
  };
  return [offline, ...planned];
}

export async function blockByKey(deps: BlockDeps, key: string): Promise<WorldBlock | null> {
  const off = OFFLINE.exec(key);
  if (off) {
    const start = new Date(off[1]!);
    if (Number.isNaN(start.getTime())) return null;
    const cfg = deps.config.core.state;
    return {
      key,
      start,
      end: start,
      block: "offline",
      busy: cfg.offline.busy,
      label: cfg.offline.label,
    };
  }
  const match = KEY.exec(key);
  if (!match) return null;
  const day = match[1]!;
  const blocks = blocksForDay(deps.config.life, day, await deps.core.world.plan(day));
  return blocks.find((b) => b.key === key) ?? null;
}
