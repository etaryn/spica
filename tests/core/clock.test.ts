import { expect, test } from "vitest";
import { SimClock } from "@/core/clock";

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
