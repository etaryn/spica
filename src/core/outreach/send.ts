import { randomUUID } from "node:crypto";
import { getState } from "@/db/repos/conversation-state";
import { dropScheduled, getReachOutLog, updateReachOutLog, usedTopics } from "@/db/repos/reach-out";
import { incrementUnanswered } from "@/db/repos/relationship";
import * as sessionLog from "@/db/repos/session-log";
import type { Turn } from "@/db/repos/session-log";
import { composeReachOut, type Composed } from "../chat/compose-reply";
import { resolveSessionId } from "../chat/session";
import { deliverPart } from "../delivery";
import type { Deps } from "../deps";
import { errorName } from "../errors";
import { emit } from "../events";
import { COLD_PATH_QUEUE, type ReachOutSendJob } from "../queue";
import { withTimeout } from "../timeout";
import { sleepUntil, typingMs } from "../turn/pacing";
import { mutateState } from "../turn/state";
import * as T from "../turn/transitions";
import { evaluateGate } from "./gate";
import { loadGateInputs } from "./inputs";
import type { Candidate, GateResult } from "./types";

const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);
type Recheck = { gate: GateResult[]; topicUsed: boolean; epochChanged: boolean; newTurn: boolean };

/**
 * `reach_out_send` (spec §6.2). Compose outside any lock (typing shows meanwhile), then under the conversation-
 * state lock re-run the whole gate and the topic check on fresh state and insert the turn in the same transaction,
 * so a user message or crisis that arrived during the jitter or typing wins. Paced like a reply; `sending_since`
 * makes a user message arriving mid-bubbles buffer behind them; released in a finally. An unlocked precheck of the same
 * gate and topic runs first, so a job that would fail anyway shows no typing and spends no generation; the locked
 * recheck stays the authority. A drop applies only while the row is still `scheduled` (a duplicate delivery of a
 * sent job is `stale`).
 */
export async function runReachOutSend(deps: Deps, job: ReachOutSendJob): Promise<"stale" | "dropped" | "sent" | "abandoned"> {
  const { db, clock, config, log } = deps;
  const { userId, logId } = job;
  const row = await getReachOutLog(db, userId, logId);
  if (!row || row.status !== "scheduled") return "stale";
  const winner = row.winner as Candidate;
  const drop = async (reason: string, recheck?: Recheck): Promise<"dropped" | "stale"> =>
    (await dropScheduled(db, userId, logId, { tick: row.gate_results, dropped: reason, ...(recheck ? { recheck } : {}) })) ? "dropped" : "stale";

  // A job that runs long after its slot (worker down) is dropped rather than sent out of context (ruling R6).
  if (row.send_at && clock.now().getTime() > row.send_at.getTime() + config.outreach.pending_max_age_minutes * 60_000) return drop("late");

  const recent = await sessionLog.recentTurns(db, userId, config.chat.recent_turns);
  if (recent.length === 0) return drop("no_history");

  // Precheck (unlocked, nothing emitted yet): mid-conversation, capped, in her block, crisis or topic used → drop now.
  const preAt = clock.now();
  const preIn = await loadGateInputs(deps, userId, preAt);
  const pre = preIn ? evaluateGate(preIn, config.outreach, preAt) : { pass: false, results: [] as GateResult[] };
  const preTopicUsed = (await usedTopics(db, userId)).includes(winner.topic);
  if (!pre.pass || preTopicUsed) return drop("precheck", { gate: pre.results, topicUsed: preTopicUsed, epochChanged: false, newTurn: false });

  // R7: a crisis (epoch bump) or a new turn landing during compose/typing must win over this reach-out.
  const startEpoch = (await getState(db, userId))?.reply_epoch ?? 0;
  const lastTurnId = recent.at(-1)!.id;

  await emit(deps, userId, { type: "typing", on: true });
  let typingOn = true;
  const stopTyping = async () => {
    if (!typingOn) return;
    typingOn = false;
    await emit(deps, userId, { type: "typing", on: false });
  };
  let epoch: number | null = null;
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
    const outcome = await mutateState<{ turn: Turn; epoch: number } | { recheck: Recheck }>(db, userId, insertAt, async (s, tx) => {
      const gateIn = await loadGateInputs(deps, userId, insertAt, tx, s);
      const gate = gateIn ? evaluateGate(gateIn, config.outreach, insertAt) : { pass: false, results: [] as GateResult[] };
      const topicUsed = (await usedTopics(tx, userId)).includes(winner.topic);
      const epochChanged = s.reply_epoch !== startEpoch;
      const newTurn = (await sessionLog.recentTurns(tx, userId, 1)).at(-1)?.id !== lastTurnId;
      if (!gate.pass || topicUsed || epochChanged || newTurn) return { patch: null, result: { recheck: { gate: gate.results, topicUsed, epochChanged, newTurn } } };
      const turn = await sessionLog.insertTurn(tx, userId, {
        id: randomUUID(), session_id: resolveSessionId(recent.at(-1)!, insertAt, config.session.idle_gap_minutes, randomUUID),
        role: "companion", text: composed.text, created_at: insertAt, trigger: "reach_out",
      });
      await updateReachOutLog(tx, userId, logId, { status: "sent", turn_id: turn.id, send_at: insertAt });
      await incrementUnanswered(tx, userId);
      return { patch: { sending_since: insertAt, updated_at: insertAt }, result: { turn, epoch: s.reply_epoch } };
    });
    if ("recheck" in outcome) {
      await composed.writeGuardLog();
      return await drop("recheck", outcome.recheck);
    }
    epoch = outcome.epoch;
    const turnId = outcome.turn.id;

    await deliverPart(deps, userId, { turnId, part: 0, parts });
    for (let i = 1; i < parts.length; i++) {
      sendAt = plus(new Date(Math.max(sendAt.getTime(), clock.now().getTime())), config.turn.part_gap_ms + typingMs(config.turn, parts[i]!.length));
      await sleepUntil(clock, sendAt);
      const cur = await getState(db, userId);
      if (!cur || cur.reply_epoch !== epoch) { // a crisis reply took over (rule 7)
        await composed.writeGuardLog();
        return "abandoned";
      }
      await deliverPart(deps, userId, { turnId, part: i, parts });
    }
    await stopTyping();
    await withTimeout(deps.queue.enqueue(COLD_PATH_QUEUE, { userId, turnIds: [turnId], replyTurnId: turnId, recalled: composed.recalled }), config.queue.enqueue_timeout_ms)
      .catch((e) => log.error("cold_path enqueue failed", { userId, error: errorName(e) }));
    await composed.writeGuardLog();
    return "sent";
  } finally {
    await stopTyping();
    if (epoch !== null) {
      const e = epoch;
      try {
        const at = clock.now();
        await mutateState(db, userId, at, (s) => T.release(s, { epoch: e, now: at }));
      } catch (err) {
        log.error("reach-out release failed", { userId, error: errorName(err) });
      }
    }
  }
}
