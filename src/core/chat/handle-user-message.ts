import { randomUUID } from "node:crypto";
import { setTimezone } from "@/db/repos/users";
import * as sessionLog from "@/db/repos/session-log";
import type { Turn } from "@/db/repos/session-log";
import type { CrisisCard } from "../config";
import type { Deps } from "../deps";
import { ConflictError, InputError, isUniqueViolation, ReplyFailedError } from "../errors";
import { retrieve } from "../memory/retrieve";
import { loadPrompt } from "../prompts";
import { COLD_PATH_QUEUE } from "../queue";
import { checkCrisis, crisisCardFor } from "../safety/crisis";
import { isValidTimeZone } from "../timezone";
import { withTimeout } from "../timeout";
import { assemblePrompt, gapLine } from "./assemble";
import { splitParts } from "./parts";
import { resolveSessionId } from "./session";

export type UserMessageInput = { clientMessageId: string; text: string; timezone?: string };
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
 * The hot path (v2 §6.2). Every companion reply goes through here: the chat
 * route, the eval harness and, from Phase 3, reach-outs.
 */
export async function handleUserMessage(deps: Deps, userId: string, input: UserMessageInput): Promise<ReplyResult> {
  const { db, clock, config, llm, queue, log } = deps;

  // 1. Receive
  const userTurn = await receive(deps, userId, input);
  if (userTurn.role !== "user") throw new ConflictError("message id refers to a companion turn");
  const answered = await sessionLog.getReplyTo(db, userId, userTurn.id);
  if (answered) return toResult(answered, deps);

  // Best-effort: the browser's time zone, for resolving relative dates in extraction.
  if (input.timezone && isValidTimeZone(input.timezone)) {
    await setTimezone(db, userId, input.timezone).catch((e) =>
      log.error("timezone update failed", { userId, error: String((e as Error)?.name ?? "Error") }));
  }

  // The window ends at this user turn, so retrying an older message never sends later turns.
  const recent = await sessionLog.turnsUpTo(db, userId, userTurn, config.chat.recent_turns);
  const earlier = recent.slice(0, -1);

  // Crisis check starts now and runs alongside retrieval and generation (it never rejects).
  const crisis = checkCrisis(deps, userTurn.text, earlier);

  // 2. Retrieve: read-only; recalled ids go to the cold path (v2 §6.2).
  const retrieval = await retrieve(deps, userId, {
    answering: [userTurn],
    context: config.retrieval.context_turns > 0 ? earlier.slice(-config.retrieval.context_turns) : [],
    now: clock.now(),
  });

  // 3. Assemble
  const prompt = assemblePrompt({
    valuesDoc: `${loadPrompt("persona", config.prompts.persona)}\n\n${loadPrompt("reply", config.prompts.reply)}`,
    egoLine: null,
    relationshipSummary: gapLine(earlier.at(-1)?.created_at ?? null, userTurn.created_at, config.chat.gap_line_min_hours),
    retrieval,
    recentTurns: recent,
    gapMarkerMinHours: config.chat.gap_line_min_hours,
    now: clock.now(),
  });

  // 4. Generate
  const [reply, safety] = await Promise.allSettled([llm.generateReply(prompt), crisis]);
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
    // Bounded: a slow or hung queue must never delay the reply (spec principle 5).
    await withTimeout(
      queue.enqueue(COLD_PATH_QUEUE, {
        userId, turnIds: [userTurn.id, companion.id], replyTurnId: companion.id, recalled: retrieval.recalled,
      }),
      config.queue.enqueue_timeout_ms,
    );
  } catch (e) {
    // Never block or fail a reply on the cold path (v2 §6.3). Unextracted turns are reprocessed.
    log.error("cold_path enqueue failed", { userId, turnId: companion.id, error: String((e as Error)?.name ?? "Error") });
  }

  return toResult(companion, deps);
}
