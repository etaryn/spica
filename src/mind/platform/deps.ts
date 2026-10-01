import type { Db } from "@/db/client";
import type { Clock } from "./clock";
import type { Config } from "./config";
import type { Embedder } from "@/mind/platform/embedder/types";
import type { EventBus } from "./events";
import type { LLMProvider } from "@/mind/platform/llm/types";
import type { Logger } from "./log";
import type { Pusher } from "./push";
import type { JobQueue } from "./jobs";

export interface Deps {
  db: Db;
  clock: Clock;
  llm: LLMProvider;
  embedder: Embedder;
  queue: JobQueue;
  config: Config;
  log: Logger;
  events: EventBus;
  pusher: Pusher;
}
