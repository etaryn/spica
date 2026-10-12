/**
 * Her reflection on one user after a big event: one thing she has noticed about them or about
 * the two of them, in her own words, or nothing when nothing new stands out. It is an ordinary
 * memory afterwards, recalled when a conversation makes it relevant.
 */
import { z } from "zod";
import { insertFact } from "@/db/repos/user/facts";
import { liveSummary, recentReflections, type Trigger } from "@/db/repos/user/user-mind";
import { isSensitive } from "@/mind/memory/user/retrieve";
import { fitText } from "@/mind/platform/llm/fit";
import { loadPrompt } from "@/mind/platform/prompts";
import { loadRelationshipSummary } from "@/mind/state/user/relationship/summary";
import { memoryLines, triggerText, type RunInputs } from "./inputs";
import { runUserLoop, type UserLoopDeps } from "./runner";

export async function userReflect(
  deps: UserLoopDeps,
  run: { id: string; user_id: string; triggers: unknown },
  inputs: RunInputs,
): Promise<"done" | "failed"> {
  const { config, db } = deps;
  const settings = config.user_mind.reflect;
  const userId = run.user_id;
  return runUserLoop(deps, run, "user_reflect", async (ctx) => {
    const summary = await liveSummary(db, userId);
    const earlier = await recentReflections(db, userId, settings.recent);
    const now = deps.clock.now();
    const Output = z.object({
      reflection: fitText(settings.max_chars).nullable(),
      subject: z.enum(["user", "shared"]),
    });
    const out = await ctx.deps.llm.classifyJson({
      purpose: "user_reflect",
      model: "user_mind",
      system: loadPrompt("user-mind/reflect", config.prompts.user_reflect),
      input: JSON.stringify({
        who_you_are: deps.snapshot,
        summary: summary?.payload ?? null,
        what_happened: (run.triggers as Trigger[]).map(triggerText),
        you_and_them: await loadRelationshipSummary(deps, userId, now),
        new_memories: memoryLines(inputs.facts),
        already_noticed: earlier.map((r) => r.content),
      }),
      schema: Output,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: settings.max_tokens,
    });
    let reflectionId: string | null = null;
    if (out.reflection) {
      const [embedding] = await deps.embedder.embed([out.reflection], "document");
      // Anything she read that a crisis touched marks what she writes from it.
      const sensitive =
        inputs.facts.some((f) => f.sensitive) ||
        (!!summary && isSensitive(summary)) ||
        earlier.some(isSensitive);
      const row = await insertFact(db, userId, {
        subject: out.subject,
        kind: "reflection",
        content: out.reflection,
        payload: sensitive ? { sensitive: true } : null,
        embedding: embedding!,
        created_at: now,
        status: "open",
        salience: settings.salience,
        valence: 0,
        confidence: settings.confidence,
        source: "generated",
        source_ref: `user_reflect:${ctx.traceId}`,
      });
      reflectionId = row.id;
    }
    return {
      inputs: {
        summary_id: summary?.id ?? null,
        fact_ids: inputs.facts.map((f) => f.id),
        reflection_ids: earlier.map((r) => r.id),
      },
      outputs: { reflection_id: reflectionId },
      written: reflectionId ? [{ id: reflectionId, kind: "reflection" }] : [],
      promptVersion: config.prompts.user_reflect,
    };
  });
}
