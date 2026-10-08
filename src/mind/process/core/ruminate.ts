/** Rumination returns to a strong landed episode once and keeps its effects atomic. */
import { z } from "zod";
import type { CoreMemoryItem } from "@/mind/memory/core/types";
import type { CoreDeps } from "@/mind/platform/deps";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { baselineNeeds } from "@/mind/state/core/core-state";
import { runCoreLoop } from "./runner";
import {
  moodLine,
  prepareThoughts,
  storeThoughts,
  traceDrops,
  WORLD_LOCK,
  worldEventId,
} from "./thoughts";
import type { ApplyOutput, ThinkingResult } from "./thoughts";
import { HOUR } from "@/mind/platform/time";
import { clamp } from "@/mind/platform/math";

const Output = z.object({
  thought: z.object({
    kind: z.literal("thought"),
    content: z.string(),
    salience: z.enum(["low", "medium"]),
  }),
});
const HistoricalEmotion = z.object({
  label: z.string().min(1),
  valence: z.number().min(-1).max(1),
  arousal: z.number().min(0).max(1),
  phrase: z.string().nullable(),
});

function payloadOf(item: CoreMemoryItem): Record<string, unknown> | null {
  const value = item.payload;
  if (value === null) return {};
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function countOf(item: CoreMemoryItem): number | null {
  const payload = payloadOf(item);
  if (!payload) return null;
  const count = "ruminated" in payload ? payload.ruminated : 0;
  return typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : null;
}

function eligible(item: CoreMemoryItem | null, from: Date, to: Date, min: number, max: number) {
  if (!item || item.kind !== "episode" || ["stale", "superseded"].includes(item.status))
    return false;
  const count = countOf(item);
  return (
    item.created_at >= from &&
    item.created_at <= to &&
    Math.abs(item.valence) >= min &&
    count !== null &&
    count < max
  );
}

export async function coreRuminate(deps: CoreDeps, now: Date): Promise<ThinkingResult> {
  const { core, config } = deps;
  const { delay_hours, window_hours, min_valence, max_per_episode, gain } = config.core.ruminate;
  const from = new Date(now.getTime() - window_hours * HOUR);
  const to = new Date(now.getTime() - delay_hours * HOUR);
  const episode = await core.memory.ruminationCandidate(from, to, min_valence, max_per_episode);
  if (!episode) return { status: "not_due", applied: false, ids: [] };

  const run = await runCoreLoop<ApplyOutput>(deps, "core_ruminate", now, async (ctx) => {
    const persona = loadPersona(config);
    const self = (await core.memory.latestSnapshot())?.content ?? persona.seedSelf;
    const historical = HistoricalEmotion.safeParse(payloadOf(episode)?.appraisal_emotion);
    const people = (await core.memory.entities()).filter((person) =>
      episode.entity_refs.includes(person.id),
    );
    const sourceEventId = worldEventId(episode);
    const event = sourceEventId ? await core.world.getEvent(sourceEventId) : null;
    const goal = event?.goal_ref ? await core.goals.get(event.goal_ref) : null;
    const state = await core.state.get();
    const input = [
      `Landed episode: ${episode.content}`,
      `Its valence: ${episode.valence.toFixed(2)}`,
      `Historical emotion: ${historical.success ? `${historical.data.label} (valence ${historical.data.valence.toFixed(2)}, arousal ${historical.data.arousal.toFixed(2)}${historical.data.phrase ? `, about ${historical.data.phrase}` : ""})` : "absent"}`,
      `People: ${people.length ? people.map((person) => person.name).join(", ") : "none named"}`,
      goal ? `Related goal: ${goal.title} (${goal.why})` : "Related goal: none",
      moodLine(state),
    ].join("\n\n");
    const raw = await ctx.deps.llm.classifyJson({
      purpose: "core_ruminate",
      model: "core",
      system: [
        persona.coreValues,
        self,
        loadPrompt("core/ruminate", config.prompts.core_ruminate),
      ].join("\n\n"),
      input,
      schema: Output,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: config.core.loops.max_tokens,
    });
    const prepared = await prepareThoughts(ctx.deps, [raw.thought]);
    return ctx.commit<ApplyOutput>(async (tx) => {
      await tx.lock(WORLD_LOCK);
      const current = await tx.memory.get(episode.id);
      if (!eligible(current, from, to, min_valence, max_per_episode)) {
        return {
          inputs: { episode: episode.id },
          outputs: { applied: false, ids: [], dropped: [], reason: "stale" },
          promptVersion: config.prompts.core_ruminate,
        };
      }
      const stored = await storeThoughts(tx, ctx.deps, prepared, {
        loop: "core_ruminate",
        traceId: ctx.traceId,
        now,
        valence: current!.valence,
        payload: { ruminates: episode.id },
        entityRefs: current!.entity_refs,
      });
      if (stored.ids.length) {
        await tx.memory.mergePayload(episode.id, { ruminated: countOf(current!)! + 1 });
        await tx.memory.reinforce(
          episode.id,
          now,
          config.retrieval.recall_bump,
          config.retrieval.recall_cap,
        );
        await tx.state.ensure(config.core.state.baseline, baselineNeeds(config.core.state));
        const lockedState = await tx.state.lock();
        await tx.state.update({
          mood_valence: clamp(lockedState.mood_valence + gain * Math.sign(current!.valence), -1, 1),
          ...(lockedState.emotion?.about === episode.id
            ? { emotion: { ...lockedState.emotion, since: now.toISOString() } }
            : {}),
        });
      }
      return {
        inputs: { episode: episode.id },
        outputs: {
          applied: stored.ids.length > 0,
          ids: stored.ids,
          dropped: traceDrops(stored.dropped),
        },
        promptVersion: config.prompts.core_ruminate,
      };
    });
  });
  return {
    status: run.status,
    applied: run.outputs?.applied ?? false,
    ids: run.outputs?.ids ?? [],
  };
}
