import { randomUUID } from "node:crypto";
import { getState } from "@/db/repos/conversation-state";
import * as sessionLog from "@/db/repos/session-log";
import type { Turn } from "@/db/repos/session-log";
import { setTimezone } from "@/db/repos/users";
import type { OpenQuestion, SafetyFlag } from "@/db/schema";
import { composeReply } from "../chat/compose-reply";
import { splitParts } from "../chat/parts";
import { receiveTurn, type UserMessageInput } from "../chat/receive";
import type { CrisisCard } from "../config";
import type { Deps } from "../deps";
import { ConflictError, isUniqueViolation } from "../errors";
import { emit } from "../events";
import { COLD_PATH_QUEUE, TURN_BACKCHANNEL_QUEUE, TURN_TIMER_QUEUE } from "../queue";
import { checkCrisis, crisisCardFor } from "../safety/crisis";
import { isValidTimeZone } from "../timezone";
import { withTimeout } from "../timeout";
import { availabilityStretch } from "./availability";
import { judgeTurn, logTurnDecision, type TurnVerdict } from "./judge";
import { seededUnit, waitWindowMs } from "./pacing";
import { mutateState } from "./state";
import * as T from "./transitions";

export type ReceiveResult =
  | { status: "accepted" }
  | { status: "replied"; turnId: string; text: string; parts: string[]; crisisCard: CrisisCard | null };

const errName = (e: unknown) => (e instanceof Error ? e.constructor.name : "UnknownError");
const ACCEPTED: ReceiveResult = { status: "accepted" };

/** Bounded, best-effort enqueue: a lost timer is recovered by `turn_sweep` (design §5.6). */
async function enqueueSafely(deps: Deps, userId: string, fn: () => Promise<void>, what: string): Promise<void> {
  try {
    await withTimeout(fn(), deps.config.queue.enqueue_timeout_ms);
  } catch (e) {
    deps.log.error(`${what} enqueue failed`, { userId, error: errName(e) });
  }
}

/**
 * POST /api/chat (v2 §6.1; design §5.1): receive → crisis check ∥ turn judge → buffer + timer (+ backchannel).
 * Replies are sent later by the `turn_timer` job, except on the crisis path, which replies here.
 */
export async function receiveMessage(deps: Deps, userId: string, input: UserMessageInput): Promise<ReceiveResult> {
  const { db, clock, config, log } = deps;
  const { turn, existed } = await receiveTurn(deps, userId, input);
  if (turn.role !== "user") throw new ConflictError("message id refers to a companion turn");

  if (input.timezone && isValidTimeZone(input.timezone)) {
    await setTimezone(db, userId, input.timezone).catch((e) => log.error("timezone update failed", { userId, error: errName(e) }));
  }

  // Retries (design §5.1 step 1): no second judge call.
  let rebuffer = false;
  if (existed) {
    const s = await getState(db, userId);
    if (s && (s.buffer_turn_ids.includes(turn.id) || s.inflight_turn_ids.includes(turn.id))) return ACCEPTED;
    const answered = await sessionLog.answeringReply(db, userId, turn);
    if (answered) {
      // Rule 7 outranks design §5.1's "answered → 202": a retried crisis message must still surface the card.
      if (!answered.safety_flag?.flagged) return ACCEPTED;
      return { status: "replied", turnId: answered.id, text: answered.text, parts: splitParts(answered.text, config.chat.max_parts), crisisCard: crisisCardFor(answered.safety_flag, config) };
    }
    rebuffer = true; // its reply failed: put it back in the buffer
  }

  const window = await sessionLog.turnsUpTo(db, userId, turn, Math.max(config.chat.recent_turns, config.turn.judge_context_turns + 1));
  const earlier = window.slice(0, -1);
  const crisis = checkCrisis(deps, turn.text, earlier);

  const state = await getState(db, userId);
  const openBefore = state?.open_questions ?? [];
  let judgedBufferIds: string[] = [turn.id]; // fix 6: the buffer the judge actually saw, not a fresh getState after the fact
  const judging: Promise<TurnVerdict | null> = rebuffer ? Promise.resolve(null) : (async () => {
    const bufferIds = [...(state?.buffer_turn_ids ?? []), turn.id];
    judgedBufferIds = bufferIds;
    const buffered = await sessionLog.getTurnsByIds(db, userId, bufferIds);
    const firstBuffered = buffered[0] ?? turn;
    const context = (await sessionLog.turnsUpTo(db, userId, firstBuffered, config.turn.judge_context_turns + 1)).slice(0, -1);
    return judgeTurn(deps, {
      context: context.map((t) => ({ role: t.role, text: t.text, at: t.created_at })),
      buffer: buffered.map((t) => ({ text: t.text, at: t.created_at })),
      openQuestions: openBefore.map((q) => q.text),
    });
  })().catch((e: unknown) => {
    // Settled so a failure here (a DB read; judgeTurn itself never throws) can't reject past the crisis check.
    // A null verdict is treated as complete, like the cue fallback.
    log.error("turn judge input failed", { userId, turnId: turn.id, error: e instanceof Error ? e.constructor.name : "UnknownError" });
    return null;
  });

  // Rule 7: a flagged message doesn't wait for the judge's verdict, which it would discard anyway.
  const flag = await crisis;
  if (flag?.flagged) return sendCrisisReply(deps, userId, turn, flag);
  const verdict = await judging;

  const complete = verdict?.complete ?? true;
  const stretch = await availabilityStretch(deps, userId);
  const windowMs = Math.round(waitWindowMs(config.turn, complete, turn.text) * stretch);
  const openQuestions: OpenQuestion[] = verdict
    ? verdict.open_questions.slice(0, config.turn.max_open_questions)
        .map((text) => ({ turn_id: openBefore.find((q) => q.text === text)?.turn_id ?? turn.id, text }))
    : openBefore;
  const now = clock.now();
  // Rebuffer race (fix 3c): re-check membership and isAnswered inside the lock, so a turn that raced into the
  // buffer, in flight or answered between the outside check above and here is never re-buffered.
  const appended = await mutateState(db, userId, now, async (s, tx) => {
    if (rebuffer && (s.buffer_turn_ids.includes(turn.id) || s.inflight_turn_ids.includes(turn.id) || (await sessionLog.isAnswered(tx, userId, turn)))) {
      return T.skip(s, now);
    }
    return T.append(s, { turnId: turn.id, now, windowMs, maxWaitMs: config.turn.max_wait_ms, openQuestions });
  });

  if (!appended.skipped) {
    await enqueueSafely(deps, userId, () => deps.queue.enqueue(TURN_TIMER_QUEUE, { userId, version: appended.version }, { startAfter: appended.waitUntil }), "turn_timer");

    if (verdict && !verdict.complete && verdict.backchannel && !appended.backchannelSent) {
      const style = config.turn.backchannel_style;
      const want = style === "judge" || (style === "signals" && seededUnit(turn.id) < config.turn.signals_probability);
      const rateOk = !appended.lastBackchannelAt || now.getTime() - appended.lastBackchannelAt.getTime() >= config.turn.backchannel_min_interval_ms;
      if (want && rateOk) {
        await enqueueSafely(deps, userId, () => deps.queue.enqueue(TURN_BACKCHANNEL_QUEUE,
          { userId, version: appended.version, text: verdict.backchannel!, turnId: turn.id },
          { startAfter: new Date(now.getTime() + config.turn.backchannel_read_delay_ms) }), "turn_backchannel");
      }
    }

    if (verdict) await logTurnDecision(deps, userId, { turnId: turn.id, bufferTurnIds: judgedBufferIds, verdict, waitMs: windowMs });
  }
  return ACCEPTED;
}

/**
 * Crisis path (rule 7; design §5.4): no waiting, pacing, backchannel or availability. Snapshots in-flight + buffered
 * turns, bumps the epoch so a paced reply in flight is abandoned, replies in the request and returns the card.
 */
export async function sendCrisisReply(deps: Deps, userId: string, userTurn: Turn, flag: SafetyFlag): Promise<ReceiveResult> {
  const { db, clock, config, log } = deps;
  const now = clock.now();
  const snap = await mutateState(db, userId, now, (s) => T.crisis(s, { turnId: userTurn.id, now }));
  const turns = await sessionLog.getTurnsByIds(db, userId, snap.turnIds);
  const answering = turns.length ? turns : [userTurn];
  const replyTo = answering.at(-1)!.id; // fix 5: the snapshot's last turn, not necessarily the POSTed one
  const composed = await composeReply(deps, userId, { turns: answering, openQuestions: [], flag });

  let companion: Turn;
  try {
    companion = await sessionLog.insertTurn(db, userId, {
      id: randomUUID(), session_id: userTurn.session_id, role: "companion", text: composed.text,
      created_at: clock.now(), reply_to: replyTo, safety_flag: flag,
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // A concurrent retry already inserted the reply: return its result verbatim, with none of this candidate's
    // side effects (it was never sent) — no emit, no cold-path enqueue, no guard log.
    const winner = await sessionLog.getReplyTo(db, userId, replyTo);
    if (!winner) throw e;
    const winnerParts = splitParts(winner.text, config.chat.max_parts);
    return { status: "replied", turnId: winner.id, text: winner.text, parts: winnerParts, crisisCard: crisisCardFor(winner.safety_flag, config) };
  }
  const parts = composed.parts;
  for (let i = 0; i < parts.length; i++) await emit(deps, userId, { type: "message", turnId: companion.id, part: i });
  // A paced reply this abandoned may still show typing until its next epoch check; rule 7: no lingering dots.
  await emit(deps, userId, { type: "typing", on: false });

  await enqueueSafely(deps, userId, () => deps.queue.enqueue(COLD_PATH_QUEUE, {
    userId, turnIds: [...answering.map((t) => t.id), companion.id], replyTurnId: companion.id, recalled: composed.recalled,
  }), "cold_path");
  await composed.writeGuardLog();
  log.info("crisis reply sent", { userId, turnId: companion.id });
  return { status: "replied", turnId: companion.id, text: companion.text, parts, crisisCard: crisisCardFor(companion.safety_flag, config) };
}
