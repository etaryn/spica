/** Propose what happened when a known plan falls through; world writes happen at landing. */
import { z } from "zod";
import type { WorldEventRow } from "@/mind/world/types";
import { errorName } from "@/mind/platform/errors";
import { fitChars } from "@/mind/platform/llm/fit";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import type { LoopContext } from "./runner";
import { eventRef } from "./appraise";
import { latestSelf } from "@/mind/memory/core/self";
import { lifeTimezone } from "@/mind/world/her-clock";

const ResolutionSchema = z.object({
  content: z.string(),
  valence: z.number(),
  stakes: z.enum(["low", "high"]),
});

export type ResolutionProposal = {
  content: string;
  valence: number;
  stakes: "low" | "high";
};

export async function proposeResolution(
  ctx: LoopContext,
  event: WorldEventRow,
): Promise<ResolutionProposal | null> {
  const { config, core, log } = ctx.deps;
  if (!ctx.canCall()) return null;

  const persona = loadPersona(config);
  const now = ctx.deps.clock.now();
  const self = await latestSelf(core.memory, persona.seedSelf, lifeTimezone(config.life, now));
  const intention = await core.memory.bySourceRef("intention", eventRef(event.id));
  const prompt = loadPrompt("core/resolve", config.prompts.core_resolve);
  const input = [
    `Planned event (${event.stakes} stakes): ${event.content}`,
    `Expected feeling: valence ${event.valence.toFixed(2)}`,
    `What she expected: ${intention?.content ?? "no recorded intention"}`,
  ].join("\n\n");

  try {
    const raw = await ctx.deps.llm.classifyJson({
      purpose: "core_resolve",
      model: "core",
      system: [persona.coreValues, self, prompt].join("\n\n"),
      input,
      schema: ResolutionSchema,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: config.core.resolve.max_tokens,
    });
    const content = fitChars(
      raw.content.trim().replace(/\s+/g, " "),
      config.core.world.event_max_chars,
    );
    if (content && Number.isFinite(raw.valence)) {
      return { content, valence: Math.max(-1, Math.min(1, raw.valence)), stakes: raw.stakes };
    }
    log.error("core resolution unusable", { worldEventId: event.id });
  } catch (error) {
    log.error("core resolution failed", { worldEventId: event.id, error: errorName(error) });
  }
  return null;
}
