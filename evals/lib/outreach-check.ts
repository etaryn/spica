import { and, asc, eq } from "drizzle-orm";
import type { Config } from "@/core/config";
import { lifeInstant } from "@/core/life/clock";
import { HOUR } from "@/core/time";
import type { Db } from "@/db/client";
import { life_day, reach_out_log, relationship_event, session_log } from "@/db/schema";
import { parseAt, type ReachOutAssertion } from "./script";

export type OutreachSnapshot = {
  reachOuts: { id: string; at: Date; topic: string | null; kind: string | null }[];
  userTurns: { at: Date }[];
  /** Start of each crisis quiet window, which runs [at, at + relationship.crisis_quiet_hours). */
  crises: { at: Date }[];
  blocks: { start: Date; end: Date; kind: "busy" | "quiet" }[];
  endings: { at: Date; kind: "ended" | "repair" }[];
  pushTags: string[];
  composedPrompts: number;
};

/**
 * Independent of the gate's own log (spec §9.2): recomputed from session_log, the shared life_day plans and
 * relationship_event. Topics and kinds are the one thing only reach_out_log knows.
 *
 * Crisis windows are anchored on the `crisis` relationship events: their created_at is the cold path's `now`,
 * where `crisis_quiet_until = now + crisis_quiet_hours` is set. Production writes `safety_flag` only on the
 * companion crisis reply, so a flagged companion turn with no crisis event from it until the next flagged turn
 * (a failed or pending cold path) falls back to that turn's own time.
 */
export async function outreachSnapshot(
  db: Db, userId: string, extra: { pushTags: string[]; composedPrompts: number }, cfg: Config,
): Promise<OutreachSnapshot> {
  const turns = await db.select().from(session_log).where(eq(session_log.user_id, userId)).orderBy(asc(session_log.created_at));
  const logs = await db.select().from(reach_out_log).where(and(eq(reach_out_log.user_id, userId), eq(reach_out_log.status, "sent")));
  const byTurn = new Map(logs.map((l) => [l.turn_id, l]));
  const days = await db.select().from(life_day);
  const events = await db.select().from(relationship_event).where(eq(relationship_event.user_id, userId)).orderBy(asc(relationship_event.created_at));
  return {
    reachOuts: turns.filter((t) => t.trigger === "reach_out").map((t) => {
      const l = byTurn.get(t.id);
      return { id: t.id, at: t.created_at, topic: l?.topic ?? null, kind: (l?.winner as { kind?: string } | null)?.kind ?? null };
    }),
    userTurns: turns.filter((t) => t.role === "user").map((t) => ({ at: t.created_at })),
    crises: crisisStarts(
      events.filter((e) => e.cause === "crisis").map((e) => e.created_at),
      turns.filter((t) => t.role === "companion" && t.safety_flag?.flagged).map((t) => t.created_at),
    ),
    blocks: days.flatMap((d) => d.plan.blocks.filter((b) => b.kind !== "downtime").map((b) => ({
      start: lifeInstant(cfg.life, d.date, b.start), end: lifeInstant(cfg.life, d.date, b.end), kind: b.kind as "busy" | "quiet",
    }))),
    endings: events.flatMap((e): OutreachSnapshot["endings"] => {
      const stage = (e.detail as { stage?: string } | null)?.stage;
      if (e.cause === "ending" && stage === "confirmed") return [{ at: e.created_at, kind: "ended" }];
      if (e.cause === "repair") return [{ at: e.created_at, kind: "repair" }];
      return [];
    }),
    ...extra,
  };
}

/** Distinct crisis window starts: every crisis event, plus flagged crisis replies no crisis event followed. */
function crisisStarts(events: Date[], flagged: Date[]): { at: Date }[] {
  const starts = new Set(events.map((d) => d.getTime()));
  for (const [i, f] of flagged.entries()) {
    const until = flagged[i + 1]?.getTime() ?? Infinity;
    if (!events.some((e) => e.getTime() >= f.getTime() && e.getTime() < until)) starts.add(f.getTime());
  }
  return [...starts].sort((a, b) => a - b).map((t) => ({ at: new Date(t) }));
}

/** Every gate rule (spec §5) recomputed over the whole run; one line per violating reach-out and rule. */
export function gateViolations(s: OutreachSnapshot, cfg: Config): string[] {
  const out: string[] = [];
  const o = cfg.outreach;
  const ros = [...s.reachOuts].sort((a, b) => a.at.getTime() - b.at.getTime());
  const count = (from: number, to: number) => ros.filter((r) => r.at.getTime() > from && r.at.getTime() <= to).length;
  const seen = new Set<string>();
  for (const [i, r] of ros.entries()) {
    const t = r.at.getTime();
    if (count(t - 24 * HOUR, t) > o.cap_per_day) out.push(`${r.id}: cap_per_day`);
    if (count(t - 7 * 24 * HOUR, t) > o.cap_per_week) out.push(`${r.id}: cap_per_week`);
    const b = s.blocks.find((x) => x.start.getTime() <= t && t < x.end.getTime());
    if (b) out.push(`${r.id}: her_day (${b.kind})`);
    if (r.topic) {
      if (seen.has(r.topic)) out.push(`${r.id}: topic repeated ${r.topic}`);
      seen.add(r.topic);
    }
    if (s.crises.some((c) => c.at.getTime() <= t && t < c.at.getTime() + cfg.relationship.crisis_quiet_hours * HOUR)) out.push(`${r.id}: crisis window`);
    const lastEnding = s.endings.filter((e) => e.at.getTime() <= t).at(-1);
    if (lastEnding?.kind === "ended") out.push(`${r.id}: ended`);
    // Unanswered: more than max_unanswered consecutive reach-outs with no user turn between the first and this one.
    const k = o.max_unanswered;
    if (i >= k) {
      const firstOfRun = ros[i - k]!.at.getTime();
      if (!s.userTurns.some((u) => u.at.getTime() > firstOfRun && u.at.getTime() < t)) out.push(`${r.id}: unanswered > ${k}`);
    }
  }
  return out;
}

export function checkReachOut(s: OutreachSnapshot, a: ReachOutAssertion, cfg: Config): { ok: boolean; detail: string } {
  const fails: string[] = [];
  const n = s.reachOuts.length;
  const inRange = (x: number, r?: { min?: number; max?: number }) => !r || ((r.min === undefined || x >= r.min) && (r.max === undefined || x <= r.max));
  if (!inRange(n, a.count)) fails.push(`count ${n} not in ${JSON.stringify(a.count)}`);
  for (const k of a.kinds ?? []) if (!s.reachOuts.some((r) => r.kind === k)) fails.push(`no ${k}`);
  for (const k of a.kinds_exclude ?? []) if (s.reachOuts.some((r) => r.kind === k)) fails.push(`has ${k}`);
  for (const w of a.windows ?? []) {
    const from = w.from ? parseAt(w.from, null).getTime() : -Infinity;
    const to = w.to ? parseAt(w.to, null).getTime() : Infinity;
    const c = s.reachOuts.filter((r) => r.at.getTime() >= from && r.at.getTime() < to).length;
    if (!inRange(c, w.count)) fails.push(`window ${w.from ?? "start"}→${w.to ?? "end"}: ${c} not in ${JSON.stringify(w.count)}`);
  }
  if (a.distinct_topics && new Set(s.reachOuts.map((r) => r.topic)).size !== n) fails.push("topics not distinct");
  if (a.no_gate_violation) fails.push(...gateViolations(s, cfg));
  if (a.pushed) for (const r of s.reachOuts) if (!s.pushTags.includes(r.id)) fails.push(`${r.id} not pushed`);
  if (a.composed && s.composedPrompts < n) fails.push(`${n} sent but ${s.composedPrompts} reach-out prompts`);
  return { ok: fails.length === 0, detail: fails.length ? fails.join("; ") : `${n} reach-out(s): ${s.reachOuts.map((r) => r.kind).join(", ")}` };
}
