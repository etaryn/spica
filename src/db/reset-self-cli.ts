import { createDb } from "./client";
import { adminResetSelf, assertLocalDatabase } from "./reset-self";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
assertLocalDatabase(url);
const { db, pool } = createDb(url);
const n = await adminResetSelf(db);
await pool.end();
console.log(`reset self: deleted ${n.facts} facts, ${n.entities} entities, ${n.threads} threads`);
