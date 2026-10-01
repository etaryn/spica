import { candidateFacts, getFact, getPreoccupationFact } from "@/db/repos/facts";
import type { Turn } from "@/db/repos/session-log";
import { dueThreads } from "@/db/repos/threads";
import { emptyRetrieval, type RetrievalResult } from "../chat/assemble";
import type { Deps } from "../deps";
import { errorName } from "../errors";
import { withTimeout } from "../timeout";
import { rankCandidates, type Scored } from "./score";

/**
 * Hot-path retrieval. Read-only and never throws: any failure
 * degrades to whatever could still be retrieved, so a memory problem never costs
 * the user their reply. `answering` is a list so a multi-turn buffer fits. `excludeSensitive` (reach-outs)
 * keeps every `payload.sensitive` fact out: ranked, forced, due threads (by their latest fact) and the preoccupation.
 */
export async function retrieve(
  deps: Pick<Deps, "db" | "embedder" | "config" | "log">,
  userId: string,
  input: {
    answering: Turn[];
    context: Turn[];
    now: Date;
    queryText?: string;
    forceFactIds?: string[];
    excludeSensitive?: boolean;
  },
): Promise<RetrievalResult> {
  const { db, embedder, config, log } = deps;
  const result = emptyRetrieval();
  const seen = new Set<string>();
  const excl = input.excludeSensitive === true;
  const isSensitive = (f: { payload: unknown }) =>
    (f.payload as { sensitive?: unknown } | null)?.sensitive === true;

  let scored: Scored[] = [];
  try {
    const text =
      input.queryText ?? [...input.context, ...input.answering].map((t) => t.text).join("\n");
    // An empty query (a check-in with no turns) has nothing to rank against: skip the embed.
    if (text.trim() !== "") {
      const [q] = await withTimeout(
        embedder.embed([text], "query"),
        config.retrieval.embed_timeout_ms,
      );
      if (!q) throw new Error("embedder returned no vector");
      scored = rankCandidates(
        await candidateFacts(db, userId, q, config.retrieval.candidate_pool, input.now, {
          excludeSensitive: excl,
        }),
        input.now,
        config.retrieval,
      );
    }
  } catch (e) {
    log.error("retrieval degraded", { userId, error: errorName(e) });
  }
  for (const s of scored) {
    seen.add(s.id);
    result.facts[s.subject].push({
      id: s.id,
      content: s.content,
      when: s.occurred_at ?? s.created_at,
    });
    result.recalled.push({
      factId: s.id,
      sim: s.sim,
      fact_salience: s.salience,
      entity_salience: s.entity_salience,
      recency: s.recency,
      score: s.score,
      forced: false,
    });
  }

  try {
    // No future-dated filter here: the only caller (a reach-out's candidate) passes facts whose time has come.
    for (const id of input.forceFactIds ?? []) {
      if (seen.has(id)) continue;
      const f = await getFact(db, userId, id);
      if (!f || f.status === "superseded" || f.status === "stale" || (excl && isSensitive(f)))
        continue;
      seen.add(id);
      result.facts[f.subject].push({
        id: f.id,
        content: f.content,
        when: f.occurred_at ?? f.created_at,
      });
      result.recalled.push({
        factId: f.id,
        sim: 0,
        fact_salience: f.salience,
        entity_salience: 1,
        recency: 1,
        score: 0,
        forced: true,
      });
    }
    for (const t of await dueThreads(db, userId, input.now, config.retrieval.max_due_threads)) {
      if (excl && t.sensitive) continue;
      result.dueThreads.push({ id: t.id, title: t.title, detail: t.content });
      if (t.fact_id && !seen.has(t.fact_id)) {
        seen.add(t.fact_id);
        result.recalled.push({
          factId: t.fact_id,
          sim: 0,
          fact_salience: t.salience ?? 0,
          entity_salience: 1,
          recency: 1,
          score: 0,
          forced: true,
        });
      }
    }
    const pre = await getPreoccupationFact(db, userId, input.now);
    if (pre && !(excl && isSensitive(pre))) {
      const hit = result.facts.self.find((f) => f.id === pre.id);
      if (hit) hit.onMind = true;
      else if (!seen.has(pre.id)) {
        seen.add(pre.id);
        result.facts.self.push({
          id: pre.id,
          content: pre.content,
          when: pre.occurred_at ?? pre.created_at,
          onMind: true,
        });
        result.recalled.push({
          factId: pre.id,
          sim: 0,
          fact_salience: pre.salience,
          entity_salience: 1,
          recency: 1,
          score: 0,
          forced: true,
        });
      }
    }
  } catch (e) {
    log.error("forced retrieval failed", { userId, error: errorName(e) });
  }
  return result;
}
