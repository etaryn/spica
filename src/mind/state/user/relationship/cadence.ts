/**
 * Cadence: how often and when this user usually talks to her. It decides when silence counts as
 * absence, and when a check-in would feel natural.
 */
import type { Cadence } from "@/db/repos/relationship";
import { HOUR } from "@/mind/platform/time";
import type { RelationshipConfig } from "./types";

/** The median gap between consecutive session starts, in hours. Input order doesn't matter. */
export function medianGapHours(starts: Date[], settings: RelationshipConfig): number {
  if (starts.length < settings.min_sessions_for_gap) return settings.default_median_gap_hours;

  const newestFirst = starts.map((start) => start.getTime()).sort((a, b) => b - a);
  const gaps = newestFirst
    .slice(0, -1)
    .map((start, i) => (start - newestFirst[i + 1]!) / HOUR)
    .sort((a, b) => a - b);

  const middle = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[middle]! : (gaps[middle - 1]! + gaps[middle]!) / 2;
}

export function buildCadence(
  activity: { msgs24h: number; msgs7d: number; starts: Date[]; activeHours: number[] },
  settings: RelationshipConfig,
): Cadence {
  return {
    msgs_24h: activity.msgs24h,
    msgs_7d: activity.msgs7d,
    median_gap_hours: medianGapHours(activity.starts, settings),
    active_hours: activity.activeHours,
  };
}
