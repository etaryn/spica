import { expect, test } from "vitest";
import { checkAge } from "@/mind/platform/age-gate";

const now = new Date("2026-09-23T12:00:00Z");

test("exactly 18 today is allowed; 18 tomorrow is not", () => {
  expect(checkAge("2008-09-23", now, 18)).toEqual({ ok: true });
  expect(checkAge("2008-09-24", now, 18).ok).toBe(false);
});

test("Feb 29 birthday counts from Mar 1 in non-leap years", () => {
  expect(checkAge("2008-02-29", new Date("2026-02-28T12:00:00Z"), 18).ok).toBe(false);
  expect(checkAge("2008-02-29", new Date("2026-03-01T12:00:00Z"), 18).ok).toBe(true);
});

test("rejects malformed, impossible and future dates", () => {
  expect(checkAge("23/09/2000", now, 18).ok).toBe(false);
  expect(checkAge("2000-02-30", now, 18).ok).toBe(false);
  expect(checkAge("2030-01-01", now, 18).ok).toBe(false);
  expect(checkAge("", now, 18).ok).toBe(false);
});
