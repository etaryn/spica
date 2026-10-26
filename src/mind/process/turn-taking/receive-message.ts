/**
 * A user's message arrives (POST /api/chat). It is stored, then the crisis check and the turn
 * judge run side by side, and the message joins the buffer with a timer, plus a backchannel or a
 * busy note when one fits. The reply comes later from the `turn_timer` job. The exception is a
 * crisis, which is answered right here, in the request.
 */
import { randomUUID } from "node:crypto";
import { getState, type ConvState } from "@/db/repos/user/conversation-state";
import * as sessionLog from "@/db/repos/user/session-log";
import type { Turn } from "@/db/repos/user/session-log";
import { setTimezone } from "@/db/repos/user/users";
import type { OpenQuestion, SafetyFlag } from "@/db/schema";
import type { CrisisCard } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { ConflictError, errorName, isUniqueViolation } from "@/mind/platform/errors";
import { emit } from "@/mind/platform/events";
import { COLD_PATH_QUEUE, TURN_BACKCHANNEL_QUEUE, TURN_TIMER_QUEUE } from "@/mind/platform/jobs";
import { withTimeout } from "@/mind/platform/timeout";
import { isValidTimeZone } from "@/mind/platform/timezone";
import { deferWhileBusy, NO_DELAY, type Availability } from "@/mind/process/availability/deferral";
import { checkCrisis, crisisCardFor } from "@/mind/process/crisis/classifier";
import { deliverPart } from "@/mind/process/deliver";
import { composeReply } from "@/mind/process/hot-path/compose";
import { splitParts } from "@/mind/process/hot-path/split-parts";
import { markReachOutAnswered } from "@/mind/process/outreach/answered";
import { receiveTurn, type UserMessageInput } from "@/mind/process/receive/receive-turn";
import { judgeTurn, logTurnDecision, type TurnVerdict } from "./judge";
import { waitWindowMs } from "./pacing";
import { openAfter, withWords } from "./questions";
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

type Appended = ReturnType<typeof T.append>["result"];

/** Bounded and best effort: a lost timer is recovered by `turn_sweep`. */
async function enqueueSafely(
  deps: Deps,
  userId: string,
  enqueue: () => Promise<void>,
  what: string,
): Promise<void> {
  try {
    await withTimeout(enqueue(), deps.config.queue.enqueue_timeout_ms);
  } catch (e) {
    deps.log.error(`${what} enqueue failed`, { userId, error: errorName(e) });
  }
}

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

  // Any new message, crisis included, answers her latest reach-out. It's a short transaction of
  // its own that never holds the conversation_state lock, and it runs after the crisis decision
  // so a lock wait never delays a crisis reply. Retries never re-mark.
  const markAnswered = () =>
    existed ? Promise.resolve() : markReachOutAnswered(deps, userId, turn.created_at);

  let rebuffer = false;
  if (existed) {
    const retry = await handleRetry(deps, userId, turn);
    if (retry !== "rebuffer") return retry;
    rebuffer = true;
  }

  const contextWindow = await sessionLog.turnsUpTo(
    db,
    userId,
    turn,
    Math.max(config.chat.recent_turns, config.turn.judge_context_turns + 1),
  );
  const crisisCheck = checkCrisis(deps, turn.text, contextWindow.slice(0, -1));

  const state = await getState(db, userId);
  const openBefore = state?.open_questions ?? [];
  const judging = rebuffer
    ? { bufferIds: [turn.id], verdict: Promise.resolve(null) }
    : startJudging(deps, userId, turn, state, openBefore);

  // A flagged message doesn't wait for the judge, whose verdict it would discard anyway.
  const flag = await crisisCheck;
  if (flag?.flagged) {
    try {
      return await sendCrisisReply(deps, userId, turn, flag);
    } finally {
      // Bounded, so the response carrying the crisis card never waits on a lock. A timed-out
      // update still commits in the background (markReachOutAnswered never throws).
      await withTimeout(markAnswered(), config.hot_path.db_timeout_ms).catch((e) =>
        log.error("reach-out answered update slow", { userId, error: errorName(e) }),
      );
    }
  }

  await markAnswered();
  const verdict = await judging.verdict;

  const complete = verdict?.complete ?? true;
  const windowMs = waitWindowMs(config.turn, complete, turn.text);

  // Availability is decided once, on a buffer's first message. The unlocked `state` read is fine:
  // `T.append` applies the deferral only if the buffer is still empty under the lock.
  const freshBuffer = !state || state.buffer_turn_ids.length === 0;
  const availability = freshBuffer
    ? await deferWhileBusy(deps, userId, clock.now(), turn.id)
    : NO_DELAY;

  const now = clock.now();
  const defer =
    availability.delayMs > 0
      ? { until: new Date(now.getTime() + availability.delayMs), blockKey: availability.blockKey }
      : null;

  const appended = await mutateState(db, userId, now, async (locked, tx) => {
    // Re-checked under the lock: a retried turn that raced into the buffer, into flight, or got
    // answered since the check above is never re-buffered.
    if (rebuffer && (await alreadyHandled(locked, tx, userId, turn))) return T.skip(locked, now);

    return T.append(locked, {
      turnId: turn.id,
      now,
      windowMs,
      maxWaitMs: config.turn.max_wait_ms,
      openQuestions: openAfter(
        locked.open_questions,
        verdict?.questions ?? null,
        config.turn.max_open_questions,
      ),
      defer,
    });
  });
  if (appended.skipped) return ACCEPTED;

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
  await maybeEnqueueBackchannel(deps, userId, turn, verdict, appended, now);
  await maybeEnqueueBusyNote(deps, userId, turn, availability, appended, now);

  if (verdict) {
    await logTurnDecision(deps, userId, {
      turnId: turn.id,
      bufferTurnIds: judging.bufferIds,
      verdict,
      waitMs: windowMs,
    });
  }
  return ACCEPTED;
}

/**
 * A retried message: already buffered or in flight means nothing to do. Already answered also
 * means nothing to do, except that a crisis reply must still surface its card. Otherwise its
 * reply failed, so it goes back in the buffer.
 */
async function handleRetry(
  deps: Deps,
  userId: string,
  turn: Turn,
): Promise<ReceiveResult | "rebuffer"> {
  const { db, config } = deps;

  const state = await getState(db, userId);
  if (
    state &&
    (state.buffer_turn_ids.includes(turn.id) || state.inflight_turn_ids.includes(turn.id))
  ) {
    return ACCEPTED;
  }

  const answer = await sessionLog.answeringReply(db, userId, turn);
  if (!answer) return "rebuffer";
  if (!answer.safety_flag?.flagged) return ACCEPTED;

  return {
    status: "replied",
    turnId: answer.id,
    text: answer.text,
    parts: splitParts(answer.text, config.chat.max_parts),
    crisisCard: crisisCardFor(answer.safety_flag, config),
  };
}

/**
 * Starts the turn judge over the buffer as it stands plus this message, and remembers exactly
 * which buffer it saw for the log. A failure reading its input settles as a null verdict (treated
 * as complete, like the cue fallback), so it can never reject past the crisis check.
 */
function startJudging(
  deps: Deps,
  userId: string,
  turn: Turn,
  state: ConvState | null,
  openBefore: OpenQuestion[],
): { bufferIds: string[]; verdict: Promise<TurnVerdict | null> } {
  const { db, config, log } = deps;
  const bufferIds = [...(state?.buffer_turn_ids ?? []), turn.id];

  const verdict = (async () => {
    const buffered = await sessionLog.getTurnsByIds(db, userId, bufferIds);
    const firstBuffered = buffered[0] ?? turn;
    const context = (
      await sessionLog.turnsUpTo(db, userId, firstBuffered, config.turn.judge_context_turns + 1)
    ).slice(0, -1);

    return judgeTurn(deps, {
      context: context.map((t) => ({ role: t.role, text: t.text, at: t.created_at })),
      buffer: buffered.map((t) => ({ id: t.id, text: t.text, at: t.created_at })),
      openQuestions: await withWords(db, userId, openBefore),
    });
  })().catch((e: unknown) => {
    log.error("turn judge input failed", { userId, turnId: turn.id, error: errorName(e) });
    return null;
  });

  return { bufferIds, verdict };
}

async function alreadyHandled(
  state: ConvState,
  tx: Deps["db"],
  userId: string,
  turn: Turn,
): Promise<boolean> {
  if (state.buffer_turn_ids.includes(turn.id)) return true;
  if (state.inflight_turn_ids.includes(turn.id)) return true;
  return sessionLog.isAnswered(tx, userId, turn);
}

/** Only mid-thought, once per buffer, rate-limited, and never while she's busy and not reading. */
async function maybeEnqueueBackchannel(
  deps: Deps,
  userId: string,
  turn: Turn,
  verdict: TurnVerdict | null,
  appended: Appended,
  now: Date,
): Promise<void> {
  const { config } = deps;

  const deferred = !!appended.deferredUntil && appended.deferredUntil > now;
  if (!verdict || verdict.complete || !verdict.backchannel) return;
  if (appended.backchannelSent || deferred) return;

  const rateOk =
    !appended.lastBackchannelAt ||
    now.getTime() - appended.lastBackchannelAt.getTime() >= config.turn.backchannel_min_interval_ms;
  if (!rateOk) return;

  const text = verdict.backchannel;
  await enqueueSafely(
    deps,
    userId,
    () =>
      deps.queue.enqueue(
        TURN_BACKCHANNEL_QUEUE,
        { userId, version: appended.version, text, turnId: turn.id },
        { startAfter: new Date(now.getTime() + config.turn.backchannel_read_delay_ms) },
      ),
    "turn_backchannel",
  );
}

/** The short "busy, later?" note, when this message just started a deferral that wants one. */
async function maybeEnqueueBusyNote(
  deps: Deps,
  userId: string,
  turn: Turn,
  availability: Availability,
  appended: Appended,
  now: Date,
): Promise<void> {
  const { blockKind, blockStart } = availability;
  if (!appended.deferredNow || !availability.note || !blockKind || !blockStart) return;

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
          blockKind,
          blockStart: blockStart.toISOString(),
        },
        { startAfter: new Date(now.getTime() + deps.config.availability.note_read_delay_ms) },
      ),
    "availability note",
  );
}

/**
 * The crisis path: no waiting, pacing, backchannel or availability. It takes the in-flight and
 * buffered turns, bumps the epoch so any paced reply in progress is abandoned, replies inside
 * the request, and returns the resources card.
 */
async function sendCrisisReply(
  deps: Deps,
  userId: string,
  userTurn: Turn,
  flag: SafetyFlag,
): Promise<ReceiveResult> {
  const { db, clock, config, log } = deps;
  const now = clock.now();

  const snapshot = await mutateState(db, userId, now, (state) =>
    T.crisis(state, { turnId: userTurn.id, now }),
  );
  const turns = await sessionLog.getTurnsByIds(db, userId, snapshot.turnIds);
  const answering = turns.length ? turns : [userTurn];
  // The snapshot's last turn, which isn't necessarily the one just posted.
  const replyTo = answering.at(-1)!.id;

  const composed = await composeReply(deps, userId, { turns: answering, openQuestions: [], flag });

  let reply: Turn;
  try {
    reply = await sessionLog.insertTurn(db, userId, {
      id: randomUUID(),
      session_id: userTurn.session_id,
      role: "companion",
      text: composed.text,
      snapshot_version: composed.snapshotVersion,
      openness: composed.openness,
      depth: composed.depth,
      pointed: composed.pointed,
      created_at: clock.now(),
      reply_to: replyTo,
      safety_flag: flag,
    });
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // A concurrent retry already replied. Return its reply as is, with none of this candidate's
    // side effects (it was never sent): no emit, no cold path, no guard log.
    const winner = await sessionLog.getReplyTo(db, userId, replyTo);
    if (!winner) throw e;
    return {
      status: "replied",
      turnId: winner.id,
      text: winner.text,
      parts: splitParts(winner.text, config.chat.max_parts),
      crisisCard: crisisCardFor(winner.safety_flag, config),
    };
  }

  const parts = composed.parts;
  for (let part = 0; part < parts.length; part++) {
    await deliverPart(deps, userId, { turnId: reply.id, part, parts, generic: true });
  }
  // An abandoned paced reply may still show typing until its next epoch check; clear the dots now.
  await emit(deps, userId, { type: "typing", on: false });

  await enqueueSafely(
    deps,
    userId,
    () =>
      deps.queue.enqueue(COLD_PATH_QUEUE, {
        userId,
        turnIds: [...answering.map((t) => t.id), reply.id],
        replyTurnId: reply.id,
        recalled: composed.recalled,
      }),
    "cold_path",
  );
  await composed.writeGuardLog();

  log.info("crisis reply sent", { userId, turnId: reply.id });
  return {
    status: "replied",
    turnId: reply.id,
    text: reply.text,
    parts,
    crisisCard: crisisCardFor(reply.safety_flag, config),
  };
}
