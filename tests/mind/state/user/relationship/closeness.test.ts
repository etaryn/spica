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

test("a new session adds its span with a minimum; the same session adds the time since last_at", () => {
  const first = advanceSession(null, 0, { sessionId: "a", firstAt: t0, lastAt: min(1) }, cfg);
  expect(first.hours).toBeCloseTo(cfg.hours.session_min_minutes / 60);
  expect(first.session).toMatchObject({ id: "a", tone_n: 0, moment_n: 0, deep_fired: false });

  const same = advanceSession(
    first.session,
    first.hours,
    { sessionId: "a", firstAt: min(10), lastAt: min(31) },
    cfg,
  );
  expect(same.hours).toBeCloseTo(first.hours + 30 / 60);
  expect(same.session.started_at).toBe(t0.toISOString());

  const next = advanceSession(
    same.session,
    same.hours,
    { sessionId: "b", firstAt: min(200), lastAt: min(260) },
    cfg,
  );
  expect(next.hours).toBeCloseTo(same.hours + 1);
  expect(next.session.id).toBe("b");
});

test("an exchange older than last_at never subtracts hours", () => {
  const s = advanceSession(null, 0, { sessionId: "a", firstAt: t0, lastAt: min(30) }, cfg);
  const back = advanceSession(
    s.session,
    s.hours,
    { sessionId: "a", firstAt: t0, lastAt: min(5) },
    cfg,
  );
  expect(back.hours).toBe(s.hours);
  expect(back.session.last_at).toBe(min(30).toISOString());
});

test("session hours run from its start, with the minimum", () => {
  const s = advanceSession(null, 0, { sessionId: "a", firstAt: t0, lastAt: min(90) }, cfg).session;
  expect(sessionHours(s, cfg)).toBeCloseTo(1.5);
});
