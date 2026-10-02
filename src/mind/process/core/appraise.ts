/**
 * Appraisal: how an event in her world lands with her, at the moment it happens. For now the
 * event's own valence is the appraisal; the episode it leaves in her memory carries that feeling,
 * her mood moves with it, and a strong one takes over her mind for a while. If she'd been planning
 * it, the plan is now done. The core loops will replace this with a model that weighs the event
 * against her goals and state.
 */
import type { CoreScope } from "@/mind/platform/core";
import type { CoreDeps } from "@/mind/platform/deps";
import { applyEvent, moodOf } from "@/mind/state/core/core-state";
import type { CoreStatePatch } from "@/mind/state/core/types";

export type AppraisableEvent = {
  worldEventId: string;
  content: string;
  valence: number;
  stakes: "low" | "high";
  at: Date;
  embedding: number[];
  agents: string[];
};

export type Appraisal = { episodeId: string; intentionId: string | null };

export const eventRef = (worldEventId: string) => `world_event:${worldEventId}`;

/** Inside the caller's transaction, which holds the world tick's lock. */
export async function appraiseEvent(
  core: CoreScope,
  deps: Pick<CoreDeps, "config">,
  event: AppraisableEvent,
  now: Date,
): Promise<Appraisal> {
  const { world, state } = deps.config.core;
  const ref = eventRef(event.worldEventId);
  const episodeId = await core.memory.insert({
    kind: "episode",
    content: event.content,
    embedding: event.embedding,
    entity_refs: event.agents,
    occurred_at: event.at,
    created_at: now,
    // A big event stays open until its story resolves; a small one is over when it happens.
    status: event.stakes === "high" ? "open" : "resolved",
    salience: world.event_salience,
    valence: event.valence,
    confidence: world.event_confidence,
    source: "world",
    source_ref: ref,
  });

  // Once it has happened the episode speaks for it; the plan stays only as history.
  const intention = await core.memory.bySourceRef("intention", ref);
  if (intention) await core.memory.setStatus(intention.id, "resolved");

  const row = await core.state.lock();
  const mood = applyEvent(moodOf(row), event.valence, state);
  const strong = Math.abs(event.valence) >= state.preoccupation_min_valence;
  let preoccupation: CoreStatePatch = {};
  if (strong) preoccupation = { preoccupation: episodeId, preoccupation_since: now };
  else if (intention && row.preoccupation === intention.id)
    preoccupation = { preoccupation: null, preoccupation_since: null };
  await core.state.update({ ...mood, ...preoccupation });

  await core.world.markAppraised(event.worldEventId, now);
  return { episodeId, intentionId: intention?.id ?? null };
}
