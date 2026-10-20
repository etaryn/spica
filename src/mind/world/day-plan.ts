/**
 * Her day plan: the busy and downtime blocks of one of her local days, at any hour (she has no
 * night), shared by every user. The `life_plan` job makes sure today and tomorrow exist. The
 * model writes the plan, code validates it with one retry, and a fallback plan means she always
 * has a day.
 */
import { z } from "zod";
import type { LifeBlock, LifePlan } from "@/db/schema";
import type { LifeConfig } from "@/mind/platform/config";
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { nextLocalDate } from "@/mind/platform/timezone";
import { runCoreLoop } from "@/mind/process/core/runner";
import { lifeDate, minutesOf, weekday } from "./her-clock";

/** The output format sent to the model. No numeric bounds (unsupported); `validatePlan` enforces them. */
const PlanSchema = z.object({
  blocks: z.array(
    z.object({
      start: z.string(),
      end: z.string(),
      kind: z.enum(["busy", "downtime"]),
      busy: z.number(),
      label: z.string(),
    }),
  ),
});

export type RawPlan = z.infer<typeof PlanSchema>;
export type PlanCheck = { ok: true; plan: LifePlan } | { ok: false; violations: string[] };

const BLOCK_TIME = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

/** Normalises busy levels and labels, then checks kinds, times, overlaps and the busy count. */
export function validatePlan(
  raw: RawPlan,
  settings: LifeConfig,
  yesterday: LifePlan | null,
): PlanCheck {
  const violations: string[] = [];
  const blocks: LifeBlock[] = [];

  for (const [i, block] of raw.blocks.entries()) {
    // Free time needs no name; an unlabelled downtime block is just a gap.
    if (block.kind === "downtime" && !tidyLabel(block.label)) continue;
    const problem = blockProblem(block, settings.plan_label_max_chars);
    if (problem) {
      violations.push(`block ${i + 1}: ${problem}`);
      continue;
    }
    blocks.push({
      start: block.start,
      end: block.end,
      kind: block.kind,
      busy: busyLevel(block, settings),
      label: tidyLabel(block.label),
    });
  }

  blocks.sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  violations.push(...overlaps(blocks));

  const busyCount = blocks.filter((b) => b.kind === "busy").length;
  if (busyCount < 1 || busyCount > settings.max_busy_blocks) {
    violations.push(`busy blocks: ${busyCount} (need 1-${settings.max_busy_blocks})`);
  }

  // Her days narrow to one template unless each must differ from the last.
  const busyLabels = (p: LifePlan) =>
    p.blocks
      .filter((b) => b.kind === "busy")
      .map((b) => b.label)
      .sort()
      .join("|");
  if (yesterday && busyLabels({ blocks }) === busyLabels(yesterday)) {
    violations.push("busy blocks are the same as yesterday: change at least one");
  }
  return violations.length ? { ok: false, violations } : { ok: true, plan: { blocks } };
}

function tidyLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

function blockProblem(block: RawPlan["blocks"][number], maxLabel: number): string | null {
  // She has no night: a quiet block, from an old plan or a model slip, is no kind she has.
  if (block.kind !== "busy" && block.kind !== "downtime")
    return `unknown kind ${String(block.kind)}`;
  if (!BLOCK_TIME.test(block.start) || !BLOCK_TIME.test(block.end)) {
    return `bad time ${block.start}-${block.end}`;
  }
  if (minutesOf(block.start) >= minutesOf(block.end)) return "start must be before end";

  const label = tidyLabel(block.label);
  if (!label || label.length > maxLabel) {
    return `label must be 1-${maxLabel} characters`;
  }
  return null;
}

/** Downtime is 0; a busy block is clamped into [min_busy, 1]. */
function busyLevel(block: RawPlan["blocks"][number], settings: LifeConfig): number {
  if (block.kind === "downtime") return 0;

  const level = Number.isFinite(block.busy) ? block.busy : settings.min_busy;
  return Math.min(1, Math.max(settings.min_busy, level));
}

/** Expects `blocks` sorted by start. */
function overlaps(blocks: LifeBlock[]): string[] {
  const found: string[] = [];
  for (let i = 1; i < blocks.length; i++) {
    const previous = blocks[i - 1]!;
    const current = blocks[i]!;
    if (minutesOf(current.start) < minutesOf(previous.end)) {
      found.push(`blocks at ${previous.start} and ${current.start} overlap`);
    }
  }
  return found;
}

/** `life.fallback_plan` with busy levels filled in. */
export function fallbackPlan(settings: LifeConfig): LifePlan {
  const busyFor = (kind: LifeBlock["kind"]) => (kind === "busy" ? settings.fallback_busy : 0);

  return {
    blocks: settings.fallback_plan.map((block) => ({ ...block, busy: busyFor(block.kind) })),
  };
}

function describePlan(plan: LifePlan): string {
  return plan.blocks.map((b) => `${b.start}-${b.end} ${b.kind} (${b.label})`).join("; ");
}

function buildPlanInput(date: string, previous: { date: string; plan: LifePlan }[]): string {
  const history = previous.length
    ? `Her previous days (oldest first):\n${previous.map((d) => `- ${d.date}: ${describePlan(d.plan)}`).join("\n")}`
    : "Her previous days: none yet.";

  return `Plan this day: ${date} (${weekday(date)}).\n\n${history}`;
}

type Generated = { plan: LifePlan; source: "model" | "fallback" };

async function generatePlan(
  deps: CoreDeps,
  date: string,
  canCall: () => boolean,
): Promise<Generated> {
  const { config, llm, log } = deps;
  const previous = await deps.core.world.plansBefore(date, config.life.plan_context_days);
  const persona = loadPersona(config).coreValues;
  const instructions = loadPrompt("life/plan", config.prompts.life_plan);
  const system = `${persona}\n\n${instructions}`;

  let input = buildPlanInput(date, previous);

  for (let attempt = 1; attempt <= config.life.plan_attempts && canCall(); attempt++) {
    try {
      const raw = await llm.classifyJson({
        purpose: "life_plan",
        model: "life",
        system,
        input,
        schema: PlanSchema,
        timeoutMs: config.models.structured_timeout_ms,
        maxTokens: config.life.plan_max_tokens,
      });

      const checked = validatePlan(raw, config.life, previous.at(-1)?.plan ?? null);
      if (checked.ok) return { plan: checked.plan, source: "model" };

      input = `${buildPlanInput(date, previous)}\n\nYour previous plan was rejected: ${checked.violations.join("; ")}. Fix these.`;
    } catch (e) {
      log.error("life plan generation failed", { date, attempt, error: errorName(e) });
    }
  }

  return { plan: fallbackPlan(config.life), source: "fallback" };
}

/**
 * The `life_plan` job: makes sure her today and tomorrow have a plan. Safe to run repeatedly. Each
 * missing day is one budgeted run; over budget, or after two failed attempts, she gets the
 * fallback plan, so she always has a day.
 */
export async function ensurePlans(deps: CoreDeps, now: Date): Promise<{ created: string[] }> {
  const { config, clock, log } = deps;
  const today = lifeDate(config.life, now);
  const created: string[] = [];

  for (const date of [today, nextLocalDate(today)]) {
    if (await deps.core.world.plan(date)) continue;

    const run = await runCoreLoop(deps, "life_plan", now, async (ctx) => {
      const { plan, source } = await generatePlan(ctx.deps, date, ctx.canCall);
      const fromModel = source === "model";
      const inserted = await ctx.deps.core.world.insertPlan({
        date,
        plan,
        source,
        model: fromModel ? config.models.life : "none",
        prompt_version: fromModel ? config.prompts.life_plan : "fallback",
        generated_at: clock.now(),
      });
      return {
        status: fromModel ? "done" : "fallback",
        inputs: { date },
        outputs: { source, inserted },
        promptVersion: config.prompts.life_plan,
      };
    });

    if (run.outputs?.inserted) created.push(date);
    log.info("life plan", { date, source: run.outputs?.source, inserted: run.outputs?.inserted });
  }

  return { created };
}
