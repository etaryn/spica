/** Wandering associates recent real memories during free time without moving her state. */
import { z } from "zod";
import { DepthLabel } from "@/mind/memory/core/depth";
import type { CoreMemoryItem } from "@/mind/memory/core/types";
import type { CoreScope } from "@/mind/platform/core";
import type { CoreDeps } from "@/mind/platform/deps";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { seededUnit } from "@/mind/platform/seeded-random";
import { blockAt, blocksForDay, todaysBlocks } from "@/mind/world/blocks";
import { lifeDate } from "@/mind/world/her-clock";
import { budgetDayStart, runCoreLoop } from "./runner";
import { prepareThoughts, storeThoughts, traceDrops, WORLD_LOCK } from "./thoughts";
import type { ApplyOutput, ThinkingResult } from "./thoughts";
import { DAY, HOUR } from "@/mind/platform/time";

const Output = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(["thought", "idea", "hypothetical"]),
        content: z.string(),
        salience: z.enum(["low", "medium"]),
        depth: DepthLabel.nullable().default(null),
      }),
    )
    .min(1),
});

async function eligibility(deps: Pick<CoreDeps, "config"> & { core: CoreScope }, now: Date) {
  const day = lifeDate(deps.config.life, now);
  const plan = await deps.core.world.plan(day);
  if (!plan || blockAt(blocksForDay(deps.config.life, day, plan), now)) return null;
  const to = new Date(now.getTime() + 1);
  const today = await deps.core.traces.appliedSummary(
    "core_wander",
    budgetDayStart(deps.config, now),
    to,
  );
  if (today.count >= deps.config.core.wander.max_per_day) return null;
  const history = await deps.core.traces.appliedSummary("core_wander", new Date(0), to);
  if (
    history.latest &&
    now.getTime() - history.latest.getTime() < deps.config.core.wander.min_gap_hours * HOUR
  )
    return null;
  return { day, completedToday: today.count };
}

function pickSeed(pool: CoreMemoryItem[], roll: number, mood: number, bias: number) {
  const weights = pool.map((item) => item.salience * Math.max(0, 1 + bias * item.valence * mood));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total === 0) return pool[Math.floor(roll * pool.length)]!;
  let position = roll * total;
  for (let index = 0; index < pool.length; index++) {
    position -= weights[index]!;
    if (position < 0) return pool[index]!;
  }
  return pool.at(-1)!;
}

async function chainFor(deps: CoreDeps, seed: CoreMemoryItem, vector: number[]) {
  const { chain, min_similarity, seed_limit } = deps.config.core.wander;
  let limit = Math.max(seed_limit, chain + 1);
  const selected: CoreMemoryItem[] = [];
  while (selected.length < chain) {
    const near = await deps.core.memory.near(vector, limit, min_similarity);
    for (const item of near) {
      if (item.id === seed.id || selected.some((part) => part.id === item.id)) continue;
      const memory = await deps.core.memory.get(item.id);
      if (
        !memory ||
        memory.kind === "hypothetical" ||
        (memory.kind === "intention" && memory.status === "resolved")
      )
        continue;
      selected.push(memory);
      if (selected.length === chain) break;
    }
    if (selected.length === chain || near.length < limit) break;
    limit *= 2;
  }
  return selected;
}

export async function coreWander(deps: CoreDeps, now: Date): Promise<ThinkingResult> {
  const { core, config } = deps;
  if (blockAt(await todaysBlocks(deps, now), now))
    return { status: "not_due", applied: false, ids: [] };
  const due = await eligibility(deps, now);
  if (!due) return { status: "not_due", applied: false, ids: [] };
  const pool = await core.memory.recallable(
    new Date(now.getTime() - config.core.wander.seed_days * DAY),
    now,
    config.core.wander.seed_limit,
  );
  if (!pool.length) return { status: "not_due", applied: false, ids: [] };

  const run = await runCoreLoop<ApplyOutput>(deps, "core_wander", now, async (ctx) => {
    const state = await core.state.get();
    const seed = pickSeed(
      pool,
      seededUnit(`${due.day}:wander:${due.completedToday}`),
      state?.mood_valence ?? config.core.state.baseline.mood_valence,
      config.core.wander.mood_bias,
    );
    const [query] = await ctx.deps.embedder.embed([seed.content], "query");
    if (!query) throw new Error("missing wander seed embedding");
    const chain = await chainFor(ctx.deps, seed, query);
    const persona = loadPersona(config);
    const self = (await core.memory.latestSnapshot())?.content ?? persona.seedSelf;
    const goals = await core.goals.active();
    const input = [
      `Seed memory: ${seed.content}`,
      `Associated memories: ${chain.length ? chain.map((item) => item.content).join("\n") : "none"}`,
      state
        ? `Mood: ${state.mood_valence.toFixed(2)}; energy: ${state.energy.toFixed(2)}; needs: autonomy ${state.needs.autonomy.toFixed(2)}, competence ${state.needs.competence.toFixed(2)}`
        : "Mood, energy and needs: unknown",
      `Active goals: ${goals.length ? goals.map((goal) => `${goal.title} (${goal.why})`).join("; ") : "none"}`,
    ].join("\n\n");
    const raw = await ctx.deps.llm.classifyJson({
      purpose: "core_wander",
      model: "core",
      system: [
        persona.coreValues,
        self,
        loadPrompt("core/wander", config.prompts.core_wander),
      ].join("\n\n"),
      input,
      schema: Output,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: config.core.loops.max_tokens,
    });
    const prepared = await prepareThoughts(
      ctx.deps,
      raw.items.slice(0, config.core.wander.max_items),
    );
    return ctx.commit<ApplyOutput>(async (tx) => {
      await tx.lock(WORLD_LOCK);
      if (!(await eligibility({ ...ctx.deps, core: tx }, now))) {
        return {
          inputs: { seed: seed.id, chain: chain.map((item) => item.id) },
          outputs: { applied: false, ids: [], dropped: [], reason: "stale" },
          promptVersion: config.prompts.core_wander,
        };
      }
      const ids: string[] = [];
      const dropped: string[] = [];
      for (const thought of prepared) {
        const stored = await storeThoughts(tx, ctx.deps, [thought], {
          loop: "core_wander",
          traceId: ctx.traceId,
          now,
          valence: seed.valence,
          payload: {
            seed: seed.id,
            chain: chain.map((item) => item.id),
            ...(thought.item.kind === "hypothetical" ? { unreal: true } : {}),
          },
          entityRefs: seed.entity_refs,
        });
        ids.push(...stored.ids);
        dropped.push(...stored.dropped);
      }
      return {
        inputs: { seed: seed.id, chain: chain.map((item) => item.id) },
        outputs: { applied: true, ids, dropped: traceDrops(dropped) },
        promptVersion: config.prompts.core_wander,
      };
    });
  });
  return {
    status: run.status,
    applied: run.outputs?.applied ?? false,
    ids: run.outputs?.ids ?? [],
  };
}
