import { z } from "zod";
import { getLifeDay, insertLifeDay, listLifeDaysBefore, type LifeDayRow } from "@/db/repos/life-day";
import type { LifeBlock, LifePlan } from "@/db/schema";
import type { LifeConfig } from "../config";
import type { Deps } from "../deps";
import { errorName } from "../errors";
import { loadPrompt } from "../prompts";
import { nextLocalDate } from "../timezone";
import { lifeDate, minutesOf, weekday } from "./clock";

/** Sent to the model as the output format. No numeric bounds (unsupported); `validatePlan` enforces them. */
export const PlanSchema = z.object({
  blocks: z.array(z.object({ start: z.string(), end: z.string(), kind: z.enum(["busy", "downtime", "quiet"]), busy: z.number(), label: z.string() })),
});
export type RawPlan = z.infer<typeof PlanSchema>;
export type PlanCheck = { ok: true; plan: LifePlan } | { ok: false; violations: string[] };

const HHMM = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;

/** Design §5.2: normalise busy levels and labels, then check times, overlap, busy count and total quiet. */
export function validatePlan(raw: RawPlan, cfg: LifeConfig): PlanCheck {
  const v: string[] = [];
  const blocks: LifeBlock[] = [];
  for (const [i, b] of raw.blocks.entries()) {
    const label = b.label.trim().replace(/\s+/g, " ");
    if (!HHMM.test(b.start) || !HHMM.test(b.end)) { v.push(`block ${i + 1}: bad time ${b.start}-${b.end}`); continue; }
    if (minutesOf(b.start) >= minutesOf(b.end)) { v.push(`block ${i + 1}: start must be before end`); continue; }
    if (!label || label.length > 80) { v.push(`block ${i + 1}: label must be 1-80 characters`); continue; }
    const busy = b.kind === "quiet" ? cfg.quiet_busy
      : b.kind === "downtime" ? 0
        : Math.min(1, Math.max(cfg.min_busy, Number.isFinite(b.busy) ? b.busy : cfg.min_busy));
    blocks.push({ start: b.start, end: b.end, kind: b.kind, busy, label });
  }
  blocks.sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
  for (let i = 1; i < blocks.length; i++) {
    if (minutesOf(blocks[i]!.start) < minutesOf(blocks[i - 1]!.end)) v.push(`blocks at ${blocks[i - 1]!.start} and ${blocks[i]!.start} overlap`);
  }
  const busyCount = blocks.filter((b) => b.kind === "busy").length;
  if (busyCount < 1 || busyCount > cfg.max_busy_blocks) v.push(`busy blocks: ${busyCount} (need 1-${cfg.max_busy_blocks})`);
  const quietMin = blocks.filter((b) => b.kind === "quiet").reduce((n, b) => n + minutesOf(b.end) - minutesOf(b.start), 0);
  if (quietMin < cfg.min_quiet_hours * 60) v.push(`quiet time ${(quietMin / 60).toFixed(1)}h (need at least ${cfg.min_quiet_hours}h)`);
  return v.length ? { ok: false, violations: v } : { ok: true, plan: { blocks } };
}

/** `life.fallback_plan` with busy levels filled in: she always has a day, even when generation fails. */
export function fallbackPlan(cfg: LifeConfig): LifePlan {
  return { blocks: cfg.fallback_plan.map((b) => ({ ...b, busy: b.kind === "quiet" ? cfg.quiet_busy : b.kind === "busy" ? cfg.fallback_busy : 0 })) };
}

function describe(plan: LifePlan): string {
  return plan.blocks.map((b) => `${b.start}-${b.end} ${b.kind} (${b.label})`).join("; ");
}

export function buildPlanInput(date: string, previous: LifeDayRow[]): string {
  const prev = previous.length
    ? `Her previous days (oldest first):\n${previous.map((d) => `- ${d.date}: ${describe(d.plan)}`).join("\n")}`
    : "Her previous days: none yet.";
  return `Plan this day: ${date} (${weekday(date)}).\n\n${prev}`;
}

async function generatePlan(deps: Pick<Deps, "db" | "llm" | "config" | "log">, date: string): Promise<{ plan: LifePlan; source: "model" | "fallback" }> {
  const { config, llm, log } = deps;
  const previous = await listLifeDaysBefore(deps.db, date, config.life.plan_context_days);
  const system = `${loadPrompt("persona", config.prompts.persona)}\n\n${loadPrompt("life/plan", config.prompts.life_plan)}`;
  let input = buildPlanInput(date, previous);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await llm.classifyJson({
        purpose: "life_plan", model: "life", system, input, schema: PlanSchema,
        timeoutMs: config.models.structured_timeout_ms, maxTokens: config.life.plan_max_tokens,
      });
      const checked = validatePlan(raw, config.life);
      if (checked.ok) return { plan: checked.plan, source: "model" };
      input = `${buildPlanInput(date, previous)}\n\nYour previous plan was rejected: ${checked.violations.join("; ")}. Fix these.`;
    } catch (e) {
      log.error("life plan generation failed", { date, attempt, error: errorName(e) });
    }
  }
  return { plan: fallbackPlan(config.life), source: "fallback" };
}

/** `life_plan` job (design §5.3): make sure her today and tomorrow have a shared plan. Idempotent. */
export async function ensurePlans(deps: Pick<Deps, "db" | "llm" | "config" | "clock" | "log">, now: Date): Promise<{ created: string[] }> {
  const { db, config, clock, log } = deps;
  const today = lifeDate(config.life, now);
  const created: string[] = [];
  for (const date of [today, nextLocalDate(today)]) {
    if (await getLifeDay(db, date)) continue;
    const { plan, source } = await generatePlan(deps, date);
    const inserted = await insertLifeDay(db, {
      date, plan, source,
      model: source === "model" ? config.models.life : "none",
      prompt_version: source === "model" ? config.prompts.life_plan : "fallback",
      generated_at: clock.now(),
    });
    if (inserted) created.push(date);
    log.info("life plan", { date, source, inserted });
  }
  return { created };
}
