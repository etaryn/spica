import type { Db } from "@/db/client";
import { getState, type ConvState } from "@/db/repos/conversation-state";
import { getFact, getPreoccupationFact, listOutreachHerDay, listOutreachUserEvents } from "@/db/repos/facts";
import { getParams, getRelationshipRow, type Cadence } from "@/db/repos/relationship";
import { sentReachOutTimes, usedTopics } from "@/db/repos/reach-out";
import { latestFlaggedTurnAt } from "@/db/repos/session-log";
import { dueThreads } from "@/db/repos/threads";
import type { Deps } from "../deps";
import { blockAt, listLifeBlocks } from "../life/blocks";
import { lifeDate } from "../life/clock";
import { faded } from "../relationship/homeostasis";
import { HOUR } from "../time";
import type { CandidateInputs, GateInputs } from "./types";

const DAY = 24 * HOUR;

/** everything the pure candidate builder needs. Read-only. */
export async function loadCandidateInputs(deps: Pick<Deps, "db" | "config">, userId: string, now: Date, db: Db = deps.db): Promise<CandidateInputs> {
  const { config } = deps;
  const cfg = config.outreach;
  const row = await getRelationshipRow(db, userId);
  const params = row ? await getParams(db, userId) : null;
  const hurt = params ? faded(params.hurt.value, params.hurt.updated_at, now, config.relationship.hurt_half_life_hours) : 0;
  const cause = row?.hurt_cause_fact ? await getFact(db, userId, row.hurt_cause_fact) : null;

  const herDay = await listOutreachHerDay(db, userId, new Date(now.getTime() - cfg.her_day_lookback_hours * HOUR), now);
  const pre = await getPreoccupationFact(db, userId, now);
  if (pre && !herDay.some((f) => f.id === pre.id)) {
    herDay.push({ id: pre.id, content: pre.content, salience: pre.salience, sensitive: (pre.payload as { sensitive?: boolean } | null)?.sensitive === true });
  }
  const cadence = (row?.cadence ?? {}) as Partial<Cadence>;
  return {
    dueThreads: (await dueThreads(db, userId, now, cfg.due_threads_limit)).map((t) => ({
      id: t.id, title: t.title, detail: t.content, stakes: t.stakes, next_checkpoint: t.next_checkpoint, fact_id: t.fact_id, sensitive: t.sensitive,
    })),
    makeUp: {
      due: row?.status !== "ended_by_user" && row?.make_up_state === "due", hurt,
      causeFactId: row?.hurt_cause_fact ?? null, causeText: cause?.content ?? null, lastHurtAt: row?.last_hurt_at ?? null,
    },
    userEvents: await listOutreachUserEvents(db, userId, new Date(now.getTime() - cfg.user_event_lookback_hours * HOUR), now),
    herDay,
    checkIn: { lastContact: row?.last_contact ?? null, medianGapHours: cadence.median_gap_hours ?? config.relationship.default_median_gap_hours },
    usedTopics: await usedTopics(db, userId),
  };
}

/**
 * Rule 7 (G6): the crisis window is the later of the stored `crisis_quiet_until` (set by the crisis exchange's cold
 * path) and the latest safety-flagged turn + `crisis_quiet_hours`, so it holds before that cold path commits, or if it
 * never does.
 */
export async function effectiveCrisisQuietUntil(
  deps: Pick<Deps, "db" | "config">, userId: string, stored: Date | null, now: Date, db: Db = deps.db,
): Promise<Date | null> {
  const window = deps.config.relationship.crisis_quiet_hours * HOUR;
  const flagged = await latestFlaggedTurnAt(db, userId, new Date(now.getTime() - window));
  const fromTurn = flagged ? new Date(flagged.getTime() + window) : null;
  if (!fromTurn) return stored;
  return !stored || fromTurn > stored ? fromTurn : stored;
}

/** gate inputs, or null when the user has no relationship row yet. */
export async function loadGateInputs(
  deps: Pick<Deps, "db" | "config">, userId: string, now: Date, db: Db = deps.db, conv?: ConvState | null,
): Promise<GateInputs | null> {
  const row = await getRelationshipRow(db, userId);
  if (!row) return null;
  const s = conv === undefined ? await getState(db, userId) : conv;
  const block = blockAt(await listLifeBlocks(db, userId, lifeDate(deps.config.life, now)), now);
  return {
    status: row.status,
    sentAt: await sentReachOutTimes(db, userId, new Date(now.getTime() - 7 * DAY)),
    herBlock: block ? { block: block.block, label: block.label } : null,
    unanswered: row.unanswered_reach_outs,
    inProgress: !!s && (s.buffer_turn_ids.length > 0 || s.inflight_turn_ids.length > 0 || s.sending_since !== null),
    crisisQuietUntil: await effectiveCrisisQuietUntil(deps, userId, row.crisis_quiet_until, now, db),
  };
}
