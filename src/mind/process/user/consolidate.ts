/**
 * Her memory of an older week with one user, folded into one gist after a big event: the shape of
 * that stretch, so a later conversation can recall "the week you were packing" instead of each
 * fact. The facts stay, weighed down once. Anything a crisis touched is never folded in.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { insertFact } from "@/db/repos/user/facts";
import { gistFacts, oldestGistGroup } from "@/db/repos/user/gist";
import { getTimezone } from "@/db/repos/user/users";
import { fitText } from "@/mind/platform/llm/fit";
import { loadPrompt } from "@/mind/platform/prompts";
import { isValidTimeZone, localDateString, shiftLocalDate } from "@/mind/platform/timezone";
import { runUserLoop, type UserLoopDeps } from "./runner";

export async function userConsolidate(
  deps: UserLoopDeps,
  run: { id: string; user_id: string },
): Promise<"done" | "failed"> {
  const { config, db } = deps;
  const settings = config.user_mind.consolidate;
  const userId = run.user_id;
  return runUserLoop(deps, run, "user_consolidate", async (ctx) => {
    const now = deps.clock.now();
    const raw = await getTimezone(db, userId);
    const tz = raw && isValidTimeZone(raw) ? raw : "UTC";
    const window = {
      before: shiftLocalDate(localDateString(now, tz), -settings.gist_after_days),
      tz,
    };
    const group = await oldestGistGroup(db, userId, {
      ...window,
      minGroup: settings.min_group,
      maxSources: settings.max_sources,
    });
    if (!group) return { inputs: { week: null }, outputs: { gist_id: null }, promptVersion: null };
    const ids = group.sources.map((s) => s.id);
    const out = await ctx.deps.llm.classifyJson({
      purpose: "user_consolidate",
      model: "user_mind",
      system: loadPrompt("user-mind/consolidate", config.prompts.user_consolidate),
      input: JSON.stringify({
        who_you_are: deps.snapshot,
        week: group.week,
        sources: group.sources.map((s) => ({
          content: s.content,
          when: localDateString(s.occurred_at, tz),
        })),
      }),
      schema: z.object({ gist: fitText(settings.max_chars) }),
      timeoutMs: config.models.structured_timeout_ms,
      maxTokens: settings.max_tokens,
    });
    const [embedding] = await deps.embedder.embed([out.gist], "document");
    const gistId = randomUUID();
    const written = await db.transaction(async (tx) => {
      // Sources merged, superseded or folded by another run while she wrote void this gist.
      if (!(await gistFacts(tx, userId, ids, gistId, settings.gist_source_factor, window)))
        return false;
      await insertFact(tx, userId, {
        id: gistId,
        subject: "shared",
        kind: "episode",
        content: out.gist,
        payload: { gist_of: ids },
        embedding: embedding!,
        occurred_at: group.sources[0]!.occurred_at,
        created_at: now,
        status: "recurring",
        salience: Math.max(...group.sources.map((s) => s.salience)),
        valence: 0,
        confidence: settings.confidence,
        source: "generated",
        source_ref: `user_consolidate:${ctx.traceId}`,
      });
      return true;
    });
    return {
      inputs: { week: group.week, source_ids: ids },
      outputs: { gist_id: written ? gistId : null },
      written: written ? [{ id: gistId, kind: "episode" }] : [],
      promptVersion: config.prompts.user_consolidate,
    };
  });
}
