/** Nightly reflection converts new core experience into bounded memories and goal changes. */
import { z } from "zod";
import type { CoreMemoryItem, NewCoreMemory } from "@/mind/memory/core/types";
import type { CoreDeps } from "@/mind/platform/deps";
import type { LoopStatus } from "@/mind/platform/core";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { runCoreLoop } from "./runner";

const active = (item: CoreMemoryItem | null, kind: CoreMemoryItem["kind"]) =>
  item?.kind === kind && item.status !== "stale" && item.status !== "superseded";

export async function coreReflect(deps: CoreDeps, now: Date): Promise<LoopStatus> {
  const { config, core } = deps;
  const bounds = config.core.reflect;
  const run = await runCoreLoop(deps, "core_reflect", now, async (ctx) => {
    const inputs = await core.memory.reflectInputs(now, bounds.max_inputs);
    const inputIds = inputs.map((item) => item.id);
    if (!inputs.length)
      return {
        inputs: { ids: [] },
        outputs: {
          memory_ids: [],
          goal_ids: [],
          faded_interest_ids: [],
          dropped_goal_ids: [],
        },
      };

    const [query] = await deps.embedder.embed(
      [inputs.map((item) => item.content).join("\n")],
      "query",
    );
    const [context, goals, snapshot, narrative] = await Promise.all([
      core.memory.nearestActive(query!, ["opinion", "interest"], bounds.context_items),
      core.goals.active(),
      core.memory.latestSnapshot(),
      core.memory.latestNarrative(),
    ]);
    const persona = loadPersona(config);
    const maxChars = config.core.loops.max_chars;
    const line = z.string().trim().min(1).max(maxChars);
    const Output = z.object({
      insights: z.array(line).max(bounds.max_insights),
      opinions: z
        .array(
          z.object({
            subject: line,
            stance: line,
            confidence: z.enum(["low", "medium", "high"]),
            supersedes: z.uuid().nullable().optional(),
          }),
        )
        .max(bounds.max_opinions),
      interests: z
        .array(
          z.discriminatedUnion("status", [
            z.object({ status: z.literal("new"), content: line }),
            z.object({ status: z.literal("fading"), target_id: z.uuid() }),
          ]),
        )
        .max(bounds.max_interests),
      goals: z.object({
        add: z.array(z.object({ title: line, why: line })).max(bounds.max_inputs),
        drop: z.array(z.uuid()).max(bounds.max_inputs),
      }),
      narrative: z
        .string()
        .trim()
        .min(1)
        .max(maxChars * bounds.max_inputs)
        .refine((text) => !/\n\s*\n/.test(text), "narrative must be one paragraph")
        .nullable(),
    });
    const result = await ctx.deps.llm.classifyJson({
      purpose: "core_reflect",
      model: "core",
      system: [
        persona.coreValues,
        snapshot?.content ?? persona.seedSelf,
        loadPrompt("core/reflect", config.prompts.core_reflect),
      ].join("\n\n"),
      input: JSON.stringify({
        inputs: inputs.map(({ id, kind, content }) => ({ id, kind, content })),
        context: context.map(({ id, kind, content }) => ({ id, kind, content })),
        narrative: narrative ? { id: narrative.id, content: narrative.content } : null,
        goals: goals.map(({ id, title, why, progress }) => ({ id, title, why, progress })),
      }),
      schema: Output,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: bounds.max_tokens,
    });
    const proposals = [
      ...result.insights.map((content) => ({
        kind: "insight" as const,
        content,
        confidence: bounds.confidence.medium,
        salience: bounds.salience.insight,
        target: null,
      })),
      ...result.opinions.map((item) => ({
        kind: "opinion" as const,
        content: `${item.subject}: ${item.stance}`,
        confidence: bounds.confidence[item.confidence],
        salience: bounds.salience.opinion,
        target: item.supersedes ?? null,
      })),
      ...result.interests
        .filter((item) => item.status === "new")
        .map((item) => ({
          kind: "interest" as const,
          content: item.content,
          confidence: bounds.confidence.medium,
          salience: bounds.salience.interest,
          target: null,
        })),
      ...(result.narrative
        ? [
            {
              kind: "narrative" as const,
              content: result.narrative,
              confidence: bounds.confidence.medium,
              salience: bounds.salience.narrative,
              target: null,
            },
          ]
        : []),
    ];
    const goalAdds = result.goals.add;
    const texts = [
      ...proposals.map((item) => item.content),
      ...goalAdds.map((goal) => `${goal.title}: ${goal.why}`),
    ];
    const embeddings = texts.length ? await deps.embedder.embed(texts, "document") : [];
    return ctx.commit(async (tx) => {
      await tx.lock("core_reflect");
      if ((await tx.memory.markReflected(inputIds, now)) !== inputIds.length)
        throw new Error("reflect inputs changed");
      const memoryIds: string[] = [];
      const goalIds: string[] = [];
      const fadedInterestIds: string[] = [];
      const droppedGoalIds: string[] = [];
      const sourceRef = `core_reflect:${ctx.traceId}`;
      for (const [index, proposal] of proposals.entries()) {
        const priorNarrative =
          proposal.kind === "narrative" ? await tx.memory.latestNarrative() : null;
        const item: NewCoreMemory = {
          kind: proposal.kind,
          content: proposal.content,
          embedding: embeddings[index]!,
          occurred_at: now,
          created_at: now,
          status: "recurring",
          salience: proposal.salience,
          valence: 0,
          confidence: proposal.confidence,
          source: "loop",
          source_ref: sourceRef,
        };
        const id = await tx.memory.insert(item);
        memoryIds.push(id);
        if (proposal.kind === "narrative") {
          if (priorNarrative) await tx.memory.supersede(priorNarrative.id, id);
        } else if (proposal.kind === "opinion" && proposal.target) {
          if (active(await tx.memory.get(proposal.target), "opinion"))
            await tx.memory.supersede(proposal.target, id);
        }
      }
      for (const interest of result.interests) {
        if (
          interest.status === "fading" &&
          active(await tx.memory.get(interest.target_id), "interest")
        ) {
          if (await tx.memory.scaleSalience(interest.target_id, bounds.fade_factor))
            fadedInterestIds.push(interest.target_id);
        }
      }
      for (const id of result.goals.drop)
        if ((await tx.goals.get(id))?.status === "active")
          if (await tx.goals.setStatus(id, "dropped", now)) droppedGoalIds.push(id);
      let available = config.core.goals.max_active - (await tx.goals.active()).length;
      for (const [index, goal] of goalAdds.entries()) {
        if (available <= 0) break;
        goalIds.push(
          await tx.goals.insert({
            ...goal,
            embedding: embeddings[proposals.length + index]!,
            status: "active",
            progress: 0,
            source: "reflect",
            source_ref: sourceRef,
            started_at: now,
            target_at: null,
          }),
        );
        available--;
      }
      return {
        inputs: { ids: inputIds },
        outputs: {
          memory_ids: memoryIds,
          goal_ids: goalIds,
          faded_interest_ids: fadedInterestIds,
          dropped_goal_ids: droppedGoalIds,
        },
        promptVersion: config.prompts.core_reflect,
      };
    });
  });
  return run.status;
}
