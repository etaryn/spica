/**
 * How a user loop calls a model: metered and traced once per run, scoped to one user. User loops
 * have no call budget of their own: the daily cap on runs per user is their budget. They get no
 * core layer, only her latest snapshot as text, so a user loop cannot write her core self.
 */
import { randomUUID } from "node:crypto";
import { insertLoopTrace } from "@/db/repos/user/user-mind";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { meterLlm, spend } from "@/mind/platform/llm/meter";
import type { LLMProvider } from "@/mind/platform/llm/types";

export type UserLoopName =
  "user_summarise" | "user_reflect" | "user_model" | "user_ideate" | "user_consolidate";
export type UserLoopDeps = Pick<
  Deps,
  "db" | "embedder" | "config" | "clock" | "log" | "modules"
> & {
  llm: LLMProvider;
  /** Her latest self snapshot, read once per run; null before one exists. */
  snapshot: string | null;
};
export type UserLoopResult = {
  inputs: unknown;
  outputs: unknown;
  promptVersion: string | null;
  /** Fact rows the loop wrote and committed, announced once its trace is in. */
  written?: { id: string; kind: string }[];
};

export async function runUserLoop(
  deps: UserLoopDeps,
  run: { id: string; user_id: string },
  name: UserLoopName,
  fn: (ctx: { deps: UserLoopDeps; traceId: string }) => Promise<UserLoopResult>,
): Promise<"done" | "failed"> {
  const meter = meterLlm(deps.llm, { maxRetries: deps.config.core.max_retries });
  const traceId = randomUUID();
  const base = {
    id: traceId,
    user_id: run.user_id,
    run_id: run.id,
    loop: name,
    created_at: deps.clock.now(),
  };
  try {
    const result = await fn({ deps: { ...deps, llm: meter.llm }, traceId });
    await insertLoopTrace(deps.db, {
      ...base,
      inputs: result.inputs,
      outputs: result.outputs,
      prompt_version: result.promptVersion,
      status: "done",
      error: null,
      calls: meter.calls(),
      ...spend(meter.usage, deps.config.core.prices),
    });
    for (const f of result.written ?? [])
      await deps.modules.emit({
        type: "fact.written",
        userId: run.user_id,
        factId: f.id,
        kind: f.kind,
      });
    return "done";
  } catch (error) {
    deps.log.error("user loop failed", {
      userId: run.user_id,
      loop: name,
      error: errorName(error),
    });
    await insertLoopTrace(deps.db, {
      ...base,
      inputs: {},
      outputs: {},
      prompt_version: null,
      status: "failed",
      error: errorName(error),
      calls: meter.calls(),
      ...spend(meter.usage, deps.config.core.prices),
    });
    return "failed";
  }
}
