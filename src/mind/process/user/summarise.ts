/**
 * Her summary of where things stand with one user: the relationship, what's live, and how she
 * feels about them. Written after a big event from this user's memories, the phrased relationship
 * and her latest self, and read in her next replies. A new summary supersedes the last; a failed
 * run writes nothing and the old one stays.
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { insertFact, setFactStatus } from "@/db/repos/user/facts";
import { listOpenThreads } from "@/db/repos/user/threads";
import { liveSummary, type Trigger } from "@/db/repos/user/user-mind";
import { isSensitive } from "@/mind/memory/user/retrieve";
import { fitText } from "@/mind/platform/llm/fit";
import { loadPrompt } from "@/mind/platform/prompts";
import { loadRelationshipSummary } from "@/mind/state/user/relationship/summary";
import { nowLine } from "@/mind/platform/time-anchors";
import { zoneOrUtc } from "@/mind/platform/timezone";
import { lifeTimezone } from "@/mind/world/her-clock";
import { noteRefs, noteTimesSchema, withNoteRules, writeNote } from "@/mind/platform/notes";
import { citables, earlierMemories, stampedNote, triggerText, type RunInputs } from "./inputs";
import { runUserLoop, type UserLoopDeps } from "./runner";

export async function userSummarise(
  deps: UserLoopDeps,
  run: { id: string; user_id: string; triggers: unknown },
  inputs: RunInputs,
): Promise<"done" | "failed"> {
  const { config, db } = deps;
  const settings = config.user_mind.summarise;
  const userId = run.user_id;
  return runUserLoop(deps, run, "user_summarise", async (ctx) => {
    const { previous, facts } = inputs;
    // A sensitive storyline's title can carry what the sensitive fact says, and a title doesn't
    // mark the summary the way a sensitive memory does, so those storylines stay out.
    const threads = await listOpenThreads(db, userId, settings.max_threads, {
      excludeSensitive: true,
    });
    const now = deps.clock.now();
    const FIELDS = ["where_things_stand", "whats_live", "how_i_feel"] as const;
    const Output = z.object({
      where_things_stand: fitText(settings.max_chars),
      whats_live: fitText(settings.max_chars),
      how_i_feel: fitText(settings.max_chars),
      times: noteTimesSchema(FIELDS),
    });
    const earlier = await earlierMemories(db, userId, [previous], {
      exclude: facts.map((f) => f.id),
      clean: inputs.clean,
    });
    const shown = citables(facts, earlier, threads, inputs.timezone);
    const zone = zoneOrUtc(inputs.timezone);
    const out = await ctx.deps.llm.classifyJson({
      purpose: "user_summarise",
      model: "user_mind",
      system: withNoteRules(
        loadPrompt("user-mind/summarise", config.prompts.user_summarise),
        config.prompts.notes,
      ),
      input: JSON.stringify({
        now: nowLine(now, zone, lifeTimezone(config.life, now)),
        who_you_are: deps.snapshot,
        previous: stampedNote(previous, inputs.timezone),
        what_happened: (run.triggers as Trigger[]).map(triggerText),
        you_and_them: await loadRelationshipSummary(deps, userId, now),
        new_memories: shown.new_memories,
        earlier_memories: shown.earlier_memories,
        open_threads: shown.open_threads,
      }),
      schema: Output,
      timeoutMs: config.models.user_mind_timeout_ms,
      maxTokens: settings.max_tokens,
    });
    const note = writeNote(
      {
        where_things_stand: out.where_things_stand,
        whats_live: out.whats_live,
        how_i_feel: out.how_i_feel,
      },
      out.times,
      shown.items,
      { now, zone },
    );
    const content = FIELDS.map((f) => note.fields[f]).join(" ");
    const [embedding] = await deps.embedder.embed([content], "document");
    // What a crisis told her stays out of anything a reach-out reads; a summary carries its
    // previous one forward, so it inherits the mark.
    const sensitive =
      [...facts, ...earlier].some((f) => f.sensitive) || (!!previous && isSensitive(previous));
    const summaryId = await db.transaction(async (tx) => {
      // The lock serialises runs for one user, so two can't both leave a live summary; then
      // re-read: a summary written meanwhile is the one to supersede.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`user_mind:${userId}`}))`);
      const current = await liveSummary(tx, userId);
      const row = await insertFact(tx, userId, {
        subject: "shared",
        kind: "summary",
        content,
        payload: { ...note.fields, ...noteRefs(note), ...(sensitive ? { sensitive: true } : {}) },
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
      inputs: {
        previous_id: previous?.id ?? null,
        fact_ids: facts.map((f) => f.id),
        earlier_ids: earlier.map((f) => f.id),
      },
      outputs: { summary_id: summaryId, dropped: note.dropped },
      written: [{ id: summaryId, kind: "summary" }],
      promptVersion: config.prompts.user_summarise,
    };
  });
}
