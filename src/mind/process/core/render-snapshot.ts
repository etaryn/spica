/**
 * Render a durable self description from bounded core evidence, preserving the prior version on
 * failure and a prior section when a render empties it.
 */
import { z } from "zod";
import { DepthLabel, depthOf, snapshotSection, type DepthLabelT } from "@/mind/memory/core/depth";
import type { CoreDeps } from "@/mind/platform/deps";
import type { LoopStatus } from "@/mind/platform/core";
import { fitList, fitText } from "@/mind/platform/llm/fit";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { runCoreLoop } from "./runner";
import { anchorTimes, stamped } from "@/mind/platform/time-anchors";
import { lifeTimezone } from "@/mind/world/her-clock";

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
    const line = z.object({
      text: fitText(config.core.loops.max_chars),
      depth: DepthLabel.nullable().default(null),
    });
    const section = fitList(line, bounds.max_items);
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
        previous: previous
          ? stamped(previous.content, previous.rendered_at, lifeTimezone(config.life, now))
          : persona.seedSelf,
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
    // A night's render can come back with a section emptied; her self doesn't vanish overnight,
    // so an empty section keeps last night's lines, each at the depth it had, so nothing kept
    // reaches someone it was held back from.
    const before = previous?.content ?? persona.seedSelf;
    const hadDepth = new Map(
      (previous ? await core.memory.selfLines(previous.version) : []).map((l) => [l.text, l.depth]),
    );
    const kept: Record<string, { text: string; depth: DepthLabelT | null; was?: number }[]> =
      Object.fromEntries(
        Object.entries(result).map(([name, items]) => [
          name,
          items.length
            ? items
            : snapshotSection(before, name).map((text) => ({
                text,
                depth: null,
                was: hadDepth.get(text),
              })),
        ]),
      );
    // Dated once here, so her snapshot's text and its self lines stay the same strings.
    const zone = lifeTimezone(config.life, now);
    for (const items of Object.values(kept))
      for (const item of items)
        item.text = anchorTimes(item.text, { at: now, zone, known: ctx.shown() });
    const sections = Object.fromEntries(
      Object.entries(kept).map(([name, items]) => [
        name,
        items.map((item) => `- ${item.text}`).join("\n"),
      ]),
    );
    const content = Object.entries(sections)
      .map(([name, text]) => `### ${name}\n${text}`)
      .join("\n\n");
    const lines = Object.entries(kept).flatMap(([name, items]) =>
      items.map((item) => ({
        text: item.text,
        depth: item.was ?? depthOf(item.depth, config.core.depth.by_section[name] ?? 1),
      })),
    );
    const vectors = await deps.embedder.embed([content, ...lines.map((l) => l.text)], "document");
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
        lines.map((l, index) => ({
          version,
          text: l.text,
          depth: l.depth,
          embedding: vectors[index + 1]!,
        })),
      );
      return {
        inputs: { source_ids: sourceIds },
        outputs: { version },
        promptVersion: config.prompts.core_snapshot,
      };
    });
  });
  const version = run.outputs?.version;
  if (version !== null && version !== undefined)
    await deps.emitCore({ type: "core.snapshot", version });
  return run.status;
}
