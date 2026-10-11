import { sql } from "drizzle-orm";
import { createDb, type Db } from "@/db/client";
import { insertUserRow, truncateAll } from "@/db/admin";

export const testDbUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://spica:spica@localhost:5432/spica_test";

let cached: ReturnType<typeof createDb> | null = null;

export function getTestDb(): Db {
  cached ??= createDb(testDbUrl);
  return cached.db;
}

export async function closeTestDb(): Promise<void> {
  if (cached) await cached.pool.end();
  cached = null;
}

export async function resetDb(): Promise<void> {
  await truncateAll(getTestDb(), testDbUrl);
}

let seq = 0;
export async function createTestUser(name = "tester"): Promise<string> {
  seq += 1;
  return insertUserRow(getTestDb(), {
    name,
    email: `${name}-${seq}-${Date.now()}@test.local`,
    now: new Date("2026-01-01T00:00:00Z"),
  });
}

/** A non-zero vector of the schema dimension (zero vectors are undefined under cosine). */
export function vec(fill = 0.01): number[] {
  return Array.from({ length: 1024 }, () => fill);
}

/**
 * The peak stage a test's seeded closeness stands for, so gates read as they did when closeness
 * set them directly: the together stages' closeness thresholds.
 */
export async function seedStageFor(db: Db, userId: string, closeness: number): Promise<void> {
  const peak = closeness >= 0.65 ? "integrating" : closeness >= 0.4 ? "intensifying" : "initiating";
  await db.execute(sql`UPDATE relationship SET peak_stage = ${peak} WHERE user_id = ${userId}`);
}
