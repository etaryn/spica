/**
 * Her reflection on one user after a big event: one thing she has noticed about them or about
 * the two of them, in her own words, or nothing when nothing new stands out. It is an ordinary
 * memory afterwards, recalled when a conversation makes it relevant.
 */
import { z } from "zod";
import { insertFact } from "@/db/repos/user/facts";
import {
  latestNonSensitiveSummary,
  liveSummary,
  recentReflections,
  type Trigger,
} from "@/db/repos/user/user-mind";
import { isSensitive } from "@/mind/memory/user/retrieve";
import { fitText } from "@/mind/platform/llm/fit";
import { loadPrompt } from "@/mind/platform/prompts";
import { loadRelationshipSummary } from "@/mind/state/user/relationship/summary";
import { nowLine } from "@/mind/platform/time-anchors";
import { zoneOrUtc } from "@/mind/platform/timezone";
import { lifeTimezone } from "@/mind/world/her-clock";
import {
  noteRefs,
  noteTimesSchema,
  onlyHers,
  withNoteRules,
  writeNote,
} from "@/mind/platform/notes";
import {
  citables,
  earlierMemories,
  stampedNote,
  triggerText,
  visible,
  type RunInputs,
} from "./inputs";
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
    const summary = inputs.clean
      ? await latestNonSensitiveSummary(db, userId)
      : await liveSummary(db, userId);
    const earlier = visible(inputs, await recentReflections(db, userId, settings.recent));
    const now = deps.clock.now();
    const Output = z.object({
      reflection: fitText(settings.max_chars).nullable(),
      subject: z.enum(["user", "shared"]),
      times: noteTimesSchema(["reflection"]),
    });
    const earlierRows = await earlierMemories(db, userId, [summary, ...earlier], {
      exclude: inputs.facts.map((f) => f.id),
      clean: inputs.clean,
    });
    const shown = citables(inputs.facts, earlierRows, [], inputs.timezone);
    const zone = zoneOrUtc(inputs.timezone);
    const out = await ctx.deps.llm.classifyJson({
      purpose: "user_reflect",
      model: "user_mind",
      system: withNoteRules(
        loadPrompt("user-mind/reflect", config.prompts.user_reflect),
        config.prompts.notes,
      ),
      input: JSON.stringify({
        now: nowLine(now, zone, lifeTimezone(config.life, now)),
        who_you_are: deps.snapshot,
        summary: stampedNote(summary, inputs.timezone),
        what_happened: (run.triggers as Trigger[]).map(triggerText),
        you_and_them: await loadRelationshipSummary(deps, userId, now),
        new_memories: shown.new_memories,
        earlier_memories: shown.earlier_memories,
        already_noticed: earlier.map((r) => r.content),
      }),
      schema: Output,
      timeoutMs: config.models.user_mind_timeout_ms,
      maxTokens: settings.max_tokens,
    });
    const note = out.reflection
      ? writeNote({ reflection: out.reflection }, out.times, shown.items, { now, zone })
      : null;
    // Her own life cited as theirs is the misreading citations exist to catch.
    const mismatch = !!note && out.subject === "user" && onlyHers(note);
    let reflectionId: string | null = null;
    if (note && !mismatch) {
      const text = note.fields.reflection!;
      const [embedding] = await deps.embedder.embed([text], "document");
      // Anything she read that a crisis touched marks what she writes from it.
      const sensitive =
        [...inputs.facts, ...earlierRows].some((f) => f.sensitive) ||
        (!!summary && isSensitive(summary)) ||
        earlier.some(isSensitive);
      const payload = { ...noteRefs(note), ...(sensitive ? { sensitive: true } : {}) };
      const row = await insertFact(db, userId, {
        subject: out.subject,
        kind: "reflection",
        content: text,
        payload: Object.keys(payload).length ? payload : null,
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
        earlier_ids: earlierRows.map((f) => f.id),
      },
      outputs: {
        reflection_id: reflectionId,
        not_written: mismatch ? "subject_mismatch" : null,
        dropped: note?.dropped ?? [],
      },
      written: reflectionId ? [{ id: reflectionId, kind: "reflection" }] : [],
      promptVersion: config.prompts.user_reflect,
    };
  });
}
