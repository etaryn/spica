import Anthropic from "@anthropic-ai/sdk";
import { PgBoss } from "pg-boss";
import { systemClock } from "@/core/clock";
import { EMBEDDING_DIMENSIONS, loadConfig } from "@/core/config";
import type { Deps } from "@/core/deps";
import { assertEmbedderMatchesSchema } from "@/core/embed/types";
import { VoyageEmbedder } from "@/core/embed/voyage";
import { AnthropicProvider } from "@/core/llm/anthropic";
import { consoleLogger } from "@/core/log";
import { createDb } from "@/db/client";
import { PgBossQueue } from "@/queue/pg-boss-queue";
import type { Env } from "./env";

/** Production wiring shared by the Next.js server and the worker. */
export function buildRuntime(env: Env): { deps: Deps; boss: PgBoss } {
  const config = loadConfig(env.configOverrides);
  const { db } = createDb(env.DATABASE_URL);
  const embedder = new VoyageEmbedder({
    apiKey: env.VOYAGE_API_KEY,
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  });
  assertEmbedderMatchesSchema(embedder, EMBEDDING_DIMENSIONS);
  const boss = new PgBoss(env.DATABASE_URL);
  boss.on("error", (e) => consoleLogger.error("pg-boss error", { error: String((e as Error)?.name ?? "Error") }));
  const deps: Deps = {
    db,
    clock: systemClock,
    llm: new AnthropicProvider(new Anthropic(), config.models),
    embedder,
    queue: new PgBossQueue(boss),
    config,
    log: consoleLogger,
  };
  return { deps, boss };
}
