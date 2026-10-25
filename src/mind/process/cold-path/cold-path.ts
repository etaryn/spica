/**
 * The cold path: after she has replied, it turns the exchange into memory and relationship state.
 * The steps are label (three calls over the conversation so far), embed, reconcile against near
 * memories (or by the id a label says it updates), grade her own claims against core, encode,
 * then update the relationship, including her feelings toward them. It all runs in one transaction holding a
 * per-user advisory lock, so a crash writes nothing and two exchanges from one user never
 * reconcile at once. It never delays a reply, and a failure is never retried (`runColdPathJob`).
 */
import type { GroundRef } from "@/mind/memory/core/types";
import { recordDisclosures } from "@/mind/memory/user/disclosure";
import { sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sessionAnnotations } from "@/db/repos/user/annotations";
import { nearFacts } from "@/db/repos/user/facts";
import {
  bumpExtractAttempts,
  getTurnsByIds,
  turnsUpTo,
  type Turn,
} from "@/db/repos/user/session-log";
import { listOpenThreads } from "@/db/repos/user/threads";
import { retireIdeas } from "@/db/repos/user/user-mind";
import { getTimezone } from "@/db/repos/user/users";
import { mergeLabels } from "@/mind/memory/user/annotations";
import { encodeExtraction, type EncodeOutcome, type PlannedFact } from "@/mind/memory/user/encode";
import { labelStretch } from "@/mind/memory/user/label";
import { memoryPlans, signalsOf, type MemoryPlan } from "@/mind/memory/user/label-memory";
import { messagesOf } from "@/mind/memory/user/layers";
import { numberPieces } from "@/mind/memory/user/pieces";
import { factIdsByLocal, fromRows } from "@/mind/memory/user/stored-labels";
import { zoneOrUtc } from "@/mind/platform/timezone";
import { reconcileAgainstNeighbours } from "@/mind/memory/shared/reconcile";
import type { Deps } from "@/mind/platform/deps";
import type { Trigger } from "@/db/repos/user/user-mind";
import { detectBigEvents } from "@/mind/process/user/big-events";
import { enqueueUserMindRun, recordBigEvents } from "@/mind/process/user/run";
import { settleHurtFacts } from "@/mind/memory/user/hurt";
import { errorName } from "@/mind/platform/errors";
import type { ColdPathJob } from "@/mind/platform/jobs";
import { exchangeTone } from "@/mind/state/user/relationship/affect";
import { bidAfter, hurtFactContent, type Signals } from "@/mind/state/user/relationship/signals";
import type { ParamName } from "@/mind/state/user/relationship/types";
import { movedParams, updateRelationship } from "@/mind/state/user/relationship/update";
import { snapshotSection } from "@/mind/memory/core/depth";

export class LockBusyError extends Error {}

export type ColdPathOutcome = {
  status: "done" | "skipped";
  applied?: EncodeOutcome;
  userMindRunId?: string | null;
  moved?: ParamName[];
};

type CandidateFact = { fact: MemoryPlan; source: "turn" | "inferred" };

/**
 * The `cold_path` job. Only a busy lock throws for pg-boss to retry, since no prompt has run yet.
 * Any other failure is logged and counted on the exchange, so neither pg-boss nor the sweep runs
 * its prompts again and a structural problem stays visible.
 */
export async function runColdPathJob(deps: Deps, job: ColdPathJob): Promise<void> {
  try {
    await runColdPath(deps, job);
  } catch (e) {
    if (e instanceof LockBusyError) throw e;
    deps.log.error("cold_path failed", { userId: job.userId, error: errorName(e) });
    // Never thrown either: a throw here would have pg-boss re-run the prompts.
    if (job.replyTurnId)
      await bumpExtractAttempts(deps.db, job.userId, job.replyTurnId).catch((err: unknown) =>
        deps.log.error("cold_path failure count failed", {
          userId: job.userId,
          error: errorName(err),
        }),
      );
  }
}

export async function runColdPath(deps: Deps, job: ColdPathJob): Promise<ColdPathOutcome> {
  const { db, config, clock, log } = deps;

  const outcome = await db.transaction(async (tx): Promise<ColdPathOutcome> => {
    const lockKey = `cold_path:${job.userId}`;
    const lock = await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS ok`,
    );
    if (!lock.rows[0]?.ok) throw new LockBusyError(`cold_path busy for user`);

    const turns = await getTurnsByIds(tx, job.userId, job.turnIds);
    if (turns.length === 0 || turns.every((t) => t.extracted)) return { status: "skipped" };

    const { labels, all, stored, pieces, zone, sessionId, context } = await labelExchange(
      deps,
      tx,
      job.userId,
      turns,
    );
    // What the checks threw out stays visible: nothing is asked again.
    if (labels.drops.length)
      log.info("labels dropped", { userId: job.userId, drops: labels.drops });
    const read = signalsOf(labels, all, pieces, config.extraction.quote_chars);

    // Each idea she was shown gets one chance; idempotent, so a retried job changes nothing.
    // ponytail: a cold path re-enqueued by the sweep carries no offered ideas, so they stay live until they expire
    await retireIdeas(tx, job.userId, job.offeredIdeas ?? []);

    const crisis = turns.some((t) => t.safety_flag?.flagged);
    // A reach-out on its own is only her words: no user behaviour to score, no exchange tone.
    const hasUserTurn = turns.some((t) => t.role === "user");
    const signals = crisis || !hasUserTurn ? null : read.signals;
    const intimacy = crisis || !hasUserTurn ? null : read.intimacy;
    const bid =
      crisis || !hasUserTurn
        ? null
        : bidAfter(read.bid, context, turns, config.session.idle_gap_minutes);

    const hurt = significantHurt(signals, config.relationship.signal_deadzone);
    const candidates: CandidateFact[] = memoryPlans(
      labels,
      all,
      pieces,
      zone,
      config.extraction,
    ).map((fact) => ({ fact, source: "turn" }));
    if (hurt) candidates.push(hurtFeeling(hurt, config));

    const planned = await reconcileCandidates(
      deps,
      tx,
      job.userId,
      candidates,
      factIdsByLocal(stored),
    );

    const applied = await encodeExtraction(tx, config, {
      userId: job.userId,
      now: clock.now(),
      // Turns come back oldest first: the exchange's first turn (hers, for a reach-out).
      exchangeAt: turns[0]!.created_at,
      labels,
      stored,
      sessionId,
      zone,
      facts: planned,
      sensitive: crisis,
      sourceRef: job.replyTurnId ?? turns.at(-1)!.id,
      recalled: job.recalled ?? [],
      replyTurnId: job.replyTurnId ?? null,
      turnIds: job.turnIds,
    });
    log.info("cold_path applied", { userId: job.userId, ...applied });
    await recordDisclosures(tx, {
      userId: job.userId,
      planned,
      factIds: applied.factIds,
      turns,
      crisis,
      now: clock.now(),
    });

    let relationship: Awaited<ReturnType<typeof updateRelationshipSafely>> = null;
    if (hasUserTurn) {
      const hurtFactId = hurt ? (applied.factIds.at(-1) ?? null) : null;
      relationship = await updateRelationshipSafely(deps, tx, {
        userId: job.userId,
        turns,
        signals,
        intimacy,
        bid,
        crisis,
        hurtFactId,
        // How she feels about them follows what they did. Her own facts are left out: her
        // news isn't about them, and her inferred hurt already moves the hurt param.
        tone: exchangeTone(candidates.filter((c) => c.fact.subject !== "self").map((c) => c.fact)),
      });
    }

    // A big event makes her think about them; recorded with the exchange so it runs exactly once.
    // Her words alone (a reach-out nobody answered yet) are no event in the relationship.
    const triggers: Trigger[] =
      crisis || !hasUserTurn
        ? []
        : [
            ...detectBigEvents({
              before: relationship?.before ?? null,
              after: relationship?.after ?? null,
              newFacts: applied.insertedFacts.filter((f) => f.subject !== "self"),
              apology: !!signals && (signals.apology || signals.make_up),
              settings: config.user_mind.triggers,
              source: "exchange",
            }),
            ...(relationship?.milestones ?? []).map((name) => ({
              kind: "milestone" as const,
              name,
            })),
          ];
    const repaired = triggers.find(
      (t): t is Extract<Trigger, { kind: "repaired" }> => t.kind === "repaired",
    );
    if (repaired) await settleHurtFacts(tx, job.userId, repaired.via, clock.now());
    const userMindRunId = await recordBigEvents(
      deps,
      tx,
      job.userId,
      `exchange:${job.replyTurnId ?? turns.at(-1)!.id}`,
      triggers,
    );
    return {
      status: "done",
      applied,
      userMindRunId,
      moved: relationship ? movedParams(relationship.before.params, relationship.after.params) : [],
    };
  });

  // Only after commit, so the worker never sees a run the transaction rolled back.
  if (outcome.userMindRunId) await enqueueUserMindRun(deps, outcome.userMindRunId);
  for (const f of outcome.applied?.written ?? [])
    await deps.modules.emit({
      type: "fact.written",
      userId: job.userId,
      factId: f.id,
      kind: f.kind,
    });
  if (outcome.moved?.length)
    await deps.modules.emit({
      type: "relationship.changed",
      userId: job.userId,
      params: outcome.moved,
    });
  return outcome;
}

/**
 * Labels the exchange: the conversation so far (capped at `window_messages`) with a few turns from
 * before it to read it by, and what earlier exchanges of the conversation already labelled.
 */
async function labelExchange(deps: Deps, tx: Db, userId: string, turns: Turn[]) {
  const { config } = deps;
  // Their messages come before her reply to them, even when both carry the same minute.
  const exchange = [...turns].sort(
    (a, b) =>
      a.created_at.getTime() - b.created_at.getTime() ||
      Number(a.role !== "user") - Number(b.role !== "user"),
  );
  const ids = new Set(exchange.map((t) => t.id));
  const last = exchange.at(-1)!;
  const before = (
    await turnsUpTo(tx, userId, exchange[0]!, config.extraction.window_messages)
  ).filter((t) => !ids.has(t.id));
  // The conversation so far, with a few turns from before it to read it by.
  const start = before.findIndex((t) => t.session_id === last.session_id);
  const context = before.slice(
    Math.max(0, (start === -1 ? before.length : start) - config.extraction.context_turns),
  );
  const pieces = numberPieces(messagesOf([...context, ...exchange]), context.length);
  // ponytail: a deferred reply in another session from its burst reads only its own session's labels; key by the conversation layer if that loses links
  const stored = await sessionAnnotations(tx, userId, last.session_id);
  const earlier = fromRows(stored, pieces);
  const zone = zoneOrUtc(await getTimezone(tx, userId));
  const labels = await labelStretch(deps, {
    pieces,
    zone,
    threads: await listOpenThreads(tx, userId, config.extraction.open_threads_in_prompt),
    interests: snapshotSection(
      (await deps.core.memory.latestSnapshot())?.content ?? "",
      "Interests",
    ),
    earlier,
    // ponytail: the model isn't told ids its window no longer shows, so it may pick one and lose that label; list the highest ids used if long conversations show it
    usedIds: stored.map((r) => r.local_id),
  });
  return {
    labels,
    all: mergeLabels(earlier, labels),
    stored,
    pieces,
    zone,
    sessionId: last.session_id,
    context,
  };
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
      localId: null,
      subject: "self",
      kind: "feeling",
      content: hurtFactContent(hurt.cause),
      embedText: hurtFactContent(hurt.cause),
      occurred_at: null,
      salience: config.relationship.hurt_fact_salience,
      valence: -hurt.amount,
      confidence: config.relationship.hurt_fact_confidence,
      claim_kind: null,
      mentions: [],
      threadId: null,
      newThread: null,
      updates: null,
      idiolect: null,
    },
  };
}

async function reconcileCandidates(
  deps: Deps,
  tx: Db,
  userId: string,
  candidates: CandidateFact[],
  /** Earlier memories of this conversation by their label id: what an update points at. */
  earlierFacts: Map<string, string>,
): Promise<PlannedFact[]> {
  const { config, embedder } = deps;
  const embeddings = candidates.length
    ? await embedder.embed(
        candidates.map((c) => c.fact.embedText),
        "document",
      )
    : [];

  const planned: PlannedFact[] = [];
  for (const [i, { fact, source }] of candidates.entries()) {
    const embedding = embeddings[i];
    if (!embedding) throw new Error("embedder returned fewer vectors than facts");

    // A label that says which memory it changes needs no model to find it.
    const updated = fact.updates ? earlierFacts.get(fact.updates) : undefined;
    const decision = updated
      ? { relation: "contradicts" as const, targetId: updated }
      : await reconcileAgainstNeighbours(
          deps,
          { label: `${fact.subject}, ${fact.kind}`, content: fact.content },
          await nearFacts(
            tx,
            userId,
            fact.subject,
            embedding,
            config.reconcile.neighbor_k,
            config.reconcile.contradiction_similarity,
          ),
        );
    const grounding = await groundClaim(deps, fact, embedding);
    planned.push({
      fact,
      embedding,
      decision,
      source,
      grounded: grounding.grounded,
      groundRef: grounding.ref,
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
  fact: MemoryPlan,
  embedding: number[],
): Promise<{ grounded: boolean | null; ref: GroundRef | null }> {
  if (fact.claim_kind !== "life" && fact.claim_kind !== "opinion")
    return { grounded: null, ref: null };
  try {
    const match = await deps.core.memory.groundingMatch(embedding);
    const grounded = match.similarity >= deps.config.claims.grounded_similarity;
    return { grounded, ref: grounded ? match.ref : null };
  } catch (e) {
    deps.log.error("claim grounding failed", { error: errorName(e) });
    return { grounded: null, ref: null };
  }
}

/** In its own savepoint, so a relationship failure never loses the memory writes. */
async function updateRelationshipSafely(
  deps: Deps,
  tx: Db,
  update: Parameters<typeof updateRelationship>[2],
): Promise<Awaited<ReturnType<typeof updateRelationship>> | null> {
  // Test seam: lets a test replace the relationship update.
  const runUpdate =
    (deps as { updateRelationship?: typeof updateRelationship }).updateRelationship ??
    updateRelationship;

  try {
    // A seam that returns nothing counts as no relationship result.
    return (await tx.transaction((savepoint) => runUpdate(savepoint, deps, update))) ?? null;
  } catch (e) {
    deps.log.error("relationship update failed", { userId: update.userId, error: errorName(e) });
    return null;
  }
}
