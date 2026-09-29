import { candidateFacts, getPreoccupationFact } from "@/db/repos/facts";
import type { Turn } from "@/db/repos/session-log";
import { dueThreads } from "@/db/repos/threads";
import { emptyRetrieval, type RetrievalResult } from "../chat/assemble";
import type { Deps } from "../deps";
import { withTimeout } from "../timeout";
import { rankCandidates, type Scored } from "./score";

const errName = (e: unknown) => String((e as Error)?.name ?? "Error");

/**
 * Hot-path retrieval (v2 §6.2 step 1). Read-only and never throws: any failure
 * degrades to whatever could still be retrieved, so a memory problem never costs
 * the user their reply. `answering` is a list so the Phase 3 turn buffer fits.
 */
export async function retrieve(
  deps: Pick<Deps, "db" | "embedder" | "config" | "log">,
  userId: string,
  input: { answering: Turn[]; context: Turn[]; now: Date },
): Promise<RetrievalResult> {
  const { db, embedder, config, log } = deps;
  const result = emptyRetrieval();
  const seen = new Set<string>();

  let scored: Scored[] = [];
  try {
    const text = [...input.context, ...input.answering].map((t) => t.text).join("\n");
    const [q] = await withTimeout(embedder.embed([text], "query"), config.retrieval.embed_timeout_ms);
    if (!q) throw new Error("embedder returned no vector");
    scored = rankCandidates(await candidateFacts(db, userId, q, config.retrieval.candidate_pool), input.now, config.retrieval);
  } catch (e) {
    log.error("retrieval degraded", { userId, error: errName(e) });
  }
  for (const s of scored) {
    seen.add(s.id);
    result.facts[s.subject].push({ id: s.id, content: s.content, when: s.occurred_at ?? s.created_at });
    result.recalled.push({
      factId: s.id, sim: s.sim, fact_salience: s.salience, entity_salience: s.entity_salience,
      recency: s.recency, score: s.score, forced: false,
    });
  }

  try {
    for (const t of await dueThreads(db, userId, input.now, config.retrieval.max_due_threads)) {
      result.dueThreads.push({ id: t.id, title: t.title, detail: t.content });
      if (t.fact_id && !seen.has(t.fact_id)) {
        seen.add(t.fact_id);
        result.recalled.push({ factId: t.fact_id, sim: 0, fact_salience: t.salience ?? 0, entity_salience: 1, recency: 1, score: 0, forced: true });
      }
    }
    const pre = await getPreoccupationFact(db, userId);
    if (pre) {
      const hit = result.facts.self.find((f) => f.id === pre.id);
      if (hit) hit.onMind = true;
      else if (!seen.has(pre.id)) {
        seen.add(pre.id);
        result.facts.self.push({ id: pre.id, content: pre.content, when: pre.occurred_at ?? pre.created_at, onMind: true });
        result.recalled.push({ factId: pre.id, sim: 0, fact_salience: pre.salience, entity_salience: 1, recency: 1, score: 0, forced: true });
      }
    }
  } catch (e) {
    log.error("forced retrieval failed", { userId, error: errName(e) });
  }
  return result;
}
