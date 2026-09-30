import type { Deps } from "./deps";
import { errorName } from "./errors";
import { emit } from "./events";
import { withTimeout } from "./timeout";

/** At most `max` code points (never splitting a surrogate pair), ending in an ellipsis when cut. */
function capChars(text: string, max: number): string {
  const cps = Array.from(text);
  return cps.length <= max ? text : `${cps.slice(0, max - 1).join("")}…`;
}

/**
 * One bubble of one of her messages (spec §8.1, D7): SSE first, then a Web Push carrying the parts sent so far
 * under the turn's tag (one notification per message, updated per bubble). The push is not awaited: pacing
 * never waits on a push service, and a push failure never fails the send (the message is already in history).
 * `generic` (crisis replies, v2 §18 O9) pushes `push.generic_body` instead of her words, so a lock screen never shows them.
 */
export async function deliverPart(deps: Pick<Deps, "events" | "log" | "pusher" | "config">, userId: string, a: { turnId: string; part: number; parts: string[]; generic?: boolean }): Promise<void> {
  await emit(deps, userId, { type: "message", turnId: a.turnId, part: a.part });
  if (!deps.config.push.enabled) return;
  const body = a.generic ? deps.config.push.generic_body : capChars(a.parts.slice(0, a.part + 1).join("\n"), deps.config.push.body_max_chars);
  let pushing: Promise<void>;
  try {
    pushing = deps.pusher.push(userId, { tag: a.turnId, body, url: "/chat" });
  } catch (e) {
    pushing = Promise.reject(e);
  }
  void withTimeout(pushing, deps.config.push.timeout_ms).catch((e) => deps.log.error("push failed", { userId, error: errorName(e) }));
}
