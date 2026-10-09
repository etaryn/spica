/**
 * Her idea for one user after a big event: one thing she wants to bring up with them next time,
 * or nothing. An idea gets one chance, in her next reply or as a reason to write first, and
 * expires unused after a few days. Ideas can become reach-outs and push notifications, so ideate
 * never reads anything a crisis touched.
 */
import { z } from "zod";
import { insertFact } from "@/db/repos/user/facts";
import { listOpenThreads } from "@/db/repos/user/threads";
import { latestNonSensitiveSummary, liveIdeas, recentReflections } from "@/db/repos/user/user-mind";
import { isSensitive } from "@/mind/memory/user/retrieve";
import { fitText } from "@/mind/platform/llm/fit";
import { loadPrompt } from "@/mind/platform/prompts";
import { DAY } from "@/mind/platform/time";
import { memoryLines, type RunInputs } from "./inputs";
import { runUserLoop, type UserLoopDeps } from "./runner";

/** Ideas created at or before this are past their chance. */
export function ideaCutoff(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() - ttlDays * DAY);
}

export async function userIdeate(
  deps: UserLoopDeps,
  run: { id: string; user_id: string; created_at: Date },
  inputs: RunInputs,
): Promise<"done" | "failed"> {
  const { config, db } = deps;
  const settings = config.user_mind.ideate;
  const userId = run.user_id;
  return runUserLoop(deps, run, "user_ideate", async (ctx) => {
    const now = deps.clock.now();
    const facts = inputs.facts.filter((f) => !f.sensitive);
    const summary = await latestNonSensitiveSummary(db, userId);
    // This run's reflection, if reflect wrote one: an older one isn't news.
    const [latest] = await recentReflections(db, userId, 1);
    const noticed =
      latest && latest.created_at >= run.created_at && !isSensitive(latest) ? latest : null;
    const planned = await liveIdeas(
      db,
      userId,
      ideaCutoff(now, settings.ttl_days),
      settings.max_planned,
    );
    // A sensitive storyline's title can carry what the sensitive fact says.
    const threads = await listOpenThreads(db, userId, config.user_mind.summarise.max_threads, {
      excludeSensitive: true,
    });
    const Output = z.object({ idea: fitText(settings.max_chars).nullable() });
    const out = await ctx.deps.llm.classifyJson({
      purpose: "user_ideate",
      model: "user_mind",
      system: loadPrompt("user-mind/ideate", config.prompts.user_ideate),
      input: JSON.stringify({
        who_you_are: deps.snapshot,
        summary: summary?.payload ?? null,
        noticed: noticed?.content ?? null,
        new_memories: memoryLines(facts),
        open_threads: threads.map((t) => t.title),
        already_planned: planned.map((i) => i.content),
      }),
      schema: Output,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: settings.max_tokens,
    });
    let ideaId: string | null = null;
    if (out.idea) {
      const [embedding] = await deps.embedder.embed([out.idea], "document");
      const row = await insertFact(db, userId, {
        subject: "shared",
        kind: "idea",
        content: out.idea,
        embedding: embedding!,
        created_at: now,
        status: "open",
        salience: settings.salience,
        valence: 0,
        confidence: settings.confidence,
        source: "generated",
        source_ref: `user_ideate:${ctx.traceId}`,
      });
      ideaId = row.id;
    }
    return {
      inputs: {
        summary_id: summary?.id ?? null,
        reflection_id: noticed?.id ?? null,
        fact_ids: facts.map((f) => f.id),
        planned_ids: planned.map((i) => i.id),
      },
      outputs: { idea_id: ideaId },
      promptVersion: config.prompts.user_ideate,
    };
  });
}
