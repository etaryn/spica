/**
 * The hot path: composes one reply from both minds: her core values and snapshot, her state and
 * her day, the relationship, her memories of them and of her own life, and the live conversation.
 * It retrieves memory, loads those side by side, assembles the prompt, makes one generation, runs
 * the guard, and puts the reply into her texting form. Read-only: the caller inserts and sends the reply, enqueues the cold path, then
 * calls `writeGuardLog`. Serves normal replies, the crisis path, and reach-outs.
 */
import { listOnboardingFacts } from "@/db/repos/user/facts";
import * as sessionLog from "@/db/repos/user/session-log";
import type { Turn } from "@/db/repos/user/session-log";
import {
  latestNonSensitiveModel,
  latestNonSensitiveSummary,
  liveIdeas,
  liveModel,
  liveSummary,
} from "@/db/repos/user/user-mind";
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
import type { Pointed } from "@/mind/process/guard/categories";
import { usedOnOccasion } from "@/mind/process/guard/occasion";
import { guardOutgoing } from "@/mind/process/guard/outgoing";
import type { Candidate } from "@/mind/process/outreach/types";
import { ideaCutoff } from "@/mind/process/user/ideate";
import { modelPayload } from "@/mind/process/user/model";
import { loadCoreStateLine } from "@/mind/state/core/line";
import {
  CRISIS_OPENNESS,
  crisisOpennessLine,
  loadOpenness,
  loadOpennessPhrases,
  opennessLine,
} from "@/mind/state/user/relationship/openness";
import { loadRelationshipSummary } from "@/mind/state/user/relationship/summary";
import { FIRST_DEPTH, loadDepth } from "@/mind/state/user/relationship/depth";
import type { IdiolectCandidate } from "@/db/repos/user/facts";
import { loadIdiolect } from "@/mind/memory/user/idiolect";
import { loadStage, loadStagePhrases, stageLine } from "@/mind/state/user/relationship/stages";
import type { DepthLimits, DepthRecord, Openness } from "@/mind/state/user/relationship/types";
import { disclosureLevels, heldBackInSession } from "@/db/repos/user/disclosure";
import { sectionDepths, snapshotWithin } from "@/mind/memory/core/depth";
import { z } from "zod";
import { assemblePrompt, type AssembleInput, gapLine, relationshipLine } from "./assemble";
import { howToText, loadHowToTextPhrases } from "./how-to-text";
import { bandShiftOf, biasesFor, loadMoodKeys, pickMove } from "./move";
import { shapeText } from "./shape-text";
import { splitParts } from "./split-parts";
import { textingShape } from "./texting-shape";
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
  /** How open she was steered to be; stored with the reply so the cold path credits intimacy. */
  openness: Openness | null;
  /** What she was allowed to reveal, and what she held back; the cold path grades her claims by it. */
  depth: DepthRecord;
  /** Her ideas shown in this reply: each gets one chance, so the cold path retires them. */
  offeredIdeas: string[];
  /** The allowed negative this reply carries, stored so the guard counts it once per occasion. */
  pointed: Pointed | null;
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
  // What she has already said on this occasion; a crisis reply is checked without it.
  const occasion = inCrisis
    ? Promise.resolve(undefined)
    : usedOnOccasion(deps, userId, input.reachOut ? "reach_out" : "reply");
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
  // In a crisis she is simply there for them, whatever her state.
  const openness: Promise<Openness | null> = inCrisis
    ? Promise.resolve(CRISIS_OPENNESS)
    : bounded(deps, "openness", userId, () => loadOpenness(deps, userId, clock.now()), null);
  // How far they've come and whether things have cooled; in a crisis she is simply there for them.
  const stage = inCrisis
    ? Promise.resolve(null)
    : bounded(deps, "stage", userId, () => loadStage(deps, userId), null);
  // How deep she may go follows how open she feels; a crisis reply stays on the surface.
  const limits: Promise<DepthLimits> = inCrisis
    ? Promise.resolve(FIRST_DEPTH)
    : openness.then((o) =>
        bounded(
          deps,
          "depth",
          userId,
          () => loadDepth(deps, userId, o, !!input.reachOut, input.anchor.session_id),
          FIRST_DEPTH,
        ),
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

  // How she texts follows her mood and how she feels about them; a crisis reply has none of it.
  const moods = inCrisis
    ? Promise.resolve([] as string[])
    : bounded(
        deps,
        "mood keys",
        userId,
        () => loadMoodKeys(deps, userId, clock.now()),
        [] as string[],
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
  const read = inCrisis
    ? Promise.resolve(null)
    : bounded(
        deps,
        "read",
        userId,
        async (): Promise<AssembleInput["read"]> => {
          // A reach-out can surface as a push notification, so it never reads a crisis.
          const row = input.reachOut
            ? await latestNonSensitiveModel(db, userId)
            : await liveModel(db, userId);
          const parsed = modelPayload.safeParse(row?.payload);
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
  // Their things together; nothing playful in a crisis.
  const idiolect = inCrisis
    ? Promise.resolve([] as IdiolectCandidate[])
    : bounded(
        deps,
        "idiolect",
        userId,
        () => loadIdiolect(deps, userId, queryVector),
        [] as IdiolectCandidate[],
      );
  const noCore = { memories: [] as RetrievedFact[], heldBack: null };
  const coreMemories = inCrisis
    ? Promise.resolve(noCore)
    : limits.then((l) =>
        bounded(
          deps,
          "core memory",
          userId,
          () =>
            retrieveCore(deps, {
              queryText,
              queryVector,
              now: clock.now(),
              forceIds: input.reachOut?.coreMemoryId ? [input.reachOut.coreMemoryId] : [],
              maxDepth: l.peek,
            }),
          noCore,
        ),
      );

  const retrieval = await retrieveFor(deps, userId, input, queryText, queryVector);
  const shownIdiolect = await idiolect;
  const latestSnapshot = await snapshot;
  const allowed = await limits;
  const recalledCore = await coreMemories;
  const herMemories = await tagShares(deps, userId, recalledCore.memories, allowed);
  const heldBack =
    !inCrisis &&
    !input.reachOut &&
    recalledCore.heldBack &&
    !(await bounded(
      deps,
      "held back",
      userId,
      () => heldBackInSession(db, userId, input.anchor.session_id, recalledCore.heldBack!.id),
      true,
    ))
      ? recalledCore.heldBack.id
      : null;
  const selfLines = latestSnapshot
    ? await bounded(
        deps,
        "self lines",
        userId,
        () => deps.core.memory.selfLines(latestSnapshot.version),
        // Unread lines take their section's depth, so a failure never shows a stranger everything.
        sectionDepths(latestSnapshot.content, config.core.depth.by_section),
      )
    : [];
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
  const stageView = await stage;
  const stageText = stageView ? stageLine(stageView, loadStagePhrases(config)) : null;
  const herOpenness = await openness;
  const opennessPhrases = loadOpennessPhrases(config);
  const opennessText = !herOpenness
    ? null
    : inCrisis
      ? crisisOpennessLine(opennessPhrases)
      : opennessLine(herOpenness, opennessPhrases, config.relationship);

  const biases = biasesFor(await moods, config.voice);
  const shape = textingShape(
    recent.filter((t) => t.role === "user").map((t) => t.text),
    config.voice,
    bandShiftOf(biases),
  );
  // A reach-out already knows what it's doing; a reply draws its move, seeded by the turn so a
  // retry draws the same one.
  const move = input.reachOut
    ? null
    : pickMove(`move:${input.anchor.id}`, config.voice.moves.weights, biases);
  const mustAnswer =
    input.openQuestions.length > 0 || input.answering.some((t) => t.text.trim().endsWith("?"));

  const prompt = assemblePrompt({
    valuesDoc: `${loadPersona(config).coreValues}\n\n${loadPrompt("reply", config.prompts.reply)}`,
    // The snapshot never stretches: only her memories can be drawn out as a hint.
    snapshot: latestSnapshot
      ? snapshotWithin(latestSnapshot.content, selfLines, allowed.open)
      : null,
    coreMemories: herMemories,
    heldBack: heldBack ? "There's something here you're not ready to share with them yet." : null,
    feelingLine: await feeling,
    relationshipSummary: youAndThem,
    stage: stageText,
    openness: opennessText,
    summary: await summary,
    read: await read,
    yourDay: await yourDay,
    retrieval,
    openQuestions: inCrisis ? [] : input.openQuestions,
    ideas: shownIdeas.map((i) => i.content),
    idiolect: shownIdiolect.map((i) => ({ content: i.content, started_by: i.payload.started_by })),
    recentTurns: recent,
    gapMarkerMinHours: config.chat.gap_line_min_hours,
    windowGapHours: config.chat.window_gap_hours,
    now: clock.now(),
    howToText: inCrisis
      ? null
      : howToText({ shape, move, mustAnswer }, loadHowToTextPhrases(config)),
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
      recalledFacts: [
        ...guardFacts(retrieval, herMemories),
        // Their things together are shared memory too: a callback to one isn't invented.
        ...shownIdiolect.map((i) => ({ id: i.id, subject: "shared", content: i.content })),
      ],
      onboardingFacts: await onboarding,
      ownContext: [await yourDay, await feeling].filter((line): line is string => !!line),
      usedOnOccasion: await occasion,
    },
  });

  // Shaping only changes form, so it runs after the guard; a crisis reply goes out as written.
  const text = inCrisis
    ? guarded.text
    : shapeText(
        guarded.text,
        { maxWords: shape.band.max_words * config.voice.split_tolerance, formal: shape.formal },
        config.chat.max_parts,
      );

  return {
    text,
    parts: splitParts(text, config.chat.max_parts),
    // What she was offered of their things together is reinforced like any recalled memory.
    recalled: [
      ...retrieval.recalled,
      ...shownIdiolect.map((i) => ({
        factId: i.id,
        sim: i.sim,
        fact_salience: i.salience,
        entity_salience: 1,
        recency: 1,
        score: i.sim * i.salience,
        forced: false,
      })),
    ],
    snapshotVersion: latestSnapshot?.version ?? null,
    openness: herOpenness,
    depth: { ...allowed, held_back: heldBack },
    offeredIdeas: shownIdeas.map((i) => i.id),
    pointed: inCrisis ? null : guarded.pointed,
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

/**
 * Marks each of her memories with what this person already knows of it, and hints at anything
 * past her usual limit. A ledger she can't read leaves the memories unmarked, never missing.
 */
async function tagShares(
  deps: Deps,
  userId: string,
  memories: RetrievedFact[],
  limits: DepthLimits,
): Promise<RetrievedFact[]> {
  if (!memories.length) return memories;
  const ledger = await bounded(
    deps,
    "ledger",
    userId,
    () =>
      disclosureLevels(
        deps.db,
        userId,
        memories.map((m) => m.id),
      ),
    new Map<string, "open" | "peek">(),
  );
  return memories.map((m) => {
    const seen = ledger.get(m.id);
    const share =
      seen === "open"
        ? "known"
        : seen === "peek"
          ? "hinted"
          : (m.depth ?? 1) > limits.open
            ? "hint"
            : undefined;
    return share ? { ...m, share } : m;
  });
}
