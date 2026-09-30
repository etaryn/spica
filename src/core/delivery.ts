import type { Deps } from "./deps";
import { errorName } from "./errors";
import { emit } from "./events";
import { withTimeout } from "./timeout";

/**
 * One bubble of one of her messages (spec §8.1, D7): SSE first, then a Web Push carrying the parts sent so far
 * under the turn's tag (one notification per message, updated per bubble). The push is not awaited: pacing
 * never waits on a push service, and a push failure never fails the send (the message is already in history).
 */
export async function deliverPart(deps: Pick<Deps, "events" | "log" | "pusher" | "config">, userId: string, a: { turnId: string; part: number; parts: string[] }): Promise<void> {
  await emit(deps, userId, { type: "message", turnId: a.turnId, part: a.part });
  if (!deps.config.push.enabled) return;
  const body = a.parts.slice(0, a.part + 1).join("\n");
  let pushing: Promise<void>;
  try {
    pushing = deps.pusher.push(userId, { tag: a.turnId, body, url: "/chat" });
  } catch (e) {
    pushing = Promise.reject(e);
  }
  void withTimeout(pushing, deps.config.push.timeout_ms).catch((e) => deps.log.error("push failed", { userId, error: errorName(e) }));
}
