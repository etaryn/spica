/**
 * The simulated user: answers her reach-outs in an eval from a short card about who they are and
 * the conversation so far, so an answer fits what she asked. Eval-only; every call goes through
 * the run's provider, so a real run logs it like any other.
 */
import { z } from "zod";

export const SimUserSchema = z.object({ text: z.string() });

export function simUserInput(
  card: string,
  turns: { role: "user" | "companion"; text: string }[],
): string {
  const convo = turns.map((t) => `${t.role === "user" ? "You" : "Spica"}: ${t.text}`).join("\n");
  return `Who you are:\n${card}\n\nThe conversation so far (oldest first):\n${convo}`;
}
