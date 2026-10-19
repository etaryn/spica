/**
 * The simulated user: answers her reach-outs in an eval from a short card about who they are and
 * the conversation so far, so an answer fits what she asked. It is told the current time and when
 * each message was sent, so it knows only what has happened by now. Eval-only; every call goes
 * through the run's provider, so a real run logs it like any other.
 */
import { z } from "zod";
import { formatLocal } from "@/mind/platform/timezone";

export const SimUserSchema = z.object({ text: z.string() });

export function simUserInput(
  card: string,
  turns: { role: "user" | "companion"; text: string; at: Date }[],
  now: Date,
  tz: string,
): string {
  const convo = turns
    .map((t) => `[${formatLocal(t.at, tz)}] ${t.role === "user" ? "You" : "Spica"}: ${t.text}`)
    .join("\n");
  return `Now: ${formatLocal(now, tz)}\n\nWho you are:\n${card}\n\nThe conversation so far (oldest first):\n${convo}`;
}
