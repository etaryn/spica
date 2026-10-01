import { listOnboardingFacts } from "@/db/repos/facts";
import * as sessionLog from "@/db/repos/session-log";
import type { Turn } from "@/db/repos/session-log";
import { getTimezone } from "@/db/repos/users";
import type { SafetyFlag } from "@/db/schema";
import type { Deps } from "@/mind/platform/deps";
import { errorName, ReplyFailedError } from "@/mind/platform/errors";
import { loadEgoLine } from "@/mind/state/legacy-ego/line";
import { guardOutgoing } from "@/mind/process/guard/outgoing";
import { loadLifeState } from "./your-day-line";
import type { RecalledFact } from "@/mind/memory/shared/types";
import { retrieve } from "@/mind/memory/user/retrieve";
import { loadPrompt } from "@/mind/platform/prompts";
import type { Candidate } from "@/mind/process/outreach/types";
import {
  loadRelationshipSummary,
  parseSummaryPhrases,
} from "@/mind/state/user/relationship/summary";
import { crisisCardFor } from "@/mind/process/crisis/classifier";
import { isValidTimeZone } from "@/mind/platform/timezone";
import { withTimeout } from "@/mind/platform/timeout";
import { assemblePrompt, gapLine, relationshipLine, type RetrievalResult } from "./assemble";
import { splitParts } from "./split-parts";

export type Composed = {
  text: string;
  parts: string[];
  recalled: RecalledFact[];
  writeGuardLog: () => Promise<void>;
};

/** What the reply's prompt contained, for the guard's honesty check. */
function guardFacts(r: RetrievalResult): { id: string; subject: string; content: string }[] {
  return [
    ...(["user", "self", "shared"] as const).flatMap((s) =>
      r.facts[s].map((f) => ({ id: f.id, subject: s, content: f.content })),
    ),
    ...r.dueThreads.map((t) => ({
      id: t.id,
      subject: "thread",
      content: t.detail ? `${t.title} (latest: ${t.detail})` : t.title,
    })),
  ];
}

export type ReachOutTrigger = Pick<Candidate, "kind" | "text" | "factId" | "threadId">;

type ComposeInput = {
  recent: Turn[];
  earlier: Turn[];
  answering: Turn[];
  gapTo: Date; // first.created_at for a reply; now for a reach-out
  anchor: Turn; // guard turn id and stats cut-off
  openQuestions: string[];
  flag: SafetyFlag | null;
  deferredFact?: string | null;
  reachOut: ReachOutTrigger | null;
};

/**
 * The hot path over a committed buffer: retrieve → assemble → generate → guard. Read-only: the caller
 * inserts the reply, sends it, enqueues the cold path and then calls `writeGuardLog` (judge_log after the send).
 * Called by the turn timer and the crisis path; reach-outs use `composeReachOut`.
 */
export async function composeReply(
  deps: Deps,
  userId: string,
  a: {
    turns: Turn[];
    openQuestions: string[];
    flag: SafetyFlag | null;
    deferredFact?: string | null;
  },
): Promise<Composed> {
  const { db, config } = deps;
  const last = a.turns.at(-1);
  if (!last) throw new Error("composeReply needs at least one turn");
  const first = a.turns[0]!;

  // The window ends at the buffer's last turn, so a retried older buffer never sees later turns.
  const recent = await sessionLog.turnsUpTo(db, userId, last, config.chat.recent_turns);
  const firstIdx = recent.findIndex((t) => t.id === first.id);
  const earlier = firstIdx === -1 ? recent.slice(0, -a.turns.length) : recent.slice(0, firstIdx);
  return composeFrom(deps, userId, {
    recent,
    earlier,
    answering: a.turns,
    gapTo: first.created_at,
    anchor: last,
    openQuestions: a.openQuestions,
    flag: a.flag,
    deferredFact: a.deferredFact,
    reachOut: null,
  });
}

/** A reach-out through the same hot path. `recent` is the prompt window, oldest first. */
export async function composeReachOut(
  deps: Deps,
  userId: string,
  trigger: ReachOutTrigger,
  recent: Turn[],
): Promise<Composed> {
  const anchor = recent.at(-1);
  if (!anchor) throw new Error("composeReachOut needs history");
  return composeFrom(deps, userId, {
    recent,
    earlier: recent,
    answering: [],
    gapTo: deps.clock.now(),
    anchor,
    openQuestions: [],
    flag: null,
    reachOut: trigger,
  });
}

export function renderReachOut(md: string, t: ReachOutTrigger): { slot: string; cue: string } {
  const p = parseSummaryPhrases(md);
  const topic = t.text || "just saying hi";
  const guidance = (p[t.kind] ?? []).join(" ");
  const slot = (p.slot ?? [])
    .map((l) => l.replace("{{topic}}", () => topic).replace("{{guidance}}", () => guidance))
    .join("\n");
  return { slot, cue: (p.cue ?? []).join(" ") };
}

async function composeFrom(deps: Deps, userId: string, a: ComposeInput): Promise<Composed> {
  const { db, clock, config, llm, log } = deps;
  const { recent, earlier } = a;

  const loadOnboarding =
    (deps as { onboardingFacts?: typeof listOnboardingFacts }).onboardingFacts ??
    listOnboardingFacts;
  const onboarding = withTimeout(
    Promise.resolve().then(() => loadOnboarding(db, userId)),
    config.hot_path.db_timeout_ms,
  ).catch((e) => {
    log.error("onboarding facts unavailable", { userId, error: errorName(e) });
    return [] as { id: string; content: string }[];
  });

  const relLinePromise: Promise<string | null> = config.chat.relationship_line
    ? (async () => {
        try {
          const tz = await getTimezone(db, userId);
          const stats = await sessionLog.userTurnStats(
            db,
            userId,
            a.anchor.created_at,
            tz && isValidTimeZone(tz) ? tz : "UTC",
          );
          return relationshipLine(stats, clock.now());
        } catch (e) {
          log.error("relationship line unavailable", { userId, error: errorName(e) });
          return null;
        }
      })()
    : Promise.resolve(null);

  const relSummaryPromise: Promise<string | null> = a.flag?.flagged
    ? Promise.resolve(null)
    : withTimeout(
        Promise.resolve().then(() => loadRelationshipSummary(deps, userId, clock.now())),
        config.hot_path.db_timeout_ms,
      ).catch((e) => {
        log.error("relationship summary unavailable", { userId, error: errorName(e) });
        return null;
      });

  // Rule 7: a crisis reply carries no mood or energy colouring.
  const egoPromise: Promise<string | null> = a.flag?.flagged
    ? Promise.resolve(null)
    : withTimeout(
        Promise.resolve().then(() => loadEgoLine(deps, userId, clock.now())),
        config.hot_path.db_timeout_ms,
      ).catch((e) => {
        log.error("ego line unavailable", { userId, error: errorName(e) });
        return null;
      });
  // Rule 7: a crisis reply never mentions being busy.
  const lifePromise: Promise<string | null> = a.flag?.flagged
    ? Promise.resolve(null)
    : withTimeout(
        Promise.resolve().then(() =>
          loadLifeState(deps, userId, clock.now(), a.deferredFact ?? null),
        ),
        config.hot_path.db_timeout_ms,
      ).catch((e) => {
        log.error("life state unavailable", { userId, error: errorName(e) });
        return null;
      });

  const retrieval = await retrieve(deps, userId, {
    answering: a.answering,
    context:
      config.retrieval.context_turns > 0 ? earlier.slice(-config.retrieval.context_turns) : [],
    now: clock.now(),
    ...(a.reachOut
      ? {
          queryText:
            a.reachOut.text ||
            recent
              .slice(-Math.max(1, config.retrieval.context_turns))
              .map((t) => t.text)
              .join("\n"),
          forceFactIds: a.reachOut.factId ? [a.reachOut.factId] : [],
          excludeSensitive: true, // nothing sensitive in a message she opens with
        }
      : {}),
  });
  const relLine = await relLinePromise;

  const prompt = assemblePrompt({
    valuesDoc: `${loadPrompt("persona", config.prompts.persona)}\n\n${loadPrompt("reply", config.prompts.reply)}`,
    egoLine: await egoPromise,
    relationshipSummary:
      [
        [
          relLine,
          gapLine(earlier.at(-1)?.created_at ?? null, a.gapTo, config.chat.gap_line_min_hours),
        ]
          .filter((x): x is string => !!x)
          .join(" "),
        await relSummaryPromise,
      ]
        .filter((x): x is string => !!x)
        .join("\n") || null,
    lifeState: await lifePromise,
    retrieval,
    openQuestions: a.flag?.flagged ? [] : a.openQuestions,
    recentTurns: recent,
    gapMarkerMinHours: config.chat.gap_line_min_hours,
    now: clock.now(),
    reachOut: a.reachOut
      ? renderReachOut(loadPrompt("reach-out", config.prompts.reach_out), a.reachOut)
      : null,
  });

  let firstText: string;
  try {
    firstText = await llm.generateReply(prompt);
  } catch (e) {
    log.error("reply generation failed", { userId, turnId: a.anchor.id, error: errorName(e) });
    throw new ReplyFailedError("reply generation failed", crisisCardFor(a.flag, config), {
      cause: e,
    });
  }

  const guarded = await guardOutgoing(deps, {
    userId,
    turnId: a.anchor.id,
    first: firstText,
    regenerate: (note) =>
      llm.generateReply({ system: `${prompt.system}\n\n${note}`, messages: prompt.messages }),
    input: {
      kind: a.flag?.flagged ? "crisis_reply" : a.reachOut ? "reach_out" : "reply",
      recentTurns: recent.map((t) => ({ role: t.role, text: t.text, at: t.created_at })),
      recalledFacts: guardFacts(retrieval),
      onboardingFacts: await onboarding,
    },
  });

  return {
    text: guarded.text,
    parts: splitParts(guarded.text, config.chat.max_parts),
    recalled: retrieval.recalled,
    writeGuardLog: guarded.writeLog,
  };
}
