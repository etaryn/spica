/** The simulated user's input: now, their card, then the dated conversation, her latest message last. */
import { expect, test } from "vitest";
import { simUserInput } from "../../evals/lib/sim-user";

test("now first, then the card, then dated turns with her reach-out last", () => {
  const input = simUserInput(
    "Sam, 27, designer.",
    [
      { role: "user", text: "big week", at: new Date("2026-01-05T10:00:00Z") },
      { role: "companion", text: "how did thursday go", at: new Date("2026-01-12T13:00:00Z") },
    ],
    new Date("2026-01-12T16:00:00Z"),
    "UTC",
  );
  expect(input.startsWith("Now: Mon 2026-01-12 16:00 (UTC)")).toBe(true);
  expect(input.indexOf("Sam, 27")).toBeLessThan(input.indexOf("big week"));
  expect(input).toContain("[Mon 2026-01-05 10:00 (UTC)] You: big week");
  expect(input.trim().endsWith("[Mon 2026-01-12 13:00 (UTC)] Spica: how did thursday go")).toBe(
    true,
  );
});
