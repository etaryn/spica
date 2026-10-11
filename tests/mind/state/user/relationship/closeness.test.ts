import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  advanceSession,
  closenessCeiling,
  intimacyMoment,
  sessionHours,
} from "@/mind/state/user/relationship/closeness";

const cfg = loadConfig().relationship;
const t0 = new Date("2026-01-05T10:00:00Z");
const min = (n: number) => new Date(t0.getTime() + n * 60_000);

test("ceiling interpolates between the hour points and is flat after close", () => {
  expect(closenessCeiling(0, cfg)).toBeCloseTo(cfg.ceiling.start);
  expect(closenessCeiling(cfg.hours.casual, cfg)).toBeCloseTo(cfg.ceiling.casual);
  expect(closenessCeiling((cfg.hours.casual + cfg.hours.friend) / 2, cfg)).toBeCloseTo(
    (cfg.ceiling.casual + cfg.ceiling.friend) / 2,
  );
  expect(closenessCeiling(cfg.hours.close, cfg)).toBeCloseTo(cfg.ceiling.close);
  expect(closenessCeiling(cfg.hours.close * 10, cfg)).toBeCloseTo(cfg.ceiling.close);
});

test("moment: either direction, nulls count as 0", () => {
  const her = { disclosure: 0.8, responsiveness: 0.5 };
  expect(intimacyMoment({ user_disclosure: 0.9, user_responsiveness: null }, her)).toBeCloseTo(
    0.45,
  );
  expect(intimacyMoment({ user_disclosure: 0, user_responsiveness: 1 }, her)).toBeCloseTo(0.8);
  expect(intimacyMoment(null, her)).toBe(0);
  expect(intimacyMoment({ user_disclosure: 1, user_responsiveness: 1 }, null)).toBe(0);
});

const span = (sessionId: string, ...at: number[]) => ({ sessionId, times: at.map(min) });

test("a new session adds its span with a minimum; the same session adds the time since last_at", () => {
  const first = advanceSession(null, 0, span("a", 0, 1), cfg);
  expect(first.hours).toBeCloseTo(cfg.hours.session_min_minutes / 60);
  expect(first.session).toMatchObject({ id: "a", tone_n: 0, moment_n: 0, deep_fired: false });

  const same = advanceSession(first.session, first.hours, span("a", 10, 31), cfg);
  expect(same.hours).toBeCloseTo(first.hours + 30 / 60);
  expect(same.session.started_at).toBe(t0.toISOString());

  const next = advanceSession(same.session, same.hours, span("b", 200, 225), cfg);
  expect(next.hours).toBeCloseTo(same.hours + 25 / 60);
  expect(next.session.id).toBe("b");
});

test("a long silence between turns counts only up to the gap cap", () => {
  const cap = cfg.hours.max_gap_minutes;
  const delayed = advanceSession(null, 0, span("a", 0, 300), cfg);
  expect(delayed.hours).toBeCloseTo(cap / 60);
  const later = advanceSession(delayed.session, delayed.hours, span("a", 600), cfg);
  expect(later.hours).toBeCloseTo((2 * cap) / 60);
  expect(sessionHours(later.session, cfg)).toBeCloseTo((2 * cap) / 60);
});

test("an exchange older than last_at never subtracts hours", () => {
  const s = advanceSession(null, 0, span("a", 0, 30), cfg);
  const back = advanceSession(s.session, s.hours, span("a", 0, 5), cfg);
  expect(back.hours).toBe(s.hours);
  expect(back.session.last_at).toBe(min(30).toISOString());
});

test("a late exchange from an older session keeps the current session's sums", () => {
  const live = advanceSession(null, 0, span("b", 200, 230), cfg);
  const current = { ...live.session, tone_sum: 1.5, tone_n: 3, deep_fired: true };
  const late = advanceSession(current, live.hours, span("a", 0, 20), cfg);
  expect(late.session).toEqual(current);
  expect(late.hours).toBeCloseTo(live.hours + 20 / 60);
});

test("session hours are its own running time, with the minimum", () => {
  const s = advanceSession(null, 0, span("a", 0, 30, 60, 90), cfg).session;
  expect(sessionHours(s, cfg)).toBeCloseTo(1.5);
  expect(sessionHours(advanceSession(null, 0, span("b", 0), cfg).session, cfg)).toBeCloseTo(
    cfg.hours.session_min_minutes / 60,
  );
});
