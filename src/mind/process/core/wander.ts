/**
 * Wandering associates her lived memories during free time without moving her state. It starts
 * from a cue picked in code (an older episode or plan, an interest, or something from today) and
 * chains through lived memory only, drawing less on what her recent wanderings already used.
 */
import { z } from "zod";
import { DepthLabel } from "@/mind/memory/core/depth";
import type { CoreMemoryItem } from "@/mind/memory/core/types";
import { recallable } from "@/mind/memory/core/retrieve";
import type { Config } from "@/mind/platform/config";
import type { CoreScope } from "@/mind/platform/core";
import type { CoreDeps } from "@/mind/platform/deps";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { seededUnit } from "@/mind/platform/seeded-random";
import { blockAt, todaysBlocks } from "@/mind/world/blocks";
import { lifeDate, lifeTimezone } from "@/mind/world/her-clock";
import { latestSelf } from "@/mind/memory/core/self";
import { dayInWords } from "@/mind/platform/relative-date";
import { budgetDayStart, runCoreLoop } from "./runner";
import { prepareThoughts, storeThoughts, traceDrops, WORLD_LOCK } from "./thoughts";
import type { ApplyOutput, ThinkingResult } from "./thoughts";
import { HOUR } from "@/mind/platform/time";

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
  if (!plan || blockAt(await todaysBlocks(deps, now), now)) return null;
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

type CueKind = "memory" | "interest" | "event";
type Cue = { kind: CueKind; items: CoreMemoryItem[] };

/**
 * Where her mind can start: an older lived memory of hers (an episode, a plan still ahead), an
 * interest, or something that happened today. Never a thought, idea, opinion or insight, so her
 * thinking doesn't feed on itself.
 */
async function wanderCues(deps: CoreDeps, now: Date): Promise<Cue[]> {
  const { core, config } = deps;
  const limit = config.core.wander.seed_limit;
  const usable = (m: CoreMemoryItem) => recallable(m) && m.created_at.getTime() <= now.getTime();
  // An opinion or insight is reflect's summary of her earlier thoughts; starting from one makes
  // her mind circle a single theme.
  const memory = (
    await Promise.all(
      (["episode", "intention"] as const).map((k) => core.memory.activeByKind(k, limit)),
    )
  )
    .flat()
    .filter((m) => m.kind !== "intention" || m.status === "open");
  const interest = await core.memory.activeByKind("interest", limit);
  const today = (await core.world.events(lifeDate(config.life, now))).filter(
    (e) => e.at.getTime() <= now.getTime(),
  );
  const event = (
    await Promise.all(today.map((e) => core.memory.bySourceRef("episode", `world_event:${e.id}`)))
  ).filter((m): m is CoreMemoryItem => !!m);
  return [
    { kind: "memory" as const, items: memory.filter(usable) },
    { kind: "interest" as const, items: interest.filter(usable) },
    { kind: "event" as const, items: event.filter(usable) },
  ].filter((c) => c.items.length);
}

/**
 * A kind by weight, then an item by salience and mood-congruence; one her recent wanderings
 * already used counts less. With every weight zero the pick is uniform; null only with no cue.
 */
export function pickCue(
  cues: Cue[],
  used: Set<string>,
  roll: number,
  cfg: Config["core"]["wander"],
  mood = 0,
): CoreMemoryItem | null {
  const pool = cues
    .flatMap((c) =>
      c.items.map((item) => ({
        item,
        weight:
          (cfg.cue_weights[c.kind] / c.items.length) *
          item.salience *
          Math.max(0, 1 + cfg.mood_bias * item.valence * mood) *
          (used.has(item.id) ? cfg.recent_penalty : 1),
      })),
    )
    .sort((a, b) => a.item.id.localeCompare(b.item.id));
  if (!pool.length) return null;
  const total = pool.reduce((sum, p) => sum + p.weight, 0);
  if (total === 0) return pool[Math.floor(roll * pool.length)]!.item;
  let position = roll * total;
  for (const p of pool) {
    position -= p.weight;
    if (position < 0) return p.item;
  }
  return pool.at(-1)!.item;
}

/** The memories her last few wanderings started from or chained through. */
async function recentlyUsed(deps: CoreDeps, now: Date): Promise<Set<string>> {
  const recent = await deps.core.memory.recentThoughts(
    new Date(0),
    now,
    deps.config.core.wander.recent_outputs,
  );
  return new Set(
    recent
      .filter((t) => t.source_ref?.startsWith("core_wander:"))
      .flatMap((t) => {
        const p = (t.payload ?? {}) as { seed?: string; chain?: string[] };
        return [...(p.seed ? [p.seed] : []), ...(p.chain ?? [])];
      }),
  );
}

/** What a chain may pass through: what happened, what she loves, what she means to do. */
const LIVED: ReadonlySet<string> = new Set(["episode", "interest", "intention"]);

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
        !LIVED.has(memory.kind) ||
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
  const cues = await wanderCues(deps, now);
  if (!cues.length) return { status: "not_due", applied: false, ids: [] };
  const used = await recentlyUsed(deps, now);

  const run = await runCoreLoop<ApplyOutput>(deps, "core_wander", now, async (ctx) => {
    const state = await core.state.get();
    const seed = pickCue(
      cues,
      used,
      seededUnit(`${due.day}:wander:${due.completedToday}`),
      config.core.wander,
      state?.mood_valence ?? config.core.state.baseline.mood_valence,
    )!;
    const [query] = await ctx.deps.embedder.embed([seed.content], "query");
    if (!query) throw new Error("missing wander seed embedding");
    const chain = await chainFor(ctx.deps, seed, query);
    const persona = loadPersona(config);
    const tz = lifeTimezone(config.life, now);
    const self = await latestSelf(core.memory, persona.seedSelf, now, tz);
    const dated = (m: CoreMemoryItem) =>
      `${m.content} (${dayInWords(m.occurred_at ?? m.created_at, now, tz)})`;
    const goals = await core.goals.active();
    const input = [
      `Seed memory: ${dated(seed)}`,
      `Associated memories: ${chain.length ? chain.map(dated).join("\n") : "none"}`,
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
