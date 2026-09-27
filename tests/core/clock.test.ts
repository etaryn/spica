import { expect, test } from "vitest";
import { SimClock, systemClock } from "@/core/clock";

test("SimClock returns copies and advances", () => {
  const clock = new SimClock(new Date("2026-01-05T09:00:00Z"));
  const a = clock.now();
  a.setFullYear(2000);
  expect(clock.now().toISOString()).toBe("2026-01-05T09:00:00.000Z");
  clock.advance(60_000);
  expect(clock.now().toISOString()).toBe("2026-01-05T09:01:00.000Z");
  clock.set(new Date("2026-01-12T09:00:00Z"));
  expect(clock.now().toISOString()).toBe("2026-01-12T09:00:00.000Z");
});

test("SimClock.sleep advances simulated time; systemClock.sleep waits for real", async () => {
  const clock = new SimClock(new Date("2026-01-05T09:00:00Z"));
  await clock.sleep(1500);
  expect(clock.now().toISOString()).toBe("2026-01-05T09:00:01.500Z");
  await clock.sleep(-10); // negative is a no-op, never moves time backwards
  expect(clock.now().toISOString()).toBe("2026-01-05T09:00:01.500Z");
  const t0 = performance.now();
  await systemClock.sleep(20);
  expect(performance.now() - t0).toBeGreaterThanOrEqual(15);
});
