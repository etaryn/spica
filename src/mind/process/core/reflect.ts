/** Nightly reflection converts new core experience into bounded memories and goal changes. */
import { z } from "zod";
import { DepthLabel, depthOf } from "@/mind/memory/core/depth";
import type { CoreMemoryItem, NewCoreMemory } from "@/mind/memory/core/types";
import type { CoreDeps } from "@/mind/platform/deps";
import type { CoreScope, LoopStatus } from "@/mind/platform/core";
import { fitList, fitText } from "@/mind/platform/llm/fit";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { DAY } from "@/mind/platform/time";
import { isCraftGoal } from "./post-library";
import { runCoreLoop } from "./runner";

const active = (item: CoreMemoryItem | null, kind: CoreMemoryItem["kind"]) =>
  item?.kind === kind && item.status !== "stale" && item.status !== "superseded";

/** The nearest active memory of `kind` written before tonight, at or above `minSimilarity`. */
async function twinOf(
  tx: Pick<CoreScope, "memory">,
  kind: "opinion" | "interest",
  embedding: number[],
  minSimilarity: number,
  now: Date,
): Promise<string | null> {
  for (const n of await tx.memory.near(embedding, 5, minSimilarity, [kind])) {
    const m = await tx.memory.get(n.id);
    if (m && active(m, kind) && m.created_at.getTime() < now.getTime()) return m.id;
  }
  return null;
}

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
    const line = fitText(maxChars);
    const depth = DepthLabel.nullable().default(null);
    const Output = z.object({
      insights: fitList(z.object({ content: line, depth }), bounds.max_insights),
      opinions: fitList(
        z.object({
          subject: line,
          stance: line,
          confidence: z.enum(["low", "medium", "high"]),
          supersedes: z.uuid().nullable().optional(),
          depth,
        }),
        bounds.max_opinions,
      ),
      interests: fitList(
        z.discriminatedUnion("status", [
          z.object({ status: z.literal("new"), content: line, depth }),
          z.object({ status: z.literal("fading"), target_id: z.uuid() }),
        ]),
        bounds.max_interests,
      ),
      goals: z.object({
        add: fitList(z.object({ title: line, why: line }), bounds.max_inputs),
        drop: fitList(z.uuid(), bounds.max_inputs),
      }),
      // One paragraph: fitting collapses any blank lines.
      narrative: fitText(maxChars * bounds.max_inputs).nullable(),
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
    const byKind = config.core.depth.by_kind;
    const proposals = [
      ...result.insights.map((item) => ({
        kind: "insight" as const,
        content: item.content,
        confidence: bounds.confidence.medium,
        salience: bounds.salience.insight,
        depth: depthOf(item.depth, byKind.insight),
        target: null,
      })),
      ...result.opinions.map((item) => ({
        kind: "opinion" as const,
        content: `${item.subject}: ${item.stance}`,
        confidence: bounds.confidence[item.confidence],
        salience: bounds.salience.opinion,
        depth: depthOf(item.depth, byKind.opinion),
        target: item.supersedes ?? null,
      })),
      ...result.interests
        .filter((item) => item.status === "new")
        .map((item) => ({
          kind: "interest" as const,
          content: item.content,
          confidence: bounds.confidence.medium,
          salience: bounds.salience.interest,
          depth: depthOf(item.depth, byKind.interest),
          target: null,
        })),
      ...(result.narrative
        ? [
            {
              kind: "narrative" as const,
              content: result.narrative,
              confidence: bounds.confidence.medium,
              salience: bounds.salience.narrative,
              depth: byKind.narrative,
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
        // Nightly reflection restates what she already thinks; a near-twin replaces the old row so
        // one view doesn't pile up as many. Only memories from before tonight count.
        const twin =
          (proposal.kind === "opinion" || proposal.kind === "interest") && !proposal.target
            ? await twinOf(tx, proposal.kind, embeddings[index]!, bounds.twin_similarity, now)
            : null;
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
          depth: proposal.depth,
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
        } else if (twin) {
          await tx.memory.supersede(twin, id);
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
      // Reflection rewords a goal it already has: the near-twin stays (with its progress), the
      // rewording isn't added, and the original isn't dropped for it.
      const twins = new Set<string>();
      const adds: { goal: (typeof goalAdds)[number]; embedding: number[] }[] = [];
      for (const [index, goal] of goalAdds.entries()) {
        const embedding = embeddings[proposals.length + index]!;
        const twin = await tx.goals.nearActive(embedding, config.core.goals.twin_similarity);
        if (twin) twins.add(twin);
        else adds.push({ goal, embedding });
      }
      // Drops stop at the floor unless replacements come in: with no goal, nothing pulls her
      // events or recall toward anything.
      let droppable = (await tx.goals.active()).length + adds.length - config.core.goals.min_active;
      const seedKeep = config.core.goals.seed_keep_days * DAY;
      for (const id of result.goals.drop) {
        if (droppable <= 0) break;
        if (twins.has(id)) continue;
        const goal = await tx.goals.get(id);
        // A seed goal gets its first week before reflection can give it up.
        const young =
          goal?.source === "seed" && now.getTime() - goal.started_at.getTime() < seedKeep;
        // Her craft goal is her outward aim: its progress is Ethan's to set, so it stays.
        if (goal?.status === "active" && !young && !isCraftGoal(goal, config))
          if (await tx.goals.setStatus(id, "dropped", now)) {
            droppedGoalIds.push(id);
            droppable--;
          }
      }
      let available = config.core.goals.max_active - (await tx.goals.active()).length;
      for (const { goal, embedding } of adds) {
        if (available <= 0) break;
        goalIds.push(
          await tx.goals.insert({
            ...goal,
            embedding,
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
