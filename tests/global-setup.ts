import { createDb } from "@/db/client";
import { runMigrations } from "@/db/migrate";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://spica:spica@localhost:5432/spica_test";
  const { db, pool } = createDb(url);
  await runMigrations(db);
  await pool.end();
}
