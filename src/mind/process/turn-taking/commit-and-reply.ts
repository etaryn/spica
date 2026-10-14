/**
 * Commit and reply: the `turn_timer` job commits the buffer and composes one reply to all of it,
 * then sends it at a human pace: a read delay, typing, then each bubble. The reply is generated
 * during the read delay, so model latency is hidden inside time she'd spend reading anyway. A
 * crisis meanwhile (an epoch bump) abandons the reply, both before it is inserted and between
 * bubbles. Also runs the `turn_backchannel` job.
 */
import { randomUUID } from "node:crypto";
import { getState } from "@/db/repos/user/conversation-state";
import * as sessionLog from "@/db/repos/user/session-log";
import type { Turn } from "@/db/repos/user/session-log";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { emit } from "@/mind/platform/events";
import {
  COLD_PATH_QUEUE,
  TURN_TIMER_QUEUE,
  type BackchannelJob,
  type TurnTimerJob,
} from "@/mind/platform/jobs";
import { seededUnit } from "@/mind/platform/seeded-random";
import { withTimeout } from "@/mind/platform/timeout";
import { runAvailabilityNote } from "@/mind/process/availability/busy-note";
import { deliverPart } from "@/mind/process/deliver";
import { guardOutgoing } from "@/mind/process/guard/outgoing";
import { composeReply, type Composed } from "@/mind/process/hot-path/compose";
import { readDelayMs, sleepUntil, typingMs } from "./pacing";
import { mutateState } from "./state";
import * as T from "./transitions";

type TimerOutcome = "stale" | "busy" | "sent" | "abandoned" | "retry" | "failed";
type Committed = Extract<T.CommitResult, { kind: "commit" }>;
type Settled<V> = { ok: true; value: V } | { ok: false; error: unknown };

function plus(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

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

export async function runTurnTimer(deps: Deps, job: TurnTimerJob): Promise<TimerOutcome> {
  const { db, clock, config } = deps;
  const { userId } = job;
  const commitAt = clock.now();

  const committed = await mutateState(db, userId, commitAt, (state) =>
    T.commit(state, { version: job.version, now: commitAt }),
  );
  if (committed.kind === "stale") return "stale";
  if (committed.kind === "busy") {
    await enqueueSafely(
      deps,
      userId,
      () =>
        deps.queue.enqueue(TURN_TIMER_QUEUE, job, {
          startAfter: plus(commitAt, config.turn.inflight_recheck_ms),
        }),
      "turn_timer",
    );
    return "busy";
  }

  // Test seam: lets a test fail the read of the committed turns.
  const getTurns =
    (deps as { getTurnsByIds?: typeof sessionLog.getTurnsByIds }).getTurnsByIds ??
    sessionLog.getTurnsByIds;

  let turns: Turn[];
  try {
    turns = await getTurns(db, userId, committed.turnIds);
  } catch (e) {
    return retryOrGiveUp(deps, job, committed, e);
  }

  const last = turns.at(-1);
  if (!last) {
    await mutateState(db, userId, clock.now(), (state) =>
      T.giveUp(state, { epoch: committed.epoch, now: clock.now() }),
    );
    return "abandoned";
  }

  const bufferChars = turns.reduce((total, t) => total + t.text.length, 0);
  const typingAt = plus(commitAt, readDelayMs(config.turn, bufferChars, seededUnit(last.id)));

  // Compose during the read delay. Settled, so a rejection is never unhandled while we sleep.
  const composing: Promise<Settled<Composed>> = composeReply(deps, userId, {
    turns,
    openQuestions: committed.openQuestions,
    flag: null,
    deferredBlock: committed.deferredBlock,
  }).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  await sleepUntil(clock, typingAt);
  await emit(deps, userId, { type: "typing", on: true });

  return sendWhileTyping(deps, job, committed, last, typingAt, composing);
}

/**
 * Everything after typing:on. Typing:off goes out on every exit, including an unexpected error
 * (which still rethrows for pg-boss to retry). Once the reply row exists and is marked sending,
 * the marker is released on every exit too.
 */
async function sendWhileTyping(
  deps: Deps,
  job: TurnTimerJob,
  committed: Committed,
  last: Turn,
  typingAt: Date,
  composing: Promise<Settled<Composed>>,
): Promise<TimerOutcome> {
  const { db, clock, config, log } = deps;
  const { userId } = job;

  let typingOn = true;
  let sending = false;
  const stopTyping = async () => {
    if (!typingOn) return;
    typingOn = false;
    await emit(deps, userId, { type: "typing", on: false });
  };

  try {
    const composed = await composing;
    if (!composed.ok) {
      log.error("turn reply failed", { userId, turnId: last.id, error: errorName(composed.error) });
      return await retryOrGiveUp(deps, job, committed, composed.error);
    }

    const reply = composed.value;
    const { parts } = reply;
    let sendAt = plus(typingAt, typingMs(config.turn, parts[0]?.length ?? 0));

    // `finish` and the insert share one transaction. The insert never throws on a duplicate
    // (ON CONFLICT DO NOTHING), so a concurrent duplicate can't abort the transaction from under
    // `finish`. `inserted` stays undefined unless the transaction commits, so an error before then
    // persisted nothing and is safe to retry.
    let inserted: Turn | null | undefined;
    try {
      await sleepUntil(clock, sendAt);
      const insertAt = clock.now();
      inserted = await mutateState<Turn | null>(db, userId, insertAt, async (state, tx) => {
        const step = T.finish(state, {
          epoch: committed.epoch,
          turnIds: committed.turnIds,
          now: insertAt,
        });
        if (!step.result) return { patch: null, result: null };

        const row = await sessionLog.insertReplyIfAbsent(tx, userId, {
          id: randomUUID(),
          session_id: last.session_id,
          role: "companion",
          text: reply.text,
          snapshot_version: reply.snapshotVersion,
          openness: reply.openness,
          depth: reply.depth,
          pointed: reply.pointed,
          created_at: insertAt,
          reply_to: last.id,
        });
        return { patch: step.patch, result: row };
      });
    } catch (e) {
      if (inserted === undefined) return await retryOrGiveUp(deps, job, committed, e);
      throw e;
    }

    sending = inserted !== null;
    if (!inserted) {
      // A crisis covered these turns first, or a duplicate job already replied. Nothing to send,
      // but the guard check still ran and is logged.
      await reply.writeGuardLog();
      return "abandoned";
    }

    await deliverPart(deps, userId, { turnId: inserted.id, part: 0, parts });

    for (let part = 1; part < parts.length; part++) {
      const from = new Date(Math.max(sendAt.getTime(), clock.now().getTime()));
      sendAt = plus(from, config.turn.part_gap_ms + typingMs(config.turn, parts[part]!.length));
      await sleepUntil(clock, sendAt);

      // Checked after the pacing sleep, right before the bubble: those seconds are when a crisis
      // is likeliest to land. Bubbles already sent stay; only the rest are abandoned.
      const current = await getState(db, userId);
      if (!current || current.reply_epoch !== committed.epoch) {
        await reply.writeGuardLog();
        return "abandoned";
      }
      await deliverPart(deps, userId, { turnId: inserted.id, part, parts });
    }

    // Right after the last bubble, before the cold path and the guard log.
    await stopTyping();

    const replyId = inserted.id;
    await enqueueSafely(
      deps,
      userId,
      () =>
        deps.queue.enqueue(COLD_PATH_QUEUE, {
          userId,
          turnIds: [...committed.turnIds, replyId],
          replyTurnId: replyId,
          recalled: reply.recalled,
          offeredIdeas: reply.offeredIdeas,
        }),
      "cold_path",
    );
    await reply.writeGuardLog();
    return "sent";
  } finally {
    try {
      await stopTyping();
    } finally {
      if (sending) await releaseSending(deps, userId, committed.epoch);
    }
  }
}

/** If this fails, turn_sweep clears the marker later; the reply row exists, so nothing is re-buffered. */
async function releaseSending(deps: Deps, userId: string, epoch: number): Promise<void> {
  try {
    const at = deps.clock.now();
    await mutateState(deps.db, userId, at, (state) => T.release(state, { epoch, now: at }));
  } catch (e) {
    deps.log.error("turn release failed", { userId, error: errorName(e) });
  }
}

/**
 * A failure after commit and before the reply row exists must not strand the committed turns.
 * They go back in the buffer with a retry queued. Past `retry_limit` it gives up instead, and
 * since no reply row exists yet, `reply_failed` is the right thing to tell the client.
 */
async function retryOrGiveUp(
  deps: Deps,
  job: TurnTimerJob,
  committed: Committed,
  error: unknown,
): Promise<"retry" | "abandoned" | "failed"> {
  const { db, clock, config, log } = deps;
  const { userId } = job;
  log.error("turn timer failed after commit", { userId, error: errorName(error) });

  const attempt = job.attempt ?? 0;
  const now = clock.now();

  if (attempt < config.turn.retry_limit) {
    const retryAt = plus(now, config.turn.retry_delay_ms);
    const restored = await mutateState(db, userId, now, (state) =>
      T.restore(state, { epoch: committed.epoch, turnIds: committed.turnIds, now, retryAt }),
    );
    if (restored.kind === "abandoned") return "abandoned";

    await enqueueSafely(
      deps,
      userId,
      () =>
        deps.queue.enqueue(
          TURN_TIMER_QUEUE,
          { userId, version: restored.version, attempt: attempt + 1 },
          { startAfter: retryAt },
        ),
      "turn_timer",
    );
    return "retry";
  }

  const cleared = await mutateState(db, userId, now, (state) =>
    T.giveUp(state, { epoch: committed.epoch, now }),
  );
  if (!cleared) return "abandoned";

  await emit(deps, userId, { type: "reply_failed", turnIds: committed.turnIds });
  return "failed";
}

/** `turn_backchannel`: once per buffer, rate-limited, keyword-guarded, and never a memory. */
export async function runBackchannel(
  deps: Deps,
  job: BackchannelJob,
): Promise<"sent" | "skipped" | "dropped"> {
  if (job.trigger === "availability") return runAvailabilityNote(deps, job);

  const { db, clock, config } = deps;
  const now = clock.now();

  const allowed = await mutateState(db, job.userId, now, (state) =>
    T.backchannel(state, {
      version: job.version,
      now,
      minIntervalMs: config.turn.backchannel_min_interval_ms,
    }),
  );
  if (!allowed) return "skipped";

  // Without the turn there's nothing to attach it to or read recent context from.
  const anchor = await sessionLog.getTurn(db, job.userId, job.turnId);
  if (!anchor) return "skipped";

  const recent = await sessionLog.turnsUpTo(db, job.userId, anchor, config.chat.recent_turns);
  const guarded = await guardOutgoing(deps, {
    userId: job.userId,
    turnId: anchor.id,
    first: job.text,
    input: {
      kind: "backchannel",
      recentTurns: recent.map((t) => ({ role: t.role, text: t.text, at: t.created_at })),
      recalledFacts: [],
      onboardingFacts: [],
    },
  });
  if (!guarded.text) {
    await guarded.writeLog();
    return "dropped";
  }

  // The guard ran unlocked, so a newer message may have started a fresh buffer meanwhile, making
  // this backchannel stale. Re-check the version under the lock at insert time.
  const insertAt = clock.now();
  const backchannel = await mutateState<Turn | null>(
    db,
    job.userId,
    insertAt,
    async (state, tx) => {
      if (state.buffer_version !== job.version) return { patch: null, result: null };

      const row = await sessionLog.insertTurn(tx, job.userId, {
        id: randomUUID(),
        session_id: anchor.session_id,
        role: "companion",
        text: guarded.text,
        created_at: insertAt,
        trigger: "backchannel",
        extracted: true,
      });
      return { patch: null, result: row };
    },
  );
  await guarded.writeLog();
  if (!backchannel) return "skipped";

  await deliverPart(deps, job.userId, {
    turnId: backchannel.id,
    part: 0,
    parts: [backchannel.text],
  });
  return "sent";
}
