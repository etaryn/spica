/**
 * Reach-out candidates: every reason she might write first, each scored in code as weight ×
 * strength. A candidate is filtered out when its topic was already used, when it's sensitive, or
 * when it scores under the threshold. Pure. Sorted best first (score, then kind order, then
 * topic), with filtered candidates kept so the log shows them too.
 */
import type { OutreachConfig } from "@/mind/platform/config";
import { HOUR } from "@/mind/platform/time";
import {
  KIND_ORDER,
  type Candidate,
  type CandidateInputs,
  type CandidateKind,
  type FilterReason,
} from "./types";

type RawCandidate = Omit<Candidate, "score" | "filtered"> & { sensitive: boolean };
type MemoryInput = CandidateInputs["userEvents"][number];

export function buildCandidates(
  inputs: CandidateInputs,
  settings: OutreachConfig,
  now: Date,
): Candidate[] {
  const raw: RawCandidate[] = [];
  // A memory already behind a due thread doesn't also become a user_event or her_day candidate.
  const claimedFacts = new Set<string>();

  for (const thread of inputs.dueThreads) {
    if (thread.stakes !== "high" && thread.stakes !== "med") continue;

    raw.push({
      kind: "thread",
      topic: `thread:${thread.id}@${thread.next_checkpoint.toISOString()}`,
      text: thread.detail ? `${thread.title} (latest: ${thread.detail})` : thread.title,
      strength: settings.stakes_strength[thread.stakes],
      factId: thread.fact_id,
      threadId: thread.id,
      sensitive: thread.sensitive,
    });
    if (thread.fact_id) claimedFacts.add(thread.fact_id);
  }

  const makeUp = makeUpCandidate(inputs.makeUp);
  if (makeUp) raw.push(makeUp);

  const addMemory = (kind: CandidateKind, memory: MemoryInput) => {
    if (claimedFacts.has(memory.id)) return;
    claimedFacts.add(memory.id);
    raw.push({
      kind,
      topic: `fact:${memory.id}`,
      text: memory.content,
      strength: memory.salience,
      factId: memory.id,
      threadId: null,
      sensitive: memory.sensitive,
    });
  };
  for (const memory of inputs.userEvents) addMemory("user_event", memory);
  for (const memory of inputs.herDay) addMemory("her_day", memory);

  const checkIn = checkInCandidate(inputs.checkIn, settings, now);
  if (checkIn) raw.push(checkIn);

  const usedTopics = new Set(inputs.usedTopics);
  return raw
    .map(({ sensitive, ...candidate }): Candidate => {
      const score = settings.weights[candidate.kind] * candidate.strength;
      const filtered = filterReason(candidate.topic, sensitive, score, usedTopics, settings);
      return { ...candidate, score, filtered };
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
    threadId: null,
    sensitive: false,
  };
}

function filterReason(
  topic: string,
  sensitive: boolean,
  score: number,
  usedTopics: Set<string>,
  settings: OutreachConfig,
): FilterReason | null {
  if (sensitive) return "sensitive";
  if (usedTopics.has(topic)) return "topic_used";
  if (score < settings.threshold) return "below_threshold";
  return null;
}

/** The best candidate that isn't filtered out, or none. */
export function pickWinner(candidates: Candidate[]): Candidate | null {
  return candidates.find((c) => c.filtered === null) ?? null;
}
