/**
 * Delivers one bubble of one of her messages: SSE first, then a Web Push carrying the bubbles
 * sent so far, under the message's tag (one notification per message, updated per bubble).
 * The push isn't awaited, so pacing never waits on a push service, and a push failure never fails
 * the send (the message is already in history). A crisis reply pushes a generic body, so her
 * words never show on a lock screen.
 */
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { emit } from "@/mind/platform/events";
import { withTimeout } from "@/mind/platform/timeout";

/** At most `max` code points (never splitting a surrogate pair), ending in "…" when cut. */
function capChars(text: string, max: number): string {
  const codePoints = Array.from(text);
  if (codePoints.length <= max) return text;
  return `${codePoints.slice(0, max - 1).join("")}…`;
}

export async function deliverPart(
  deps: Pick<Deps, "events" | "log" | "pusher" | "config">,
  userId: string,
  bubble: { turnId: string; part: number; parts: string[]; generic?: boolean },
): Promise<void> {
  await emit(deps, userId, { type: "message", turnId: bubble.turnId, part: bubble.part });

  const settings = deps.config.push;
  if (!settings.enabled) return;

  const body = bubble.generic
    ? settings.generic_body
    : capChars(bubble.parts.slice(0, bubble.part + 1).join("\n"), settings.body_max_chars);

  let pushing: Promise<void>;
  try {
    pushing = deps.pusher.push(userId, { tag: bubble.turnId, body, url: "/chat" });
  } catch (e) {
    pushing = Promise.reject(e);
  }

  void withTimeout(pushing, settings.timeout_ms).catch((e) =>
    deps.log.error("push failed", { userId, error: errorName(e) }),
  );
}
