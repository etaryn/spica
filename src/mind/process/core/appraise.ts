/**
 * Appraisal: how an event in her world lands with her, at the moment it happens. A model reads the
 * event against what she expected, how she is and what she's working towards, and says how it felt,
 * how much it matters, and which goals and needs it touched. Code bounds every number before
 * anything moves; a failed or unusable answer, or no budget left, falls back to the event's own
 * valence, so an event always lands. The same event can be remembered differently on a different
 * day: the episode is written in her appraisal's words.
 */
import { z } from "zod";
import { DepthLabel, depthOf } from "@/mind/memory/core/depth";
import type { Config } from "@/mind/platform/config";
import type { CoreScope } from "@/mind/platform/core";
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { fitChars } from "@/mind/platform/llm/fit";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { tokenDates } from "@/mind/platform/time-anchors";
import { applyEvent, moodOf } from "@/mind/state/core/core-state";
import type { CoreNeeds, CoreStatePatch } from "@/mind/state/core/types";
import type { LoopContext } from "./runner";
import { clamp } from "@/mind/platform/math";
import { isCraftGoal } from "./post-library";
import { latestSelf } from "@/mind/memory/core/self";
import { lifeTimezone } from "@/mind/world/her-clock";

/** Sent to the model. No numeric bounds (unsupported); `boundAppraisal` clamps. */
export const AppraisalSchema = z.object({
  episode: z.string(),
  emotion: z.object({
    label: z.string(),
    valence: z.number(),
    arousal: z.number(),
    about: z.string(),
  }),
  salience: z.enum(["low", "medium", "high"]),
  goal_effects: z.array(
    z.object({
      goal_id: z.string(),
      effect: z.enum(["advance", "block"]),
      size: z.enum(["small", "medium", "large"]),
    }),
  ),
  need_effects: z.object({ autonomy: z.number(), competence: z.number() }),
  // Required for the model; fixtures without it read as null and take the kind default.
  depth: DepthLabel.nullable().default(null),
});
export type RawAppraisal = z.infer<typeof AppraisalSchema>;
export type Appraisal = {
  source: "model" | "fallback";
  episode: string;
  emotion: { label: string; valence: number; arousal: number; phrase: string | null };
  salience: number;
  goalEffects: { goalId: string; delta: number }[];
  needEffects: CoreNeeds;
  depth: number;
  /** Dates in the input it was written from. */
  shown?: Date[];
};
export type LandingEvent = {
  worldEventId: string;
  kind: "planned" | "surprise" | "resolution" | "action";
  content: string;
  valence: number;
  stakes: "low" | "high";
  at: Date;
  agents: string[];
  goalRef: string | null;
  intentionEventId?: string;
  resolvesMemoryId?: string | null;
};
export const eventRef = (worldEventId: string) => `world_event:${worldEventId}`;
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");
const NO_NEEDS: CoreNeeds = { autonomy: 0, competence: 0 };

export function boundAppraisal(
  raw: RawAppraisal,
  goalIds: Set<string>,
  cfg: Config["core"],
): Appraisal | null {
  const a = cfg.appraise;
  const episode = fitChars(tidy(raw.episode), a.episode_max_chars);
  const label = tidy(raw.emotion.label).toLowerCase();
  const phrase = tidy(raw.emotion.about);
  if (!episode || !label || label.length > a.label_max_chars) return null;
  if (!Number.isFinite(raw.emotion.valence) || !Number.isFinite(raw.emotion.arousal)) return null;
  const seen = new Set<string>();
  const goalEffects: Appraisal["goalEffects"] = [];
  for (const g of raw.goal_effects) {
    if (!goalIds.has(g.goal_id) || seen.has(g.goal_id)) continue;
    seen.add(g.goal_id);
    const step = cfg.goals.step[g.size];
    goalEffects.push({ goalId: g.goal_id, delta: g.effect === "block" ? -step : step });
  }
  const need = (x: number) => (Number.isFinite(x) ? Math.sign(x) * a.need_gain : 0);
  return {
    source: "model",
    episode,
    emotion: {
      label,
      valence: clamp(raw.emotion.valence, -1, 1),
      arousal: clamp(raw.emotion.arousal, 0, 1),
      phrase: phrase && phrase.length <= a.about_max_chars ? phrase : null,
    },
    salience: a.salience[raw.salience],
    goalEffects,
    needEffects: {
      autonomy: need(raw.need_effects.autonomy),
      competence: need(raw.need_effects.competence),
    },
    depth: depthOf(raw.depth, cfg.depth.by_kind.episode),
  };
}

/** The event's own valence is the appraisal: what she had before the model, kept as the fallback. */
export function codeAppraisal(event: LandingEvent, cfg: Config["core"]): Appraisal {
  const [lo, hi] = cfg.appraise.fallback_band;
  const labels = cfg.appraise.fallback_labels;
  const label =
    event.valence <= lo ? labels.negative : event.valence >= hi ? labels.positive : labels.neutral;
  return {
    source: "fallback",
    episode: event.content,
    emotion: { label, valence: event.valence, arousal: Math.abs(event.valence), phrase: null },
    salience: cfg.world.event_salience,
    goalEffects: [],
    needEffects: NO_NEEDS,
    depth: cfg.depth.by_kind.episode,
  };
}

/** Outside any transaction: model failures fall back; context read failures propagate. */
export async function proposeAppraisal(ctx: LoopContext, event: LandingEvent): Promise<Appraisal> {
  const { deps } = ctx;
  const { config, core, log } = deps;
  if (!ctx.canCall()) return codeAppraisal(event, config.core);
  const persona = loadPersona(config);
  const now = deps.clock.now();
  const self = await latestSelf(core.memory, persona.seedSelf, lifeTimezone(config.life, now));
  const expected = await core.memory.bySourceRef(
    "intention",
    eventRef(event.intentionEventId ?? event.worldEventId),
  );
  const state = await core.state.get();
  const goals = await core.goals.active();
  const input = [
    `Event (${event.kind}, ${event.stakes} stakes): ${event.content}`,
    `How it went on the surface: valence ${event.valence.toFixed(2)}`,
    `What she expected: ${expected?.content ?? "nothing; she didn't see it coming"}`,
    state
      ? `How she is right now: mood ${state.mood_valence.toFixed(2)}, energy ${state.energy.toFixed(2)}, autonomy ${state.needs.autonomy.toFixed(2)}, competence ${state.needs.competence.toFixed(2)}${state.emotion ? `, feeling ${state.emotion.label}` : ""}`
      : "How she is right now: unknown",
    goals.length
      ? `Her goals:\n${goals.map((g) => `- [${g.id}] ${g.title} (${Math.round(g.progress * 100)}% there): ${g.why}`).join("\n")}`
      : "Her goals: none right now.",
  ].join("\n\n");
  const system = [
    persona.coreValues,
    self,
    loadPrompt("core/appraise", config.prompts.core_appraise),
  ].join("\n\n");
  try {
    const raw = await deps.llm.classifyJson({
      purpose: "core_appraise",
      model: "core",
      system,
      input,
      schema: AppraisalSchema,
      timeoutMs: config.models.core_timeout_ms,
      maxTokens: config.core.appraise.max_tokens,
    });
    const bounded = boundAppraisal(raw, new Set(goals.map((g) => g.id)), config.core);
    if (bounded) return { ...bounded, shown: tokenDates(`${system}\n${input}`) };
    log.error("core appraisal unusable", { worldEventId: event.worldEventId });
  } catch (error) {
    log.error("core appraisal failed", {
      worldEventId: event.worldEventId,
      error: errorName(error),
    });
  }
  return codeAppraisal(event, config.core);
}

/** Inside the caller's transaction, which holds the world tick's lock. */
export async function applyAppraisal(
  core: CoreScope,
  deps: Pick<CoreDeps, "config">,
  event: LandingEvent,
  a: Appraisal,
  embedding: number[],
  now: Date,
): Promise<{ episodeId: string; intentionId: string | null }> {
  const { world, state } = deps.config.core;
  const ref = eventRef(event.worldEventId);
  const intentionRef = eventRef(event.intentionEventId ?? event.worldEventId);
  const episodeId = await core.memory.insert(
    {
      kind: "episode",
      content: a.episode,
      payload: { appraisal_emotion: a.emotion },
      embedding,
      entity_refs: event.agents,
      occurred_at: event.at,
      created_at: now,
      // A big event stays open until its story resolves; a small one is over when it happens.
      status: event.stakes === "high" ? "open" : "resolved",
      salience: a.salience,
      valence: a.emotion.valence,
      confidence: world.event_confidence,
      depth: a.depth,
      source: "world",
      source_ref: ref,
    },
    { known: a.shown ?? [] },
  );
  // Once it has happened the episode speaks for it; the plan stays only as history.
  const intention = await core.memory.bySourceRef("intention", intentionRef);
  if (intention) await core.memory.setStatus(intention.id, "resolved");
  const target = event.resolvesMemoryId ? await core.memory.get(event.resolvesMemoryId) : null;
  if (target?.kind === "episode" && target.status === "open")
    await core.memory.setStatus(target.id, "resolved");
  for (const g of a.goalEffects) {
    const goal = await core.goals.get(g.goalId);
    if (!goal || goal.status !== "active" || isCraftGoal(goal, deps.config)) continue;
    const progress = clamp(goal.progress + g.delta, 0, 1);
    await core.goals.setProgress(goal.id, progress, now);
    if (progress >= 1) await core.goals.setStatus(goal.id, "done", now);
  }
  const firstGoal = a.goalEffects[0];
  if (firstGoal && !event.goalRef && event.kind !== "resolution")
    await core.world.setGoalRef(event.worldEventId, firstGoal.goalId);
  const row = await core.state.lock();
  const mood = applyEvent(moodOf(row), a.emotion.valence, state, a.emotion.arousal);
  const strong = Math.abs(a.emotion.valence) >= state.preoccupation_min_valence;
  let preoccupation: CoreStatePatch = {};
  if (target?.kind === "episode" && row.preoccupation === target.id)
    preoccupation = { preoccupation: null, preoccupation_since: null };
  if (intention && row.preoccupation === intention.id)
    preoccupation = { preoccupation: null, preoccupation_since: null };
  if (strong) preoccupation = { preoccupation: episodeId, preoccupation_since: now };
  await core.state.update({
    ...mood,
    ...preoccupation,
    needs: {
      autonomy: clamp(row.needs.autonomy + a.needEffects.autonomy, 0, 1),
      competence: clamp(row.needs.competence + a.needEffects.competence, 0, 1),
    },
    emotion: { ...a.emotion, about: episodeId, since: now.toISOString() },
  });
  await core.world.markAppraised(event.worldEventId, now);
  return { episodeId, intentionId: intention?.id ?? null };
}
