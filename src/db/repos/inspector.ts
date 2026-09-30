import { and, arrayContains, desc, eq, getTableColumns, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { effect, fadeParams } from "@/core/relationship/homeostasis";
import { PARAM_NAMES, type RelConfig } from "@/core/relationship/types";
import type { Db } from "../client";
import {
  conversation_state, ego_tick, entity, fact, factStatus, factSubject, identity, judge_log, reach_out_log, retrieval_trace, thread,
} from "../schema";
import { getLifeDay } from "./life-day";
import { listLifeEventLogs } from "./life-event-log";
import { getParams, getRelationshipRow, listRelationshipEvents } from "./relationship";

export type FactFilters = {
  subject: (typeof factSubject.enumValues)[number] | undefined;
  status: (typeof factStatus.enumValues)[number] | undefined;
  entityId: string | undefined;
  threadId: string | undefined;
  sort: "salience" | "recency";
};

const opt = <T extends z.ZodType>(s: T) => s.optional().catch(undefined);

export function parseFactFilters(sp: Record<string, string | undefined>): FactFilters {
  return {
    subject: opt(z.enum(factSubject.enumValues)).parse(sp.subject),
    status: opt(z.enum(factStatus.enumValues)).parse(sp.status),
    entityId: opt(z.uuid()).parse(sp.entityId),
    threadId: opt(z.uuid()).parse(sp.threadId),
    sort: z.enum(["salience", "recency"]).catch("recency").parse(sp.sort),
  };
}

const { embedding: _embedding, ...factColumns } = getTableColumns(fact);

export async function listFacts(db: Db, userId: string, f: FactFilters) {
  const conds = [eq(fact.user_id, userId)];
  if (f.subject) conds.push(eq(fact.subject, f.subject));
  if (f.status) conds.push(eq(fact.status, f.status));
  if (f.entityId) conds.push(arrayContains(fact.entity_refs, [f.entityId]));
  if (f.threadId) conds.push(eq(fact.thread_id, f.threadId));
  const recency = sql`greatest(${fact.created_at}, coalesce(${fact.last_recalled_at}, ${fact.created_at}))`;
  return db.select(factColumns).from(fact).where(and(...conds))
    .orderBy(f.sort === "salience" ? desc(fact.salience) : desc(recency))
    .limit(500);
}

export const listEntities = (db: Db, userId: string) =>
  db.select().from(entity).where(eq(entity.user_id, userId)).orderBy(desc(entity.salience));

export const listThreads = (db: Db, userId: string) =>
  db.select().from(thread).where(eq(thread.user_id, userId)).orderBy(desc(thread.last_touched));

export async function getIdentity(db: Db, userId: string) {
  return (await db.select().from(identity).where(eq(identity.user_id, userId)))[0] ?? null;
}

export async function getRelationshipView(db: Db, userId: string, now: Date, cfg: RelConfig) {
  const row = await getRelationshipRow(db, userId);
  if (!row) return null;
  const params = fadeParams(await getParams(db, userId), now, cfg);
  return {
    row,
    params: PARAM_NAMES.map((name) => ({ name, ...params[name], effect: effect(params[name], cfg.variance_epsilon) })),
    events: await listRelationshipEvents(db, userId, cfg.event_list_limit),
  };
}

export const listEgoTicks = (db: Db, userId: string) =>
  db.select().from(ego_tick).where(eq(ego_tick.user_id, userId)).orderBy(desc(ego_tick.created_at)).limit(100);

export const listRetrievalTraces = (db: Db, userId: string) =>
  db.select({ trace: retrieval_trace, content: fact.content })
    .from(retrieval_trace)
    .leftJoin(fact, eq(fact.id, retrieval_trace.fact_id))
    .where(eq(retrieval_trace.user_id, userId))
    .orderBy(desc(retrieval_trace.created_at), desc(retrieval_trace.score))
    .limit(500);

export const listReachOuts = (db: Db, userId: string, limit: number) =>
  db.select().from(reach_out_log).where(eq(reach_out_log.user_id, userId)).orderBy(desc(reach_out_log.created_at)).limit(limit);

export const getConversationState = async (db: Db, userId: string) =>
  (await db.select().from(conversation_state).where(eq(conversation_state.user_id, userId)).limit(1))[0] ?? null;

export const listJudgeLog = (db: Db, userId: string) =>
  db.select().from(judge_log).where(eq(judge_log.user_id, userId))
    .orderBy(desc(judge_log.created_at), desc(judge_log.attempt)).limit(200);

/**
 * View-time resolution of the fact ids `judge_log.input` holds (v2 §5.8: the log never stores fact
 * content). User-scoped, so a deleted or foreign id never resolves. Missing ids mean the fact was
 * hard-deleted since (`forgetFact`) — the caller shows "(deleted)".
 */
export async function resolveFactContents(db: Db, userId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await db.select({ id: fact.id, content: fact.content }).from(fact)
    .where(and(eq(fact.user_id, userId), inArray(fact.id, unique)));
  return new Map(rows.map((r) => [r.id, r.content]));
}

/** The Life tab (Phase 5 design §9.2). The plan is global; facts and the event log are this user's. */
export async function getLifeView(db: Db, userId: string, day: string) {
  const [plan, facts, log] = await Promise.all([
    getLifeDay(db, day),
    db.select({ id: fact.id, content: fact.content, status: fact.status, payload: fact.payload, occurred_at: fact.occurred_at })
      .from(fact).where(and(eq(fact.user_id, userId), eq(fact.source, "generated"))).orderBy(desc(fact.created_at)).limit(200),
    listLifeEventLogs(db, userId, 200),
  ]);
  return { plan, facts, log };
}
