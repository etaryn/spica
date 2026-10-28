/**
 * Her idea for one user after a big event: one thing she wants to bring up with them next time,
 * or nothing. An idea gets one chance, in her next reply or as a reason to write first, and
 * expires unused once the event it's about has passed, or after a few days. Ideas can become
 * reach-outs and push notifications, so ideate never reads anything a crisis touched.
 */
import { z } from "zod";
import { insertFact } from "@/db/repos/user/facts";
import { listOpenThreads } from "@/db/repos/user/threads";
import {
  latestNonSensitiveModel,
  latestNonSensitiveSummary,
  liveIdeas,
  recentlyRaisedIdeas,
  recentReflections,
} from "@/db/repos/user/user-mind";
import { isSensitive } from "@/mind/memory/user/retrieve";
import { fitText } from "@/mind/platform/llm/fit";
import { loadPrompt } from "@/mind/platform/prompts";
import { DAY } from "@/mind/platform/time";
import { localDateString, localMidnight, nextLocalDate, zoneOrUtc } from "@/mind/platform/timezone";
import {
  noteRefs,
  noteTimesSchema,
  onlyHers,
  withNoteRules,
  writeNote,
} from "@/mind/platform/notes";
import { nowLine, written } from "@/mind/platform/time-anchors";
import { labelInstant } from "@/mind/platform/time-labels";
import { lifeTimezone } from "@/mind/world/her-clock";
import { citables, earlierMemories, stampedNote, type RunInputs } from "./inputs";
import { modelPayload } from "./model";
import { runUserLoop, type UserLoopDeps } from "./runner";

/**
 * When an idea stops being worth raising: the end of the day, in their zone, of the latest event
 * it's about that hasn't passed when it's written, and never later than its few days' chance. An
 * idea from events already past (how did it go) keeps the few days; asking after an event is the
 * job of threads and their events.
 */
export function ideaStaleAfter(
  createdAt: Date,
  sourceDates: Date[],
  ttlDays: number,
  tz: string,
): Date {
  const chance = new Date(createdAt.getTime() + ttlDays * DAY);
  const today = localDateString(createdAt, tz);
  const last = sourceDates
    .map((d) => localDateString(d, tz))
    .filter((d) => d >= today)
    .sort()
    .at(-1);
  if (!last) return chance;
  const end = localMidnight(nextLocalDate(last), tz);
  return end < chance ? end : chance;
}

const SUBJECT = { them: "user", you: "self", both: "shared" } as const;

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
    // Ideas she already brought up count too, so she doesn't pitch the same one twice.
    const planned = [
      ...(await liveIdeas(db, userId, now, settings.max_planned)),
      ...(await recentlyRaisedIdeas(
        db,
        userId,
        new Date(now.getTime() - settings.recent_days * DAY),
        settings.max_planned,
      )),
    ];
    // A sensitive storyline's title can carry what the sensitive fact says.
    const threads = await listOpenThreads(db, userId, config.user_mind.summarise.max_threads, {
      excludeSensitive: true,
    });
    // Ideas become reach-outs and push notifications, so a read a crisis touched stays out.
    const readRow = await latestNonSensitiveModel(db, userId);
    const read = readRow ? (modelPayload.safeParse(readRow.payload).data ?? null) : null;
    const Output = z.object({
      idea: fitText(settings.max_chars).nullable(),
      about: z.enum(["them", "you", "both"]),
      times: noteTimesSchema(["idea"]),
    });
    // Ideas become reach-outs, so even an older memory her notes cite stays out if a crisis
    // touched it.
    const earlier = await earlierMemories(db, userId, [summary, readRow, noticed, ...planned], {
      exclude: facts.map((f) => f.id),
      clean: true,
    });
    const shown = citables(facts, earlier, threads, inputs.timezone);
    const zone = zoneOrUtc(inputs.timezone);
    const out = await ctx.deps.llm.classifyJson({
      purpose: "user_ideate",
      model: "user_mind",
      system: withNoteRules(
        loadPrompt("user-mind/ideate", config.prompts.user_ideate),
        config.prompts.notes,
      ),
      input: JSON.stringify({
        now: nowLine(now, zone, lifeTimezone(config.life, now)),
        who_you_are: deps.snapshot,
        summary: stampedNote(summary, inputs.timezone),
        noticed: noticed?.content ?? null,
        your_read_on_them: read ? { written: written(readRow!.created_at, zone), ...read } : null,
        new_memories: shown.new_memories,
        earlier_memories: shown.earlier_memories,
        open_threads: shown.open_threads,
        already_planned: planned.map((i) => i.content),
      }),
      schema: Output,
      timeoutMs: config.models.user_mind_timeout_ms,
      maxTokens: settings.max_tokens,
    });
    const note = out.idea
      ? writeNote({ idea: out.idea }, out.times, shown.items, { now, zone })
      : null;
    // Her own life cited as theirs is the misreading citations exist to catch.
    const mismatch = !!note && out.about === "them" && onlyHers(note);
    let ideaId: string | null = null;
    if (note && !mismatch) {
      const content = note.fields.idea!;
      const [embedding] = await deps.embedder.embed([content], "document");
      const refs = noteRefs(note);
      const row = await insertFact(db, userId, {
        subject: SUBJECT[out.about],
        kind: "idea",
        content,
        embedding: embedding!,
        created_at: now,
        // The days it's about, cited or its own ("tonight"), set when it stops being worth raising.
        stale_after: ideaStaleAfter(
          now,
          [
            ...note.cited.flatMap((c) => (c.at ? [c.at] : [])),
            ...note.times.map((t) => labelInstant(t, zone)),
          ],
          settings.ttl_days,
          zone,
        ),
        status: "open",
        salience: settings.salience,
        valence: 0,
        confidence: settings.confidence,
        source: "generated",
        source_ref: `user_ideate:${ctx.traceId}`,
        // What it cites, so a reach-out carrying it knows their dates.
        payload: Object.keys(refs).length ? refs : null,
      });
      ideaId = row.id;
    }
    return {
      inputs: {
        summary_id: summary?.id ?? null,
        reflection_id: noticed?.id ?? null,
        model_id: readRow?.id ?? null,
        fact_ids: facts.map((f) => f.id),
        planned_ids: planned.map((i) => i.id),
        earlier_ids: earlier.map((f) => f.id),
      },
      outputs: {
        idea_id: ideaId,
        not_written: mismatch ? "subject_mismatch" : null,
        dropped: note?.dropped ?? [],
      },
      written: ideaId ? [{ id: ideaId, kind: "idea" }] : [],
      promptVersion: config.prompts.user_ideate,
    };
  });
}
