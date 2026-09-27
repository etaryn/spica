import { randomUUID } from "node:crypto";
import * as sessionLog from "@/db/repos/session-log";
import type { Turn } from "@/db/repos/session-log";
import { composeReply, type Composed } from "../chat/compose-reply";
import type { Deps } from "../deps";
import { isUniqueViolation } from "../errors";
import { emit } from "../events";
import { guardOutgoing } from "../guard/outgoing";
import { COLD_PATH_QUEUE, TURN_TIMER_QUEUE, type BackchannelJob, type TurnTimerJob } from "../queue";
import { withTimeout } from "../timeout";
import { availabilityStretch } from "./availability";
import { readDelayMs, seededUnit, sleepUntil, typingMs } from "./pacing";
import { mutateState } from "./state";
import * as T from "./transitions";

const errName = (e: unknown) => (e instanceof Error ? e.constructor.name : "UnknownError");
const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

async function enqueueSafely(deps: Deps, userId: string, fn: () => Promise<void>, what: string) {
  try {
    await withTimeout(fn(), deps.config.queue.enqueue_timeout_ms);
  } catch (e) {
    deps.log.error(`${what} enqueue failed`, { userId, error: errName(e) });
  }
}

/**
 * turn_timer (design §5.2–5.3, §5.5): commit the buffer, compose one reply to all of it, and send it on a
 * target timeline (read delay → typing → bubbles). Generation runs during the read delay, so model and guard
 * latency is absorbed as typing time. A crisis reply meanwhile (epoch bump) abandons this one before insert.
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

  const turns = await sessionLog.getTurnsByIds(db, userId, c.turnIds);
  const last = turns.at(-1);
  if (!last) {
    await mutateState(db, userId, clock.now(), (s) => T.giveUp(s, { epoch: c.epoch, now: clock.now() }));
    return "abandoned";
  }

  const stretch = await availabilityStretch(deps, userId);
  const bufferChars = turns.reduce((n, t) => n + t.text.length, 0);
  const typingAt = plus(commitAt, Math.round(readDelayMs(config.turn, bufferChars, seededUnit(last.id)) * stretch));

  // Generate during the read delay; settle so a rejection never goes unhandled while we sleep.
  const composing: Promise<{ ok: true; value: Composed } | { ok: false; error: unknown }> =
    composeReply(deps, userId, { turns, openQuestions: c.openQuestions, flag: null })
      .then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));

  await sleepUntil(clock, typingAt);
  await emit(deps, userId, { type: "typing", on: true });
  const composed = await composing;

  if (!composed.ok) {
    await emit(deps, userId, { type: "typing", on: false });
    log.error("turn reply failed", { userId, turnId: last.id, error: errName(composed.error) });
    const attempt = job.attempt ?? 0;
    const now = clock.now();
    if (attempt < config.turn.retry_limit) {
      const r = await mutateState(db, userId, now, (s) => T.restore(s, { epoch: c.epoch, turnIds: c.turnIds, now, retryAt: plus(now, config.turn.retry_delay_ms) }));
      if (r.kind === "abandoned") return "abandoned";
      await enqueueSafely(deps, userId, () => deps.queue.enqueue(TURN_TIMER_QUEUE, { userId, version: r.version, attempt: attempt + 1 }, { startAfter: plus(now, config.turn.retry_delay_ms) }), "turn_timer");
      return "retry";
    }
    await mutateState(db, userId, now, (s) => T.giveUp(s, { epoch: c.epoch, now }));
    await emit(deps, userId, { type: "reply_failed", turnIds: c.turnIds });
    return "failed";
  }

  const { parts } = composed.value;
  let sendAt = plus(typingAt, typingMs(config.turn, parts[0]?.length ?? 0));
  await sleepUntil(clock, sendAt);

  const insertAt = clock.now();
  const companion = await mutateState<Turn | null>(db, userId, insertAt, async (s, tx) => {
    const step = T.finish(s, { epoch: c.epoch, now: insertAt });
    if (!step.result) return { patch: null, result: null };
    try {
      const row = await sessionLog.insertTurn(tx, userId, {
        id: randomUUID(), session_id: last.session_id, role: "companion", text: composed.value.text, created_at: insertAt, reply_to: last.id,
      });
      return { patch: step.patch, result: row };
    } catch (e) {
      if (isUniqueViolation(e)) return { patch: step.patch, result: null }; // already answered (duplicate job)
      throw e;
    }
  });
  if (!companion) {
    await emit(deps, userId, { type: "typing", on: false });
    return "abandoned";
  }

  await emit(deps, userId, { type: "message", turnId: companion.id, part: 0 });
  for (let i = 1; i < parts.length; i++) {
    sendAt = plus(new Date(Math.max(sendAt.getTime(), clock.now().getTime())), config.turn.part_gap_ms + typingMs(config.turn, parts[i]!.length));
    await sleepUntil(clock, sendAt);
    await emit(deps, userId, { type: "message", turnId: companion.id, part: i });
  }
  await emit(deps, userId, { type: "typing", on: false });

  await enqueueSafely(deps, userId, () => deps.queue.enqueue(COLD_PATH_QUEUE, {
    userId, turnIds: [...c.turnIds, companion.id], replyTurnId: companion.id, recalled: composed.value.recalled,
  }), "cold_path");
  await composed.value.writeGuardLog(); // judge_log after the send (§15.2 #1)
  return "sent";
}

/** turn_backchannel (design §5.1 step 5, §7): once per buffer, rate-limited, keyword-guarded, never a memory. */
export async function runBackchannel(deps: Deps, job: BackchannelJob): Promise<"sent" | "skipped" | "dropped"> {
  const { db, clock, config } = deps;
  const now = clock.now();
  const ok = await mutateState(db, job.userId, now, (s) => T.backchannel(s, { version: job.version, now, minIntervalMs: config.turn.backchannel_min_interval_ms }));
  if (!ok) return "skipped";

  const anchor = await sessionLog.getTurn(db, job.userId, job.turnId);
  const recent = anchor ? await sessionLog.turnsUpTo(db, job.userId, anchor, config.chat.recent_turns) : [];
  const guarded = await guardOutgoing(deps, {
    userId: job.userId, turnId: anchor?.id ?? null, first: job.text,
    input: { kind: "backchannel", recentTurns: recent.map((t) => ({ role: t.role, text: t.text, at: t.created_at })), recalledFacts: [], onboardingFacts: [] },
  });
  if (!guarded.text) {
    await guarded.writeLog();
    return "dropped";
  }
  const bc = await sessionLog.insertTurn(db, job.userId, {
    id: randomUUID(), session_id: anchor?.session_id ?? randomUUID(), role: "companion", text: guarded.text,
    created_at: clock.now(), trigger: "backchannel", extracted: true,
  });
  await emit(deps, job.userId, { type: "message", turnId: bc.id, part: 0 });
  await guarded.writeLog();
  return "sent";
}
