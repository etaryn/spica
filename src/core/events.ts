import type { Deps } from "./deps";
import { errorName } from "./errors";

/**
 * Server → client notifications (v2 §4: SSE fed by LISTEN/NOTIFY). Never message text: the SSE route
 * reads the turn from session_log (design §8.1), keeping text out of Postgres logs and under NOTIFY's 8 KB.
 */
export type ChatEvent =
  | { type: "typing"; on: boolean }
  | { type: "message"; turnId: string; part: number }
  | { type: "reply_failed"; turnIds: string[] };

export interface EventBus {
  publish(userId: string, event: ChatEvent): Promise<void>;
}

export class RecordingEventBus implements EventBus {
  events: { userId: string; event: ChatEvent }[] = [];
  async publish(userId: string, event: ChatEvent): Promise<void> { this.events.push({ userId, event }); }
}

/** Best-effort publish: a notification failure never fails a reply (the client catches up from history). */
export async function emit(deps: Pick<Deps, "events" | "log">, userId: string, event: ChatEvent): Promise<void> {
  try {
    await deps.events.publish(userId, event);
  } catch (e) {
    deps.log.error("event publish failed", { userId, type: event.type, error: errorName(e) });
  }
}

export function isChatEvent(x: unknown): x is ChatEvent {
  if (!x || typeof x !== "object") return false;
  const e = x as Record<string, unknown>;
  if (e.type === "typing") return typeof e.on === "boolean";
  if (e.type === "message") return typeof e.turnId === "string" && Number.isInteger(e.part);
  if (e.type === "reply_failed") return Array.isArray(e.turnIds) && e.turnIds.every((t) => typeof t === "string");
  return false;
}
