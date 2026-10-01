/**
 * The hot path: composes one reply from both minds and the live conversation. It retrieves
 * memory, loads her feeling, the relationship summary and her day side by side, assembles the
 * prompt, makes one generation, and runs the guard. Read-only: the caller inserts and sends the
 * reply, enqueues the cold path, then calls `writeGuardLog`. Serves normal replies, the crisis
 * path, and reach-outs.
 */
import { listOnboardingFacts } from "@/db/repos/user/facts";
import * as sessionLog from "@/db/repos/user/session-log";
import type { Turn } from "@/db/repos/user/session-log";
import { getTimezone } from "@/db/repos/user/users";
import type { SafetyFlag } from "@/db/schema";
import type { RecalledFact, RetrievalResult } from "@/mind/memory/shared/types";
import { retrieve } from "@/mind/memory/user/retrieve";
import type { Deps } from "@/mind/platform/deps";
import { errorName, ReplyFailedError } from "@/mind/platform/errors";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";
import { withTimeout } from "@/mind/platform/timeout";
import { isValidTimeZone } from "@/mind/platform/timezone";
import { crisisCardFor } from "@/mind/process/crisis/classifier";
import { guardOutgoing } from "@/mind/process/guard/outgoing";
import type { Candidate } from "@/mind/process/outreach/types";
import { loadEgoLine } from "@/mind/state/legacy-ego/line";
import {
  loadRelationshipSummary,
  parseSummaryPhrases,
} from "@/mind/state/user/relationship/summary";
import { assemblePrompt, gapLine, relationshipLine } from "./assemble";
import { splitParts } from "./split-parts";
import { loadYourDayLine } from "./your-day-line";

export type Composed = {
  text: string;
  parts: string[];
  recalled: RecalledFact[];
  writeGuardLog: () => Promise<void>;
};

export type ReachOutTrigger = Pick<Candidate, "kind" | "text" | "factId" | "threadId">;

type ComposeInput = {
  recent: Turn[];
  earlier: Turn[];
  answering: Turn[];
  /** The buffer's first turn for a reply; now for a reach-out. */
  gapTo: Date;
  /** The guard's turn id, and the cut-off for relationship stats. */
  anchor: Turn;
  openQuestions: string[];
  flag: SafetyFlag | null;
  deferredBlock?: string | null;
  reachOut: ReachOutTrigger | null;
};

/** What the reply's prompt contained, for the guard's honesty check. */
function guardFacts(
  retrieval: RetrievalResult,
): { id: string; subject: string; content: string }[] {
  const facts = (["user", "self", "shared"] as const).flatMap((subject) =>
    retrieval.facts[subject].map((f) => ({ id: f.id, subject, content: f.content })),
  );
  const threads = retrieval.dueThreads.map((t) => ({
    id: t.id,
    subject: "thread",
    content: t.detail ? `${t.title} (latest: ${t.detail})` : t.title,
  }));
  return [...facts, ...threads];
}

/** A reply to a committed buffer. Used by the turn timer and the crisis path. */
export async function composeReply(
  deps: Deps,
  userId: string,
  request: {
    turns: Turn[];
    openQuestions: string[];
    flag: SafetyFlag | null;
    deferredBlock?: string | null;
  },
): Promise<Composed> {
  const last = request.turns.at(-1);
  if (!last) throw new Error("composeReply needs at least one turn");
  const first = request.turns[0]!;

  // The window ends at the buffer's last turn, so a retried older buffer never sees later turns.
  const recent = await sessionLog.turnsUpTo(deps.db, userId, last, deps.config.chat.recent_turns);
  const firstIndex = recent.findIndex((t) => t.id === first.id);
  const earlier =
    firstIndex === -1 ? recent.slice(0, -request.turns.length) : recent.slice(0, firstIndex);

  return composeFrom(deps, userId, {
    recent,
    earlier,
    answering: request.turns,
    gapTo: first.created_at,
    anchor: last,
    openQuestions: request.openQuestions,
    flag: request.flag,
    deferredBlock: request.deferredBlock,
    reachOut: null,
  });
}

/** A reach-out, through the same hot path. `recent` is the prompt window, oldest first. */
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

/** Fills the reach-out prompt file's `slot` and `cue` with this trigger's topic and guidance. */
export function renderReachOut(
  markdown: string,
  trigger: ReachOutTrigger,
): { slot: string; cue: string } {
  const phrases = parseSummaryPhrases(markdown);
  const topic = trigger.text || "just saying hi";
  const guidance = (phrases[trigger.kind] ?? []).join(" ");

  const slot = (phrases.slot ?? [])
    .map((line) => line.replace("{{topic}}", () => topic).replace("{{guidance}}", () => guidance))
    .join("\n");
  return { slot, cue: (phrases.cue ?? []).join(" ") };
}

/**
 * Each side lookup gets the hot path's deadline and degrades to nothing on failure, so a slow or
 * broken lookup costs a section of the prompt, never the reply.
 */
function bounded<T>(
  deps: Deps,
  what: string,
  userId: string,
  load: () => Promise<T>,
  fallback: T,
): Promise<T> {
  return withTimeout(Promise.resolve().then(load), deps.config.hot_path.db_timeout_ms).catch(
    (e) => {
      deps.log.error(`${what} unavailable`, { userId, error: errorName(e) });
      return fallback;
    },
  );
}

async function composeFrom(deps: Deps, userId: string, input: ComposeInput): Promise<Composed> {
  const { db, clock, config, llm, log } = deps;
  const { recent, earlier } = input;
  const inCrisis = !!input.flag?.flagged;

  // Started together so they overlap retrieval.
  const loadOnboarding =
    (deps as { onboardingFacts?: typeof listOnboardingFacts }).onboardingFacts ??
    listOnboardingFacts;
  const onboarding = bounded(
    deps,
    "onboarding facts",
    userId,
    () => loadOnboarding(db, userId),
    [] as { id: string; content: string }[],
  );
  const relationshipLinePromise = loadRelationshipLine(deps, userId, input.anchor);
  // A crisis reply carries no relationship friction, no mood colouring, and never mentions being busy.
  const relationshipSummary = inCrisis
    ? Promise.resolve(null)
    : bounded(
        deps,
        "relationship summary",
        userId,
        () => loadRelationshipSummary(deps, userId, clock.now()),
        null,
      );
  const feeling = inCrisis
    ? Promise.resolve(null)
    : bounded(deps, "ego line", userId, () => loadEgoLine(deps, userId, clock.now()), null);
  const yourDay = inCrisis
    ? Promise.resolve(null)
    : bounded(
        deps,
        "life state",
        userId,
        () => loadYourDayLine(deps, clock.now(), input.deferredBlock ?? null),
        null,
      );

  const retrieval = await retrieveFor(deps, userId, input);
  const factualLine = await relationshipLinePromise;
  const gap = gapLine(
    earlier.at(-1)?.created_at ?? null,
    input.gapTo,
    config.chat.gap_line_min_hours,
  );
  const youAndThem =
    [[factualLine, gap].filter((x): x is string => !!x).join(" "), await relationshipSummary]
      .filter((x): x is string => !!x)
      .join("\n") || null;

  const prompt = assemblePrompt({
    valuesDoc: `${loadPersona(config).coreValues}\n\n${loadPrompt("reply", config.prompts.reply)}`,
    feelingLine: await feeling,
    relationshipSummary: youAndThem,
    yourDay: await yourDay,
    retrieval,
    openQuestions: inCrisis ? [] : input.openQuestions,
    recentTurns: recent,
    gapMarkerMinHours: config.chat.gap_line_min_hours,
    now: clock.now(),
    reachOut: input.reachOut
      ? renderReachOut(loadPrompt("reach-out", config.prompts.reach_out), input.reachOut)
      : null,
  });

  let firstDraft: string;
  try {
    firstDraft = await llm.generateReply(prompt);
  } catch (e) {
    log.error("reply generation failed", { userId, turnId: input.anchor.id, error: errorName(e) });
    throw new ReplyFailedError("reply generation failed", crisisCardFor(input.flag, config), {
      cause: e,
    });
  }

  const guarded = await guardOutgoing(deps, {
    userId,
    turnId: input.anchor.id,
    first: firstDraft,
    regenerate: (note) =>
      llm.generateReply({ system: `${prompt.system}\n\n${note}`, messages: prompt.messages }),
    input: {
      kind: inCrisis ? "crisis_reply" : input.reachOut ? "reach_out" : "reply",
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

/** How long she's known them, so she doesn't guess. Off when `chat.relationship_line` is false. */
async function loadRelationshipLine(
  deps: Deps,
  userId: string,
  anchor: Turn,
): Promise<string | null> {
  if (!deps.config.chat.relationship_line) return null;

  try {
    const zone = await getTimezone(deps.db, userId);
    const stats = await sessionLog.userTurnStats(
      deps.db,
      userId,
      anchor.created_at,
      zone && isValidTimeZone(zone) ? zone : "UTC",
    );
    return relationshipLine(stats, deps.clock.now());
  } catch (e) {
    deps.log.error("relationship line unavailable", { userId, error: errorName(e) });
    return null;
  }
}

/** A reach-out queries by its topic, forces its own memory in, and keeps sensitive memories out. */
function retrieveFor(deps: Deps, userId: string, input: ComposeInput): Promise<RetrievalResult> {
  const { config, clock } = deps;
  const contextTurns =
    config.retrieval.context_turns > 0 ? input.earlier.slice(-config.retrieval.context_turns) : [];

  const reachOut = input.reachOut;
  const reachOutQuery = reachOut
    ? {
        queryText:
          reachOut.text ||
          input.recent
            .slice(-Math.max(1, config.retrieval.context_turns))
            .map((t) => t.text)
            .join("\n"),
        forceFactIds: reachOut.factId ? [reachOut.factId] : [],
        excludeSensitive: true,
      }
    : {};

  return retrieve(deps, userId, {
    answering: input.answering,
    context: contextTurns,
    now: clock.now(),
    ...reachOutQuery,
  });
}
