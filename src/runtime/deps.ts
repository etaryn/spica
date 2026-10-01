import Anthropic from "@anthropic-ai/sdk";
import { PgBoss } from "pg-boss";
import { systemClock } from "@/core/clock";
import { EMBEDDING_DIMENSIONS, loadConfig } from "@/core/config";
import type { Deps } from "@/core/deps";
import { assertEmbedderMatchesSchema } from "@/core/embed/types";
import { VoyageEmbedder } from "@/core/embed/voyage";
import { errorName } from "@/core/errors";
import { AnthropicProvider } from "@/core/llm/anthropic";
import { consoleLogger } from "@/core/log";
import { noopPusher } from "@/core/push";
import { createDb } from "@/db/client";
import { PgBossQueue } from "@/queue/pg-boss-queue";
import { vapidPublicKey, type Env } from "./env";
import { PgEventBus } from "./pg-event-bus";
import { WebPushPusher } from "./web-push";

/** Production wiring shared by the Next.js server and the worker. */
export function buildRuntime(env: Env): { deps: Deps; boss: PgBoss } {
  const config = loadConfig(env.configOverrides);
  const { db } = createDb(env.DATABASE_URL);
  const pusher =
    config.push.enabled && vapidPublicKey(env)
      ? new WebPushPusher(
          db,
          {
            publicKey: env.VAPID_PUBLIC_KEY!,
            privateKey: env.VAPID_PRIVATE_KEY!,
            subject: env.VAPID_SUBJECT!,
            ttlSeconds: config.push.ttl_seconds,
            timeoutMs: config.push.timeout_ms,
          },
          consoleLogger,
        )
      : noopPusher;
  if (pusher === noopPusher)
    consoleLogger.info("web push disabled", {
      reason: config.push.enabled ? "no VAPID keys" : "push.enabled false",
    });
  const embedder = new VoyageEmbedder({
    apiKey: env.VOYAGE_API_KEY,
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  });
  assertEmbedderMatchesSchema(embedder, EMBEDDING_DIMENSIONS);
  const boss = new PgBoss(env.DATABASE_URL);
  boss.on("error", (e) => consoleLogger.error("pg-boss error", { error: errorName(e) }));
  const deps: Deps = {
    db,
    clock: systemClock,
    llm: new AnthropicProvider(new Anthropic(), config.models),
    embedder,
    queue: new PgBossQueue(boss, {
      retryLimit: config.cold_path.retry_limit,
      retryDelaySeconds: config.cold_path.retry_delay_seconds,
      turnExpireSeconds: config.turn.job_expire_seconds,
      timerRetryLimit: config.turn.timer_job_retry_limit,
      timerRetryDelaySeconds: config.turn.timer_job_retry_delay_seconds,
    }),
    config,
    log: consoleLogger,
    events: new PgEventBus(db, config.events.channel),
    pusher,
  };
  return { deps, boss };
}
