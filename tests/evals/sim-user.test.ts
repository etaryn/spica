/** The simulated user's input: their card, then the conversation, her latest message last. */
import { expect, test } from "vitest";
import { simUserInput } from "../../evals/lib/sim-user";

test("card first, turns in order, her reach-out last", () => {
  const input = simUserInput("Sam, 27, designer.", [
    { role: "user", text: "big week" },
    { role: "companion", text: "how did thursday go" },
  ]);
  expect(input.indexOf("Sam, 27")).toBeLessThan(input.indexOf("big week"));
  expect(input.trim().endsWith("Spica: how did thursday go")).toBe(true);
});
