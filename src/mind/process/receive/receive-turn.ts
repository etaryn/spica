/**
 * Receive: stores the user's message as a turn. Idempotent on the client's message id, so a
 * retried POST returns the turn already stored instead of storing it twice.
 */
import { randomUUID } from "node:crypto";
import * as sessionLog from "@/db/repos/user/session-log";
import type { Turn } from "@/db/repos/user/session-log";
import type { Deps } from "@/mind/platform/deps";
import { ConflictError, InputError, isUniqueViolation } from "@/mind/platform/errors";
import { resolveSessionId } from "./session";

export type UserMessageInput = { clientMessageId: string; text: string; timezone?: string };

/** `existed` is true when this is a retry of a message already stored. */
export async function receiveTurn(
  deps: Pick<Deps, "db" | "clock" | "config" | "modules">,
  userId: string,
  input: UserMessageInput,
): Promise<{ turn: Turn; existed: boolean }> {
  const { db, clock, config } = deps;

  const existing = await sessionLog.getTurn(db, userId, input.clientMessageId);
  if (existing) return { turn: existing, existed: true };

  const text = input.text.trim();
  if (!text) throw new InputError("message is empty");
  if (text.length > config.chat.max_message_chars) throw new InputError("message is too long");

  const now = clock.now();
  const previous = await sessionLog.lastUserTurn(db, userId);
  const sessionId = resolveSessionId(previous, now, config.session.idle_gap_minutes, randomUUID);

  try {
    const turn = await sessionLog.insertTurn(db, userId, {
      id: input.clientMessageId,
      session_id: sessionId,
      role: "user",
      text,
      created_at: now,
    });
    await deps.modules.emit({ type: "turn.received", userId, turnId: turn.id });
    return { turn, existed: false };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;

    // The id is already stored: either a concurrent retry by this user, or another user's id.
    const raced = await sessionLog.getTurn(db, userId, input.clientMessageId);
    if (raced) return { turn: raced, existed: true };
    throw new ConflictError("message id already in use");
  }
}
