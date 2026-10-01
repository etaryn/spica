/**
 * The `reach_out_send` job: she writes first. The message is composed outside any lock, with
 * typing showing meanwhile. Then, under the conversation lock, the whole gate and the topic check
 * are re-run on fresh state, and the turn is inserted in the same transaction, so a user message
 * or a crisis that arrived during the jitter or typing always wins. An unlocked precheck runs
 * first, so a job that would fail anyway shows no typing and costs no generation; the locked
 * recheck stays the authority. Bubbles are paced like a reply.
 */
import { randomUUID } from "node:crypto";
import { getState } from "@/db/repos/user/conversation-state";
import {
  dropScheduled,
  getReachOutLog,
  updateReachOutLog,
  usedTopics,
} from "@/db/repos/user/reach-out";
import { incrementUnanswered } from "@/db/repos/user/relationship";
import * as sessionLog from "@/db/repos/user/session-log";
import type { Turn } from "@/db/repos/user/session-log";
import type { Db } from "@/db/client";
import type { ConvState } from "@/db/repos/user/conversation-state";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { emit } from "@/mind/platform/events";
import { COLD_PATH_QUEUE, type ReachOutSendJob } from "@/mind/platform/jobs";
import { withTimeout } from "@/mind/platform/timeout";
import { deliverPart } from "@/mind/process/deliver";
import { composeReachOut, type Composed } from "@/mind/process/hot-path/compose";
import { resolveSessionId } from "@/mind/process/receive/session";
import { sleepUntil, typingMs } from "@/mind/process/turn-taking/pacing";
import { mutateState } from "@/mind/process/turn-taking/state";
import * as T from "@/mind/process/turn-taking/transitions";
import { evaluateGate } from "./gate";
import { loadGateInputs } from "./inputs";
import type { Candidate, GateOutcome, GateResult } from "./types";

const MINUTE = 60_000;

type SendOutcome = "stale" | "dropped" | "sent" | "abandoned";
type Recheck = { gate: GateResult[]; topicUsed: boolean; epochChanged: boolean; newTurn: boolean };
type Inserted = { turn: Turn; epoch: number };

const CLOSED_GATE: GateOutcome = { pass: false, results: [] };

function plus(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

export async function runReachOutSend(deps: Deps, job: ReachOutSendJob): Promise<SendOutcome> {
  const { db, clock, config, log } = deps;
  const { userId, logId } = job;

  const row = await getReachOutLog(db, userId, logId);
  if (!row || row.status !== "scheduled") return "stale";
  const stored = row.winner as Candidate;
  // Winners logged before her_day moved to core memory carry no coreMemoryId.
  const winner: Candidate = { ...stored, coreMemoryId: stored.coreMemoryId ?? null };

  // A drop applies only while the row is still `scheduled`: a duplicate delivery of a sent job is stale.
  const drop = async (reason: string, recheck?: Recheck): Promise<"dropped" | "stale"> => {
    const dropped = await dropScheduled(db, userId, logId, {
      tick: row.gate_results,
      dropped: reason,
      ...(recheck ? { recheck } : {}),
    });
    return dropped ? "dropped" : "stale";
  };

  // A job that runs long after its slot (the worker was down) is dropped rather than sent out of context.
  const lateAfterMs = config.outreach.pending_max_age_minutes * MINUTE;
  if (row.send_at && clock.now().getTime() > row.send_at.getTime() + lateAfterMs) {
    return drop("late");
  }

  const recent = await sessionLog.recentTurns(db, userId, config.chat.recent_turns);
  if (recent.length === 0) return drop("no_history");

  // Unlocked, before anything is emitted.
  const precheck = await checkGateAndTopic(deps, db, userId, winner, clock.now());
  if (!precheck.gate.pass || precheck.topicUsed) {
    return drop("precheck", {
      gate: precheck.gate.results,
      topicUsed: precheck.topicUsed,
      epochChanged: false,
      newTurn: false,
    });
  }

  // A crisis (an epoch bump) or a new turn during compose or typing must win over this reach-out.
  const startEpoch = (await getState(db, userId))?.reply_epoch ?? 0;
  const lastTurn = recent.at(-1)!;

  await emit(deps, userId, { type: "typing", on: true });
  let typingOn = true;
  const stopTyping = async () => {
    if (!typingOn) return;
    typingOn = false;
    await emit(deps, userId, { type: "typing", on: false });
  };

  let sendingEpoch: number | null = null;
  try {
    let composed: Composed;
    try {
      composed = await composeReachOut(deps, userId, winner, recent);
    } catch (e) {
      log.error("reach-out compose failed", { userId, error: errorName(e) });
      return await drop("compose_failed");
    }

    const { parts } = composed;
    let sendAt = plus(clock.now(), typingMs(config.turn, parts[0]?.length ?? 0));
    await sleepUntil(clock, sendAt);

    const insertAt = clock.now();
    const outcome = await mutateState<Inserted | { recheck: Recheck }>(
      db,
      userId,
      insertAt,
      async (state, tx) => {
        const recheck = await recheckUnderLock(deps, tx, state, userId, winner, insertAt, {
          startEpoch,
          lastTurnId: lastTurn.id,
        });
        if (recheck) return { patch: null, result: { recheck } };

        const turn = await sessionLog.insertTurn(tx, userId, {
          id: randomUUID(),
          session_id: resolveSessionId(
            lastTurn,
            insertAt,
            config.session.idle_gap_minutes,
            randomUUID,
          ),
          role: "companion",
          text: composed.text,
          snapshot_version: composed.snapshotVersion,
          created_at: insertAt,
          trigger: "reach_out",
        });
        await updateReachOutLog(tx, userId, logId, {
          status: "sent",
          turn_id: turn.id,
          send_at: insertAt,
        });
        await incrementUnanswered(tx, userId);

        // `sending_since` makes a user message arriving mid-bubbles buffer behind them.
        return {
          patch: { sending_since: insertAt, updated_at: insertAt },
          result: { turn, epoch: state.reply_epoch },
        };
      },
    );

    if ("recheck" in outcome) {
      await composed.writeGuardLog();
      return await drop("recheck", outcome.recheck);
    }

    sendingEpoch = outcome.epoch;
    const turnId = outcome.turn.id;

    await deliverPart(deps, userId, { turnId, part: 0, parts });
    for (let part = 1; part < parts.length; part++) {
      const from = new Date(Math.max(sendAt.getTime(), clock.now().getTime()));
      sendAt = plus(from, config.turn.part_gap_ms + typingMs(config.turn, parts[part]!.length));
      await sleepUntil(clock, sendAt);

      // A crisis reply took over.
      const current = await getState(db, userId);
      if (!current || current.reply_epoch !== sendingEpoch) {
        await composed.writeGuardLog();
        return "abandoned";
      }
      await deliverPart(deps, userId, { turnId, part, parts });
    }
    await stopTyping();

    await withTimeout(
      deps.queue.enqueue(COLD_PATH_QUEUE, {
        userId,
        turnIds: [turnId],
        replyTurnId: turnId,
        recalled: composed.recalled,
      }),
      config.queue.enqueue_timeout_ms,
    ).catch((e) => log.error("cold_path enqueue failed", { userId, error: errorName(e) }));
    await composed.writeGuardLog();
    return "sent";
  } finally {
    try {
      await stopTyping();
    } finally {
      if (sendingEpoch !== null) await releaseSending(deps, userId, sendingEpoch);
    }
  }
}

async function checkGateAndTopic(
  deps: Deps,
  db: Db,
  userId: string,
  winner: Candidate,
  at: Date,
  conversation?: ConvState,
): Promise<{ gate: GateOutcome; topicUsed: boolean }> {
  const gateInputs = await loadGateInputs(deps, userId, at, db, conversation);
  const gate = gateInputs ? evaluateGate(gateInputs, deps.config.outreach, at) : CLOSED_GATE;
  const topicUsed = (await usedTopics(db, userId)).includes(winner.topic);
  return { gate, topicUsed };
}

/** Null when it's still fine to send; otherwise what changed. */
async function recheckUnderLock(
  deps: Deps,
  tx: Db,
  state: ConvState,
  userId: string,
  winner: Candidate,
  at: Date,
  before: { startEpoch: number; lastTurnId: string },
): Promise<Recheck | null> {
  const { gate, topicUsed } = await checkGateAndTopic(deps, tx, userId, winner, at, state);
  const epochChanged = state.reply_epoch !== before.startEpoch;
  const newTurn = (await sessionLog.recentTurns(tx, userId, 1)).at(-1)?.id !== before.lastTurnId;

  if (gate.pass && !topicUsed && !epochChanged && !newTurn) return null;
  return { gate: gate.results, topicUsed, epochChanged, newTurn };
}

async function releaseSending(deps: Deps, userId: string, epoch: number): Promise<void> {
  try {
    const at = deps.clock.now();
    await mutateState(deps.db, userId, at, (state) => T.release(state, { epoch, now: at }));
  } catch (e) {
    deps.log.error("reach-out release failed", { userId, error: errorName(e) });
  }
}
