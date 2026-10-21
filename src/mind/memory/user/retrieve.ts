/**
 * Retrieval for the hot path. It ranks the user's memories against the conversation, then forces
 * in what must be there: a reach-out's own topic and threads due a check-in. Read-only, and it
 * never throws: a failure degrades to whatever could still be found, so a memory problem never
 * costs the user their reply.
 */
import { candidateFacts, getFact, type CandidateFact } from "@/db/repos/user/facts";
import type { Turn } from "@/db/repos/user/session-log";
import { dueThreads } from "@/db/repos/user/threads";
import { embedQuery } from "@/mind/memory/shared/embed-query";
import { rankMemories, type Scored } from "@/mind/memory/shared/ranking";
import {
  emptyRetrieval,
  type RecalledFact,
  type RetrievalResult,
  type RetrievedFact,
} from "@/mind/memory/shared/types";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";

type RetrieveDeps = Pick<Deps, "db" | "embedder" | "config" | "log">;

export type RetrieveInput = {
  /** The turns being answered; a list, so a multi-message buffer fits. */
  answering: Turn[];
  context: Turn[];
  now: Date;
  queryText?: string;
  /** The query already embedded by the caller; null when there's nothing to rank against. */
  queryVector?: Promise<number[] | null>;
  forceFactIds?: string[];
  /** Reach-outs: keeps every sensitive memory out, whether ranked, forced or due. */
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

export function isSensitive(fact: { payload: unknown }): boolean {
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
    const vector = await (input.queryVector ?? embedQuery({ embedder, config }, query));
    if (!vector) return [];

    const candidates = await candidateFacts(db, userId, vector, config.retrieval.candidate_pool, {
      excludeSensitive: input.excludeSensitive === true,
    });
    return rankMemories(candidates, input.now, config.retrieval);
  } catch (e) {
    log.error("retrieval degraded", { userId, error: errorName(e) });
    return [];
  }
}

/** Whether they told her this, or she worked it out herself: what they know she knows. */
export function originOf(source: string, kind: string): RetrievedFact["origin"] {
  if (source === "onboarding") return "onboarding";
  if (source === "inferred" || ["reflection", "belief", "model"].includes(kind)) return "guess";
  return undefined;
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
      noted: memory.created_at,
      origin: originOf(memory.source, memory.kind),
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
      noted: fact.created_at,
      origin: originOf(fact.source, fact.kind),
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
