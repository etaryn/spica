import type { Db } from "@/db/client";
import { normalizeName, upsertEntityMention } from "@/db/repos/entities";
import { applyRecall, bumpDuplicate, getFact, insertFact, setFactStatus } from "@/db/repos/facts";
import { markExtracted } from "@/db/repos/session-log";
import { findOpenThreadByTitle, getOwnedThread, insertThread, resolveThread, touchThread } from "@/db/repos/threads";
import type { Config } from "../config";
import type { ExtractedEntity, ExtractedFact, ExtractedThread } from "./extract";
import type { Decision } from "./reconcile";
import type { RecalledFact } from "./types";

export type PlannedFact = { fact: ExtractedFact; embedding: number[]; decision: Decision; source?: "turn" | "inferred" | "generated" };
export type ApplyInput = {
  /** now: job run time (recall write-back, entity last_mentioned, thread resolve). exchangeAt: the earliest turn's created_at (inserted facts' created_at, thread open/touch). */
  userId: string; now: Date; exchangeAt: Date; entities: ExtractedEntity[]; facts: PlannedFact[]; threads: ExtractedThread[];
  sensitive: boolean; sourceRef: string; recalled: RecalledFact[]; replyTurnId: string | null; turnIds: string[];
};
export type ApplyOutcome = {
  inserted: number; duplicates: number; resolved: number; superseded: number;
  entitiesCreated: number; threadsOpened: number; recalledUpdated: number;
  /** One entry per planned fact, in order: the inserted row's id, or the duplicate target's id. */
  factIds: (string | null)[];
};

const entityKey = (subject: "user" | "self", name: string) => `${subject}|${normalizeName(name)}`;
const entitySubject = (s: ExtractedFact["subject"]): "user" | "self" => (s === "self" ? "self" : "user");

/** Blank names dropped; mentions with the same subject + normalized name merged, so no alias is lost (§15.1 #10). */
function mergeMentions(ms: ExtractedEntity[]): ExtractedEntity[] {
  const byKey = new Map<string, ExtractedEntity>();
  for (const m of ms) {
    if (!normalizeName(m.name)) continue;
    const aliases = m.aliases.filter((a) => normalizeName(a));
    const k = entityKey(m.subject, m.name);
    const prev = byKey.get(k);
    byKey.set(k, prev
      ? { ...prev, aliases: [...new Set([...prev.aliases, ...aliases])], relation: prev.relation ?? m.relation, type: prev.type === "other" ? m.type : prev.type }
      : { ...m, aliases });
  }
  return [...byKey.values()];
}

/** Cold-path writes (v2 §6.3 steps 5–7). Call inside the job's transaction; every id the model supplied is ownership-checked. */
export async function applyExtraction(db: Db, config: Config, input: ApplyInput): Promise<ApplyOutcome> {
  const { userId, now } = input;
  const out: ApplyOutcome = { inserted: 0, duplicates: 0, resolved: 0, superseded: 0, entitiesCreated: 0, threadsOpened: 0, recalledUpdated: 0, factIds: [] };

  // 1. Entities: declared ones plus any named only in facts.
  const mentions: ExtractedEntity[] = [...input.entities];
  const known = () => new Set(mentions.flatMap((m) => [m.name, ...m.aliases].map((n) => entityKey(m.subject, n))));
  for (const p of input.facts) {
    for (const name of p.fact.entity_names) {
      if (!normalizeName(name)) continue;
      const subject = entitySubject(p.fact.subject);
      if (!known().has(entityKey(subject, name))) mentions.push({ name, aliases: [], type: "other", subject, relation: null });
    }
  }
  const entityIds = new Map<string, string>();
  const entOpts = { newSalience: config.extraction.new_entity_salience, bump: config.extraction.entity_bump, cap: config.retrieval.recall_cap };
  for (const m of mergeMentions(mentions)) {
    const existing = entityIds.get(entityKey(m.subject, m.name));
    const { id, created } = existing ? { id: existing, created: false } : await upsertEntityMention(db, userId, m, now, entOpts);
    if (created) out.entitiesCreated += 1;
    for (const n of [m.name, ...m.aliases]) entityIds.set(entityKey(m.subject, n), id);
  }

  // 2. Threads (model-supplied thread_ids must belong to this user).
  const threadIds = new Map<string, string>();
  for (const t of input.threads) {
    const byId = t.thread_id ? await getOwnedThread(db, userId, t.thread_id) : null;
    const existing = byId ?? (await findOpenThreadByTitle(db, userId, t.title));
    if (t.action === "open") {
      if (existing && existing.status === "open") {
        await touchThread(db, userId, existing.id, input.exchangeAt, t.next_checkpoint);
        threadIds.set(normalizeName(t.title), existing.id);
      } else {
        const row = await insertThread(db, userId, { title: t.title, subject: t.subject, stakes: t.stakes, next_checkpoint: t.next_checkpoint }, input.exchangeAt);
        out.threadsOpened += 1;
        threadIds.set(normalizeName(t.title), row.id);
      }
    } else if (existing) {
      if (t.action === "touch") await touchThread(db, userId, existing.id, input.exchangeAt, t.next_checkpoint);
      else await resolveThread(db, userId, existing.id, now);
      threadIds.set(normalizeName(t.title), existing.id);
      threadIds.set(normalizeName(existing.title), existing.id);
    }
  }

  // 3. Facts.
  const payload = input.sensitive ? { sensitive: true } : null;
  for (const p of input.facts) {
    const f = p.fact;
    const subject = entitySubject(f.subject);
    const entity_refs = [...new Set(f.entity_names.map((n) => entityIds.get(entityKey(subject, n))).filter((x): x is string => !!x))];
    const thread_id = f.thread_title
      ? threadIds.get(normalizeName(f.thread_title)) ?? (await findOpenThreadByTitle(db, userId, f.thread_title))?.id ?? null
      : null;
    const base = {
      subject: f.subject, kind: f.kind, content: f.content, payload, embedding: p.embedding, entity_refs, thread_id,
      occurred_at: f.occurred_at, created_at: input.exchangeAt, salience: f.salience, valence: f.valence, confidence: f.confidence,
      source: p.source ?? "turn", source_ref: input.sourceRef,
    };
    const target = p.decision.targetId ? await getFact(db, userId, p.decision.targetId) : null;
    const relation = target ? p.decision.relation : "new";

    if (relation === "duplicate" && target) {
      await bumpDuplicate(db, userId, target.id, config.reconcile.duplicate_bump, config.retrieval.recall_cap, f.confidence);
      out.duplicates += 1;
      out.factIds.push(target.id);
    } else if (relation === "resolves" && target) {
      // A late job must not resolve a truth stated after this exchange (§15.1 #9, mirrors contradicts).
      if (target.created_at <= input.exchangeAt) {
        await setFactStatus(db, userId, target.id, "resolved");
        out.resolved += 1;
      }
      const row = await insertFact(db, userId, { ...base, status: "resolved" });
      out.inserted += 1;
      out.factIds.push(row.id);
    } else if (relation === "contradicts" && target) {
      if (target.created_at > input.exchangeAt) {
        // A late job: the target is newer than this exchange, so the candidate is the outdated one.
        const row = await insertFact(db, userId, { ...base, status: "superseded", superseded_by: target.id });
        out.factIds.push(row.id);
      } else {
        const row = await insertFact(db, userId, { ...base, status: "open" });
        await setFactStatus(db, userId, target.id, "superseded", row.id);
        out.factIds.push(row.id);
      }
      out.superseded += 1;
      out.inserted += 1;
    } else {
      const row = await insertFact(db, userId, { ...base, status: "open" });
      out.inserted += 1;
      out.factIds.push(row.id);
    }
  }

  // 4. Recall write-back from the hot path's retrieval: a trace for every surviving fact, reinforcement
  //    only for unforced recalls with sim >= reinforce_min_sim (skips facts deleted meanwhile).
  out.recalledUpdated = (await applyRecall(
    db, userId, input.recalled, now,
    { bump: config.retrieval.recall_bump, cap: config.retrieval.recall_cap, minSim: config.retrieval.reinforce_min_sim },
    input.replyTurnId,
  )).length;

  // 5. Done.
  await markExtracted(db, userId, input.turnIds);
  return out;
}
