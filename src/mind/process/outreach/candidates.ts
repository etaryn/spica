/**
 * Reach-out candidates: every reason she might write first, each scored in code as weight ×
 * strength. A candidate is filtered out when its topic was already used, when it's sensitive, or
 * when it scores under the threshold. A thread's topic is keyed on their newest fact on it, so it
 * goes out once until they bring it up again; candidates carry dated notes for the reason line.
 * Pure. Sorted best first (score, then kind order, then
 * topic), with filtered candidates kept so the log shows them too.
 */
import type { OutreachConfig } from "@/mind/platform/config";
import { HOUR } from "@/mind/platform/time";
import {
  KIND_ORDER,
  type Candidate,
  type CandidateInputs,
  type FilterReason,
  type Note,
} from "./types";

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
    const facts = thread.facts.slice(0, settings.reason_facts);

    raw.push({
      kind: "thread",
      // Keyed on what they last said about it: her own reach-out adds nothing about them, so the
      // thread goes out once until they bring it up again.
      topic: `thread:${thread.id}@${facts[0]?.id ?? "none"}`,
      text: thread.detail ? `${thread.title} (latest: ${thread.detail})` : thread.title,
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
    });
  }

  const checkIn = checkInCandidate(inputs.checkIn, settings, now);
  if (checkIn) raw.push(checkIn);

  const usedTopics = new Set(inputs.usedTopics);
  return raw
    .map(({ sensitive, tooDeep, notes, ...candidate }): Candidate => {
      const score = settings.weights[candidate.kind] * candidate.strength;
      const filtered = filterReason(
        candidate.topic,
        sensitive,
        tooDeep ?? false,
        score,
        usedTopics,
        settings,
      );
      return { ...candidate, notes: notes ?? [], score, filtered };
    })
    .sort(
      (a, b) =>
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
  settings: OutreachConfig,
): FilterReason | null {
  if (sensitive) return "sensitive";
  if (tooDeep) return "too_deep";
  if (usedTopics.has(topic)) return "topic_used";
  if (score < settings.threshold) return "below_threshold";
  return null;
}

/** The best candidate that isn't filtered out, or none. */
export function pickWinner(candidates: Candidate[]): Candidate | null {
  return candidates.find((c) => c.filtered === null) ?? null;
}
