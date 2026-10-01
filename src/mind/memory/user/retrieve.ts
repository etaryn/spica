/**
 * Retrieval for the hot path. It ranks the user's memories against the conversation, then forces
 * in what must be there: a reach-out's own topic, threads due a check-in, and her current
 * preoccupation. Read-only, and it never throws: a failure degrades to whatever could still be
 * found, so a memory problem never costs the user their reply.
 */
import {
  candidateFacts,
  getFact,
  getPreoccupationFact,
  type CandidateFact,
} from "@/db/repos/user/facts";
import type { Turn } from "@/db/repos/user/session-log";
import { dueThreads } from "@/db/repos/user/threads";
import { rankMemories, type Scored } from "@/mind/memory/shared/ranking";
import {
  emptyRetrieval,
  type RecalledFact,
  type RetrievalResult,
} from "@/mind/memory/shared/types";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { withTimeout } from "@/mind/platform/timeout";

type RetrieveDeps = Pick<Deps, "db" | "embedder" | "config" | "log">;

export type RetrieveInput = {
  /** The turns being answered; a list, so a multi-message buffer fits. */
  answering: Turn[];
  context: Turn[];
  now: Date;
  queryText?: string;
  forceFactIds?: string[];
  /** Reach-outs: keeps every sensitive memory out, whether ranked, forced, due or on her mind. */
  excludeSensitive?: boolean;
};

/** A forced memory skips ranking, so its score breakdown is fixed. */
function forcedRecall(factId: string, salience: number): RecalledFact {
  return {
    factId,
    sim: 0,
    fact_salience: salience,
    entity_salience: 1,
    recency: 1,
    score: 0,
    forced: true,
  };
}

function isSensitive(fact: { payload: unknown }): boolean {
  return (fact.payload as { sensitive?: unknown } | null)?.sensitive === true;
}

export async function retrieve(
  deps: RetrieveDeps,
  userId: string,
  input: RetrieveInput,
): Promise<RetrievalResult> {
  const result = emptyRetrieval();
  const seen = new Set<string>();

  addRanked(result, seen, await rankAgainstConversation(deps, userId, input));

  try {
    await addForcedFacts(deps, userId, input, result, seen);
    await addDueThreads(deps, userId, input, result, seen);
    await addPreoccupation(deps, userId, input, result, seen);
  } catch (e) {
    deps.log.error("forced retrieval failed", { userId, error: errorName(e) });
  }

  return result;
}

async function rankAgainstConversation(
  deps: RetrieveDeps,
  userId: string,
  input: RetrieveInput,
): Promise<Scored<CandidateFact>[]> {
  const { db, embedder, config, log } = deps;

  try {
    const query =
      input.queryText ?? [...input.context, ...input.answering].map((t) => t.text).join("\n");
    // A check-in with no turns has nothing to rank against, so skip the embed.
    if (query.trim() === "") return [];

    const [vector] = await withTimeout(
      embedder.embed([query], "query"),
      config.retrieval.embed_timeout_ms,
    );
    if (!vector) throw new Error("embedder returned no vector");

    const candidates = await candidateFacts(
      db,
      userId,
      vector,
      config.retrieval.candidate_pool,
      input.now,
      { excludeSensitive: input.excludeSensitive === true },
    );
    return rankMemories(candidates, input.now, config.retrieval);
  } catch (e) {
    log.error("retrieval degraded", { userId, error: errorName(e) });
    return [];
  }
}

function addRanked(
  result: RetrievalResult,
  seen: Set<string>,
  ranked: Scored<CandidateFact>[],
): void {
  for (const memory of ranked) {
    seen.add(memory.id);
    result.facts[memory.subject].push({
      id: memory.id,
      content: memory.content,
      when: memory.occurred_at ?? memory.created_at,
    });
    result.recalled.push({
      factId: memory.id,
      sim: memory.sim,
      fact_salience: memory.salience,
      entity_salience: memory.entity_salience,
      recency: memory.recency,
      score: memory.score,
      forced: false,
    });
  }
}

/** No future-date filter: the only caller (a reach-out) passes memories whose time has come. */
async function addForcedFacts(
  deps: RetrieveDeps,
  userId: string,
  input: RetrieveInput,
  result: RetrievalResult,
  seen: Set<string>,
): Promise<void> {
  const excludeSensitive = input.excludeSensitive === true;

  for (const id of input.forceFactIds ?? []) {
    if (seen.has(id)) continue;

    const fact = await getFact(deps.db, userId, id);
    if (!fact || fact.status === "superseded" || fact.status === "stale") continue;
    if (excludeSensitive && isSensitive(fact)) continue;

    seen.add(id);
    result.facts[fact.subject].push({
      id: fact.id,
      content: fact.content,
      when: fact.occurred_at ?? fact.created_at,
    });
    result.recalled.push(forcedRecall(fact.id, fact.salience));
  }
}

/** A due thread is judged sensitive by its latest memory. */
async function addDueThreads(
  deps: RetrieveDeps,
  userId: string,
  input: RetrieveInput,
  result: RetrievalResult,
  seen: Set<string>,
): Promise<void> {
  const due = await dueThreads(deps.db, userId, input.now, deps.config.retrieval.max_due_threads);

  for (const thread of due) {
    if (input.excludeSensitive === true && thread.sensitive) continue;

    result.dueThreads.push({ id: thread.id, title: thread.title, detail: thread.content });

    if (thread.fact_id && !seen.has(thread.fact_id)) {
      seen.add(thread.fact_id);
      result.recalled.push(forcedRecall(thread.fact_id, thread.salience ?? 0));
    }
  }
}

/** Marks her preoccupation "on your mind lately", adding it if ranking didn't find it. */
async function addPreoccupation(
  deps: RetrieveDeps,
  userId: string,
  input: RetrieveInput,
  result: RetrievalResult,
  seen: Set<string>,
): Promise<void> {
  const preoccupation = await getPreoccupationFact(deps.db, userId, input.now);
  if (!preoccupation) return;
  if (input.excludeSensitive === true && isSensitive(preoccupation)) return;

  const alreadyIncluded = result.facts.self.find((f) => f.id === preoccupation.id);
  if (alreadyIncluded) {
    alreadyIncluded.onMind = true;
    return;
  }
  if (seen.has(preoccupation.id)) return;

  seen.add(preoccupation.id);
  result.facts.self.push({
    id: preoccupation.id,
    content: preoccupation.content,
    when: preoccupation.occurred_at ?? preoccupation.created_at,
    onMind: true,
  });
  result.recalled.push(forcedRecall(preoccupation.id, preoccupation.salience));
}
