/**
 * The cold path: after she has replied, it turns the exchange into memory and relationship state.
 * The steps are extract, embed, reconcile against near memories, grade her own claims against
 * core, encode, then update the
 * relationship, including her feelings toward them. It all runs in one transaction holding a
 * per-user advisory lock, so a crash writes nothing and two exchanges from one user never
 * reconcile at once. It throws on failure so pg-boss retries, and it never delays a reply.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { nearFacts } from "@/db/repos/user/facts";
import { getTurnsByIds, turnsUpTo, type Turn } from "@/db/repos/user/session-log";
import { listOpenThreads } from "@/db/repos/user/threads";
import { getTimezone } from "@/db/repos/user/users";
import { encodeExtraction, type EncodeOutcome, type PlannedFact } from "@/mind/memory/user/encode";
import { extract, type Extraction, type ExtractedFact } from "@/mind/memory/user/extract";
import { reconcileAgainstNeighbours } from "@/mind/memory/shared/reconcile";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import type { ColdPathJob } from "@/mind/platform/jobs";
import { exchangeTone } from "@/mind/state/user/relationship/affect";
import { hurtFactContent, type Signals } from "@/mind/state/user/relationship/signals";
import { updateRelationship } from "@/mind/state/user/relationship/update";

export class LockBusyError extends Error {}

export type ColdPathOutcome = { status: "done" | "skipped"; applied?: EncodeOutcome };

type CandidateFact = { fact: ExtractedFact; source: "turn" | "inferred" };

export async function runColdPath(deps: Deps, job: ColdPathJob): Promise<ColdPathOutcome> {
  const { db, config, clock, log } = deps;

  return db.transaction(async (tx) => {
    const lockKey = `cold_path:${job.userId}`;
    const lock = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS ok`,
    );
    if (!lock.rows[0]?.ok) throw new LockBusyError(`cold_path busy for user`);

    const turns = await getTurnsByIds(tx, job.userId, job.turnIds);
    if (turns.length === 0 || turns.every((t) => t.extracted)) return { status: "skipped" };

    const extraction = await extractExchange(deps, tx, job.userId, turns);

    const crisis = turns.some((t) => t.safety_flag?.flagged);
    // A reach-out on its own is only her words: no user behaviour to score, no exchange tone.
    const hasUserTurn = turns.some((t) => t.role === "user");
    const signals = crisis || !hasUserTurn ? null : extraction.relationship;

    const hurt = significantHurt(signals, config.relationship.signal_deadzone);
    const candidates: CandidateFact[] = extraction.facts.map((fact) => ({ fact, source: "turn" }));
    if (hurt) candidates.push(hurtFeeling(hurt, config));

    const planned = await reconcileCandidates(deps, tx, job.userId, candidates);

    const applied = await encodeExtraction(tx, config, {
      userId: job.userId,
      now: clock.now(),
      // Turns come back oldest first: the exchange's first turn (hers, for a reach-out).
      exchangeAt: turns[0]!.created_at,
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

    if (hasUserTurn) {
      const hurtFactId = hurt ? (applied.factIds.at(-1) ?? null) : null;
      await updateRelationshipSafely(deps, tx, {
        userId: job.userId,
        turns,
        signals,
        crisis,
        hurtFactId,
        // How she feels about them follows what they did. Her own facts are left out: her
        // news isn't about them, and her inferred hurt already moves the hurt param.
        tone: exchangeTone(candidates.filter((c) => c.fact.subject !== "self").map((c) => c.fact)),
      });
    }

    return { status: "done", applied };
  });
}

async function extractExchange(
  deps: Deps,
  tx: Db,
  userId: string,
  turns: Turn[],
): Promise<Extraction> {
  const { config } = deps;
  const context = (
    await turnsUpTo(tx, userId, turns[0]!, config.extraction.context_turns + 1)
  ).slice(0, -1);

  return extract(deps, {
    newTurns: turns,
    contextTurns: context,
    openThreads: await listOpenThreads(tx, userId, config.extraction.open_threads_in_prompt),
    timezone: await getTimezone(tx, userId),
  });
}

/**
 * The same deadzone comparison the relationship uses (`>=`): a hurt too small to move it writes
 * nothing.
 */
function significantHurt(signals: Signals | null, deadzone: number): Signals["hurt"] {
  const hurt = signals?.hurt;
  return hurt && hurt.amount >= deadzone ? hurt : null;
}

/** Why she's hurt lives in memory: one self `feeling` fact, reconciled like any other. */
function hurtFeeling(hurt: NonNullable<Signals["hurt"]>, config: Deps["config"]): CandidateFact {
  return {
    source: "inferred",
    fact: {
      subject: "self",
      kind: "feeling",
      content: hurtFactContent(hurt.cause),
      occurred_at: null,
      salience: config.relationship.hurt_fact_salience,
      valence: -hurt.amount,
      confidence: config.relationship.hurt_fact_confidence,
      entity_names: [],
      thread_title: null,
    },
  };
}

async function reconcileCandidates(
  deps: Deps,
  tx: Db,
  userId: string,
  candidates: CandidateFact[],
): Promise<PlannedFact[]> {
  const { config, embedder } = deps;
  const embeddings = candidates.length
    ? await embedder.embed(
        candidates.map((c) => c.fact.content),
        "document",
      )
    : [];

  const planned: PlannedFact[] = [];
  for (const [i, { fact, source }] of candidates.entries()) {
    const embedding = embeddings[i];
    if (!embedding) throw new Error("embedder returned fewer vectors than facts");

    const neighbors = await nearFacts(
      tx,
      userId,
      fact.subject,
      embedding,
      config.reconcile.neighbor_k,
      config.reconcile.near_match_similarity,
    );
    const decision = await reconcileAgainstNeighbours(
      deps,
      { label: `${fact.subject}, ${fact.kind}`, content: fact.content },
      neighbors,
    );
    planned.push({
      fact,
      embedding,
      decision,
      source,
      grounded: await groundClaim(deps, fact, embedding),
    });
  }
  return planned;
}

/**
 * Whether her own life or opinion claim is backed by core (her memory, values or latest self).
 * Reading core here is one-way; the answer is stored only on this user's fact. A failure leaves
 * it unknown rather than losing the exchange.
 */
async function groundClaim(
  deps: Deps,
  fact: ExtractedFact,
  embedding: number[],
): Promise<boolean | null> {
  if (fact.claim_kind !== "life" && fact.claim_kind !== "opinion") return null;
  try {
    const sim = await deps.core.memory.groundingSimilarity(embedding);
    return sim >= deps.config.claims.grounded_similarity;
  } catch (e) {
    deps.log.error("claim grounding failed", { error: errorName(e) });
    return null;
  }
}

/** In its own savepoint, so a relationship failure never loses the memory writes. */
async function updateRelationshipSafely(
  deps: Deps,
  tx: Db,
  update: Parameters<typeof updateRelationship>[2],
): Promise<void> {
  // Test seam: lets a test replace the relationship update.
  const runUpdate =
    (deps as { updateRelationship?: typeof updateRelationship }).updateRelationship ??
    updateRelationship;

  try {
    await tx.transaction(async (savepoint) => {
      await runUpdate(savepoint, deps, update);
    });
  } catch (e) {
    deps.log.error("relationship update failed", { userId: update.userId, error: errorName(e) });
  }
}
