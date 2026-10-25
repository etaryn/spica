/**
 * Encoding: writes one exchange's labels into the user's memory. It covers the people and things
 * the mentions name, threads, memories (each reconciled against what's already stored), every
 * label as an annotation pointing at the words, then the hot path's recall reinforcement. Runs
 * inside the cold path's transaction; every id the model supplied is checked to belong to this
 * user.
 */
import type { GroundRef } from "@/mind/memory/core/types";
import type { Db } from "@/db/client";
import { insertAnnotations, type AnnotationRow } from "@/db/repos/user/annotations";
import { normalizeName, upsertEntityMention } from "@/db/repos/user/entities";
import {
  applyRecall,
  bumpDuplicate,
  establishIdiolect,
  getFact,
  insertFact,
  setFactStatus,
} from "@/db/repos/user/facts";
import { inSameSession, markExtracted } from "@/db/repos/user/session-log";
import {
  findOpenThreadByTitle,
  getOwnedThread,
  insertThread,
  resolveThread,
  touchThread,
} from "@/db/repos/user/threads";
import type { RecalledFact } from "@/mind/memory/shared/types";
import type { Config } from "@/mind/platform/config";
import { labelInstant } from "@/mind/platform/time-labels";
import type { Decision } from "@/mind/memory/shared/reconcile";
import type { CheckedLabels } from "./annotations";
import type { MemoryPlan } from "./label-memory";
import { entityIdsByLocal, toRows } from "./stored-labels";

export type PlannedFact = {
  fact: MemoryPlan;
  embedding: number[];
  decision: Decision;
  source?: "turn" | "inferred";
  /** Whether core backed this claim; null when it isn't a life or opinion claim. */
  grounded?: boolean | null;
  /** What in core backed it, when it was backed: the ledger records that she told them. */
  groundRef?: GroundRef | null;
};

export type EncodeInput = {
  userId: string;
  /** When the job runs: recall write-back, entity last_mentioned, thread resolve. */
  now: Date;
  /** The exchange's earliest turn: new facts' created_at, thread open and touch, labels. */
  exchangeAt: Date;
  /** This call's checked labels. */
  labels: CheckedLabels;
  /** The conversation's labels from earlier exchanges. */
  stored: AnnotationRow[];
  sessionId: string;
  /** Their zone: a thread's checkpoint is a day on their calendar. */
  zone: string;
  facts: PlannedFact[];
  sensitive: boolean;
  sourceRef: string;
  recalled: RecalledFact[];
  replyTurnId: string | null;
  turnIds: string[];
};

export type EncodeOutcome = {
  inserted: number;
  duplicates: number;
  resolved: number;
  superseded: number;
  entitiesCreated: number;
  threadsOpened: number;
  recalledUpdated: number;
  /** One entry per planned fact, in order: the inserted row's id, or the duplicate target's id. */
  factIds: (string | null)[];
  /** Each new fact's subject, weight and words: the cold path reads them for big events. */
  insertedFacts: { subject: string; salience: number; content: string }[];
  /** Every fact row inserted, for announcing after the cold path commits. */
  written: { id: string; kind: string }[];
};

export async function encodeExtraction(
  db: Db,
  config: Config,
  input: EncodeInput,
): Promise<EncodeOutcome> {
  const outcome: EncodeOutcome = {
    inserted: 0,
    duplicates: 0,
    resolved: 0,
    superseded: 0,
    entitiesCreated: 0,
    threadsOpened: 0,
    recalledUpdated: 0,
    factIds: [],
    insertedFacts: [],
    written: [],
  };

  const entityIds = await encodeEntities(db, config, input, outcome);
  const threads = await encodeThreads(db, input, outcome);
  await encodeFacts(db, config, input, entityIds, threads, outcome);
  const factIds = new Map(
    input.facts.flatMap((p, i) => {
      const id = outcome.factIds[i];
      return p.fact.localId && id ? [[p.fact.localId, id] as const] : [];
    }),
  );
  await insertAnnotations(
    db,
    input.userId,
    toRows(input.labels, {
      sessionId: input.sessionId,
      exchangeRef: input.replyTurnId ?? input.turnIds.at(-1)!,
      at: input.exchangeAt,
      factIds,
      entityIds,
    }),
  );
  outcome.recalledUpdated = await writeBackRecall(db, config, input);

  await markExtracted(db, input.userId, input.turnIds);
  return outcome;
}

// ---------- Entities ----------

/**
 * Upserts what each new mention names; a mention of an open thread names no entity. Returns
 * entity ids by mention id, earlier exchanges' included.
 */
async function encodeEntities(
  db: Db,
  config: Config,
  input: EncodeInput,
  outcome: EncodeOutcome,
): Promise<Map<string, string>> {
  const settings = {
    newSalience: config.extraction.new_entity_salience,
    bump: config.extraction.entity_bump,
    cap: config.retrieval.recall_cap,
  };
  const entityIds = entityIdsByLocal(input.stored);
  for (const m of input.labels.mentions) {
    if (m.refers_to !== null || m.name === null || !normalizeName(m.name)) continue;
    const { id, created } = await upsertEntityMention(
      db,
      input.userId,
      {
        name: m.name,
        aliases: normalizeName(m.words) === normalizeName(m.name) ? [] : [m.words],
        type: m.type ?? "other",
        subject: m.subject ?? "user",
        relation: m.relation,
      },
      input.now,
      settings,
    );
    if (created) outcome.entitiesCreated += 1;
    entityIds.set(m.id, id);
  }
  return entityIds;
}

// ---------- Threads ----------

type ThreadIds = { byTitle: Map<string, string>; byProposition: Map<string, string> };

/** Opens, touches or resolves threads, by id or by title. */
async function encodeThreads(
  db: Db,
  input: EncodeInput,
  outcome: EncodeOutcome,
): Promise<ThreadIds> {
  const { userId } = input;
  const ids: ThreadIds = { byTitle: new Map(), byProposition: new Map() };
  const record = (id: string, titles: string[], propositions: string[]) => {
    for (const t of titles) ids.byTitle.set(normalizeName(t), id);
    for (const p of propositions) ids.byProposition.set(p, id);
  };

  for (const t of input.labels.threads) {
    const checkpoint = t.checkpointAt ? labelInstant(t.checkpointAt, input.zone) : null;
    const byId = t.thread_id ? await getOwnedThread(db, userId, t.thread_id) : null;
    const existing = byId ?? (await findOpenThreadByTitle(db, userId, t.title));

    if (t.action === "open") {
      if (existing && existing.status === "open") {
        await touchThread(db, userId, existing.id, input.exchangeAt, checkpoint);
        record(existing.id, [t.title, existing.title], t.propositions);
        continue;
      }
      const thread = await insertThread(
        db,
        userId,
        { title: t.title, subject: t.subject, stakes: t.stakes, next_checkpoint: checkpoint },
        input.exchangeAt,
      );
      outcome.threadsOpened += 1;
      record(thread.id, [t.title], t.propositions);
      continue;
    }

    if (!existing) continue;
    if (t.action === "touch") {
      await touchThread(db, userId, existing.id, input.exchangeAt, checkpoint);
    } else {
      await resolveThread(db, userId, existing.id, input.now);
    }
    record(existing.id, [t.title, existing.title], t.propositions);
  }
  return ids;
}

// ---------- Facts ----------

async function encodeFacts(
  db: Db,
  config: Config,
  input: EncodeInput,
  entityIds: Map<string, string>,
  threads: ThreadIds,
  outcome: EncodeOutcome,
): Promise<void> {
  const { userId } = input;

  for (const planned of input.facts) {
    const plan = planned.fact;
    const sensitive = input.sensitive ? { sensitive: true } : null;
    const threadId =
      plan.threadId ??
      (plan.localId ? threads.byProposition.get(plan.localId) : undefined) ??
      (plan.newThread
        ? (threads.byTitle.get(normalizeName(plan.newThread)) ??
          (await findOpenThreadByTitle(db, userId, plan.newThread))?.id)
        : undefined) ??
      null;

    const row = {
      subject: plan.subject,
      kind: plan.kind,
      content: plan.content,
      payload: plan.idiolect ? { ...sensitive, idiolect: plan.idiolect } : sensitive,
      embedding: planned.embedding,
      entity_refs: [...new Set(plan.mentions.flatMap((id) => entityIds.get(id) ?? []))],
      thread_id: threadId,
      occurred_at: plan.occurred_at,
      created_at: input.exchangeAt,
      salience: plan.salience,
      valence: plan.valence,
      confidence: plan.confidence,
      source: planned.source ?? "turn",
      source_ref: input.sourceRef,
      claim_kind: plan.claim_kind,
      grounded: planned.grounded ?? null,
    };
    // A labelled memory quotes its words as said, and its dates are already tokens.
    const insert = (extra: {
      status: "open" | "resolved" | "superseded";
      superseded_by?: string;
    }) => insertFact(db, userId, { ...row, ...extra }, { asSaid: true });
    const news = { subject: plan.subject, salience: plan.salience, content: plan.content };

    const target = planned.decision.targetId
      ? await getFact(db, userId, planned.decision.targetId)
      : null;
    // A joke merged into a plain fact would be lost as a joke: it starts as its own candidate.
    const relation =
      target && !(plan.kind === "idiolect" && target.kind !== "idiolect")
        ? planned.decision.relation
        : "new";

    if (relation === "duplicate" && target) {
      await bumpDuplicate(
        db,
        userId,
        target.id,
        config.reconcile.duplicate_bump,
        config.retrieval.recall_cap,
        plan.confidence,
      );
      // A joke becomes theirs only once it survives a gap: a callback in a later sitting.
      if (
        target.kind === "idiolect" &&
        target.source_ref !== input.sourceRef &&
        !(await inSameSession(db, userId, target.source_ref, input.sourceRef))
      ) {
        await establishIdiolect(db, userId, target.id, input.exchangeAt);
      }
      outcome.duplicates += 1;
      outcome.factIds.push(target.id);
      continue;
    }

    // A late job must never overturn something said after this exchange: when the target is
    // newer, the new candidate is the outdated one.
    const targetIsNewer = !!target && target.created_at > input.exchangeAt;

    if (relation === "resolves" && target) {
      if (!targetIsNewer) {
        await setFactStatus(db, userId, target.id, "resolved");
        outcome.resolved += 1;
      }
      const inserted = await insert({ status: "resolved" });
      outcome.written.push({ id: inserted.id, kind: inserted.kind });
      outcome.inserted += 1;
      outcome.insertedFacts.push(news);
      outcome.factIds.push(inserted.id);
      continue;
    }

    if (relation === "contradicts" && target) {
      if (targetIsNewer) {
        const inserted = await insert({ status: "superseded", superseded_by: target.id });
        outcome.written.push({ id: inserted.id, kind: inserted.kind });
        outcome.factIds.push(inserted.id);
      } else {
        const inserted = await insert({ status: "open" });
        outcome.written.push({ id: inserted.id, kind: inserted.kind });
        await setFactStatus(db, userId, target.id, "superseded", inserted.id);
        outcome.factIds.push(inserted.id);
        // Only news that stands counts as salient: an already-overridden fact is no big event.
        outcome.insertedFacts.push(news);
      }
      outcome.superseded += 1;
      outcome.inserted += 1;
      continue;
    }

    const inserted = await insert({ status: "open" });
    outcome.written.push({ id: inserted.id, kind: inserted.kind });
    outcome.inserted += 1;
    outcome.insertedFacts.push(news);
    outcome.factIds.push(inserted.id);
  }
}

// ---------- Recall reinforcement ----------

/**
 * Writes back what the hot path recalled: a trace for every memory that still exists, and
 * reinforcement only for unforced recalls with similarity at or above `reinforce_min_sim`.
 */
async function writeBackRecall(db: Db, config: Config, input: EncodeInput): Promise<number> {
  const updated = await applyRecall(
    db,
    input.userId,
    input.recalled,
    input.now,
    {
      bump: config.retrieval.recall_bump,
      cap: config.retrieval.recall_cap,
      minSim: config.retrieval.reinforce_min_sim,
    },
    input.replyTurnId,
  );
  return updated.length;
}
