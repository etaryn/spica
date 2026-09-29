import { expect, test } from "vitest";
import { SimClock } from "@/core/clock";
import { loadConfig } from "@/core/config";
import { readDelayMs, seededUnit, sleepUntil, typingMs, waitWindowMs } from "@/core/turn/pacing";

const t = loadConfig().turn;

test("seededUnit is deterministic and in [0, 1)", () => {
  expect(seededUnit("abc")).toBe(seededUnit("abc"));
  expect(seededUnit("abc")).not.toBe(seededUnit("abd"));
  for (const s of ["", "x", "a-long-seed-value"]) {
    expect(seededUnit(s)).toBeGreaterThanOrEqual(0);
    expect(seededUnit(s)).toBeLessThan(1);
  }
});

test("wait window: settle when complete; longer, with a bonus for short messages, when incomplete", () => {
  expect(waitWindowMs(t, true, "turns out it was a promotion lol")).toBe(4000);
  expect(waitWindowMs(t, false, "ok so today was insane and")).toBe(12000);
  expect(waitWindowMs(t, false, "wait")).toBe(16000);
});

test("read delay grows with buffer length and stays within [min, max]", () => {
  expect(readDelayMs(t, 0, 0.5)).toBe(1500);
  expect(readDelayMs(t, 400, 0.5)).toBe(4000);
  const mid = readDelayMs(t, 200, 0.5);
  expect(mid).toBeGreaterThan(1500);
  expect(mid).toBeLessThan(4000);
  expect(readDelayMs(t, 200, 0)).toBeLessThan(readDelayMs(t, 200, 0.99));
  for (const u of [0, 0.99]) for (const c of [0, 50, 10_000]) {
    expect(readDelayMs(t, c, u)).toBeGreaterThanOrEqual(1500);
    expect(readDelayMs(t, c, u)).toBeLessThanOrEqual(4000);
  }
});

test("typing time scales with length and is capped", () => {
  expect(typingMs(t, 50)).toBe(2000);
  expect(typingMs(t, 10_000)).toBe(7000);
});

test("sleepUntil waits only for the remaining time", async () => {
  const clock = new SimClock(new Date("2026-01-05T09:00:00Z"));
  await sleepUntil(clock, new Date("2026-01-05T09:00:03Z"));
  expect(clock.now().toISOString()).toBe("2026-01-05T09:00:03.000Z");
  await sleepUntil(clock, new Date("2026-01-05T09:00:01Z"));
  expect(clock.now().toISOString()).toBe("2026-01-05T09:00:03.000Z");
});
