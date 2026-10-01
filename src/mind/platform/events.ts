/**
 * Server-to-client notifications, carried over SSE from Postgres LISTEN/NOTIFY. Events carry ids,
 * never message text: the SSE route reads the turn from session_log, which keeps text out of
 * Postgres logs and under NOTIFY's 8 KB limit.
 */
import type { Deps } from "./deps";
import { errorName } from "./errors";

export type ChatEvent =
  | { type: "typing"; on: boolean }
  | { type: "message"; turnId: string; part: number }
  | { type: "reply_failed"; turnIds: string[] };

export interface EventBus {
  publish(userId: string, event: ChatEvent): Promise<void>;
}

export class RecordingEventBus implements EventBus {
  events: { userId: string; event: ChatEvent }[] = [];

  async publish(userId: string, event: ChatEvent): Promise<void> {
    this.events.push({ userId, event });
  }
}

/** Best effort: a failed notification never fails a reply; the client catches up from history. */
export async function emit(
  deps: Pick<Deps, "events" | "log">,
  userId: string,
  event: ChatEvent,
): Promise<void> {
  try {
    await deps.events.publish(userId, event);
  } catch (e) {
    deps.log.error("event publish failed", { userId, type: event.type, error: errorName(e) });
  }
}

export function isChatEvent(value: unknown): value is ChatEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;

  switch (event.type) {
    case "typing":
      return typeof event.on === "boolean";
    case "message":
      return typeof event.turnId === "string" && Number.isInteger(event.part);
    case "reply_failed":
      return Array.isArray(event.turnIds) && event.turnIds.every((id) => typeof id === "string");
    default:
      return false;
  }
}
