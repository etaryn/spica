/**
 * Eval checks on her world and her core mind. `life` reads the shared plans, her world events and
 * the generator's attempts; `core` reads her core state tick history, whether a strong event ever
 * took over her mind, and how many episodes and world events she has. Nothing here is per user.
 */
import { asc, count, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_loop_trace, core_memory, life_day, life_event_log, world_event } from "@/db/schema";
import type { Config } from "@/mind/platform/config";
import type { CoreAssertion, LifeAssertion } from "./script";

export type LifeSnapshot = {
  plans: number;
  events: number;
  logs: { content: string; decision: string }[];
  memories: string[];
};

const rows = async (db: Db, table: typeof life_day | typeof world_event) =>
  (await db.select({ n: count() }).from(table))[0]?.n ?? 0;

export async function lifeSnapshot(db: Db): Promise<LifeSnapshot> {
  const logs = (
    await db
      .select({ candidate: life_event_log.candidate, decision: life_event_log.decision })
      .from(life_event_log)
      .orderBy(asc(life_event_log.created_at))
  ).map((l) => ({
    content: String((l.candidate as { content?: unknown }).content ?? ""),
    decision: l.decision,
  }));
  const memories = (await db.select({ content: core_memory.content }).from(core_memory)).map(
    (m) => m.content,
  );
  return { plans: await rows(db, life_day), events: await rows(db, world_event), logs, memories };
}

const lc = (s: string) => s.toLowerCase();
type MinMax = { min?: number; max?: number };

function range(fails: string[], label: string, n: number, r?: MinMax) {
  if (r?.min !== undefined && n < r.min) fails.push(`${label} ${n} < ${r.min}`);
  if (r?.max !== undefined && n > r.max) fails.push(`${label} ${n} > ${r.max}`);
}

export function checkLife(s: LifeSnapshot, a: LifeAssertion): { ok: boolean; detail?: string } {
  const fails: string[] = [];
  range(fails, "plans", s.plans, a.plans);
  range(fails, "events", s.events, a.events);
  if (a.decision) {
    const hits = s.logs.filter((l) => lc(l.content).includes(lc(a.decision!.content_includes)));
    if (!hits.length) fails.push(`no event attempt contains "${a.decision.content_includes}"`);
    const bad = hits.filter((l) => !a.decision!.in.includes(l.decision));
    if (bad.length)
      fails.push(
        `"${a.decision.content_includes}" decided ${bad.map((b) => b.decision).join(", ")}, expected one of ${a.decision.in.join(", ")}`,
      );
  }
  if (a.not_stored && s.memories.some((m) => lc(m).includes(lc(a.not_stored!))))
    fails.push(`a core memory containing "${a.not_stored}" was stored`);
  return fails.length ? { ok: false, detail: fails.join("; ") } : { ok: true };
}

export type CoreHistory = {
  ticks: { at: Date; energy: number }[];
  preoccupationEverSet: boolean;
  episodes: number;
  worldEvents: number;
};

/**
 * `preoccupationEverSet`: an episode or a planned event's intention strong enough to take over her
 * mind exists, which is exactly when the world tick sets her preoccupation.
 */
export async function coreHistory(db: Db, config: Config): Promise<CoreHistory> {
  const ticks = await db
    .select({ at: core_loop_trace.created_at, outputs: core_loop_trace.outputs })
    .from(core_loop_trace)
    .where(eq(core_loop_trace.loop, "core_state_tick"))
    .orderBy(asc(core_loop_trace.created_at));
  const memories = await db
    .select({ kind: core_memory.kind, valence: core_memory.valence })
    .from(core_memory)
    .where(inArray(core_memory.kind, ["episode", "intention"]));
  const episodes = memories.filter((m) => m.kind === "episode");
  const min = config.core.state.preoccupation_min_valence;
  return {
    ticks: ticks.map((t) => ({ at: t.at, energy: (t.outputs as { energy: number }).energy })),
    preoccupationEverSet: memories.some((m) => Math.abs(m.valence) >= min),
    episodes: episodes.length,
    worldEvents: await rows(db, world_event),
  };
}

/** Energy of the latest tick at or before `at`. */
export function energyAt(ticks: CoreHistory["ticks"], at: Date): number | null {
  const before = ticks.filter((t) => t.at.getTime() <= at.getTime());
  return before.at(-1)?.energy ?? null;
}

export function checkCore(
  h: CoreHistory,
  a: CoreAssertion,
  at: (spec: string) => Date,
): { ok: boolean; detail?: string } {
  const fails: string[] = [];
  if (a.energy) {
    const e = energyAt(h.ticks, at(a.energy.at));
    if (e === null) fails.push(`no core state tick by ${a.energy.at}`);
    else {
      if (a.energy.lt !== undefined && !(e < a.energy.lt))
        fails.push(`energy ${e.toFixed(3)} at ${a.energy.at} not < ${a.energy.lt}`);
      if (a.energy.gt !== undefined && !(e > a.energy.gt))
        fails.push(`energy ${e.toFixed(3)} at ${a.energy.at} not > ${a.energy.gt}`);
    }
  }
  if (a.lower_energy) {
    const x = energyAt(h.ticks, at(a.lower_energy.at));
    const y = energyAt(h.ticks, at(a.lower_energy.than));
    if (x === null || y === null) fails.push("missing core state ticks for lower_energy");
    else if (!(x < y - a.lower_energy.by))
      fails.push(
        `energy ${x.toFixed(3)} at ${a.lower_energy.at} not below ${y.toFixed(3)} at ${a.lower_energy.than} by ${a.lower_energy.by}`,
      );
  }
  if (a.preoccupation_set !== undefined && h.preoccupationEverSet !== a.preoccupation_set)
    fails.push(`preoccupation set by an event: ${h.preoccupationEverSet}`);
  range(fails, "episodes", h.episodes, a.episodes);
  range(fails, "world events", h.worldEvents, a.world_events);
  return fails.length ? { ok: false, detail: fails.join("; ") } : { ok: true };
}
