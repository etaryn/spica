/**
 * The mind-split migration's data cleanup: her old per-user generated events (and the threads they
 * opened) go, while anything she said in a conversation stays. Runs the migration's own DELETE
 * statements against seeded rows.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { insertThread } from "@/db/repos/user/threads";
import { fact, thread } from "@/db/schema";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const t0 = new Date("2026-01-05T10:00:00Z");
const deletes = readFileSync(join(process.cwd(), "src/db/migrations/0015_mind_split.sql"), "utf8")
  .split("--> statement-breakpoint")
  .map((s) => s.trim())
  .filter((s) => s.startsWith("DELETE"));

test("the migration drops generated self facts and their threads, keeping what she said", async () => {
  expect(deletes).toHaveLength(3);
  const db = getTestDb();
  const u = await createTestUser();
  const base = {
    subject: "self" as const,
    kind: "event" as const,
    embedding: vec(),
    created_at: t0,
    status: "open" as const,
    salience: 0.5,
    valence: 0,
    confidence: 1,
  };
  const t = await insertThread(
    db,
    u,
    { title: "Spica's big audition", subject: "self", stakes: "high", next_checkpoint: t0 },
    t0,
  );
  await insertFact(db, u, {
    ...base,
    content: "Spica has a big audition.",
    source: "generated",
    thread_id: t.id,
  });
  await insertFact(db, u, { ...base, content: "Spica told them about Solaris.", source: "turn" });

  for (const statement of deletes) await db.execute(sql.raw(statement));

  expect((await db.select().from(fact)).map((f) => f.content)).toEqual([
    "Spica told them about Solaris.",
  ]);
  expect(await db.select().from(thread)).toEqual([]);
});
