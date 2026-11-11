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
import type { CoreEvent, ModuleBus } from "./modules";
import type { Pusher } from "./push";
import type { ReelTools } from "./reel-tools";
import type { WebSources } from "@/mind/world/types";

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
  modules: ModuleBus;
  webSources: WebSources;
  reelTools: ReelTools;
}

/**
 * What a core loop gets: her own memory, state and world, and the model, but no database, queue
 * or push, so it cannot reach a user's data even by mistake. It also gets the web sources she
 * browses and the reel tools her posts are made with, neither of which carries a user. It can announce her own events to
 * modules, and nothing about a user.
 */
export type CoreDeps = Pick<
  Deps,
  "core" | "llm" | "embedder" | "clock" | "config" | "log" | "webSources" | "reelTools"
> & {
  emitCore(event: CoreEvent): Promise<void>;
};

export function coreDepsOf(deps: Deps): CoreDeps {
  const { core, llm, embedder, clock, config, log, webSources, reelTools } = deps;
  return {
    core,
    llm,
    embedder,
    clock,
    config,
    log,
    webSources,
    reelTools,
    emitCore: (event) => deps.modules.emit(event),
  };
}
