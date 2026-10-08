/** Nightly core memory decay and one bounded gist of older resolved episodes. */
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import type { CoreDeps } from "@/mind/platform/deps";
import type { LoopStatus } from "@/mind/platform/core";
import { errorName } from "@/mind/platform/errors";
import { loadPrompt } from "@/mind/platform/prompts";
import { lifeDate, lifeTimezone } from "@/mind/world/her-clock";
import { runCoreLoop } from "./runner";
import { DAY } from "@/mind/platform/time";

function daysBefore(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - count);
  return date.toISOString().slice(0, 10);
}

export async function coreConsolidate(deps: CoreDeps, now: Date): Promise<LoopStatus> {
  const { config, core } = deps;
  const timezone = lifeTimezone(config.life, now);
  const day = lifeDate(config.life, now);
  const bounds = config.core.consolidate;
  const cutoff = new Date(now.getTime() - config.core.decay.grace_days * DAY);
  try {
    await core.memory.decay(cutoff, config.core.decay.rate, config.core.decay.stale_floor);
  } catch (error) {
    await core.traces.insert({
      id: randomUUID(),
      loop: "core_consolidate",
      inputs: {},
      outputs: {},
      prompt_version: null,
      status: "failed",
      error: errorName(error),
      created_at: now,
      calls: 0,
      model: null,
      tokens_in: null,
      tokens_out: null,
      cost: null,
    });
    throw error;
  }

  const run = await runCoreLoop<{ gist_id: string | null; source_ids: string[] }>(
    deps,
    "core_consolidate",
    now,
    async (ctx) => {
      const beforeDay = daysBefore(day, bounds.gist_after_days);
      const [group] = await core.memory.eligibleGistGroups(
        beforeDay,
        timezone,
        bounds.min_group,
        bounds.max_groups,
      );
      if (!group) return { inputs: { week: null }, outputs: { gist_id: null, source_ids: [] } };
      const ids = group.sources.map((source) => source.id);
      const Output = z.object({ gist: z.string().trim().min(1).max(config.core.loops.max_chars) });
      let gist: string;
      try {
        ({ gist } = await ctx.deps.llm.classifyJson({
          purpose: "core_consolidate",
          model: "core",
          system: loadPrompt("core/consolidate", config.prompts.core_consolidate),
          input: JSON.stringify({
            week: group.week,
            sources: group.sources.map(({ id, content, occurred_at }) => ({
              id,
              content,
              occurred_at,
            })),
          }),
          schema: Output,
          timeoutMs: config.models.structured_timeout_ms,
          maxTokens: bounds.max_tokens,
        }));
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        return {
          status: "fallback",
          inputs: { week: group.week, source_ids: ids },
          outputs: { gist_id: null, source_ids: [] },
          promptVersion: config.prompts.core_consolidate,
        };
      }
      const [embedding] = await deps.embedder.embed([gist], "document");
      return ctx.commit<{ gist_id: string | null; source_ids: string[] }>(async (tx) => {
        const [current] = await tx.memory.eligibleGistGroups(
          beforeDay,
          timezone,
          bounds.min_group,
          bounds.max_groups,
        );
        if (
          !current ||
          current.week !== group.week ||
          ids.some((id) => !current.sources.some((source) => source.id === id))
        ) {
          return {
            inputs: { week: group.week, source_ids: ids },
            outputs: { gist_id: null, source_ids: [] },
            promptVersion: config.prompts.core_consolidate,
          };
        }
        const gistId = await tx.memory.insert({
          kind: "episode",
          content: gist,
          payload: { gist_of: ids },
          embedding: embedding!,
          occurred_at: group.sources[0]!.occurred_at,
          created_at: now,
          status: "recurring",
          salience: Math.max(...group.sources.map((source) => source.salience)),
          valence: 0,
          confidence: 0.6,
          source: "loop",
          source_ref: `core_consolidate:${ctx.traceId}`,
        });
        if (
          !(await tx.memory.gistSources(
            ids,
            gistId,
            bounds.gist_source_factor,
            beforeDay,
            timezone,
            bounds.min_group,
          ))
        )
          throw new Error("gist sources changed during consolidation");
        return {
          inputs: { week: group.week, source_ids: ids },
          outputs: { gist_id: gistId, source_ids: ids },
          promptVersion: config.prompts.core_consolidate,
        };
      });
    },
  );
  return run.status;
}
