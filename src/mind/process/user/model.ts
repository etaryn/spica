/**
 * Her read on one user after a big event: how they are lately, what they want, and what lands
 * with them, kept as one live read she replaces each time; plus a few standing beliefs about them
 * that she revises when she learns better. The read has its own place in her replies; beliefs
 * come back through ordinary recall.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { insertFact, setFactStatus } from "@/db/repos/user/facts";
import {
  latestNonSensitiveModel,
  latestNonSensitiveSummary,
  liveBeliefs,
  liveModel,
  liveSummary,
  nearestBeliefSimilarity,
  recentReflections,
  supersedeBelief,
  type Trigger,
} from "@/db/repos/user/user-mind";
import { isSensitive } from "@/mind/memory/user/retrieve";
import { fitList, fitText } from "@/mind/platform/llm/fit";
import { loadPrompt } from "@/mind/platform/prompts";
import { loadRelationshipSummary } from "@/mind/state/user/relationship/summary";
import { nowLine, written } from "@/mind/platform/time-anchors";
import { lifeTimezone } from "@/mind/world/her-clock";
import { zoneOrUtc } from "@/mind/platform/timezone";
import { memoryLines, stampedNote, triggerText, visible, type RunInputs } from "./inputs";
import { runUserLoop, type UserLoopDeps } from "./runner";

export const modelPayload = z.object({
  how_they_are: z.string(),
  what_they_want: z.string(),
  what_lands: z.string(),
});
export type ModelPayload = z.infer<typeof modelPayload>;

export async function userModel(
  deps: UserLoopDeps,
  run: { id: string; user_id: string; triggers: unknown; created_at: Date },
  inputs: RunInputs,
): Promise<"done" | "failed"> {
  const { config, db } = deps;
  const settings = config.user_mind.model;
  const userId = run.user_id;
  return runUserLoop(deps, run, "user_model", async (ctx) => {
    const now = deps.clock.now();
    const summary = inputs.clean
      ? await latestNonSensitiveSummary(db, userId)
      : await liveSummary(db, userId);
    // This run's reflection, if reflect wrote one: an older one isn't news.
    const [latest] = visible(inputs, await recentReflections(db, userId, 1));
    const noticed = latest && latest.created_at >= run.created_at ? latest : null;
    const previous = inputs.clean
      ? await latestNonSensitiveModel(db, userId)
      : await liveModel(db, userId);
    const beliefs = visible(inputs, await liveBeliefs(db, userId, settings.belief_context));
    const previousRead = previous ? modelPayload.safeParse(previous.payload).data : undefined;
    const Output = z.object({
      how_they_are: fitText(settings.max_chars),
      what_they_want: fitText(settings.max_chars),
      what_lands: fitText(settings.max_chars),
      beliefs: fitList(
        z.object({ text: fitText(settings.max_chars), replaces: z.string().nullable() }),
        settings.max_beliefs,
      ),
    });
    const out = await ctx.deps.llm.classifyJson({
      purpose: "user_model",
      model: "user_mind",
      system: loadPrompt("user-mind/model", config.prompts.user_model),
      input: JSON.stringify({
        now: nowLine(now, zoneOrUtc(inputs.timezone), lifeTimezone(config.life, now)),
        who_you_are: deps.snapshot,
        summary: stampedNote(summary, inputs.timezone),
        noticed: noticed?.content ?? null,
        what_happened: (run.triggers as Trigger[]).map(triggerText),
        you_and_them: await loadRelationshipSummary(deps, userId, now),
        new_memories: memoryLines(inputs.facts, inputs.timezone),
        previous_read: previousRead
          ? {
              written: written(previous!.created_at, zoneOrUtc(inputs.timezone)),
              ...previousRead,
            }
          : null,
        beliefs: beliefs.map((b) => ({ id: b.id, text: b.content })),
      }),
      schema: Output,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: settings.max_tokens,
    });
    const read: ModelPayload = {
      how_they_are: out.how_they_are,
      what_they_want: out.what_they_want,
      what_lands: out.what_lands,
    };
    const content = `How they are: ${read.how_they_are} What they want: ${read.what_they_want} What lands: ${read.what_lands}`;
    // Anything she read that a crisis touched marks what she writes from it.
    const sensitive =
      inputs.facts.some((f) => f.sensitive) ||
      [summary, noticed, previous, ...beliefs].some((f) => !!f && isSensitive(f));
    const mark = sensitive ? { sensitive: true } : {};
    const [modelVec, ...beliefVecs] = await deps.embedder.embed(
      [content, ...out.beliefs.map((b) => b.text)],
      "document",
    );
    const shown = new Set(beliefs.map((b) => b.id));
    const outputs = await db.transaction(async (tx) => {
      // The lock serialises runs for one user, so two can't both leave a live read.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`user_mind:${userId}`}))`);
      const current = await liveModel(tx, userId);
      const model = await insertFact(tx, userId, {
        subject: "user",
        kind: "model",
        content,
        payload: { ...read, ...mark },
        embedding: modelVec!,
        created_at: now,
        status: "open",
        salience: settings.salience,
        valence: 0,
        confidence: settings.confidence,
        source: "generated",
        source_ref: `user_model:${ctx.traceId}`,
      });
      if (current) await setFactStatus(tx, userId, current.id, "superseded", model.id);
      const written = {
        model_id: model.id,
        belief_ids: [] as string[],
        superseded_ids: [] as string[],
        dropped: [] as string[],
      };
      for (const [i, belief] of out.beliefs.entries()) {
        const embedding = beliefVecs[i]!;
        // Only a belief she was shown, and still holds, can be replaced. A correction can embed
        // close to what it corrects, so that belief is no duplicate of it.
        const replaces = belief.replaces && shown.has(belief.replaces) ? belief.replaces : null;
        const near = await nearestBeliefSimilarity(tx, userId, embedding, replaces);
        if (near !== null && near > settings.dedupe_similarity) {
          written.dropped.push(belief.text);
          continue;
        }
        const row = await insertFact(tx, userId, {
          subject: "user",
          kind: "belief",
          content: belief.text,
          payload: sensitive ? mark : null,
          embedding,
          created_at: now,
          status: "open",
          salience: settings.belief_salience,
          valence: 0,
          confidence: settings.confidence,
          source: "generated",
          source_ref: `user_model:${ctx.traceId}`,
        });
        written.belief_ids.push(row.id);
        if (replaces && (await supersedeBelief(tx, userId, replaces, row.id)))
          written.superseded_ids.push(replaces);
      }
      return written;
    });
    return {
      inputs: {
        summary_id: summary?.id ?? null,
        reflection_id: noticed?.id ?? null,
        previous_id: previous?.id ?? null,
        fact_ids: inputs.facts.map((f) => f.id),
        belief_ids: beliefs.map((b) => b.id),
      },
      outputs,
      promptVersion: config.prompts.user_model,
      written: [
        { id: outputs.model_id, kind: "model" },
        ...outputs.belief_ids.map((id) => ({ id, kind: "belief" })),
      ],
    };
  });
}
