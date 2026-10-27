/** Nightly core memory decay and one bounded gist of older resolved episodes. */
import { randomUUID } from "node:crypto";
import { z, ZodError } from "zod";
import { DepthLabel, depthOf } from "@/mind/memory/core/depth";
import type { CoreDeps } from "@/mind/platform/deps";
import type { LoopStatus } from "@/mind/platform/core";
import { errorName } from "@/mind/platform/errors";
import { fitText } from "@/mind/platform/llm/fit";
import { loadPrompt } from "@/mind/platform/prompts";
import { lifeDate, lifeTimezone } from "@/mind/world/her-clock";
import { runCoreLoop } from "./runner";
import { DAY } from "@/mind/platform/time";
import { shiftLocalDate } from "@/mind/platform/timezone";
import { coreCitables } from "@/mind/memory/core/citables";
import { noteTimesSchema, withNoteRules, writeNote } from "@/mind/platform/notes";
import { nowLine } from "@/mind/platform/time-anchors";

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
      const beforeDay = shiftLocalDate(day, -bounds.gist_after_days);
      const [group] = await core.memory.eligibleGistGroups(
        beforeDay,
        timezone,
        bounds.min_group,
        bounds.max_groups,
      );
      if (!group) return { inputs: { week: null }, outputs: { gist_id: null, source_ids: [] } };
      const ids = group.sources.map((source) => source.id);
      const Output = z.object({
        gist: fitText(config.core.loops.max_chars),
        depth: DepthLabel.nullable().default(null),
        times: noteTimesSchema(["gist"]).default([]),
      });
      const cite = coreCitables(group.sources, timezone);
      let out: z.infer<typeof Output>;
      try {
        out = await ctx.deps.llm.classifyJson({
          purpose: "core_consolidate",
          model: "core",
          system: withNoteRules(
            loadPrompt("core/consolidate", config.prompts.core_consolidate),
            config.prompts.core_notes,
            "core/notes",
          ),
          input: JSON.stringify({
            now: nowLine(now, timezone, timezone),
            week: group.week,
            sources: cite.lines,
          }),
          schema: Output,
          timeoutMs: config.models.core_timeout_ms,
          maxTokens: bounds.max_tokens,
        });
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        return {
          status: "fallback",
          inputs: { week: group.week, source_ids: ids },
          outputs: { gist_id: null, source_ids: [] },
          promptVersion: config.prompts.core_consolidate,
        };
      }
      // A day inside the week reads from the source it cites, so the words keep the day they meant.
      const note = writeNote({ gist: out.gist }, out.times, cite.items, { now, zone: timezone });
      const gist = note.fields.gist!;
      const judged = out.depth;
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
          payload: { gist_of: ids, ...(note.memories.length ? { cites: note.memories } : {}) },
          embedding: embedding!,
          occurred_at: group.sources[0]!.occurred_at,
          created_at: now,
          status: "recurring",
          salience: Math.max(...group.sources.map((source) => source.salience)),
          valence: 0,
          confidence: 0.6,
          // A gist reveals as much as the most private thing it remembers.
          depth: depthOf(judged, Math.max(...group.sources.map((source) => source.depth))),
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
          outputs: { gist_id: gistId, source_ids: ids, note_dropped: note.dropped },
          promptVersion: config.prompts.core_consolidate,
        };
      });
    },
  );
  return run.status;
}
