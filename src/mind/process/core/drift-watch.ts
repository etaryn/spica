/** Record snapshot change and value drift without blocking the new self description. */
import { z } from "zod";
import type { CoreDeps } from "@/mind/platform/deps";
import type { LoopStatus } from "@/mind/platform/core";
import { fitText } from "@/mind/platform/llm/fit";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { cosine } from "@/mind/platform/math";
import { runCoreLoop } from "./runner";

export async function coreDriftWatch(
  deps: CoreDeps,
  now: Date,
  version: number,
): Promise<LoopStatus> {
  const { core, config } = deps;
  if (version < 1) return "done";
  const current = await core.memory.snapshot(version);
  const previous = await core.memory.snapshot(version - 1);
  if (!current || !previous || (await core.memory.latestSnapshot())?.version !== version)
    return "done";

  await core.transaction(async (tx) => {
    await tx.lock(`core_drift_watch:${version}`);
    const existing = await tx.drift.forVersion(version);
    if (current.embedding && previous.embedding && !existing.some((row) => row.check === "diff")) {
      const names = new Set([...Object.keys(previous.sections), ...Object.keys(current.sections)]);
      const changed = [...names].filter(
        (name) => previous.sections[name] !== current.sections[name],
      ).length;
      await tx.drift.insert({
        version,
        check: "diff",
        value: null,
        excerpt: `${changed}/${names.size} sections changed (${Math.round((changed / names.size) * 100)}%)`,
        verdict: null,
        score: 1 - cosine(current.embedding, previous.embedding),
        created_at: now,
      });
    }
    const seed = await tx.memory.snapshot(0);
    if (current.embedding && seed?.embedding && !existing.some((row) => row.check === "trend")) {
      await tx.drift.insert({
        version,
        check: "trend",
        value: null,
        excerpt: null,
        verdict: null,
        score: 1 - cosine(current.embedding, seed.embedding),
        created_at: now,
      });
    }
  });

  if ((await core.drift.forVersion(version)).some((row) => row.check === "values")) return "done";
  const text = fitText(config.core.loops.max_chars);
  const Output = z.object({
    findings: z.array(
      z.object({
        value: text,
        excerpt: text,
        verdict: z.enum(["contradicts", "strains"]),
      }),
    ),
  });
  const persona = loadPersona(config);
  const run = await runCoreLoop(deps, "core_drift_watch", now, async (ctx) => {
    const { findings } = await ctx.deps.llm.classifyJson({
      purpose: "core_drift_watch",
      model: "core",
      system: loadPrompt("core/drift", config.prompts.core_drift),
      input: JSON.stringify({ core_values: persona.coreValues, snapshot: current.content }),
      schema: Output,
      timeoutMs: config.models.core_timeout_ms,
      maxTokens: config.core.drift.max_tokens,
    });
    return ctx.commit(async (tx) => {
      await tx.lock(`core_drift_watch:${version}`);
      if (!(await tx.drift.forVersion(version)).some((row) => row.check === "values")) {
        for (const finding of findings.length
          ? findings
          : [{ value: null, excerpt: null, verdict: "ok" as const }]) {
          await tx.drift.insert({
            version,
            check: "values",
            value: finding.value,
            excerpt: finding.excerpt,
            verdict: finding.verdict,
            score: null,
            created_at: now,
          });
        }
      }
      return {
        inputs: { version },
        outputs: { findings: findings.length },
        promptVersion: config.prompts.core_drift,
      };
    });
  });
  return run.status;
}
