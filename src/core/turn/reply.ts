import { randomUUID } from "node:crypto";
import { getState } from "@/db/repos/conversation-state";
import * as sessionLog from "@/db/repos/session-log";
import type { Turn } from "@/db/repos/session-log";
import { composeReply, type Composed } from "../chat/compose-reply";
import type { Deps } from "../deps";
import { errorName } from "../errors";
import { deliverPart } from "../delivery";
import { emit } from "../events";
import { guardOutgoing } from "../guard/outgoing";
import { COLD_PATH_QUEUE, TURN_TIMER_QUEUE, type BackchannelJob, type TurnTimerJob } from "../queue";
import { runAvailabilityNote } from "./availability-note";
import { withTimeout } from "../timeout";
import { readDelayMs, seededUnit, sleepUntil, typingMs } from "./pacing";
import { mutateState } from "./state";
import * as T from "./transitions";

const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

async function enqueueSafely(deps: Deps, userId: string, fn: () => Promise<void>, what: string) {
  try {
    await withTimeout(fn(), deps.config.queue.enqueue_timeout_ms);
  } catch (e) {
    deps.log.error(`${what} enqueue failed`, { userId, error: errorName(e) });
  }
}

/**
 * turn_timer (design §5.2–5.3, §5.5): commit the buffer, compose one reply to all of it, and send it on a
 * target timeline (read delay → typing → bubbles). Generation runs during the read delay, so model and guard
 * latency is absorbed as typing time. A crisis reply meanwhile (epoch bump) abandons this one: before the
 * insert via `finish`'s epoch/turn check, or between bubbles via an explicit re-read — the design's "the
 * epoch check stops any further ones" (§5.4), not just the first (rule 7: crisis suspends all friction).
 */
export async function runTurnTimer(deps: Deps, job: TurnTimerJob): Promise<"stale" | "busy" | "sent" | "abandoned" | "retry" | "failed"> {
  const { db, clock, config, log } = deps;
  const { userId } = job;
  const commitAt = clock.now();
  const c = await mutateState(db, userId, commitAt, (s) => T.commit(s, { version: job.version, now: commitAt }));
  if (c.kind === "stale") return "stale";
  if (c.kind === "busy") {
    await enqueueSafely(deps, userId, () => deps.queue.enqueue(TURN_TIMER_QUEUE, job, { startAfter: plus(commitAt, config.turn.inflight_recheck_ms) }), "turn_timer");
    return "busy";
  }

  const getTurns = (deps as { getTurnsByIds?: typeof sessionLog.getTurnsByIds }).getTurnsByIds ?? sessionLog.getTurnsByIds;

  /**
   * A post-commit infrastructure error (before the reply row exists) must not strand the committed turns in
   * limbo: put them back in the buffer and queue a retry, same as a generation failure (§15.4 #24). Past
   * `retry_limit`, give up instead — no reply row exists yet, so `reply_failed` is still correct there.
   */
  const fail = async (e: unknown): Promise<"retry" | "abandoned" | "failed"> => {
    log.error("turn timer failed after commit", { userId, error: errorName(e) });
    const attempt = job.attempt ?? 0;
    const now = clock.now();
    if (attempt < config.turn.retry_limit) {
      const r = await mutateState(db, userId, now, (s) => T.restore(s, { epoch: c.epoch, turnIds: c.turnIds, now, retryAt: plus(now, config.turn.retry_delay_ms) }));
      if (r.kind === "abandoned") return "abandoned";
      await enqueueSafely(deps, userId, () => deps.queue.enqueue(TURN_TIMER_QUEUE, { userId, version: r.version, attempt: attempt + 1 }, { startAfter: plus(now, config.turn.retry_delay_ms) }), "turn_timer");
      return "retry";
    }
    const cleared = await mutateState(db, userId, now, (s) => T.giveUp(s, { epoch: c.epoch, now }));
    if (!cleared) return "abandoned";
    await emit(deps, userId, { type: "reply_failed", turnIds: c.turnIds });
    return "failed";
  };

  let turns: Turn[];
  try {
    turns = await getTurns(db, userId, c.turnIds);
  } catch (e) {
    return fail(e);
  }
  const last = turns.at(-1);
  if (!last) {
    await mutateState(db, userId, clock.now(), (s) => T.giveUp(s, { epoch: c.epoch, now: clock.now() }));
    return "abandoned";
  }

  const bufferChars = turns.reduce((n, t) => n + t.text.length, 0);
  const typingAt = plus(commitAt, readDelayMs(config.turn, bufferChars, seededUnit(last.id)));

  // Generate during the read delay; settle so a rejection never goes unhandled while we sleep.
  const composing: Promise<{ ok: true; value: Composed } | { ok: false; error: unknown }> =
    composeReply(deps, userId, { turns, openQuestions: c.openQuestions, flag: null, deferredFact: c.deferredFact })
      .then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

  await sleepUntil(clock, typingAt);
  await emit(deps, userId, { type: "typing", on: true });

  // Everything past this point has emitted typing:on, so typing:off must be emitted on every exit — including
  // an unexpected infrastructure error, which still rethrows (for pg-boss to retry) after the finally runs.
  // stopTyping is idempotent so the normal "sent" path (which emits it right after the last bubble, to keep
  // it out of the outgoing-message ordering) doesn't also double-emit it from the finally below.
  let typingOn = true;
  let sending = false; // set once the reply row is in and finish marked it sending; cleared by release below
  const stopTyping = async () => {
    if (!typingOn) return;
    typingOn = false;
    await emit(deps, userId, { type: "typing", on: false });
  };
  try {
    const composed = await composing;

    if (!composed.ok) {
      log.error("turn reply failed", { userId, turnId: last.id, error: errorName(composed.error) });
      return await fail(composed.error);
    }

    const { parts } = composed.value;
    let sendAt = plus(typingAt, typingMs(config.turn, parts[0]?.length ?? 0));

    // finish + the insert share one transaction: `insertReplyIfAbsent` never throws on a `reply_to` collision
    // (ON CONFLICT DO NOTHING), so a concurrent duplicate can't abort this transaction out from under the
    // `finish` patch that clears inflight. `companion` stays `undefined` unless the transaction commits, so a
    // thrown error here (nothing persisted, transactional) is still safe to restore and retry (§15.4 #24); an
    // error after that point (companion assigned) rethrows as before.
    let companion: Turn | null | undefined;
    try {
      await sleepUntil(clock, sendAt);
      const insertAt = clock.now();
      companion = await mutateState<Turn | null>(db, userId, insertAt, async (s, tx) => {
        const step = T.finish(s, { epoch: c.epoch, turnIds: c.turnIds, now: insertAt });
        if (!step.result) return { patch: null, result: null };
        const row = await sessionLog.insertReplyIfAbsent(tx, userId, {
          id: randomUUID(), session_id: last.session_id, role: "companion", text: composed.value.text, created_at: insertAt, reply_to: last.id,
        });
        return { patch: step.patch, result: row };
      });
    } catch (e) {
      if (companion === undefined) return await fail(e);
      throw e;
    }
    sending = companion !== null;
    if (!companion) {
      // Either a crisis covered these turns first (finish's epoch/turn check) or a concurrent duplicate job
      // already inserted the reply — either way, nothing more to send, but the guard check still ran.
      await composed.value.writeGuardLog();
      return "abandoned";
    }

    await deliverPart(deps, userId, { turnId: companion.id, part: 0, parts });
    for (let i = 1; i < parts.length; i++) {
      sendAt = plus(new Date(Math.max(sendAt.getTime(), clock.now().getTime())), config.turn.part_gap_ms + typingMs(config.turn, parts[i]!.length));
      await sleepUntil(clock, sendAt);
      // Re-read right after the pacing sleep, immediately before this bubble's emit: the part-gap + typing
      // wait (seconds) is the likeliest window for a crisis to land, so checking before the sleep (as the
      // round 1 fix did) would still let this bubble out. The already-inserted reply and any earlier bubbles
      // stay — only what hasn't gone out yet is abandoned.
      const cur = await getState(db, userId);
      if (!cur || cur.reply_epoch !== c.epoch) {
        await composed.value.writeGuardLog();
        return "abandoned";
      }
      await deliverPart(deps, userId, { turnId: companion.id, part: i, parts });
    }

    await enqueueSafely(deps, userId, () => deps.queue.enqueue(COLD_PATH_QUEUE, {
      userId, turnIds: [...c.turnIds, companion.id], replyTurnId: companion.id, recalled: composed.value.recalled,
    }), "cold_path");
    await composed.value.writeGuardLog(); // judge_log after the send (§15.2 #1)
    await stopTyping(); // on the happy path, emit typing:off right after the last bubble rather than in finally
    return "sent";
  } finally {
    await stopTyping();
    if (sending) {
      // Release the sending marker on every exit, errors included; if this fails, turn_sweep clears it after
      // turn.job_expire_seconds (the reply row already exists, so nothing is re-buffered).
      try {
        const at = clock.now();
        await mutateState(db, userId, at, (s) => T.release(s, { epoch: c.epoch, now: at }));
      } catch (e) {
        log.error("turn release failed", { userId, error: errorName(e) });
      }
    }
  }
}

/** turn_backchannel (design §5.1 step 5, §7): once per buffer, rate-limited, keyword-guarded, never a memory. */
export async function runBackchannel(deps: Deps, job: BackchannelJob): Promise<"sent" | "skipped" | "dropped"> {
  if (job.trigger === "availability") return runAvailabilityNote(deps, job);
  const { db, clock, config } = deps;
  const now = clock.now();
  const ok = await mutateState(db, job.userId, now, (s) => T.backchannel(s, { version: job.version, now, minIntervalMs: config.turn.backchannel_min_interval_ms }));
  if (!ok) return "skipped";

  const anchor = await sessionLog.getTurn(db, job.userId, job.turnId);
  if (!anchor) return "skipped"; // no turn to attach it to or read recent context from

  const recent = await sessionLog.turnsUpTo(db, job.userId, anchor, config.chat.recent_turns);
  const guarded = await guardOutgoing(deps, {
    userId: job.userId, turnId: anchor.id, first: job.text,
    input: { kind: "backchannel", recentTurns: recent.map((t) => ({ role: t.role, text: t.text, at: t.created_at })), recalledFacts: [], onboardingFacts: [] },
  });
  if (!guarded.text) {
    await guarded.writeLog();
    return "dropped";
  }

  // Re-check the buffer version under the row lock at insert time: the guard check above ran unlocked, so a
  // newer message may have started a fresh buffer while it was in flight, making this backchannel stale.
  const insertAt = clock.now();
  const bc = await mutateState<Turn | null>(db, job.userId, insertAt, async (s, tx) => {
    if (s.buffer_version !== job.version) return { patch: null, result: null };
    const row = await sessionLog.insertTurn(tx, job.userId, {
      id: randomUUID(), session_id: anchor.session_id, role: "companion", text: guarded.text,
      created_at: insertAt, trigger: "backchannel", extracted: true,
    });
    return { patch: null, result: row };
  });
  await guarded.writeLog();
  if (!bc) return "skipped";
  await deliverPart(deps, job.userId, { turnId: bc.id, part: 0, parts: [bc.text] });
  return "sent";
}
