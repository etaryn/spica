/**
 * Reads everything outreach decides from: the candidate inputs (due threads, a pending make-up,
 * the user's recent events, her own day and preoccupation, her recent thoughts, her live ideas
 * about them, check-in timing, topics already used)
 * and the send gate's inputs. Read-only.
 */
import type { Db } from "@/db/client";
import { getState, type ConvState } from "@/db/repos/user/conversation-state";
import { getFact, listOutreachUserEvents } from "@/db/repos/user/facts";
import { sentReachOutTimes, usedTopics } from "@/db/repos/user/reach-out";
import { getParams, getRelationshipRow, type Cadence } from "@/db/repos/user/relationship";
import { latestFlaggedTurnAt } from "@/db/repos/user/session-log";
import { getTimezone } from "@/db/repos/user/users";
import { liveIdeas } from "@/db/repos/user/user-mind";
import { dueThreads, threadUserFacts } from "@/db/repos/user/threads";
import { ideaCutoff } from "@/mind/process/user/ideate";
import { recallable } from "@/mind/memory/core/retrieve";
import type { CoreMemoryItem } from "@/mind/memory/core/types";
import type { Deps } from "@/mind/platform/deps";
import { HOUR } from "@/mind/platform/time";
import { isValidTimeZone, localHour } from "@/mind/platform/timezone";
import { loadDepth } from "@/mind/state/user/relationship/depth";
import { faded, rateEstimated } from "@/mind/state/user/relationship/params";
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

  // Writing first draws on no live chemistry: her usual limit, never a stretch.
  const depthLimit = (await loadDepth({ db, config }, userId, null, true, null)).open;
  const herDay = await loadHerDay(
    deps,
    now,
    settings.her_day_lookback_hours,
    settings.her_day_limit,
    depthLimit,
  );
  const cadence = (relationship?.cadence ?? {}) as Partial<Cadence>;

  const due = await dueThreads(db, userId, now, settings.due_threads_limit);
  const userEvents = await listOutreachUserEvents(
    db,
    userId,
    new Date(now.getTime() - settings.user_event_lookback_hours * HOUR),
    now,
  );

  const thoughtsFrom = new Date(now.getTime() - settings.core_thought_lookback_hours * HOUR);
  const coreThoughts = (
    await deps.core.memory.recentThoughts(thoughtsFrom, now, settings.core_thought_limit)
  )
    .filter(recallable)
    .map((m) => ({ id: m.id, content: m.content, salience: m.salience, depth: m.depth }));
  const userIdeas = (
    await liveIdeas(
      db,
      userId,
      ideaCutoff(now, config.user_mind.ideate.ttl_days),
      settings.user_idea_limit,
    )
  ).map((f) => ({ id: f.id, content: f.content, salience: f.salience }));

  return {
    dueThreads: await Promise.all(
      due.map(async (thread) => ({
        id: thread.id,
        title: thread.title,
        detail: thread.content,
        stakes: thread.stakes,
        next_checkpoint: thread.next_checkpoint,
        fact_id: thread.fact_id,
        sensitive: thread.sensitive,
        facts: (await threadUserFacts(db, userId, thread.id, settings.reason_facts)).map((f) => ({
          id: f.id,
          content: f.content,
          at: f.occurred_at ?? f.created_at,
          dated: f.occurred_at !== null,
        })),
      })),
    ),
    makeUp: {
      // While their "we're done" is pending she lets go: writing first to make up would be
      // pressure to stay.
      due:
        relationship?.status !== "ended_by_user" &&
        !relationship?.end_pending_since &&
        relationship?.make_up_state === "due",
      hurt,
      causeFactId: relationship?.hurt_cause_fact ?? null,
      causeText: cause?.content ?? null,
      lastHurtAt: relationship?.last_hurt_at ?? null,
    },
    userEvents,
    herDay,
    coreThoughts,
    userIdeas,
    checkIn: {
      lastContact: relationship?.last_contact ?? null,
      medianGapHours: cadence.median_gap_hours ?? config.relationship.default_median_gap_hours,
    },
    usedTopics: await usedTopics(db, userId),
    depthLimit,
    theirRate:
      params && rateEstimated(params.msgs_per_day, config.relationship)
        ? params.msgs_per_day.baseline
        : null,
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
  open: number,
): Promise<CandidateInputs["herDay"]> {
  const from = new Date(now.getTime() - lookbackHours * HOUR);
  const episodes = await deps.core.memory.recentEpisodes(from, now, limit);
  const intentions = await deps.core.memory.openIntentions(from, now, limit);
  const memories = [...episodes, ...intentions];
  const state = await deps.core.state.get();
  const pre = state?.preoccupation ? await deps.core.memory.get(state.preoccupation) : null;
  if (pre && recallable(pre) && !memories.some((m) => m.id === pre.id)) memories.push(pre);
  return Promise.all(memories.map((m) => shareable(deps, m, open, now)));
}

/**
 * What happened is surface news anyone can hear, like her day plan; how it felt keeps its depth.
 * A memory deeper than she'd share falls back to its world event's plain words.
 */
async function shareable(
  deps: Pick<Deps, "core">,
  m: CoreMemoryItem,
  open: number,
  now: Date,
): Promise<CandidateInputs["herDay"][number]> {
  const at = m.occurred_at ?? m.created_at;
  const plain = {
    id: m.id,
    content: m.content,
    salience: m.salience,
    depth: m.depth,
    sensitive: false,
    at,
  };
  if (m.depth <= open || !m.source_ref?.startsWith("world_event:")) return plain;
  const event = await deps.core.world.getEvent(m.source_ref.slice("world_event:".length));
  if (!event) return plain;
  const ahead = event.at.getTime() > now.getTime();
  return {
    ...plain,
    content: ahead ? `planned: ${event.content}` : event.content,
    depth: 1,
    at: event.at,
  };
}

/**
 * The crisis window is the later of the stored `crisis_quiet_until` (set by the crisis
 * exchange's cold path) and the latest flagged turn plus `crisis_quiet_hours`. That way it holds
 * before that cold path commits, or even if it never does.
 */
export async function effectiveCrisisQuietUntil(
  deps: Pick<Deps, "db" | "config">,
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
  const zone = await getTimezone(db, userId);

  return {
    status: relationship.status,
    sentAt: await sentReachOutTimes(db, userId, new Date(now.getTime() - WEEK)),
    herBlock: block ? { block: block.block, label: block.label } : null,
    theirHour: localHour(now, zone && isValidTimeZone(zone) ? zone : "UTC"),
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
