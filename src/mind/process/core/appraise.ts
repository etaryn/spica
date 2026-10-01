/**
 * Appraisal: how an event in her world lands with her. For now the event's own valence is the
 * appraisal; the episode it leaves in her memory carries that feeling, her mood moves with it,
 * and a strong one takes over her mind for a while. The core loops will replace this with a
 * model that weighs the event against her goals and state.
 */
import type { CoreScope } from "@/mind/platform/core";
import type { CoreDeps } from "@/mind/platform/deps";
import { applyEvent, moodOf } from "@/mind/state/core/core-state";

export type AppraisableEvent = {
  worldEventId: string;
  content: string;
  valence: number;
  stakes: "low" | "high";
  at: Date;
  embedding: number[];
  agents: string[];
};

/** Inside the caller's transaction. Returns the new episode's id. */
export async function appraiseEvent(
  core: CoreScope,
  deps: Pick<CoreDeps, "config">,
  event: AppraisableEvent,
  now: Date,
): Promise<string> {
  const { world, state } = deps.config.core;
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
    source_ref: `world_event:${event.worldEventId}`,
  });

  const row = await core.state.lock();
  const mood = applyEvent(moodOf(row), event.valence, state);
  const strong = Math.abs(event.valence) >= state.preoccupation_min_valence;
  await core.state.update({
    ...mood,
    ...(strong ? { preoccupation: episodeId, preoccupation_since: now } : {}),
  });
  return episodeId;
}
