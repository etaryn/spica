/**
 * The hot path: composes one reply from both minds: her core values and snapshot, her state and
 * her day, the relationship, her memories of them and of her own life, and the live conversation.
 * It retrieves memory, loads those side by side, assembles the prompt, makes one generation, and
 * runs the guard. Read-only: the caller inserts and sends the reply, enqueues the cold path, then
 * calls `writeGuardLog`. Serves normal replies, the crisis path, and reach-outs.
 */
import { listOnboardingFacts } from "@/db/repos/user/facts";
import * as sessionLog from "@/db/repos/user/session-log";
import type { Turn } from "@/db/repos/user/session-log";
import { latestNonSensitiveSummary, liveIdeas, liveSummary } from "@/db/repos/user/user-mind";
import { getTimezone } from "@/db/repos/user/users";
import type { SafetyFlag } from "@/db/schema";
import type { RecalledFact, RetrievalResult, RetrievedFact } from "@/mind/memory/shared/types";
import { retrieveCore } from "@/mind/memory/core/retrieve";
import { embedQuery } from "@/mind/memory/shared/embed-query";
import { retrieve } from "@/mind/memory/user/retrieve";
import type { Deps } from "@/mind/platform/deps";
import { errorName, ReplyFailedError } from "@/mind/platform/errors";
import { loadPersona } from "@/mind/platform/persona";
import { parseSummaryPhrases } from "@/mind/platform/phrases";
import { loadPrompt } from "@/mind/platform/prompts";
import { withTimeout } from "@/mind/platform/timeout";
import { isValidTimeZone } from "@/mind/platform/timezone";
import { crisisCardFor } from "@/mind/process/crisis/classifier";
import { guardOutgoing } from "@/mind/process/guard/outgoing";
import type { Candidate } from "@/mind/process/outreach/types";
import { ideaCutoff } from "@/mind/process/user/ideate";
import { loadCoreStateLine } from "@/mind/state/core/line";
import { loadRelationshipSummary } from "@/mind/state/user/relationship/summary";
import { z } from "zod";
import { assemblePrompt, type AssembleInput, gapLine, relationshipLine } from "./assemble";
import { splitParts } from "./split-parts";
import { loadYourDayLine } from "./your-day-line";

const summaryPayload = z.object({
  where_things_stand: z.string(),
  whats_live: z.string(),
  how_i_feel: z.string(),
});

export type Composed = {
  text: string;
  parts: string[];
  /** Recalled user memories only: the cold path never reinforces her own. */
  recalled: RecalledFact[];
  /** The self snapshot this reply was written from; null when none exists yet. */
  snapshotVersion: number | null;
  /** Her ideas shown in this reply: each gets one chance, so the cold path retires them. */
  offeredIdeas: string[];
  writeGuardLog: () => Promise<void>;
};

export type ReachOutTrigger = Pick<
  Candidate,
  "kind" | "text" | "factId" | "threadId" | "coreMemoryId"
>;

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
  coreMemories: RetrievedFact[],
): { id: string; subject: string; content: string }[] {
  const facts = (["user", "self", "shared"] as const).flatMap((subject) =>
    retrieval.facts[subject].map((f) => ({ id: f.id, subject, content: f.content })),
  );
  const threads = retrieval.dueThreads.map((t) => ({
    id: t.id,
    subject: "thread",
    content: t.detail ? `${t.title} (latest: ${t.detail})` : t.title,
  }));
  const core = coreMemories.map((m) => ({ id: m.id, subject: "core", content: m.content }));
  return [...facts, ...threads, ...core];
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
  // A crisis reply carries no relationship friction, no mood colouring, and never mentions being
  // busy.
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
    : bounded(deps, "core state line", userId, () => loadCoreStateLine(deps, clock.now()), null);
  const yourDay = inCrisis
    ? Promise.resolve(null)
    : bounded(
        deps,
        "life state",
        userId,
        () => loadYourDayLine(deps, clock.now(), input.deferredBlock ?? null),
        null,
      );

  // Embedded once for both minds' retrieval; a failure leaves both with nothing ranked.
  const queryText = replyQuery(input, config.retrieval.context_turns);
  const queryVector = embedQuery(deps, queryText).catch((e) => {
    log.error("retrieval degraded", { userId, error: errorName(e) });
    return null;
  });

  const snapshot = bounded(deps, "snapshot", userId, () => deps.core.memory.latestSnapshot(), null);
  // A malformed payload renders nothing rather than failing the reply.
  const summary = inCrisis
    ? Promise.resolve(null)
    : bounded(
        deps,
        "summary",
        userId,
        async (): Promise<AssembleInput["summary"]> => {
          // A reach-out can surface as a push notification, so it never reads a crisis.
          const row = input.reachOut
            ? await latestNonSensitiveSummary(db, userId)
            : await liveSummary(db, userId);
          const parsed = summaryPayload.safeParse(row?.payload);
          return parsed.success ? parsed.data : null;
        },
        null,
      );
  // An idea gets one chance in a reply; a reach-out has its own reason, and a crisis has none.
  const ideas =
    inCrisis || input.reachOut
      ? Promise.resolve([] as { id: string; content: string }[])
      : bounded(
          deps,
          "ideas",
          userId,
          () =>
            liveIdeas(
              db,
              userId,
              ideaCutoff(clock.now(), config.user_mind.ideate.ttl_days),
              config.user_mind.ideate.slot_max,
            ),
          [] as { id: string; content: string }[],
        );
  const coreMemories = inCrisis
    ? Promise.resolve({ memories: [] as RetrievedFact[] })
    : bounded(
        deps,
        "core memory",
        userId,
        () =>
          retrieveCore(deps, {
            queryText,
            queryVector,
            now: clock.now(),
            forceIds: input.reachOut?.coreMemoryId ? [input.reachOut.coreMemoryId] : [],
          }),
        { memories: [] as RetrievedFact[] },
      );

  const retrieval = await retrieveFor(deps, userId, input, queryText, queryVector);
  const latestSnapshot = await snapshot;
  const herMemories = (await coreMemories).memories;
  const shownIdeas = await ideas;
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
    snapshot: latestSnapshot?.content ?? null,
    coreMemories: herMemories,
    feelingLine: await feeling,
    relationshipSummary: youAndThem,
    summary: await summary,
    yourDay: await yourDay,
    retrieval,
    openQuestions: inCrisis ? [] : input.openQuestions,
    ideas: shownIdeas.map((i) => i.content),
    recentTurns: recent,
    gapMarkerMinHours: config.chat.gap_line_min_hours,
    windowGapHours: config.chat.window_gap_hours,
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
      recalledFacts: guardFacts(retrieval, herMemories),
      onboardingFacts: await onboarding,
    },
  });

  return {
    text: guarded.text,
    parts: splitParts(guarded.text, config.chat.max_parts),
    recalled: retrieval.recalled,
    snapshotVersion: latestSnapshot?.version ?? null,
    offeredIdeas: shownIdeas.map((i) => i.id),
    writeGuardLog: guarded.writeLog,
  };
}

/**
 * What both minds' memories are matched against: a reach-out's topic (or, with none, the latest
 * turns), else the turns being answered with up to `contextTurns` before them.
 */
function replyQuery(input: ComposeInput, contextTurns: number): string {
  const reachOut = input.reachOut;
  if (reachOut) {
    if (reachOut.text) return reachOut.text;
    return input.recent
      .slice(-Math.max(1, contextTurns))
      .map((t) => t.text)
      .join("\n");
  }
  const context = contextTurns > 0 ? input.earlier.slice(-contextTurns) : [];
  return [...context, ...input.answering].map((t) => t.text).join("\n");
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

/**
 * A reach-out forces its own memory in and keeps sensitive memories out. An idea is not a memory
 * (it hasn't happened): it shows only as why she's writing.
 */
function retrieveFor(
  deps: Deps,
  userId: string,
  input: ComposeInput,
  queryText: string,
  queryVector: Promise<number[] | null>,
): Promise<RetrievalResult> {
  const reachOut = input.reachOut;
  return retrieve(deps, userId, {
    answering: input.answering,
    context: [],
    now: deps.clock.now(),
    queryText,
    queryVector,
    ...(reachOut
      ? {
          forceFactIds: reachOut.factId && reachOut.kind !== "user_idea" ? [reachOut.factId] : [],
          excludeSensitive: true,
        }
      : {}),
  });
}
