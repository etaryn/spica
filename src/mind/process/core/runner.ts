/**
 * How a core loop calls a model: within her daily call budget, metered, and traced once per run.
 * Each call first reserves a slot in her local day's budget row, so the budget holds across jobs,
 * restarts and overlapping runs. Optional loops stop while a reserve is left for the essential
 * ones; essential loops that can fall back always run and are told whether they may still call;
 * the rest are skipped. A call refused mid-run (another job spent the last slot) throws
 * `BudgetSpentError`, which the loop may catch to fall back; uncaught, the run is traced as
 * skipped. Any other failure is traced with its class and rethrown.
 */
import { randomUUID } from "node:crypto";
import type { Config, CoreLoopName } from "@/mind/platform/config";
import type { LoopStatus, NewCoreLoopTrace } from "@/mind/platform/core";
import type { CoreScope } from "@/mind/platform/core";
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import type { LLMProvider, LlmUsage } from "@/mind/platform/llm/types";
import { localMidnight } from "@/mind/platform/timezone";
import { lifeDate, lifeTimezone } from "@/mind/world/her-clock";

export type LoopContext = {
  /** The loop's deps, with the model metered. */
  deps: CoreDeps;
  /** This run's trace id, for `source_ref`s written before the trace row exists. */
  traceId: string;
  /** Whether one more model call fits today's budget for this loop's tier. */
  canCall(): boolean;
  /** Apply writes and record successful completion in the same core transaction. */
  commit<T>(apply: (tx: CoreScope) => Promise<LoopResult<T>>): Promise<LoopResult<T>>;
};

export type LoopResult<T> = {
  status?: "done" | "fallback";
  inputs: unknown;
  outputs: T;
  promptVersion?: string | null;
};

/** Loops that have a code fallback, so they run even over budget. */
const FALLS_BACK: ReadonlySet<CoreLoopName> = new Set([
  "life_plan",
  "life_event",
  "core_resolve",
  "core_appraise",
]);

export function budgetDayStart(config: Config, now: Date): Date {
  return localMidnight(lifeDate(config.life, now), lifeTimezone(config.life, now));
}

/** Today's budget ran out between the loop's check and its call. */
export class BudgetSpentError extends Error {}

function meterLlm(llm: LLMProvider, reserve: () => Promise<boolean>) {
  const usage: LlmUsage[] = [];
  let calls = 0;
  const metered: LLMProvider = {
    async generateReply() {
      throw new Error("core loops never call the reply model");
    },
    async classifyJson(request) {
      if (!(await reserve())) throw new BudgetSpentError(`${request.purpose}: budget spent`);
      calls += 1;
      return llm.classifyJson({
        ...request,
        onUsage: (u) => {
          request.onUsage?.(u);
          usage.push(u);
        },
      });
    },
  };
  return { llm: metered, usage, calls: () => calls };
}

function spend(usage: LlmUsage[], config: Config) {
  if (!usage.length) return { model: null, tokens_in: null, tokens_out: null, cost: null };
  const tokensIn = usage.reduce((sum, u) => sum + u.input_tokens, 0);
  const tokensOut = usage.reduce((sum, u) => sum + u.output_tokens, 0);
  let cost: number | null = 0;
  for (const u of usage) {
    const price = config.core.prices[u.model];
    if (!price || cost === null) {
      cost = null;
      continue;
    }
    cost += (u.input_tokens * price.input + u.output_tokens * price.output) / 1_000_000;
  }
  return { model: usage.at(-1)!.model, tokens_in: tokensIn, tokens_out: tokensOut, cost };
}

export async function runCoreLoop<T>(
  deps: CoreDeps,
  name: CoreLoopName,
  now: Date,
  fn: (ctx: LoopContext) => Promise<LoopResult<T>>,
): Promise<{ status: LoopStatus; outputs: T | null }> {
  const { config, core } = deps;
  const optional = config.core.loop_priority.optional.includes(name);
  const limit = config.core.daily_call_budget - (optional ? config.core.budget_reserve : 0);
  const day = lifeDate(config.life, now);
  const spent = await core.traces.callsOn(day);
  const meter = meterLlm(deps.llm, () => core.traces.reserveCall(day, limit));
  const canCall = () => spent + meter.calls() < limit;
  const traceId = randomUUID();
  const trace = (fields: Partial<NewCoreLoopTrace> & Pick<NewCoreLoopTrace, "status">) =>
    core.traces.insert({
      id: traceId,
      loop: name,
      inputs: {},
      outputs: {},
      prompt_version: null,
      error: null,
      created_at: now,
      calls: meter.calls(),
      ...spend(meter.usage, config),
      ...fields,
    });

  if (!canCall() && !FALLS_BACK.has(name)) {
    await trace({ status: "skipped_budget", inputs: { spent, limit } });
    return { status: "skipped_budget", outputs: null };
  }

  let result: LoopResult<T>;
  let commitStarted = false;
  let committed = false;
  const commit: LoopContext["commit"] = async (apply) => {
    if (commitStarted) throw new Error("core loop already committed");
    commitStarted = true;
    const applied = await core.transaction(async (tx) => {
      const value = await apply(tx);
      await tx.traces.insert({
        id: traceId,
        loop: name,
        inputs: value.inputs,
        outputs: value.outputs,
        prompt_version: value.promptVersion ?? null,
        status: value.status ?? "done",
        error: null,
        created_at: now,
        calls: meter.calls(),
        ...spend(meter.usage, config),
      });
      return value;
    });
    committed = true;
    return applied;
  };
  try {
    result = await fn({ deps: { ...deps, llm: meter.llm }, traceId, canCall, commit });
  } catch (error) {
    if (committed) throw error;
    if (error instanceof BudgetSpentError) {
      await trace({ status: "skipped_budget", inputs: { spent, limit } });
      return { status: "skipped_budget", outputs: null };
    }
    await trace({ status: "failed", error: errorName(error) });
    throw error;
  }
  const status = result.status ?? "done";
  if (!committed) {
    await trace({
      status,
      inputs: result.inputs,
      outputs: result.outputs,
      prompt_version: result.promptVersion ?? null,
    });
  }
  return { status, outputs: result.outputs };
}
