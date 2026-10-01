/**
 * Reads everything outreach decides from: the candidate inputs (due threads, a pending make-up,
 * the user's recent events, her own day and preoccupation, check-in timing, topics already used)
 * and the send gate's inputs. Read-only.
 */
import type { Db } from "@/db/client";
import { getState, type ConvState } from "@/db/repos/user/conversation-state";
import {
  getFact,
  getPreoccupationFact,
  listOutreachHerDay,
  listOutreachUserEvents,
} from "@/db/repos/user/facts";
import { sentReachOutTimes, usedTopics } from "@/db/repos/user/reach-out";
import { getParams, getRelationshipRow, type Cadence } from "@/db/repos/user/relationship";
import { latestFlaggedTurnAt } from "@/db/repos/user/session-log";
import { dueThreads } from "@/db/repos/user/threads";
import type { Deps } from "@/mind/platform/deps";
import { HOUR } from "@/mind/platform/time";
import { faded } from "@/mind/state/user/relationship/params";
import { lifeDate } from "@/mind/world/her-clock";
import { blockAt, listLifeBlocks } from "@/mind/world/legacy-life-tick/blocks";
import type { CandidateInputs, GateInputs } from "./types";

const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

type InputDeps = Pick<Deps, "db" | "config">;

export async function loadCandidateInputs(
  deps: InputDeps,
  userId: string,
  now: Date,
  db: Db = deps.db,
): Promise<CandidateInputs> {
  const { config } = deps;
  const settings = config.outreach;

  const relationship = await getRelationshipRow(db, userId);
  const params = relationship ? await getParams(db, userId) : null;
  const hurt = params
    ? faded(
        params.hurt.value,
        params.hurt.updated_at,
        now,
        config.relationship.hurt_half_life_hours,
      )
    : 0;
  const cause = relationship?.hurt_cause_fact
    ? await getFact(db, userId, relationship.hurt_cause_fact)
    : null;

  const herDay = await loadHerDay(db, userId, now, settings.her_day_lookback_hours);
  const cadence = (relationship?.cadence ?? {}) as Partial<Cadence>;

  const due = await dueThreads(db, userId, now, settings.due_threads_limit);
  const userEvents = await listOutreachUserEvents(
    db,
    userId,
    new Date(now.getTime() - settings.user_event_lookback_hours * HOUR),
    now,
  );

  return {
    dueThreads: due.map((thread) => ({
      id: thread.id,
      title: thread.title,
      detail: thread.content,
      stakes: thread.stakes,
      next_checkpoint: thread.next_checkpoint,
      fact_id: thread.fact_id,
      sensitive: thread.sensitive,
    })),
    makeUp: {
      due: relationship?.status !== "ended_by_user" && relationship?.make_up_state === "due",
      hurt,
      causeFactId: relationship?.hurt_cause_fact ?? null,
      causeText: cause?.content ?? null,
      lastHurtAt: relationship?.last_hurt_at ?? null,
    },
    userEvents,
    herDay,
    checkIn: {
      lastContact: relationship?.last_contact ?? null,
      medianGapHours: cadence.median_gap_hours ?? config.relationship.default_median_gap_hours,
    },
    usedTopics: await usedTopics(db, userId),
  };
}

/** Her recent day, plus her preoccupation if it isn't already among them. */
async function loadHerDay(
  db: Db,
  userId: string,
  now: Date,
  lookbackHours: number,
): Promise<CandidateInputs["herDay"]> {
  const herDay = await listOutreachHerDay(
    db,
    userId,
    new Date(now.getTime() - lookbackHours * HOUR),
    now,
  );

  const preoccupation = await getPreoccupationFact(db, userId, now);
  if (preoccupation && !herDay.some((f) => f.id === preoccupation.id)) {
    herDay.push({
      id: preoccupation.id,
      content: preoccupation.content,
      salience: preoccupation.salience,
      sensitive: (preoccupation.payload as { sensitive?: boolean } | null)?.sensitive === true,
    });
  }
  return herDay;
}

/**
 * The crisis window is the later of the stored `crisis_quiet_until` (set by the crisis
 * exchange's cold path) and the latest flagged turn plus `crisis_quiet_hours`. That way it holds
 * before that cold path commits, or even if it never does.
 */
export async function effectiveCrisisQuietUntil(
  deps: InputDeps,
  userId: string,
  stored: Date | null,
  now: Date,
  db: Db = deps.db,
): Promise<Date | null> {
  const window = deps.config.relationship.crisis_quiet_hours * HOUR;
  const flaggedAt = await latestFlaggedTurnAt(db, userId, new Date(now.getTime() - window));
  if (!flaggedAt) return stored;

  const fromTurn = new Date(flaggedAt.getTime() + window);
  return !stored || fromTurn > stored ? fromTurn : stored;
}

/** Null when the user has no relationship row yet. */
export async function loadGateInputs(
  deps: InputDeps,
  userId: string,
  now: Date,
  db: Db = deps.db,
  conversation?: ConvState | null,
): Promise<GateInputs | null> {
  const relationship = await getRelationshipRow(db, userId);
  if (!relationship) return null;

  const state = conversation === undefined ? await getState(db, userId) : conversation;
  const block = blockAt(await listLifeBlocks(db, userId, lifeDate(deps.config.life, now)), now);
  const inProgress =
    !!state &&
    (state.buffer_turn_ids.length > 0 ||
      state.inflight_turn_ids.length > 0 ||
      state.sending_since !== null);

  return {
    status: relationship.status,
    sentAt: await sentReachOutTimes(db, userId, new Date(now.getTime() - WEEK)),
    herBlock: block ? { block: block.block, label: block.label } : null,
    unanswered: relationship.unanswered_reach_outs,
    inProgress,
    crisisQuietUntil: await effectiveCrisisQuietUntil(
      deps,
      userId,
      relationship.crisis_quiet_until,
      now,
      db,
    ),
  };
}
