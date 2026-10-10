/**
 * Encoding: writes one exchange's extraction into the user's memory. It covers entities, threads
 * and facts (each reconciled against what's already stored), then the hot path's recall
 * reinforcement. Runs inside the cold path's transaction; every id the model supplied is checked
 * to belong to this user.
 */
import type { GroundRef } from "@/mind/memory/core/types";
import type { Db } from "@/db/client";
import { normalizeName, upsertEntityMention } from "@/db/repos/user/entities";
import {
  applyRecall,
  bumpDuplicate,
  establishIdiolect,
  getFact,
  insertFact,
  setFactStatus,
} from "@/db/repos/user/facts";
import { markExtracted } from "@/db/repos/user/session-log";
import {
  findOpenThreadByTitle,
  getOwnedThread,
  insertThread,
  resolveThread,
  touchThread,
} from "@/db/repos/user/threads";
import type { RecalledFact } from "@/mind/memory/shared/types";
import type { Config } from "@/mind/platform/config";
import type { ExtractedEntity, ExtractedFact, ExtractedThread } from "./extract";
import type { Decision } from "@/mind/memory/shared/reconcile";
import { idiolectPayload } from "./idiolect";

export type PlannedFact = {
  fact: ExtractedFact;
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
  /** The exchange's earliest turn: new facts' created_at, thread open and touch. */
  exchangeAt: Date;
  entities: ExtractedEntity[];
  facts: PlannedFact[];
  threads: ExtractedThread[];
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
  /** Salience of each fact row inserted, for the big-event check. */
  insertedSaliences: number[];
};

type EntitySubject = "user" | "self";

function entityKey(subject: EntitySubject, name: string): string {
  return `${subject}|${normalizeName(name)}`;
}

function entitySubjectOf(subject: ExtractedFact["subject"]): EntitySubject {
  return subject === "self" ? "self" : "user";
}

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
    insertedSaliences: [],
  };

  const entityIds = await encodeEntities(db, config, input, outcome);
  const threadIds = await encodeThreads(db, input, outcome);
  await encodeFacts(db, config, input, entityIds, threadIds, outcome);
  outcome.recalledUpdated = await writeBackRecall(db, config, input);

  await markExtracted(db, input.userId, input.turnIds);
  return outcome;
}

// ---------- Entities ----------

/** Upserts the declared entities plus any named only inside a fact. Returns ids by entity key. */
async function encodeEntities(
  db: Db,
  config: Config,
  input: EncodeInput,
  outcome: EncodeOutcome,
): Promise<Map<string, string>> {
  const mentions = withEntitiesNamedInFacts(input.entities, input.facts);
  const settings = {
    newSalience: config.extraction.new_entity_salience,
    bump: config.extraction.entity_bump,
    cap: config.retrieval.recall_cap,
  };

  const entityIds = new Map<string, string>();
  for (const mention of mergeMentions(mentions)) {
    const knownId = entityIds.get(entityKey(mention.subject, mention.name));
    const { id, created } = knownId
      ? { id: knownId, created: false }
      : await upsertEntityMention(db, input.userId, mention, input.now, settings);
    if (created) outcome.entitiesCreated += 1;

    for (const name of [mention.name, ...mention.aliases]) {
      entityIds.set(entityKey(mention.subject, name), id);
    }
  }
  return entityIds;
}

function withEntitiesNamedInFacts(
  declared: ExtractedEntity[],
  facts: PlannedFact[],
): ExtractedEntity[] {
  const mentions = [...declared];
  const known = new Set(
    mentions.flatMap((m) => [m.name, ...m.aliases].map((name) => entityKey(m.subject, name))),
  );

  for (const { fact } of facts) {
    const subject = entitySubjectOf(fact.subject);
    for (const name of fact.entity_names) {
      if (!normalizeName(name)) continue;
      const key = entityKey(subject, name);
      if (known.has(key)) continue;

      mentions.push({ name, aliases: [], type: "other", subject, relation: null });
      known.add(key);
    }
  }
  return mentions;
}

/** Drops blank names and merges mentions with the same subject and name, so no alias is lost. */
function mergeMentions(mentions: ExtractedEntity[]): ExtractedEntity[] {
  const byKey = new Map<string, ExtractedEntity>();

  for (const mention of mentions) {
    if (!normalizeName(mention.name)) continue;
    const aliases = mention.aliases.filter((alias) => normalizeName(alias));
    const key = entityKey(mention.subject, mention.name);
    const earlier = byKey.get(key);

    if (!earlier) {
      byKey.set(key, { ...mention, aliases });
      continue;
    }
    byKey.set(key, {
      ...earlier,
      aliases: [...new Set([...earlier.aliases, ...aliases])],
      relation: earlier.relation ?? mention.relation,
      type: earlier.type === "other" ? mention.type : earlier.type,
    });
  }
  return [...byKey.values()];
}

// ---------- Threads ----------

/** Opens, touches or resolves threads. Returns thread ids by normalized title. */
async function encodeThreads(
  db: Db,
  input: EncodeInput,
  outcome: EncodeOutcome,
): Promise<Map<string, string>> {
  const { userId } = input;
  const threadIds = new Map<string, string>();

  for (const update of input.threads) {
    const byId = update.thread_id ? await getOwnedThread(db, userId, update.thread_id) : null;
    const existing = byId ?? (await findOpenThreadByTitle(db, userId, update.title));

    if (update.action === "open") {
      if (existing && existing.status === "open") {
        await touchThread(db, userId, existing.id, input.exchangeAt, update.next_checkpoint);
        threadIds.set(normalizeName(update.title), existing.id);
        continue;
      }
      const thread = await insertThread(
        db,
        userId,
        {
          title: update.title,
          subject: update.subject,
          stakes: update.stakes,
          next_checkpoint: update.next_checkpoint,
        },
        input.exchangeAt,
      );
      outcome.threadsOpened += 1;
      threadIds.set(normalizeName(update.title), thread.id);
      continue;
    }

    if (!existing) continue;
    if (update.action === "touch") {
      await touchThread(db, userId, existing.id, input.exchangeAt, update.next_checkpoint);
    } else {
      await resolveThread(db, userId, existing.id, input.now);
    }
    threadIds.set(normalizeName(update.title), existing.id);
    threadIds.set(normalizeName(existing.title), existing.id);
  }
  return threadIds;
}

// ---------- Facts ----------

async function encodeFacts(
  db: Db,
  config: Config,
  input: EncodeInput,
  entityIds: Map<string, string>,
  threadIds: Map<string, string>,
  outcome: EncodeOutcome,
): Promise<void> {
  const { userId } = input;

  for (const planned of input.facts) {
    const fact = planned.fact;
    const sensitive = input.sensitive ? { sensitive: true } : null;
    const payload =
      fact.kind === "idiolect" ? { ...sensitive, idiolect: idiolectPayload(fact) } : sensitive;
    const subject = entitySubjectOf(fact.subject);

    const entityRefs = fact.entity_names
      .map((name) => entityIds.get(entityKey(subject, name)))
      .filter((id): id is string => !!id);
    const threadId = fact.thread_title
      ? (threadIds.get(normalizeName(fact.thread_title)) ??
        (await findOpenThreadByTitle(db, userId, fact.thread_title))?.id ??
        null)
      : null;

    const row = {
      subject: fact.subject,
      kind: fact.kind,
      content: fact.content,
      payload,
      embedding: planned.embedding,
      entity_refs: [...new Set(entityRefs)],
      thread_id: threadId,
      occurred_at: fact.occurred_at,
      created_at: input.exchangeAt,
      salience: fact.salience,
      valence: fact.valence,
      confidence: fact.confidence,
      source: planned.source ?? "turn",
      source_ref: input.sourceRef,
      claim_kind: fact.claim_kind ?? null,
      grounded: planned.grounded ?? null,
    };

    const target = planned.decision.targetId
      ? await getFact(db, userId, planned.decision.targetId)
      : null;
    // A joke merged into a plain fact would be lost as a joke: it starts as its own candidate.
    const relation =
      target && !(fact.kind === "idiolect" && target.kind !== "idiolect")
        ? planned.decision.relation
        : "new";

    if (relation === "duplicate" && target) {
      await bumpDuplicate(
        db,
        userId,
        target.id,
        config.reconcile.duplicate_bump,
        config.retrieval.recall_cap,
        fact.confidence,
      );
      // An inside joke is born when it comes up again in another exchange, not twice in one.
      if (target.kind === "idiolect" && target.source_ref !== input.sourceRef) {
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
      const inserted = await insertFact(db, userId, { ...row, status: "resolved" });
      outcome.inserted += 1;
      outcome.insertedSaliences.push(fact.salience);
      outcome.factIds.push(inserted.id);
      continue;
    }

    if (relation === "contradicts" && target) {
      if (targetIsNewer) {
        const inserted = await insertFact(db, userId, {
          ...row,
          status: "superseded",
          superseded_by: target.id,
        });
        outcome.factIds.push(inserted.id);
      } else {
        const inserted = await insertFact(db, userId, { ...row, status: "open" });
        await setFactStatus(db, userId, target.id, "superseded", inserted.id);
        outcome.factIds.push(inserted.id);
        // Only news that stands counts as salient: an already-overridden fact is no big event.
        outcome.insertedSaliences.push(fact.salience);
      }
      outcome.superseded += 1;
      outcome.inserted += 1;
      continue;
    }

    const inserted = await insertFact(db, userId, { ...row, status: "open" });
    outcome.inserted += 1;
    outcome.insertedSaliences.push(fact.salience);
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
