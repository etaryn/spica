import { SimClock } from "@/core/clock";
import { loadConfig } from "@/core/config";
import type { Deps } from "@/core/deps";
import { FakeEmbedder } from "@/core/embed/fake";
import { FakeLLMProvider } from "@/core/llm/fake";
import { silentLogger } from "@/core/log";
import { RecordingQueue } from "@/core/queue";
import { getTestDb } from "./db";

export function makeTestDeps(configOverrides: unknown = {}) {
  const config = loadConfig(configOverrides);
  return {
    db: getTestDb(),
    clock: new SimClock(new Date("2026-01-05T09:00:00Z")),
    llm: new FakeLLMProvider(),
    embedder: new FakeEmbedder(config.embedding.dimensions),
    queue: new RecordingQueue(),
    config,
    log: silentLogger,
  } satisfies Deps;
}
