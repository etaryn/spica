import type { OutreachConfig } from "../config";
import { HOUR } from "../time";
import { KIND_ORDER, type Candidate, type CandidateInputs, type CandidateKind } from "./types";

type Raw = Omit<Candidate, "score" | "filtered"> & { sensitive: boolean };

/**
 * every candidate with its score and, if it can't win, why. Pure. Sorted best first
 * (score desc, then kind order, then topic), filtered ones included so the log shows them.
 */
export function buildCandidates(i: CandidateInputs, cfg: OutreachConfig, now: Date): Candidate[] {
  const raw: Raw[] = [];
  const seenFacts = new Set<string>();

  for (const t of i.dueThreads) {
    if (t.stakes !== "high" && t.stakes !== "med") continue;
    raw.push({
      kind: "thread", topic: `thread:${t.id}@${t.next_checkpoint.toISOString()}`,
      text: t.detail ? `${t.title} (latest: ${t.detail})` : t.title,
      strength: cfg.stakes_strength[t.stakes], factId: t.fact_id, threadId: t.id, sensitive: t.sensitive,
    });
    // Reserve fact_id from due threads so they don't become user_event/her_day candidates
    if (t.fact_id) seenFacts.add(t.fact_id);
  }

  if (i.makeUp.due) {
    const key = i.makeUp.causeFactId ?? i.makeUp.lastHurtAt?.toISOString() ?? "unknown";
    raw.push({
      kind: "make_up", topic: `make_up:${key}`, text: i.makeUp.causeText ?? "Something hurt between you recently.",
      strength: i.makeUp.hurt, factId: i.makeUp.causeFactId, threadId: null, sensitive: false,
    });
  }

  const factCand = (kind: CandidateKind, f: { id: string; content: string; salience: number; sensitive: boolean }) => {
    if (seenFacts.has(f.id)) return;
    seenFacts.add(f.id);
    raw.push({ kind, topic: `fact:${f.id}`, text: f.content, strength: f.salience, factId: f.id, threadId: null, sensitive: f.sensitive });
  };
  for (const f of i.userEvents) factCand("user_event", f);
  for (const f of i.herDay) factCand("her_day", f);

  const { lastContact, medianGapHours } = i.checkIn;
  if (lastContact) {
    const ratio = (now.getTime() - lastContact.getTime()) / HOUR / medianGapHours;
    if (ratio >= cfg.check_in_gap_factor) {
      raw.push({
        kind: "check_in", topic: `check_in:${lastContact.toISOString()}`, text: "",
        strength: Math.min(1, ratio / (2 * cfg.check_in_gap_factor)), factId: null, threadId: null, sensitive: false,
      });
    }
  }

  const used = new Set(i.usedTopics);
  return raw.map(({ sensitive, ...c }): Candidate => {
    const score = cfg.weights[c.kind] * c.strength;
    const filtered = sensitive ? "sensitive" : used.has(c.topic) ? "topic_used" : score < cfg.threshold ? "below_threshold" : null;
    return { ...c, score, filtered };
  }).sort((a, b) => b.score - a.score || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.topic.localeCompare(b.topic));
}

/** the best unfiltered candidate, or none. */
export function pickWinner(cands: Candidate[]): Candidate | null {
  return cands.find((c) => c.filtered === null) ?? null;
}
