import type { Cadence } from "@/db/repos/relationship";
import type { RelConfig } from "./types";

const HOUR = 3_600_000;

/** Median gap between consecutive session starts (design §4.4); starts are newest first. */
export function medianGapHours(starts: Date[], cfg: RelConfig): number {
  if (starts.length < cfg.min_sessions_for_gap) return cfg.default_median_gap_hours;
  const gaps = starts.slice(0, -1).map((s, i) => (s.getTime() - starts[i + 1]!.getTime()) / HOUR).sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
}

export function buildCadence(a: { msgs24h: number; msgs7d: number; starts: Date[]; activeHours: number[] }, cfg: RelConfig): Cadence {
  return { msgs_24h: a.msgs24h, msgs_7d: a.msgs7d, median_gap_hours: medianGapHours(a.starts, cfg), active_hours: a.activeHours };
}
