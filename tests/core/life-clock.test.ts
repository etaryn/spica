import { expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import {
  lifeDate,
  lifeHour,
  lifeInstant,
  lifeTimezone,
  minutesOf,
  weekday,
} from "@/core/life/clock";

const cfg = loadConfig().life; // Asia/Singapore, UTC+8, no DST

test("her date and hour are in her zone, not UTC", () => {
  const at = new Date("2026-01-05T17:00:00Z"); // 01:00 on the 6th in Singapore
  expect(lifeTimezone(cfg, at)).toBe("Asia/Singapore");
  expect(lifeDate(cfg, at)).toBe("2026-01-06");
  expect(lifeHour(cfg, at)).toBe(1);
});

test("lifeInstant maps HH:MM on her date to an instant; 24:00 is the next midnight", () => {
  expect(lifeInstant(cfg, "2026-01-05", "10:00").toISOString()).toBe("2026-01-05T02:00:00.000Z");
  expect(lifeInstant(cfg, "2026-01-05", "00:00").toISOString()).toBe("2026-01-04T16:00:00.000Z");
  expect(lifeInstant(cfg, "2026-01-05", "24:00").toISOString()).toBe("2026-01-05T16:00:00.000Z");
});

test("minutesOf and weekday", () => {
  expect(minutesOf("07:30")).toBe(450);
  expect(minutesOf("24:00")).toBe(1440);
  expect(weekday("2026-01-05")).toBe("Monday");
});
