import { sql } from "drizzle-orm";
import { nearFacts } from "@/db/repos/facts";
import { getTurnsByIds, turnsUpTo } from "@/db/repos/session-log";
import { listOpenThreads } from "@/db/repos/threads";
import { getTimezone } from "@/db/repos/users";
import type { Deps } from "./deps";
import { applyExtraction, type ApplyOutcome, type PlannedFact } from "./memory/apply";
import { extract } from "./memory/extract";
import { decide } from "./memory/reconcile";
import type { ColdPathJob } from "./queue";

export class LockBusyError extends Error {}
export type ColdPathOutcome = { status: "done" | "skipped"; applied?: ApplyOutcome };

/**
 * Cold path (v2 §6.3): extract → embed → reconcile → apply, all inside one transaction
 * holding a per-user advisory lock, so a crash writes nothing and two exchanges from
 * one user never reconcile concurrently. Throws on failure so pg-boss retries.
 */
export async function handleColdPath(deps: Deps, job: ColdPathJob): Promise<ColdPathOutcome> {
  const { db, config, clock, embedder, log } = deps;
  return db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${`cold_path:${job.userId}`})) AS ok`);
    if (!lock.rows[0]?.ok) throw new LockBusyError(`cold_path busy for user`);

    const turns = await getTurnsByIds(tx, job.userId, job.turnIds);
    if (turns.length === 0 || turns.every((t) => t.extracted)) return { status: "skipped" };

    const context = (await turnsUpTo(tx, job.userId, turns[0]!, config.extraction.context_turns + 1)).slice(0, -1);
    const extraction = await extract(deps, {
      newTurns: turns,
      contextTurns: context,
      openThreads: await listOpenThreads(tx, job.userId, config.extraction.open_threads_in_prompt),
      timezone: await getTimezone(tx, job.userId),
    });

    const embeddings = extraction.facts.length > 0
      ? await embedder.embed(extraction.facts.map((f) => f.content), "document")
      : [];
    const planned: PlannedFact[] = [];
    for (const [i, fact] of extraction.facts.entries()) {
      const embedding = embeddings[i];
      if (!embedding) throw new Error("embedder returned fewer vectors than facts");
      const neighbors = await nearFacts(tx, job.userId, fact.subject, embedding, config.reconcile.neighbor_k, config.reconcile.near_match_similarity);
      planned.push({ fact, embedding, decision: await decide(deps, fact, neighbors) });
    }

    const applied = await applyExtraction(tx, config, {
      userId: job.userId,
      now: clock.now(),
      entities: extraction.entities,
      facts: planned,
      threads: extraction.threads,
      sensitive: turns.some((t) => t.safety_flag?.flagged),
      sourceRef: job.replyTurnId ?? turns.at(-1)!.id,
      recalled: job.recalled ?? [],
      replyTurnId: job.replyTurnId ?? null,
      turnIds: job.turnIds,
    });
    log.info("cold_path applied", { userId: job.userId, ...applied });
    return { status: "done", applied };
  });
}
