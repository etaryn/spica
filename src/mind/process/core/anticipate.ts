/** Anticipation gives an approaching plan one thought and a bounded rise in feeling. */
import { z } from "zod";
import type { CoreDeps } from "@/mind/platform/deps";
import type { CoreMemoryItem } from "@/mind/memory/core/types";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { baselineNeeds } from "@/mind/state/core/core-state";
import { prepareThoughts, storeThoughts, traceDrops } from "./thoughts";
import { runCoreLoop } from "./runner";
import type { ThinkingResult } from "./thoughts";

const HOUR_MS = 3_600_000;
const WORLD_LOCK = "core_world_tick";
const Output = z.object({
  thought: z.object({
    kind: z.literal("thought"),
    content: z.string(),
    salience: z.enum(["low", "medium"]),
  }),
  emotion: z.object({
    label: z.string(),
    valence: z.number(),
    arousal: z.number(),
    about: z.string(),
  }),
});

function eventId(item: CoreMemoryItem): string | null {
  const match = /^world_event:(.+)$/.exec(item.source_ref ?? "");
  return match && z.uuid().safeParse(match[1]).success ? match[1]! : null;
}

function eligible(item: CoreMemoryItem | null, now: Date, until: Date): item is CoreMemoryItem {
  if (!item || item.kind !== "intention" || item.status !== "open") return false;
  const payload = item.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const fields = payload as Record<string, unknown>;
  if ("anticipated_at" in fields || typeof fields.event_at !== "string") return false;
  const at = new Date(fields.event_at).getTime();
  return Number.isFinite(at) && at > now.getTime() && at <= until.getTime();
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const tidy = (text: string) => text.trim().replace(/\s+/g, " ");
type ApplyOutput = {
  applied: boolean;
  ids: string[];
  dropped: ReturnType<typeof traceDrops>;
  reason?: string;
};

export async function coreAnticipate(deps: CoreDeps, now: Date): Promise<ThinkingResult> {
  const { config, core } = deps;
  const until = new Date(now.getTime() + config.core.anticipate.lead_hours * HOUR_MS);
  const intention = await core.memory.anticipationCandidate(now, until);
  if (!intention) return { status: "not_due", applied: false, ids: [] };
  const sourceEventId = eventId(intention);
  const event = sourceEventId ? await core.world.getEvent(sourceEventId) : null;
  if (
    !event ||
    event.kind !== "planned" ||
    event.appraised_at !== null ||
    event.at <= now ||
    event.at > until
  )
    return { status: "not_due", applied: false, ids: [] };

  const run = await runCoreLoop<ApplyOutput>(deps, "core_anticipate", now, async (ctx) => {
    const persona = loadPersona(config);
    const self = (await core.memory.latestSnapshot())?.content ?? persona.seedSelf;
    const state = await core.state.get();
    const goal = event.goal_ref ? await core.goals.get(event.goal_ref) : null;
    const input = [
      `Upcoming plan: ${event.content}`,
      `When: ${event.at.toISOString()}`,
      `Her intention: ${intention.content}`,
      `People: ${event.agent_names.length ? event.agent_names.join(", ") : "none named"}`,
      goal ? `Related goal: ${goal.title} (${goal.why})` : "Related goal: none",
      state
        ? `How she is now: mood valence ${state.mood_valence.toFixed(2)}, arousal ${state.mood_arousal.toFixed(2)}${state.emotion ? `, feeling ${state.emotion.label}` : ""}`
        : "How she is now: unknown",
    ].join("\n\n");
    const raw = await ctx.deps.llm.classifyJson({
      purpose: "core_anticipate",
      model: "core",
      system: [
        persona.coreValues,
        self,
        loadPrompt("core/anticipate", config.prompts.core_anticipate),
      ].join("\n\n"),
      input,
      schema: Output,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: config.core.loops.max_tokens,
    });
    const label = tidy(raw.emotion.label).toLowerCase();
    const about = tidy(raw.emotion.about);
    if (!label || label.length > config.core.appraise.label_max_chars)
      throw new Error("invalid anticipation emotion");
    const phrase = about && about.length <= config.core.appraise.about_max_chars ? about : null;
    const emotion = {
      label,
      valence: clamp(raw.emotion.valence, -1, 1),
      arousal: clamp(raw.emotion.arousal, 0, 1),
      phrase,
    };
    const prepared = await prepareThoughts(ctx.deps, [raw.thought]);
    return ctx.commit<ApplyOutput>(async (tx) => {
      await tx.lock(WORLD_LOCK);
      const current = await tx.memory.get(intention.id);
      const liveEvent = await tx.world.getEvent(sourceEventId!);
      const valid =
        eligible(current, now, until) &&
        liveEvent?.kind === "planned" &&
        liveEvent.appraised_at === null &&
        liveEvent.at > now &&
        liveEvent.at <= until;
      if (!valid) {
        return {
          inputs: { intention: intention.id, event: sourceEventId },
          outputs: { applied: false, ids: [], dropped: [], reason: "stale" },
          promptVersion: config.prompts.core_anticipate,
        };
      }
      const stored = await storeThoughts(tx, ctx.deps, prepared, {
        loop: "core_anticipate",
        traceId: ctx.traceId,
        now,
        valence: emotion.valence,
        payload: { anticipates: intention.id },
        entityRefs: liveEvent.agents,
      });
      if (stored.ids.length) {
        await tx.memory.mergePayload(intention.id, { anticipated_at: now.toISOString() });
        await tx.state.ensure(config.core.state.baseline, baselineNeeds(config.core.state));
        const lockedState = await tx.state.lock();
        await tx.state.update({
          mood_arousal: clamp(
            lockedState.mood_arousal +
              config.core.anticipate.arousal_gain * (emotion.arousal - lockedState.mood_arousal),
            0,
            1,
          ),
          emotion: { ...emotion, about: intention.id, since: now.toISOString() },
        });
      }
      return {
        inputs: { intention: intention.id, event: sourceEventId },
        outputs: {
          applied: stored.ids.length > 0,
          ids: stored.ids,
          dropped: traceDrops(stored.dropped),
        },
        promptVersion: config.prompts.core_anticipate,
      };
    });
  });
  return {
    status: run.status,
    applied: run.outputs?.applied ?? false,
    ids: run.outputs?.ids ?? [],
  };
}
