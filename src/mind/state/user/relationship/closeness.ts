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

export type ExchangeSpan = { sessionId: string; firstAt: Date; lastAt: Date };

/** Adds this exchange's time together; a new session starts fresh running sums. */
export function advanceSession(
  session: SessionState | null,
  hours: number,
  span: ExchangeSpan,
  settings: RelationshipConfig,
): { session: SessionState; hours: number } {
  if (session && session.id === span.sessionId) {
    const lastAt = new Date(session.last_at);
    // An exchange scored out of order never takes time back.
    if (span.lastAt <= lastAt) return { session, hours };
    return {
      session: { ...session, last_at: span.lastAt.toISOString() },
      hours: hours + (span.lastAt.getTime() - lastAt.getTime()) / HOUR,
    };
  }
  const spanMs = Math.max(
    settings.hours.session_min_minutes * MINUTE,
    span.lastAt.getTime() - span.firstAt.getTime(),
  );
  return {
    session: {
      id: span.sessionId,
      started_at: span.firstAt.toISOString(),
      last_at: span.lastAt.toISOString(),
      tone_sum: 0,
      tone_n: 0,
      moment_sum: 0,
      moment_n: 0,
      deep_fired: false,
    },
    hours: hours + spanMs / HOUR,
  };
}

export function sessionHours(session: SessionState, settings: RelationshipConfig): number {
  const span = new Date(session.last_at).getTime() - new Date(session.started_at).getTime();
  return Math.max(settings.hours.session_min_minutes * MINUTE, span) / HOUR;
}
