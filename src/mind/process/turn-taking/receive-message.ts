import { randomUUID } from "node:crypto";
import { getState } from "@/db/repos/conversation-state";
import * as sessionLog from "@/db/repos/session-log";
import type { Turn } from "@/db/repos/session-log";
import { setTimezone } from "@/db/repos/users";
import type { OpenQuestion, SafetyFlag } from "@/db/schema";
import { composeReply } from "@/mind/process/hot-path/compose";
import { splitParts } from "@/mind/process/hot-path/split-parts";
import { receiveTurn, type UserMessageInput } from "@/mind/process/receive/receive-turn";
import type { CrisisCard } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { ConflictError, errorName, isUniqueViolation } from "@/mind/platform/errors";
import { deliverPart } from "@/mind/process/deliver";
import { emit } from "@/mind/platform/events";
import { markReachOutAnswered } from "@/mind/process/outreach/answered";
import { COLD_PATH_QUEUE, TURN_BACKCHANNEL_QUEUE, TURN_TIMER_QUEUE } from "@/mind/platform/jobs";
import { checkCrisis, crisisCardFor } from "@/mind/process/crisis/classifier";
import { isValidTimeZone } from "@/mind/platform/timezone";
import { withTimeout } from "@/mind/platform/timeout";
import { availabilityFor, NO_DELAY } from "@/mind/process/availability/deferral";
import { judgeTurn, logTurnDecision, type TurnVerdict } from "./judge";
import { seededUnit, waitWindowMs } from "./pacing";
import { mutateState } from "./state";
import * as T from "./transitions";

export type ReceiveResult =
  | { status: "accepted" }
  | {
      status: "replied";
      turnId: string;
      text: string;
      parts: string[];
      crisisCard: CrisisCard | null;
    };

const ACCEPTED: ReceiveResult = { status: "accepted" };

/** Bounded, best-effort enqueue: a lost timer is recovered by `turn_sweep`. */
async function enqueueSafely(
  deps: Deps,
  userId: string,
  fn: () => Promise<void>,
  what: string,
): Promise<void> {
  try {
    await withTimeout(fn(), deps.config.queue.enqueue_timeout_ms);
  } catch (e) {
    deps.log.error(`${what} enqueue failed`, { userId, error: errorName(e) });
  }
}

/**
 * POST /api/chat: receive → crisis check ∥ turn judge → buffer + timer (+ backchannel).
 * Replies are sent later by the `turn_timer` job, except on the crisis path, which replies here.
 */
export async function receiveMessage(
  deps: Deps,
  userId: string,
  input: UserMessageInput,
): Promise<ReceiveResult> {
  const { db, clock, config, log } = deps;
  const { turn, existed } = await receiveTurn(deps, userId, input);
  if (turn.role !== "user") throw new ConflictError("message id refers to a companion turn");

  if (input.timezone && isValidTimeZone(input.timezone)) {
    await setTimezone(db, userId, input.timezone).catch((e) =>
      log.error("timezone update failed", { userId, error: errorName(e) }),
    );
  }

  // Any NEW user message, crisis included, answers her latest reach-out. Own short transaction on
  // relationship + reach_out_log only; never holds the conversation_state lock. Run after the crisis decision so a
  // lock wait here never delays a crisis reply (rule 7: crisis bypasses waits); a crisis runs it once replied.
  // Retries (`existed`) return before either call site, and never re-mark.
  const markAnswered = () =>
    existed ? Promise.resolve() : markReachOutAnswered(deps, userId, turn.created_at);

  // Retries: no second judge call.
  let rebuffer = false;
  if (existed) {
    const s = await getState(db, userId);
    if (s && (s.buffer_turn_ids.includes(turn.id) || s.inflight_turn_ids.includes(turn.id)))
      return ACCEPTED;
    const answered = await sessionLog.answeringReply(db, userId, turn);
    if (answered) {
      // Rule 7 outranks "answered → 202": a retried crisis message must still surface the card.
      if (!answered.safety_flag?.flagged) return ACCEPTED;
      return {
        status: "replied",
        turnId: answered.id,
        text: answered.text,
        parts: splitParts(answered.text, config.chat.max_parts),
        crisisCard: crisisCardFor(answered.safety_flag, config),
      };
    }
    rebuffer = true; // its reply failed: put it back in the buffer
  }

  const window = await sessionLog.turnsUpTo(
    db,
    userId,
    turn,
    Math.max(config.chat.recent_turns, config.turn.judge_context_turns + 1),
  );
  const earlier = window.slice(0, -1);
  const crisis = checkCrisis(deps, turn.text, earlier);

  const state = await getState(db, userId);
  const openBefore = state?.open_questions ?? [];
  let judgedBufferIds: string[] = [turn.id]; // fix 6: the buffer the judge actually saw, not a fresh getState after the fact
  const judging: Promise<TurnVerdict | null> = rebuffer
    ? Promise.resolve(null)
    : (async () => {
        const bufferIds = [...(state?.buffer_turn_ids ?? []), turn.id];
        judgedBufferIds = bufferIds;
        const buffered = await sessionLog.getTurnsByIds(db, userId, bufferIds);
        const firstBuffered = buffered[0] ?? turn;
        const context = (
          await sessionLog.turnsUpTo(db, userId, firstBuffered, config.turn.judge_context_turns + 1)
        ).slice(0, -1);
        return judgeTurn(deps, {
          context: context.map((t) => ({ role: t.role, text: t.text, at: t.created_at })),
          buffer: buffered.map((t) => ({ text: t.text, at: t.created_at })),
          openQuestions: openBefore.map((q) => q.text),
        });
      })().catch((e: unknown) => {
        // Settled so a failure here (a DB read; judgeTurn itself never throws) can't reject past the crisis check.
        // A null verdict is treated as complete, like the cue fallback.
        log.error("turn judge input failed", { userId, turnId: turn.id, error: errorName(e) });
        return null;
      });

  // Rule 7: a flagged message doesn't wait for the judge's verdict, which it would discard anyway.
  const flag = await crisis;
  if (flag?.flagged) {
    try {
      return await sendCrisisReply(deps, userId, turn, flag);
    } finally {
      // After the reply is sent (or failed). Bounded so the POST carrying the card never waits on a lock; a timed-out
      // update still commits in the background (markReachOutAnswered never throws).
      await withTimeout(markAnswered(), config.hot_path.db_timeout_ms).catch((e) =>
        log.error("reach-out answered update slow", { userId, error: errorName(e) }),
      );
    }
  }
  await markAnswered();
  const verdict = await judging;

  const complete = verdict?.complete ?? true;
  const windowMs = waitWindowMs(config.turn, complete, turn.text);
  // Availability: decided once, on the first message of a buffer. The unlocked `state` read is
  // fine: `T.append` applies `defer` only if the buffer is still empty under the lock.
  const freshBuffer = !state || state.buffer_turn_ids.length === 0;
  const avail = freshBuffer ? await availabilityFor(deps, userId, clock.now(), turn.id) : NO_DELAY;
  const openQuestions: OpenQuestion[] = verdict
    ? verdict.open_questions.slice(0, config.turn.max_open_questions).map((text) => ({
        turn_id: openBefore.find((q) => q.text === text)?.turn_id ?? turn.id,
        text,
      }))
    : openBefore;
  const now = clock.now();
  const defer =
    avail.delayMs > 0
      ? { until: new Date(now.getTime() + avail.delayMs), factId: avail.blockFactId }
      : null;
  // Rebuffer race (fix 3c): re-check membership and isAnswered inside the lock, so a turn that raced into the
  // buffer, in flight or answered between the outside check above and here is never re-buffered.
  const appended = await mutateState(db, userId, now, async (s, tx) => {
    if (
      rebuffer &&
      (s.buffer_turn_ids.includes(turn.id) ||
        s.inflight_turn_ids.includes(turn.id) ||
        (await sessionLog.isAnswered(tx, userId, turn)))
    ) {
      return T.skip(s, now);
    }
    return T.append(s, {
      turnId: turn.id,
      now,
      windowMs,
      maxWaitMs: config.turn.max_wait_ms,
      openQuestions,
      defer,
    });
  });

  if (!appended.skipped) {
    await enqueueSafely(
      deps,
      userId,
      () =>
        deps.queue.enqueue(
          TURN_TIMER_QUEUE,
          { userId, version: appended.version },
          { startAfter: appended.waitUntil },
        ),
      "turn_timer",
    );

    const deferred = !!appended.deferredUntil && appended.deferredUntil > now; // she isn't reading while busy
    if (
      verdict &&
      !verdict.complete &&
      verdict.backchannel &&
      !appended.backchannelSent &&
      !deferred
    ) {
      const style = config.turn.backchannel_style;
      const want =
        style === "judge" ||
        (style === "signals" && seededUnit(turn.id) < config.turn.signals_probability);
      const rateOk =
        !appended.lastBackchannelAt ||
        now.getTime() - appended.lastBackchannelAt.getTime() >=
          config.turn.backchannel_min_interval_ms;
      if (want && rateOk) {
        await enqueueSafely(
          deps,
          userId,
          () =>
            deps.queue.enqueue(
              TURN_BACKCHANNEL_QUEUE,
              { userId, version: appended.version, text: verdict.backchannel!, turnId: turn.id },
              { startAfter: new Date(now.getTime() + config.turn.backchannel_read_delay_ms) },
            ),
          "turn_backchannel",
        );
      }
    }

    if (appended.deferredNow && avail.note && avail.blockKind && avail.blockStart) {
      await enqueueSafely(
        deps,
        userId,
        () =>
          deps.queue.enqueue(
            TURN_BACKCHANNEL_QUEUE,
            {
              userId,
              version: appended.version,
              text: "",
              turnId: turn.id,
              trigger: "availability",
              blockKind: avail.blockKind!,
              blockStart: avail.blockStart!.toISOString(),
            },
            { startAfter: new Date(now.getTime() + config.availability.note_read_delay_ms) },
          ),
        "availability note",
      );
    }

    if (verdict)
      await logTurnDecision(deps, userId, {
        turnId: turn.id,
        bufferTurnIds: judgedBufferIds,
        verdict,
        waitMs: windowMs,
      });
  }
  return ACCEPTED;
}

/**
 * Crisis path (rule 7): no waiting, pacing, backchannel or availability. Snapshots in-flight + buffered
 * turns, bumps the epoch so a paced reply in flight is abandoned, replies in the request and returns the card.
 */
export async function sendCrisisReply(
  deps: Deps,
  userId: string,
  userTurn: Turn,
  flag: SafetyFlag,
): Promise<ReceiveResult> {
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
      id: randomUUID(),
      session_id: userTurn.session_id,
      role: "companion",
      text: composed.text,
      created_at: clock.now(),
      reply_to: replyTo,
      safety_flag: flag,
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // A concurrent retry already inserted the reply: return its result verbatim, with none of this candidate's
    // side effects (it was never sent) — no emit, no cold-path enqueue, no guard log.
    const winner = await sessionLog.getReplyTo(db, userId, replyTo);
    if (!winner) throw e;
    const winnerParts = splitParts(winner.text, config.chat.max_parts);
    return {
      status: "replied",
      turnId: winner.id,
      text: winner.text,
      parts: winnerParts,
      crisisCard: crisisCardFor(winner.safety_flag, config),
    };
  }
  const parts = composed.parts;
  for (let i = 0; i < parts.length; i++)
    await deliverPart(deps, userId, { turnId: companion.id, part: i, parts, generic: true });
  // A paced reply this abandoned may still show typing until its next epoch check; rule 7: no lingering dots.
  await emit(deps, userId, { type: "typing", on: false });

  await enqueueSafely(
    deps,
    userId,
    () =>
      deps.queue.enqueue(COLD_PATH_QUEUE, {
        userId,
        turnIds: [...answering.map((t) => t.id), companion.id],
        replyTurnId: companion.id,
        recalled: composed.recalled,
      }),
    "cold_path",
  );
  await composed.writeGuardLog();
  log.info("crisis reply sent", { userId, turnId: companion.id });
  return {
    status: "replied",
    turnId: companion.id,
    text: companion.text,
    parts,
    crisisCard: crisisCardFor(companion.safety_flag, config),
  };
}
