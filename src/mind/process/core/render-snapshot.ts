/** Render a durable self description from bounded core evidence, preserving the prior version on failure. */
import { z } from "zod";
import type { CoreDeps } from "@/mind/platform/deps";
import type { LoopStatus } from "@/mind/platform/core";
import { fitList, fitText } from "@/mind/platform/llm/fit";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { runCoreLoop } from "./runner";

export async function coreRenderSnapshot(deps: CoreDeps, now: Date): Promise<LoopStatus> {
  const { core, config } = deps;
  const bounds = config.core.snapshot;
  const run = await runCoreLoop(deps, "core_render_snapshot", now, async (ctx) => {
    const previous = await core.memory.latestSnapshot();
    const [narrative, opinions, interests, insights, notes, goals, entities] = await Promise.all([
      core.memory.latestNarrative(),
      core.memory.activeByKind("opinion", bounds.max_items),
      core.memory.activeByKind("interest", bounds.max_items),
      core.memory.recentInsights(previous?.rendered_at ?? null, now, bounds.max_items),
      core.memory.activeByKind("agent_note", bounds.max_items),
      core.goals.active(),
      core.memory.entities(),
    ]);
    const persona = loadPersona(config);
    const people = entities.slice(0, bounds.max_items);
    const activeGoals = goals.slice(0, bounds.max_items);
    const section = fitList(fitText(config.core.loops.max_chars), bounds.max_items);
    const Output = z
      .object({
        Lately: section,
        Opinions: section,
        Interests: section,
        Goals: section,
        People: section,
        "Habits of speech": section,
      })
      .strict();
    const result = await ctx.deps.llm.classifyJson({
      purpose: "core_render_snapshot",
      model: "core",
      system: [persona.coreValues, loadPrompt("core/snapshot", config.prompts.core_snapshot)].join(
        "\n\n",
      ),
      input: JSON.stringify({
        previous: previous?.content ?? persona.seedSelf,
        narrative,
        opinions,
        interests,
        insights,
        notes,
        goals: activeGoals,
        people,
      }),
      schema: Output,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: bounds.max_tokens,
    });
    const sections = Object.fromEntries(
      Object.entries(result).map(([name, lines]) => [
        name,
        lines.map((line) => `- ${line}`).join("\n"),
      ]),
    );
    const content = Object.entries(sections)
      .map(([name, text]) => `### ${name}\n${text}`)
      .join("\n\n");
    const lines = Object.values(result).flat();
    const vectors = await deps.embedder.embed([content, ...lines], "document");
    const sourceIds = [
      ...(narrative ? [narrative.id] : []),
      ...[...opinions, ...interests, ...insights, ...notes, ...activeGoals, ...people].map(
        (item) => item.id,
      ),
    ];
    return ctx.commit<{ version: number | null }>(async (tx) => {
      await tx.lock("core_render_snapshot");
      const current = await tx.memory.latestSnapshot();
      if (current?.version !== previous?.version)
        return {
          status: "fallback",
          inputs: { source_ids: sourceIds },
          outputs: { version: null },
          promptVersion: config.prompts.core_snapshot,
        };
      const version = (previous?.version ?? -1) + 1;
      if (
        !(await tx.memory.insertSnapshot({
          version,
          content,
          sections,
          embedding: vectors[0]!,
          source_ids: sourceIds,
          rendered_at: now,
          model: config.models.core,
          prompt_version: config.prompts.core_snapshot,
        }))
      )
        throw new Error("snapshot version conflict");
      await tx.memory.insertSelfLines(
        lines.map((text, index) => ({ version, text, embedding: vectors[index + 1]! })),
      );
      return {
        inputs: { source_ids: sourceIds },
        outputs: { version },
        promptVersion: config.prompts.core_snapshot,
      };
    });
  });
  return run.status;
}
