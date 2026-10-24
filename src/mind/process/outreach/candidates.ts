/**
 * Reach-out candidates: every reason she might write first, each scored in code as weight ×
 * strength. A candidate is filtered out when its topic was already used, when it's sensitive, or
 * when it scores under the threshold. A thread's topic is keyed on their newest fact on it, so it
 * goes out once until they bring it up again; candidates carry dated notes for the reason line.
 * Pure. Sorted their things first, then by score (then kind order, then topic), with filtered
 * candidates kept so the log shows them too.
 */
import type { OutreachConfig } from "@/mind/platform/config";
import { HOUR } from "@/mind/platform/time";
import {
  KIND_ORDER,
  type Candidate,
  type CandidateKind,
  type CandidateInputs,
  type FilterReason,
  type Note,
} from "./types";

/** Their things (a due thread, making up, their event) always come before hers. */
const THEIRS: ReadonlySet<CandidateKind> = new Set(["thread", "make_up", "user_event"]);
const tier = (c: Candidate) => (THEIRS.has(c.kind) ? 0 : 1);

type RawCandidate = Omit<Candidate, "score" | "filtered" | "notes"> & {
  notes?: Note[];
  sensitive: boolean;
  tooDeep?: boolean;
};

export function buildCandidates(
  inputs: CandidateInputs,
  settings: OutreachConfig,
  now: Date,
): Candidate[] {
  const raw: RawCandidate[] = [];
  // A memory already behind a due thread doesn't also become a user_event candidate.
  const claimedFacts = new Set<string>();

  for (const thread of inputs.dueThreads) {
    if (thread.stakes !== "high" && thread.stakes !== "med") continue;
    // A date is what keeps a past event from reading as upcoming, so a dated fact goes first.
    const dated = thread.facts.filter((f) => f.dated);
    const facts = [...dated, ...thread.facts.filter((f) => !f.dated)].slice(
      0,
      settings.reason_facts,
    );
    const lead = dated[0]?.content;

    raw.push({
      kind: "thread",
      // Keyed on what they last said about it: her own reach-out adds nothing about them, so the
      // thread goes out once until they bring it up again.
      topic: `thread:${thread.id}@${thread.facts[0]?.id ?? "none"}`,
      text: lead
        ? `${thread.title}: ${lead}`
        : thread.detail
          ? `${thread.title} (latest: ${thread.detail})`
          : thread.title,
      strength: settings.stakes_strength[thread.stakes],
      factId: thread.fact_id,
      coreMemoryId: null,
      threadId: thread.id,
      sensitive: thread.sensitive,
      notes: facts.map((f) => ({ text: f.content, at: f.at.toISOString(), dated: f.dated })),
    });
    if (thread.fact_id) claimedFacts.add(thread.fact_id);
  }

  const makeUp = makeUpCandidate(inputs.makeUp);
  if (makeUp) raw.push(makeUp);

  for (const memory of inputs.userEvents) {
    if (claimedFacts.has(memory.id)) continue;
    claimedFacts.add(memory.id);
    raw.push({
      kind: "user_event",
      topic: `fact:${memory.id}`,
      text: memory.content,
      strength: memory.salience,
      factId: memory.id,
      coreMemoryId: null,
      threadId: null,
      sensitive: memory.sensitive,
      notes: memory.occurred_at
        ? [{ text: memory.content, at: memory.occurred_at.toISOString(), dated: true }]
        : [],
    });
  }
  for (const memory of inputs.herDay) {
    raw.push({
      kind: "her_day",
      topic: `core:${memory.id}`,
      text: memory.content,
      strength: memory.salience,
      factId: null,
      coreMemoryId: memory.id,
      threadId: null,
      sensitive: memory.sensitive,
      depth: memory.depth,
      tooDeep: memory.depth > inputs.depthLimit,
      notes: [{ text: memory.content, at: memory.at.toISOString(), dated: true }],
    });
  }
  for (const memory of inputs.coreThoughts) {
    raw.push({
      kind: "core_thought",
      // Her day's namespace: one memory of hers reaches a user once, whichever kind carries it.
      topic: `core:${memory.id}`,
      text: memory.content,
      strength: memory.salience,
      factId: null,
      coreMemoryId: memory.id,
      threadId: null,
      sensitive: false,
      depth: memory.depth,
      tooDeep: memory.depth > inputs.depthLimit,
    });
  }
  for (const idea of inputs.userIdeas) {
    raw.push({
      kind: "user_idea",
      topic: `idea:${idea.id}`,
      text: idea.content,
      strength: idea.salience,
      factId: idea.id,
      coreMemoryId: null,
      threadId: null,
      sensitive: false,
      notes: idea.notes,
    });
  }

  const checkIn = checkInCandidate(inputs.checkIn, settings, now);
  if (checkIn) raw.push(checkIn);

  const usedTopics = new Set(inputs.usedTopics);
  const threshold = herThreshold(inputs.theirRate, settings);
  return raw
    .map(({ sensitive, tooDeep, notes, ...candidate }): Candidate => {
      const score = settings.weights[candidate.kind] * candidate.strength;
      const filtered =
        filterReason(candidate.topic, sensitive, tooDeep ?? false, score, usedTopics, threshold) ??
        // Ideas are her questions about them: two in a row without a word from them reads as an
        // interview.
        (candidate.kind === "user_idea" && inputs.lastSentKind === "user_idea"
          ? "idea_again"
          : null);
      return { ...candidate, notes: notes ?? [], score, filtered };
    })
    .sort(
      (a, b) =>
        tier(a) - tier(b) ||
        b.score - a.score ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.topic.localeCompare(b.topic),
    );
}

function makeUpCandidate(makeUp: CandidateInputs["makeUp"]): RawCandidate | null {
  if (!makeUp.due) return null;

  const key = makeUp.causeFactId ?? makeUp.lastHurtAt?.toISOString() ?? "unknown";
  return {
    kind: "make_up",
    topic: `make_up:${key}`,
    text: makeUp.causeText ?? "Something hurt between you recently.",
    strength: makeUp.hurt,
    factId: makeUp.causeFactId,
    coreMemoryId: null,
    threadId: null,
    sensitive: false,
  };
}

/** Strength grows with how far past their usual gap the silence has gone. */
function checkInCandidate(
  checkIn: CandidateInputs["checkIn"],
  settings: OutreachConfig,
  now: Date,
): RawCandidate | null {
  const { lastContact, medianGapHours } = checkIn;
  if (!lastContact) return null;

  const gapRatio = (now.getTime() - lastContact.getTime()) / HOUR / medianGapHours;
  if (gapRatio < settings.check_in_gap_factor) return null;

  return {
    kind: "check_in",
    topic: `check_in:${lastContact.toISOString()}`,
    text: "",
    strength: Math.min(1, gapRatio / (2 * settings.check_in_gap_factor)),
    factId: null,
    coreMemoryId: null,
    threadId: null,
    sensitive: false,
  };
}

function filterReason(
  topic: string,
  sensitive: boolean,
  tooDeep: boolean,
  score: number,
  usedTopics: Set<string>,
  threshold: number,
): FilterReason | null {
  if (sensitive) return "sensitive";
  if (tooDeep) return "too_deep";
  if (usedTopics.has(topic)) return "topic_used";
  if (score < threshold) return "below_threshold";
  return null;
}

/** The best candidate that isn't filtered out, or none. */
/**
 * How readily she writes first to this person. Her own chattiness moves part-way toward how much
 * she thinks they text, once she has a sense of it; the caps and gates still apply.
 */
export function herThreshold(theirRate: number | null, settings: OutreachConfig): number {
  if (theirRate === null) return settings.threshold;
  const { default: base, toward_them, scale_min, scale_max } = settings.her_rate;
  const hers = base + toward_them * (theirRate - base);
  const scale = Math.min(scale_max, Math.max(scale_min, hers / base));
  return settings.threshold / scale;
}

export function pickWinner(candidates: Candidate[]): Candidate | null {
  return candidates.find((c) => c.filtered === null) ?? null;
}

/** Her own news, as opposed to something of theirs or about them. */
const HERS: ReadonlySet<CandidateKind> = new Set(["her_day", "core_thought"]);

/**
 * The week's last slot is kept for them: with one left, her own news waits, so a thread that
 * comes due later in the week still has room.
 */
export function holdLastSlot(
  candidates: Candidate[],
  sentThisWeek: number,
  settings: OutreachConfig,
): Candidate[] {
  if (settings.cap_per_week - sentThisWeek > 1) return candidates;
  return candidates.map((c) =>
    HERS.has(c.kind) && c.filtered === null ? { ...c, filtered: "last_slot" as const } : c,
  );
}

/** The day a topic is about: its latest dated note; null when nothing behind it is dated. */
export function eventDay(notes: Note[]): Date | null {
  const dated = notes.filter((n) => n.dated).map((n) => new Date(n.at).getTime());
  return dated.length ? new Date(Math.max(...dated)) : null;
}
