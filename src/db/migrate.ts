import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client";

export async function runMigrations(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "src/db/migrations") });
}
