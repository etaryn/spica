import { randomUUID } from "node:crypto";
import * as sessionLog from "@/db/repos/session-log";
import type { Turn } from "@/db/repos/session-log";
import type { Deps } from "../deps";
import { ConflictError, InputError, isUniqueViolation } from "../errors";
import { resolveSessionId } from "./session";

export type UserMessageInput = { clientMessageId: string; text: string; timezone?: string };

/** Receive: the stored user turn, inserting it unless this is a retry (`existed`). */
export async function receiveTurn(
  deps: Pick<Deps, "db" | "clock" | "config">,
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
  const prev = await sessionLog.lastUserTurn(db, userId);
  const session_id = resolveSessionId(prev, now, config.session.idle_gap_minutes, randomUUID);
  try {
    return {
      turn: await sessionLog.insertTurn(db, userId, {
        id: input.clientMessageId,
        session_id,
        role: "user",
        text,
        created_at: now,
      }),
      existed: false,
    };
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Same id already stored: a concurrent retry by this user, or another user's id.
    const raced = await sessionLog.getTurn(db, userId, input.clientMessageId);
    if (raced) return { turn: raced, existed: true };
    throw new ConflictError("message id already in use");
  }
}
