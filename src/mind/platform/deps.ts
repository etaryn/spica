/**
 * Everything the mind needs from the outside world, passed in rather than imported, so the same
 * code runs in the app, the worker, the tests and the evals.
 */
import type { Db } from "@/db/client";
import type { Clock } from "./clock";
import type { Config } from "./config";
import type { CoreLayer } from "./core";
import type { Embedder } from "@/mind/platform/embedder/types";
import type { EventBus } from "./events";
import type { JobQueue } from "./jobs";
import type { LLMProvider } from "@/mind/platform/llm/types";
import type { Logger } from "./log";
import type { Pusher } from "./push";

export interface Deps {
  db: Db;
  core: CoreLayer;
  clock: Clock;
  llm: LLMProvider;
  embedder: Embedder;
  queue: JobQueue;
  config: Config;
  log: Logger;
  events: EventBus;
  pusher: Pusher;
}

/**
 * What a core loop gets: her own memory, state and world, and the model, but no database, queue
 * or push, so it cannot reach a user's data even by mistake.
 */
export type CoreDeps = Pick<Deps, "core" | "llm" | "embedder" | "clock" | "config" | "log">;

export function coreDepsOf(deps: Deps): CoreDeps {
  const { core, llm, embedder, clock, config, log } = deps;
  return { core, llm, embedder, clock, config, log };
}
