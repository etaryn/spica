import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Db } from "./client";
import { user } from "./schema";

/** Throws unless the URL points at a database whose name ends in _test or _eval. */
export function assertDisposableDatabase(url: string): void {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/_(test|eval)$/.test(name)) {
    throw new Error(
      `refusing to wipe database "${name}": only *_test or *_eval databases may be truncated`,
    );
  }
}

/** Deletes every row of every Spica table. Tests and evals only. */
export async function truncateAll(db: Db, url: string): Promise<void> {
  assertDisposableDatabase(url);
  // Every domain table cascades from "user"; the rest hold no user data and are listed by name.
  await db.execute(
    sql`TRUNCATE "user", verification, life_day, core_memory, core_entity, core_state, core_goal, core_snapshot, world_event, life_event_log, core_loop_trace, core_budget_day CASCADE`,
  );
}

/** Inserts a user row directly, bypassing Better Auth. Tests and evals only. */
export async function insertUserRow(
  db: Db,
  input: { name: string; email: string; dateOfBirth?: string; now: Date },
): Promise<string> {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name: input.name,
    email: input.email,
    dateOfBirth: input.dateOfBirth ?? "1990-01-01",
    createdAt: input.now,
    updatedAt: input.now,
  });
  return id;
}
