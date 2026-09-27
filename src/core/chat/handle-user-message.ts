import { randomUUID } from "node:crypto";
import * as sessionLog from "@/db/repos/session-log";
import type { Turn } from "@/db/repos/session-log";
import { setTimezone } from "@/db/repos/users";
import type { CrisisCard } from "../config";
import type { Deps } from "../deps";
import { ConflictError, isUniqueViolation } from "../errors";
import { COLD_PATH_QUEUE } from "../queue";
import { checkCrisis, crisisCardFor } from "../safety/crisis";
import { isValidTimeZone } from "../timezone";
import { withTimeout } from "../timeout";
import { composeReply } from "./compose-reply";
import { splitParts } from "./parts";
import { receiveTurn, type UserMessageInput } from "./receive";

export type { UserMessageInput };
export type ReplyResult = { turnId: string; text: string; parts: string[]; crisisCard: CrisisCard | null };

const toResult = (c: Turn, deps: Deps): ReplyResult =>
  ({ turnId: c.id, text: c.text, parts: splitParts(c.text, deps.config.chat.max_parts), crisisCard: crisisCardFor(c.safety_flag, deps.config) });

/** Phase 2 synchronous flow, kept only until Task 7 replaces it with receiveMessage. */
export async function handleUserMessage(deps: Deps, userId: string, input: UserMessageInput): Promise<ReplyResult> {
  const { db, clock, config, queue, log } = deps;
  const { turn: userTurn } = await receiveTurn(deps, userId, input);
  if (userTurn.role !== "user") throw new ConflictError("message id refers to a companion turn");
  const answered = await sessionLog.getReplyTo(db, userId, userTurn.id);
  if (answered) return toResult(answered, deps);
  if (input.timezone && isValidTimeZone(input.timezone)) {
    await setTimezone(db, userId, input.timezone).catch((e) => log.error("timezone update failed", { userId, error: String((e as Error)?.name ?? "Error") }));
  }
  const earlier = (await sessionLog.turnsUpTo(db, userId, userTurn, config.chat.recent_turns)).slice(0, -1);
  const flag = await checkCrisis(deps, userTurn.text, earlier);
  const composed = await composeReply(deps, userId, { turns: [userTurn], openQuestions: [], flag });
  let companion: Turn;
  try {
    companion = await sessionLog.insertTurn(db, userId, {
      id: randomUUID(), session_id: userTurn.session_id, role: "companion", text: composed.text, created_at: clock.now(), reply_to: userTurn.id, safety_flag: flag,
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const winner = await sessionLog.getReplyTo(db, userId, userTurn.id);
    if (!winner) throw e;
    return toResult(winner, deps);
  }
  try {
    await withTimeout(queue.enqueue(COLD_PATH_QUEUE, { userId, turnIds: [userTurn.id, companion.id], replyTurnId: companion.id, recalled: composed.recalled }), config.queue.enqueue_timeout_ms);
  } catch (e) {
    log.error("cold_path enqueue failed", { userId, turnId: companion.id, error: String((e as Error)?.name ?? "Error") });
  }
  await composed.writeGuardLog();
  return toResult(companion, deps);
}
