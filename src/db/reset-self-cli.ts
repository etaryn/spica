/**
 * `pnpm db:reset-self`: wipes her self facts and her whole core mind on a local dev database, then
 * reseeds snapshot v0 and her canon people from the current persona and config, so replies have
 * "Who you are lately" straight away rather than after the next worker start.
 */
import { createCoreLayer } from "@/db/repos/core";
import { seedCore } from "@/mind/memory/core/seed";
import { systemClock } from "@/mind/platform/clock";
import { loadConfig } from "@/mind/platform/config";
import { VoyageEmbedder } from "@/mind/platform/embedder/voyage";
import { readEnv } from "@/runtime/env";
import { createDb } from "./client";
import { adminResetSelf, assertLocalDatabase } from "./reset-self";

const env = readEnv();
assertLocalDatabase(env.DATABASE_URL);
const { db, pool } = createDb(env.DATABASE_URL);
const config = loadConfig(env.configOverrides);
const embedder = new VoyageEmbedder({
  apiKey: env.VOYAGE_API_KEY,
  model: config.embedding.model,
  dimensions: config.embedding.dimensions,
});
const n = await adminResetSelf(db);
await seedCore({
  core: createCoreLayer(db),
  clock: systemClock,
  config,
  embedder,
});
await pool.end();
console.log(
  `reset self: deleted ${n.facts} facts, ${n.entities} entities, ${n.threads} threads; ` +
    "cleared her core mind and reseeded snapshot v0, her canon people and her goals",
);
