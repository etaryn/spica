/**
 * The inspector's life tab says whether each of her world events has landed yet.
 */
import { expect, test } from "vitest";
import { eventStatus } from "@/app/inspector/[userId]/event-status";

test("an appraised event shows when it landed; an unappraised one is pending", () => {
  expect(eventStatus({ appraised_at: new Date("2026-01-05T15:10:00Z") })).toBe(
    "landed 2026-01-05 15:10",
  );
  expect(eventStatus({ appraised_at: null })).toBe("pending");
});
