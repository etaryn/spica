/**
 * Her summary of where things stand with one user: the relationship, what's live, and how she
 * feels about them. Written after a big event from this user's memories, the phrased relationship
 * and her latest self, and read in her next replies. A new summary supersedes the last; a failed
 * run writes nothing and the old one stays.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { insertFact, listFactsForSummary, setFactStatus } from "@/db/repos/user/facts";
import { listOpenThreads } from "@/db/repos/user/threads";
import { liveSummary, type Trigger } from "@/db/repos/user/user-mind";
import { fitText } from "@/mind/platform/llm/fit";
import { loadPrompt } from "@/mind/platform/prompts";
import { loadRelationshipSummary } from "@/mind/state/user/relationship/summary";
import { runUserLoop, type UserLoopDeps } from "./runner";

function triggerText(t: Trigger): string {
  switch (t.kind) {
    case "param_jump":
      return `${t.param} between you just ${t.to > t.from ? "rose" : "fell"} sharply`;
    case "param_band":
      return `${t.param} between you just ${t.to > t.from ? "rose" : "fell"}`;
    case "salient_fact":
      return "they told you something important";
    case "make_up_done":
      return "you two made up after a hurt";
  }
}

export async function userSummarise(
  deps: UserLoopDeps,
  run: { id: string; user_id: string; triggers: unknown },
): Promise<"done" | "failed"> {
  const { config, db } = deps;
  const settings = config.user_mind.summarise;
  const userId = run.user_id;
  return runUserLoop(deps, run, "user_summarise", async (ctx) => {
    const previous = await liveSummary(db, userId);
    const facts = await listFactsForSummary(
      db,
      userId,
      previous?.created_at ?? null,
      settings.max_facts,
    );
    const threads = await listOpenThreads(db, userId, settings.max_threads);
    const now = deps.clock.now();
    const Output = z.object({
      where_things_stand: fitText(settings.max_chars),
      whats_live: fitText(settings.max_chars),
      how_i_feel: fitText(settings.max_chars),
    });
    const out = await ctx.deps.llm.classifyJson({
      purpose: "user_summarise",
      model: "user_mind",
      system: loadPrompt("user-mind/summarise", config.prompts.user_summarise),
      input: JSON.stringify({
        who_you_are: deps.snapshot,
        previous: previous?.payload ?? null,
        what_happened: (run.triggers as Trigger[]).map(triggerText),
        you_and_them: await loadRelationshipSummary(deps, userId, now),
        new_memories: facts.map(({ subject, kind, content }) => ({ subject, kind, content })),
        open_threads: threads.map((t) => t.title),
      }),
      schema: Output,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: settings.max_tokens,
    });
    const content = [out.where_things_stand, out.whats_live, out.how_i_feel].join(" ");
    const [embedding] = await deps.embedder.embed([content], "document");
    const summaryId = await db.transaction(async (tx) => {
      // The lock serialises runs for one user, so two can't both leave a live summary; then
      // re-read: a summary written meanwhile is the one to supersede.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`user_mind:${userId}`}))`);
      const current = await liveSummary(tx, userId);
      const row = await insertFact(tx, userId, {
        subject: "shared",
        kind: "summary",
        content,
        payload: out,
        embedding: embedding!,
        created_at: now,
        status: "open",
        salience: settings.salience,
        valence: 0,
        confidence: settings.confidence,
        source: "generated",
        source_ref: `user_summarise:${ctx.traceId}`,
      });
      if (current) await setFactStatus(tx, userId, current.id, "superseded", row.id);
      return row.id;
    });
    return {
      inputs: { previous_id: previous?.id ?? null, fact_ids: facts.map((f) => f.id) },
      outputs: { summary_id: summaryId },
      promptVersion: config.prompts.user_summarise,
    };
  });
}
