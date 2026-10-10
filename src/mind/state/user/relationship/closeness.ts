/**
 * How close she can be and what makes her closer: time together sets a ceiling, and a moment of
 * one side opening up while the other meets it fills up to it. Pure functions over the
 * relationship's running hours and this conversation's session.
 */
import { HOUR, MINUTE } from "@/mind/platform/time";
import type { Intimacy, Openness, RelationshipConfig, SessionState } from "./types";

/** Linear between the hour points, flat after the last: closeness is earned over time. */
export function closenessCeiling(hours: number, settings: RelationshipConfig): number {
  const { hours: h, ceiling: c } = settings;
  const points: [number, number][] = [
    [0, c.start],
    [h.casual, c.casual],
    [h.friend, c.friend],
    [h.close, c.close],
  ];
  for (let i = 1; i < points.length; i++) {
    const [h1, c1] = points[i]!;
    if (hours > h1) continue;
    const [h0, c0] = points[i - 1]!;
    return c0 + ((c1 - c0) * (Math.max(0, hours) - h0)) / (h1 - h0);
  }
  return c.close;
}

/** They opened up and she met it, or she opened up and they met it. */
export function intimacyMoment(user: Intimacy | null, her: Openness | null): number {
  const theyShared = (user?.user_disclosure ?? 0) * (her?.responsiveness ?? 0);
  const sheShared = (her?.disclosure ?? 0) * (user?.user_responsiveness ?? 0);
  return Math.max(theyShared, sheShared);
}

/** The exchange's session and the times of its turns in that session, oldest first. */
export type ExchangeSpan = { sessionId: string; times: Date[] };

/** Hours between consecutive times, each gap capped: a long silence isn't time together. */
function activeHours(times: Date[], settings: RelationshipConfig): number {
  const cap = settings.hours.max_gap_minutes * MINUTE;
  let ms = 0;
  for (let i = 1; i < times.length; i++) {
    ms += Math.min(cap, Math.max(0, times[i]!.getTime() - times[i - 1]!.getTime()));
  }
  return ms / HOUR;
}

/** Adds this exchange's time together; a new session starts fresh running sums. */
export function advanceSession(
  session: SessionState | null,
  hours: number,
  span: ExchangeSpan,
  settings: RelationshipConfig,
): { session: SessionState; hours: number } {
  const lastAt = span.times.at(-1)!;
  if (session && session.id === span.sessionId) {
    const previous = new Date(session.last_at);
    // An exchange scored out of order never takes time back.
    const newer = span.times.filter((t) => t > previous);
    if (newer.length === 0) return { session, hours };
    const added = activeHours([previous, ...newer], settings);
    return {
      session: { ...session, last_at: lastAt.toISOString(), hours: session.hours + added },
      hours: hours + added,
    };
  }
  const added = Math.max(
    settings.hours.session_min_minutes / 60,
    activeHours(span.times, settings),
  );
  return {
    session: {
      id: span.sessionId,
      started_at: span.times[0]!.toISOString(),
      last_at: lastAt.toISOString(),
      hours: added,
      tone_sum: 0,
      tone_n: 0,
      moment_sum: 0,
      moment_n: 0,
      deep_fired: false,
    },
    hours: hours + added,
  };
}

/** A crisis adds no time, but the session's clock moves past it so the next exchange can't count it. */
export function skipSessionTime(
  session: SessionState | null,
  span: ExchangeSpan,
): SessionState | null {
  if (!session || session.id !== span.sessionId) return session;
  const lastAt = span.times.at(-1)!;
  return lastAt > new Date(session.last_at)
    ? { ...session, last_at: lastAt.toISOString() }
    : session;
}

export function sessionHours(session: SessionState, settings: RelationshipConfig): number {
  return Math.max(settings.hours.session_min_minutes / 60, session.hours);
}
