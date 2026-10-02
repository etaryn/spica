/**
 * Reads everything outreach decides from: the candidate inputs (due threads, a pending make-up,
 * the user's recent events, her own day and preoccupation, check-in timing, topics already used)
 * and the send gate's inputs. Read-only.
 */
import type { Db } from "@/db/client";
import { getState, type ConvState } from "@/db/repos/user/conversation-state";
import { getFact, listOutreachUserEvents } from "@/db/repos/user/facts";
import { sentReachOutTimes, usedTopics } from "@/db/repos/user/reach-out";
import { getParams, getRelationshipRow, type Cadence } from "@/db/repos/user/relationship";
import { latestFlaggedTurnAt } from "@/db/repos/user/session-log";
import { dueThreads } from "@/db/repos/user/threads";
import { recallable } from "@/mind/memory/core/retrieve";
import type { Deps } from "@/mind/platform/deps";
import { HOUR } from "@/mind/platform/time";
import { faded } from "@/mind/state/user/relationship/params";
import { blockAt, todaysBlocks } from "@/mind/world/blocks";
import type { CandidateInputs, GateInputs } from "./types";

const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

type InputDeps = Pick<Deps, "db" | "core" | "config">;

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

  const herDay = await loadHerDay(
    deps,
    now,
    settings.her_day_lookback_hours,
    settings.her_day_limit,
  );
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

/**
 * Her recent episodes and the plans on her mind (open intentions from the same window), plus her
 * preoccupation if it isn't already among them. Core memory: never sensitive.
 */
async function loadHerDay(
  deps: Pick<Deps, "core">,
  now: Date,
  lookbackHours: number,
  limit: number,
): Promise<CandidateInputs["herDay"]> {
  const from = new Date(now.getTime() - lookbackHours * HOUR);
  const episodes = await deps.core.memory.recentEpisodes(from, now, limit);
  const intentions = await deps.core.memory.openIntentions(from, now, limit);
  const herDay = [...episodes, ...intentions].map((e) => ({
    id: e.id,
    content: e.content,
    salience: e.salience,
    sensitive: false,
  }));
  const state = await deps.core.state.get();
  const pre = state?.preoccupation ? await deps.core.memory.get(state.preoccupation) : null;
  if (pre && recallable(pre) && !herDay.some((m) => m.id === pre.id))
    herDay.push({ id: pre.id, content: pre.content, salience: pre.salience, sensitive: false });
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
  const block = blockAt(await todaysBlocks(deps, now), now);
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
