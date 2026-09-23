import type { Db } from "@/db/client";
import type { Clock } from "./clock";
import type { Config } from "./config";
import type { Embedder } from "./embed/types";
import type { LLMProvider } from "./llm/types";
import type { Logger } from "./log";
import type { JobQueue } from "./queue";

export interface Deps {
  db: Db;
  clock: Clock;
  llm: LLMProvider;
  embedder: Embedder;
  queue: JobQueue;
  config: Config;
  log: Logger;
}
