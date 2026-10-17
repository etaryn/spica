/**
 * Her busy and quiet blocks, read straight from the shared day plan. Downtime is free time, so it
 * isn't a block. A block's key is her local date and start time, which is stable for the day. A
 * quiet block ending at midnight runs on into tomorrow morning's: one night, one deferral.
 */
import type { LifePlan } from "@/db/schema";
import type { LifeConfig } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { nextLocalDate } from "@/mind/platform/timezone";
import { lifeDate, lifeInstant } from "./her-clock";

export type WorldBlock = {
  key: string;
  start: Date;
  end: Date;
  block: "busy" | "quiet";
  busy: number;
  label: string;
};

const KEY = /^(\d{4}-\d{2}-\d{2})#(\d{2}:\d{2})$/;

export function blocksForDay(
  settings: LifeConfig,
  day: string,
  plan: LifePlan | null,
): WorldBlock[] {
  if (!plan) return [];
  return plan.blocks
    .filter((b): b is typeof b & { kind: "busy" | "quiet" } => b.kind !== "downtime")
    .map((b) => ({
      key: `${day}#${b.start}`,
      start: lifeInstant(settings, day, b.start),
      end: lifeInstant(settings, day, b.end),
      block: b.kind,
      busy: b.busy,
      label: b.label,
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export const blockAt = (blocks: WorldBlock[], at: Date): WorldBlock | null =>
  blocks.find((b) => b.start.getTime() <= at.getTime() && at.getTime() < b.end.getTime()) ?? null;

/** Tonight's quiet block and tomorrow morning's are one night: one deferral, one note. */
export function joinNight(today: WorldBlock[], tomorrow: WorldBlock[]): WorldBlock[] {
  const last = today.at(-1);
  const first = tomorrow[0];
  if (!last || !first || last.block !== "quiet" || first.block !== "quiet") return today;
  if (last.end.getTime() !== first.start.getTime()) return today;
  return [...today.slice(0, -1), { ...last, end: first.end }];
}

export async function todaysBlocks(
  deps: Pick<Deps, "core" | "config">,
  now: Date,
): Promise<WorldBlock[]> {
  const day = lifeDate(deps.config.life, now);
  const next = nextLocalDate(day);
  return joinNight(
    blocksForDay(deps.config.life, day, await deps.core.world.plan(day)),
    blocksForDay(deps.config.life, next, await deps.core.world.plan(next)),
  );
}

export async function blockByKey(
  deps: Pick<Deps, "core" | "config">,
  key: string,
): Promise<WorldBlock | null> {
  const match = KEY.exec(key);
  if (!match) return null;
  const day = match[1]!;
  const blocks = blocksForDay(deps.config.life, day, await deps.core.world.plan(day));
  return blocks.find((b) => b.key === key) ?? null;
}
