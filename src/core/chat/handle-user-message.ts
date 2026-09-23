import { randomUUID } from "node:crypto";
import * as sessionLog from "@/db/repos/session-log";
import type { Turn } from "@/db/repos/session-log";
import type { CrisisCard } from "../config";
import type { Deps } from "../deps";
import { ConflictError, InputError, isUniqueViolation, ReplyFailedError } from "../errors";
import { loadPrompt } from "../prompts";
import { COLD_PATH_QUEUE } from "../queue";
import { checkCrisis, crisisCardFor } from "../safety/crisis";
import { assemblePrompt, emptyRetrieval } from "./assemble";
import { splitParts } from "./parts";
import { resolveSessionId } from "./session";

export type UserMessageInput = { clientMessageId: string; text: string };
export type ReplyResult = { turnId: string; text: string; parts: string[]; crisisCard: CrisisCard | null };

function toResult(companion: Turn, deps: Deps): ReplyResult {
  return {
    turnId: companion.id,
    text: companion.text,
    parts: splitParts(companion.text, deps.config.chat.max_parts),
    crisisCard: crisisCardFor(companion.safety_flag, deps.config),
  };
}

/** Step 1 (receive): returns the stored user turn, inserting it unless this is a retry. */
async function receive(deps: Deps, userId: string, input: UserMessageInput): Promise<Turn> {
  const { db, clock, config } = deps;
  const existing = await sessionLog.getTurn(db, userId, input.clientMessageId);
  if (existing) return existing;

  const text = input.text.trim();
  if (!text) throw new InputError("message is empty");
  if (text.length > config.chat.max_message_chars) throw new InputError("message is too long");

  const now = clock.now();
  const prev = await sessionLog.lastUserTurn(db, userId);
  const session_id = resolveSessionId(prev, now, config.session.idle_gap_minutes, randomUUID);
  try {
    return await sessionLog.insertTurn(db, userId, {
      id: input.clientMessageId, session_id, role: "user", text, created_at: now,
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Same id already stored: a concurrent retry by this user, or another user's id.
    const raced = await sessionLog.getTurn(db, userId, input.clientMessageId);
    if (raced) return raced;
    throw new ConflictError("message id already in use");
  }
}

/**
 * The hot path (spec §4.1). Every companion reply goes through here: the chat
 * route, the eval harness and, from Phase 3, reach-outs.
 */
export async function handleUserMessage(deps: Deps, userId: string, input: UserMessageInput): Promise<ReplyResult> {
  const { db, clock, config, llm, queue, log } = deps;

  // 1. Receive
  const userTurn = await receive(deps, userId, input);
  if (userTurn.role !== "user") throw new ConflictError("message id refers to a companion turn");
  const answered = await sessionLog.getReplyTo(db, userId, userTurn.id);
  if (answered) return toResult(answered, deps);

  // 2. Retrieve (Phase 1)
  const retrieval = emptyRetrieval();

  // 3. Assemble
  const recent = await sessionLog.recentTurns(db, userId, config.chat.recent_turns);
  const prompt = assemblePrompt({
    valuesDoc: loadPrompt("reply", config.prompts.reply),
    egoLine: null,
    relationshipSummary: null,
    retrieval,
    recentTurns: recent,
    now: clock.now(),
  });

  // 4. Generate + crisis check in parallel (checkCrisis never rejects)
  const [reply, safety] = await Promise.allSettled([llm.generateReply(prompt), checkCrisis(deps, userTurn.text)]);
  const flag = safety.status === "fulfilled" ? safety.value : null;
  if (reply.status === "rejected") {
    log.error("reply generation failed", { userId, turnId: userTurn.id, error: String((reply.reason as Error)?.name ?? "Error") });
    throw new ReplyFailedError("reply generation failed", crisisCardFor(flag, config), { cause: reply.reason });
  }

  // 5. Send + log
  let companion: Turn;
  try {
    companion = await sessionLog.insertTurn(db, userId, {
      id: randomUUID(),
      session_id: userTurn.session_id,
      role: "companion",
      text: reply.value.trim(),
      created_at: clock.now(),
      reply_to: userTurn.id,
      safety_flag: flag,
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const winner = await sessionLog.getReplyTo(db, userId, userTurn.id);
    if (!winner) throw e;
    return toResult(winner, deps); // a concurrent request answered first
  }

  try {
    await queue.enqueue(COLD_PATH_QUEUE, { userId, turnIds: [userTurn.id, companion.id] });
  } catch (e) {
    // Never block or fail a reply on the cold path (spec §4.2). Unextracted turns are reprocessed.
    log.error("cold_path enqueue failed", { userId, turnId: companion.id, error: String((e as Error)?.name ?? "Error") });
  }

  return toResult(companion, deps);
}
