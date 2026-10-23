/**
 * Her idea for one user after a big event: one thing she wants to bring up with them next time,
 * or nothing. An idea gets one chance, in her next reply or as a reason to write first, and
 * expires unused once the event it's about has passed, or after a few days. Ideas can become reach-outs and push notifications, so ideate
 * never reads anything a crisis touched.
 */
import { z } from "zod";
import { insertFact, nearestDated } from "@/db/repos/user/facts";
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
import { anchorTimes, nowLine, tokenDates, written } from "@/mind/platform/time-anchors";
import { lifeTimezone } from "@/mind/world/her-clock";
import { memoryLines, shownDates, threadLines, stampedNote, type RunInputs } from "./inputs";
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
    const Output = z.object({ idea: fitText(settings.max_chars).nullable() });
    const out = await ctx.deps.llm.classifyJson({
      purpose: "user_ideate",
      model: "user_mind",
      system: loadPrompt("user-mind/ideate", config.prompts.user_ideate),
      input: JSON.stringify({
        now: nowLine(now, zoneOrUtc(inputs.timezone), lifeTimezone(config.life, now)),
        who_you_are: deps.snapshot,
        summary: stampedNote(summary, inputs.timezone),
        noticed: noticed?.content ?? null,
        your_read_on_them: read
          ? { written: written(readRow!.created_at, zoneOrUtc(inputs.timezone)), ...read }
          : null,
        new_memories: memoryLines(facts, inputs.timezone),
        open_threads: threadLines(threads, inputs.timezone),
        already_planned: planned.map((i) => i.content),
      }),
      schema: Output,
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: settings.max_tokens,
    });
    let ideaId: string | null = null;
    if (out.idea) {
      const [embedding] = await deps.embedder.embed([out.idea], "document");
      const from = await nearestDated(
        db,
        userId,
        facts.filter((f) => f.occurred_at !== null).map((f) => f.id),
        embedding!,
        settings.source_similarity,
        settings.dated_facts,
      );
      // Dated here, not on insert, so its own days ("tonight") set when it stops being worth raising.
      const zone = zoneOrUtc(inputs.timezone);
      const content = anchorTimes(out.idea, {
        at: now,
        zone,
        known: shownDates(facts, threads, [summary?.content, readRow?.content]),
      });
      const row = await insertFact(db, userId, {
        subject: "shared",
        kind: "idea",
        content,
        embedding: embedding!,
        created_at: now,
        stale_after: ideaStaleAfter(
          now,
          [
            ...facts.filter((f) => from.includes(f.id)).map((f) => f.occurred_at!),
            ...tokenDates(content),
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
        // The dated facts it's about, so a reach-out carrying it knows their dates; a date it
        // isn't about would ride along into the message.
        payload: { from },
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
      },
      outputs: { idea_id: ideaId },
      written: ideaId ? [{ id: ideaId, kind: "idea" }] : [],
      promptVersion: config.prompts.user_ideate,
    };
  });
}
