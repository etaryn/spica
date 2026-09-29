import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { ego_tick, fact, life_day, life_event_log } from "@/db/schema";
import type { EgoAssertion, LifeAssertion } from "./script";

export type LifeSnapshot = { plans: number; blockDays: number; events: number; logs: { content: string; decision: string }[]; facts: string[] };

export async function lifeSnapshot(db: Db, userId: string): Promise<LifeSnapshot> {
  const plans = (await db.select({ n: sql<number>`count(*)::int` }).from(life_day))[0]?.n ?? 0;
  const generated = await db.select({ payload: fact.payload }).from(fact).where(and(eq(fact.user_id, userId), eq(fact.source, "generated")));
  const blockDays = new Set(generated.flatMap((f) => { const p = f.payload as { block?: string; life_day?: string } | null; return p?.block && p.life_day ? [p.life_day] : []; })).size;
  const events = generated.filter((f) => !(f.payload as { block?: string } | null)?.block).length;
  const logs = (await db.select({ candidate: life_event_log.candidate, decision: life_event_log.decision }).from(life_event_log)
    .where(eq(life_event_log.user_id, userId)).orderBy(asc(life_event_log.created_at)))
    .map((l) => ({ content: String((l.candidate as { content?: unknown }).content ?? ""), decision: l.decision }));
  const facts = (await db.select({ content: fact.content }).from(fact).where(eq(fact.user_id, userId))).map((f) => f.content);
  return { plans, blockDays, events, logs, facts };
}

const lc = (s: string) => s.toLowerCase();

export function checkLife(s: LifeSnapshot, a: LifeAssertion): { ok: boolean; detail?: string } {
  const fails: string[] = [];
  const range = (label: string, n: number, r?: { min?: number; max?: number }) => {
    if (r?.min !== undefined && n < r.min) fails.push(`${label} ${n} < ${r.min}`);
    if (r?.max !== undefined && n > r.max) fails.push(`${label} ${n} > ${r.max}`);
  };
  range("plans", s.plans, a.plans);
  range("block days", s.blockDays, a.block_days);
  range("events", s.events, a.events);
  if (a.decision) {
    const hits = s.logs.filter((l) => lc(l.content).includes(lc(a.decision!.content_includes)));
    if (!hits.length) fails.push(`no event attempt contains "${a.decision.content_includes}"`);
    const bad = hits.filter((l) => !a.decision!.in.includes(l.decision));
    if (bad.length) fails.push(`"${a.decision.content_includes}" decided ${bad.map((b) => b.decision).join(", ")}, expected one of ${a.decision.in.join(", ")}`);
  }
  if (a.not_stored && s.facts.some((f) => lc(f).includes(lc(a.not_stored!)))) fails.push(`a fact containing "${a.not_stored}" was stored`);
  return fails.length ? { ok: false, detail: fails.join("; ") } : { ok: true };
}

export type EgoHistory = { ticks: { at: Date; energy: number; reason: string; preoccupation: string | null }[] };

export async function egoHistory(db: Db, userId: string): Promise<EgoHistory> {
  const rows = await db.select().from(ego_tick).where(eq(ego_tick.user_id, userId)).orderBy(asc(ego_tick.created_at));
  return { ticks: rows.map((r) => ({ at: r.created_at, energy: r.energy, reason: r.reason, preoccupation: r.preoccupation })) };
}

/** Energy of the latest tick at or before `at`. */
export function energyAt(ticks: EgoHistory["ticks"], at: Date): number | null {
  const before = ticks.filter((t) => t.at.getTime() <= at.getTime());
  return before.at(-1)?.energy ?? null;
}

export function checkEgo(h: EgoHistory, a: EgoAssertion, at: (spec: string) => Date): { ok: boolean; detail?: string } {
  const fails: string[] = [];
  if (a.energy) {
    const e = energyAt(h.ticks, at(a.energy.at));
    if (e === null) fails.push(`no ego tick by ${a.energy.at}`);
    else {
      if (a.energy.lt !== undefined && !(e < a.energy.lt)) fails.push(`energy ${e.toFixed(3)} at ${a.energy.at} not < ${a.energy.lt}`);
      if (a.energy.gt !== undefined && !(e > a.energy.gt)) fails.push(`energy ${e.toFixed(3)} at ${a.energy.at} not > ${a.energy.gt}`);
    }
  }
  if (a.lower_energy) {
    const x = energyAt(h.ticks, at(a.lower_energy.at));
    const y = energyAt(h.ticks, at(a.lower_energy.than));
    if (x === null || y === null) fails.push("missing ego ticks for lower_energy");
    else if (!(x < y - a.lower_energy.by)) fails.push(`energy ${x.toFixed(3)} at ${a.lower_energy.at} not below ${y.toFixed(3)} at ${a.lower_energy.than} by ${a.lower_energy.by}`);
  }
  if (a.preoccupation_set !== undefined) {
    const set = h.ticks.some((t) => t.reason === "event" && t.preoccupation !== null);
    if (set !== a.preoccupation_set) fails.push(`preoccupation set by an event: ${set}`);
  }
  return fails.length ? { ok: false, detail: fails.join("; ") } : { ok: true };
}
