import { sql } from "drizzle-orm";
import { nearFacts } from "@/db/repos/facts";
import { getTurnsByIds, turnsUpTo } from "@/db/repos/session-log";
import { listOpenThreads } from "@/db/repos/threads";
import { getTimezone } from "@/db/repos/users";
import type { Deps } from "./deps";
import { applyExtraction, type ApplyOutcome, type PlannedFact } from "./memory/apply";
import { extract, type ExtractedFact } from "./memory/extract";
import { decide } from "./memory/reconcile";
import type { ColdPathJob } from "./queue";
import { nudgeEgoForExchange } from "./ego/nudge";
import { errorName } from "./errors";
import { applyRelationship } from "./relationship/apply";
import { hurtFactContent } from "./relationship/signals";

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

    const crisis = turns.some((t) => t.safety_flag?.flagged);
    // Phase 6 (spec §6.2 step 5): a reach-out alone is her words only; no user behaviour to score, no exchange tone.
    const hasUserTurn = turns.some((t) => t.role === "user");
    const signals = crisis || !hasUserTurn ? null : extraction.relationship;
    // The hurt cause lives in the fact store (design §5): one self `feeling` fact, reconciled like any other.
    const facts: { fact: ExtractedFact; source: "turn" | "inferred" }[] = extraction.facts.map((fact) => ({ fact, source: "turn" }));
    // Same deadzone comparison applyExchange uses (`>=`): a hurt too small to move the param writes no fact.
    const hurt = signals?.hurt && signals.hurt.amount >= config.relationship.signal_deadzone ? signals.hurt : null;
    if (hurt) {
      facts.push({ source: "inferred", fact: {
        subject: "self", kind: "feeling", content: hurtFactContent(hurt.cause), occurred_at: null,
        salience: config.relationship.hurt_fact_salience, valence: -hurt.amount, confidence: config.relationship.hurt_fact_confidence,
        entity_names: [], thread_title: null,
      } });
    }

    const embeddings = facts.length > 0
      ? await embedder.embed(facts.map((f) => f.fact.content), "document")
      : [];
    const planned: PlannedFact[] = [];
    for (const [i, { fact, source }] of facts.entries()) {
      const embedding = embeddings[i];
      if (!embedding) throw new Error("embedder returned fewer vectors than facts");
      const neighbors = await nearFacts(tx, job.userId, fact.subject, embedding, config.reconcile.neighbor_k, config.reconcile.near_match_similarity);
      planned.push({ fact, embedding, decision: await decide(deps, fact, neighbors), source });
    }

    const applied = await applyExtraction(tx, config, {
      userId: job.userId,
      now: clock.now(),
      exchangeAt: turns[0]!.created_at, // getTurnsByIds sorts oldest first: the exchange's user turn
      entities: extraction.entities,
      facts: planned,
      threads: extraction.threads,
      sensitive: crisis,
      sourceRef: job.replyTurnId ?? turns.at(-1)!.id,
      recalled: job.recalled ?? [],
      replyTurnId: job.replyTurnId ?? null,
      turnIds: job.turnIds,
    });
    log.info("cold_path applied", { userId: job.userId, ...applied });

    const hurtFactId = hurt ? applied.factIds.at(-1) ?? null : null;
    const applyRel = (deps as { applyRelationship?: typeof applyRelationship }).applyRelationship ?? applyRelationship;
    if (hasUserTurn) {
      try {
        await tx.transaction(async (sp) => { await applyRel(sp, deps, { userId: job.userId, turns, signals, crisis, hurtFactId }); });
      } catch (e) {
        log.error("relationship update failed", { userId: job.userId, error: e instanceof Error ? e.constructor.name : "UnknownError" });
      }
    }

    // Phase 5 (design §7.3): its own savepoint, so an ego failure never loses the memory or relationship writes.
    if (hasUserTurn) {
      try {
        await tx.transaction(async (sp) => {
          await nudgeEgoForExchange(sp, config, { userId: job.userId, facts: facts.map((f) => f.fact), crisis, now: clock.now() });
        });
      } catch (e) {
        log.error("ego nudge failed", { userId: job.userId, error: errorName(e) });
      }
    }

    return { status: "done", applied };
  });
}
