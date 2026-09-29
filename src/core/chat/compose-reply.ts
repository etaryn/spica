import { listOnboardingFacts } from "@/db/repos/facts";
import * as sessionLog from "@/db/repos/session-log";
import type { Turn } from "@/db/repos/session-log";
import { getTimezone } from "@/db/repos/users";
import type { SafetyFlag } from "@/db/schema";
import type { Deps } from "../deps";
import { ReplyFailedError } from "../errors";
import { loadEgoLine } from "../ego/line";
import { guardOutgoing } from "../guard/outgoing";
import { loadLifeState } from "../life/state";
import type { RecalledFact } from "../memory/types";
import { retrieve } from "../memory/retrieve";
import { loadPrompt } from "../prompts";
import { loadRelationshipSummary } from "../relationship/summary";
import { crisisCardFor } from "../safety/crisis";
import { isValidTimeZone } from "../timezone";
import { withTimeout } from "../timeout";
import { assemblePrompt, gapLine, relationshipLine, type RetrievalResult } from "./assemble";
import { splitParts } from "./parts";

export type Composed = { text: string; parts: string[]; recalled: RecalledFact[]; writeGuardLog: () => Promise<void> };

const errName = (e: unknown) => String((e as Error)?.name ?? "Error");

/** What the reply's prompt contained, for the guard's honesty check (v2 §6.4). */
function guardFacts(r: RetrievalResult): { id: string; subject: string; content: string }[] {
  return [
    ...(["user", "self", "shared"] as const).flatMap((s) => r.facts[s].map((f) => ({ id: f.id, subject: s, content: f.content }))),
    ...r.dueThreads.map((t) => ({ id: t.id, subject: "thread", content: t.detail ? `${t.title} (latest: ${t.detail})` : t.title })),
  ];
}

/**
 * The hot path (v2 §6.2) over a committed buffer: retrieve → assemble → generate → guard. Read-only: the caller
 * inserts the reply, sends it, enqueues the cold path and then calls `writeGuardLog` (judge_log after the send).
 * Called by the turn timer, the crisis path and (Phase 6) reach-outs.
 */
export async function composeReply(deps: Deps, userId: string, a: { turns: Turn[]; openQuestions: string[]; flag: SafetyFlag | null; deferredFact?: string | null }): Promise<Composed> {
  const { db, clock, config, llm, log } = deps;
  const last = a.turns.at(-1);
  if (!last) throw new Error("composeReply needs at least one turn");
  const first = a.turns[0]!;

  // The window ends at the buffer's last turn, so a retried older buffer never sees later turns.
  const recent = await sessionLog.turnsUpTo(db, userId, last, config.chat.recent_turns);
  const firstIdx = recent.findIndex((t) => t.id === first.id);
  const earlier = firstIdx === -1 ? recent.slice(0, -a.turns.length) : recent.slice(0, firstIdx);

  const loadOnboarding = (deps as { onboardingFacts?: typeof listOnboardingFacts }).onboardingFacts ?? listOnboardingFacts;
  const onboarding = withTimeout(Promise.resolve().then(() => loadOnboarding(db, userId)), config.hot_path.db_timeout_ms).catch((e) => {
    log.error("onboarding facts unavailable", { userId, error: errName(e) });
    return [] as { id: string; content: string }[];
  });

  const relLinePromise: Promise<string | null> = config.chat.relationship_line
    ? (async () => {
        try {
          const tz = await getTimezone(db, userId);
          const stats = await sessionLog.userTurnStats(db, userId, last.created_at, tz && isValidTimeZone(tz) ? tz : "UTC");
          return relationshipLine(stats, clock.now());
        } catch (e) {
          log.error("relationship line unavailable", { userId, error: errName(e) });
          return null;
        }
      })()
    : Promise.resolve(null);

  const relSummaryPromise: Promise<string | null> = a.flag?.flagged
    ? Promise.resolve(null)
    : withTimeout(Promise.resolve().then(() => loadRelationshipSummary(deps, userId, clock.now())), config.hot_path.db_timeout_ms).catch((e) => {
        log.error("relationship summary unavailable", { userId, error: errName(e) });
        return null;
      });

  // Rule 7: a crisis reply carries no mood or energy colouring.
  const egoPromise: Promise<string | null> = a.flag?.flagged
    ? Promise.resolve(null)
    : withTimeout(Promise.resolve().then(() => loadEgoLine(deps, userId, clock.now())), config.hot_path.db_timeout_ms).catch((e) => {
        log.error("ego line unavailable", { userId, error: errName(e) });
        return null;
      });
  // Rule 7: a crisis reply never mentions being busy.
  const lifePromise: Promise<string | null> = a.flag?.flagged
    ? Promise.resolve(null)
    : withTimeout(Promise.resolve().then(() => loadLifeState(deps, userId, clock.now(), a.deferredFact ?? null)), config.hot_path.db_timeout_ms).catch((e) => {
        log.error("life state unavailable", { userId, error: errName(e) });
        return null;
      });

  const retrieval = await retrieve(deps, userId, {
    answering: a.turns,
    context: config.retrieval.context_turns > 0 ? earlier.slice(-config.retrieval.context_turns) : [],
    now: clock.now(),
  });
  const relLine = await relLinePromise;

  const prompt = assemblePrompt({
    valuesDoc: `${loadPrompt("persona", config.prompts.persona)}\n\n${loadPrompt("reply", config.prompts.reply)}`,
    egoLine: await egoPromise,
    relationshipSummary: [
      [relLine, gapLine(earlier.at(-1)?.created_at ?? null, first.created_at, config.chat.gap_line_min_hours)].filter((x): x is string => !!x).join(" "),
      await relSummaryPromise,
    ].filter((x): x is string => !!x).join("\n") || null,
    lifeState: await lifePromise,
    retrieval,
    openQuestions: a.flag?.flagged ? [] : a.openQuestions,
    recentTurns: recent,
    gapMarkerMinHours: config.chat.gap_line_min_hours,
    now: clock.now(),
  });

  let firstText: string;
  try {
    firstText = await llm.generateReply(prompt);
  } catch (e) {
    log.error("reply generation failed", { userId, turnId: last.id, error: errName(e) });
    throw new ReplyFailedError("reply generation failed", crisisCardFor(a.flag, config), { cause: e });
  }

  const guarded = await guardOutgoing(deps, {
    userId, turnId: last.id, first: firstText,
    regenerate: (note) => llm.generateReply({ system: `${prompt.system}\n\n${note}`, messages: prompt.messages }),
    input: {
      kind: a.flag?.flagged ? "crisis_reply" : "reply",
      recentTurns: recent.map((t) => ({ role: t.role, text: t.text, at: t.created_at })),
      recalledFacts: guardFacts(retrieval),
      onboardingFacts: await onboarding,
    },
  });

  return { text: guarded.text, parts: splitParts(guarded.text, config.chat.max_parts), recalled: retrieval.recalled, writeGuardLog: guarded.writeLog };
}
