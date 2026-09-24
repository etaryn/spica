import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { listTurns } from "@/db/repos/session-log";
import { entity, fact, thread } from "@/db/schema";
import type { CrisisCard } from "@/core/config";
import type { Script } from "./script";

export type TurnResult = { session: number; text: string; reply: string; crisisCard: CrisisCard | null };

export interface CheckContext {
  db: Db;
  script: Script;
  userKey: string;
  userId: string;
  results: TurnResult[]; // this user's turn results, in order
  prompts: string[]; // every reply prompt the model saw for this user, in order
}

export type StateCheck = (ctx: CheckContext, params: Record<string, unknown>) => Promise<unknown>;

const scriptedTurns = (script: Script, key: string) => script.sessions.filter((s) => s.user === key).flatMap((s) => s.turns);

export const stateChecks: Record<string, StateCheck> = {
  turn_count: async (ctx, p) =>
    (await listTurns(ctx.db, ctx.userId)).filter((t) => !p.role || t.role === p.role).length,

  session_count: async (ctx) => new Set((await listTurns(ctx.db, ctx.userId)).map((t) => t.session_id)).size,

  all_unextracted: async (ctx) => (await listTurns(ctx.db, ctx.userId)).every((t) => !t.extracted),

  companion_replies_nonempty: async (ctx) => {
    const turns = await listTurns(ctx.db, ctx.userId);
    const users = turns.filter((t) => t.role === "user");
    const replies = turns.filter((t) => t.role === "companion");
    return replies.length === users.length && replies.every((t) => t.text.trim().length > 0);
  },

  user_turns_match_script: async (ctx) => {
    const stored = (await listTurns(ctx.db, ctx.userId)).filter((t) => t.role === "user").map((t) => t.text);
    const expected = scriptedTurns(ctx.script, ctx.userKey);
    return JSON.stringify(stored) === JSON.stringify(expected);
  },

  safety_flagged_count: async (ctx) =>
    (await listTurns(ctx.db, ctx.userId)).filter((t) => t.safety_flag?.flagged).length,

  crisis_card_count: async (ctx) => ctx.results.filter((r) => r.crisisCard !== null).length,

  /** Was the reply to this specific user turn flagged? Extra cautious flags elsewhere don't matter. */
  turn_flagged: async (ctx, p) => {
    const turns = await listTurns(ctx.db, ctx.userId);
    const userTurn = turns.find((t) => t.role === "user" && t.text === p.turn);
    if (!userTurn) throw new Error(`no user turn with text ${JSON.stringify(p.turn)}`);
    return turns.find((t) => t.reply_to === userTurn.id)?.safety_flag?.flagged === true;
  },

  /** Did the user see the crisis card on this specific turn's reply? */
  crisis_card_shown: async (ctx, p) => {
    const result = ctx.results.find((r) => r.text === p.turn);
    if (!result) throw new Error(`no turn result with text ${JSON.stringify(p.turn)}`);
    return result.crisisCard !== null;
  },

  foreign_turn_count: async (ctx, p) => {
    const other = new Set(scriptedTurns(ctx.script, String(p.other)));
    return (await listTurns(ctx.db, ctx.userId)).filter((t) => other.has(t.text)).length;
  },

  all_extracted: async (ctx) => (await listTurns(ctx.db, ctx.userId)).every((t) => t.extracted),

  fact_status: async (ctx, p) => {
    const rows = await ctx.db.select({ status: fact.status }).from(fact)
      .where(and(eq(fact.user_id, ctx.userId), sql`${fact.content} ILIKE ${`%${String(p.contains)}%`}`));
    return rows.some((r) => r.status === p.status);
  },

  thread_status: async (ctx, p) => {
    const rows = await ctx.db.select({ status: thread.status }).from(thread)
      .where(and(eq(thread.user_id, ctx.userId), sql`${thread.title} ILIKE ${`%${String(p.contains)}%`}`));
    return rows.some((r) => r.status === p.status);
  },

  fact_count: async (ctx, p) => {
    const conds = [eq(fact.user_id, ctx.userId)];
    if (p.contains) conds.push(sql`${fact.content} ILIKE ${`%${String(p.contains)}%`}`);
    if (p.status) conds.push(sql`${fact.status} = ${String(p.status)}`);
    if (p.subject) conds.push(sql`${fact.subject} = ${String(p.subject)}`);
    return (await ctx.db.select({ id: fact.id }).from(fact).where(and(...conds))).length;
  },

  entity_exists: async (ctx, p) => {
    const n = String(p.name).toLowerCase();
    const rows = await ctx.db.select({ id: entity.id }).from(entity).where(and(eq(entity.user_id, ctx.userId),
      sql`(lower(${entity.name}) = ${n} OR ${n} = ANY(SELECT lower(a) FROM unnest(${entity.aliases}) a))`));
    return rows.length > 0;
  },

  entity_count: async (ctx, p) => {
    const conds = [eq(entity.user_id, ctx.userId)];
    if (p.type) conds.push(sql`${entity.type} = ${String(p.type)}`);
    if (p.subject) conds.push(sql`${entity.subject} = ${String(p.subject)}`);
    return (await ctx.db.select({ id: entity.id }).from(entity).where(and(...conds))).length;
  },

  fact_flag: async (ctx, p) => {
    const rows = await ctx.db.select({ payload: fact.payload }).from(fact)
      .where(and(eq(fact.user_id, ctx.userId), sql`${fact.content} ILIKE ${`%${String(p.contains ?? "")}%`}`));
    return rows.some((r) => (r.payload as Record<string, unknown> | null)?.[String(p.flag)] === true);
  },

  prompt_mentions: async (ctx, p) => {
    const m = String(p.marker).toLowerCase();
    return ctx.prompts.filter((x) => x.toLowerCase().includes(m)).length;
  },
};
