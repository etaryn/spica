/**
 * Model usage per user: one row per call (counts only), summed per purpose and model on read.
 */
import { and, eq, gte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "@/db/client";
import { llm_usage } from "@/db/schema";

export type NewLlmUsage = Omit<typeof llm_usage.$inferInsert, "user_id" | "id">;

export async function insertLlmUsage(db: Db, userId: string, row: NewLlmUsage): Promise<void> {
  await db.insert(llm_usage).values({ ...row, user_id: userId });
}

/** The user's calls since `since`, summed per purpose and model; biggest first. */
export async function llmUsageSince(db: Db, userId: string, since: Date) {
  const sum = (c: AnyPgColumn) => sql<number>`sum(${c})::int`;
  return db
    .select({
      purpose: llm_usage.purpose,
      model: llm_usage.model,
      calls: sql<number>`count(*)::int`,
      input_tokens: sum(llm_usage.input_tokens),
      output_tokens: sum(llm_usage.output_tokens),
      cache_read_input_tokens: sum(llm_usage.cache_read_input_tokens),
      cache_creation_input_tokens: sum(llm_usage.cache_creation_input_tokens),
      cache_creation_1h_input_tokens: sum(llm_usage.cache_creation_1h_input_tokens),
    })
    .from(llm_usage)
    .where(and(eq(llm_usage.user_id, userId), gte(llm_usage.created_at, since)))
    .groupBy(llm_usage.purpose, llm_usage.model)
    .orderBy(sql`sum(${llm_usage.input_tokens} + ${llm_usage.output_tokens}) desc`);
}
