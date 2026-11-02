/**
 * Builds the real runtime for the app and the worker: config, database, Claude, Voyage, pg-boss,
 * the Postgres event bus and Web Push, wired into the mind's `Deps`.
 */
import { createCoreLayer } from "@/db/repos/core";
import Anthropic from "@anthropic-ai/sdk";
import { PgBoss } from "pg-boss";
import { systemClock } from "@/mind/platform/clock";
import { EMBEDDING_DIMENSIONS, loadConfig } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { assertEmbedderMatchesSchema } from "@/mind/platform/embedder/types";
import { VoyageEmbedder } from "@/mind/platform/embedder/voyage";
import { errorName } from "@/mind/platform/errors";
import { withTimeRendering } from "@/mind/platform/llm/render-net";
import { AnthropicProvider } from "@/mind/platform/llm/anthropic";
import { consoleLogger } from "@/mind/platform/log";
import { createModuleBus } from "@/mind/platform/modules";
import { noopPusher } from "@/mind/platform/push";
import { createDb } from "@/db/client";
import { modules } from "@/modules";
import { PgBossQueue } from "./pg-boss-jobs";
import { vapidPublicKey, type Env } from "./env";
import { PgEventBus } from "./pg-event-bus";
import { usageSink } from "./usage-sink";
import { WebPushPusher } from "./web-push";
import { createWebSources } from "./web-sources";

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
    core: createCoreLayer(db),
    clock: systemClock,
    llm: withTimeRendering(
      new AnthropicProvider(
        new Anthropic(),
        config.models,
        usageSink({ db, clock: systemClock, log: consoleLogger }),
      ),
      systemClock,
      config.time.relative_max_days,
    ),
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
    modules: createModuleBus(modules, () => deps),
    webSources: createWebSources({
      userAgent: config.posts.user_agent,
      timeoutMs: config.posts.fetch_timeout_ms,
      maxDownloadBytes: config.posts.max_download_bytes,
      weeklyMaxAgeDays: config.posts.weekly_max_age_days,
      descriptionMaxChars: config.posts.description_max_chars,
    }),
  };
  return { deps, boss };
}
