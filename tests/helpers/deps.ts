import { SimClock } from "@/mind/platform/clock";
import { loadConfig } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { FakeEmbedder } from "@/mind/platform/embedder/fake";
import { RecordingEventBus } from "@/mind/platform/events";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { silentLogger } from "@/mind/platform/log";
import { createModuleBus, type Module } from "@/mind/platform/modules";
import { RecordingPusher } from "@/mind/platform/push";
import { RecordingQueue } from "@/mind/platform/jobs";
import { createCoreLayer } from "@/db/repos/core";
import { getTestDb } from "./db";

/** Handlers get this object, so a copy spread from it doesn't reach them. */
export function makeTestDeps(configOverrides: unknown = {}, modules: readonly Module[] = []) {
  const config = loadConfig(configOverrides);
  const ref: { deps?: Deps } = {};
  const deps = {
    db: getTestDb(),
    core: createCoreLayer(getTestDb()),
    clock: new SimClock(new Date("2026-01-05T09:00:00Z")),
    llm: new FakeLLMProvider(),
    embedder: new FakeEmbedder(config.embedding.dimensions),
    queue: new RecordingQueue(),
    config,
    log: silentLogger,
    events: new RecordingEventBus(),
    pusher: new RecordingPusher(),
    modules: createModuleBus(modules, () => ref.deps!),
  } satisfies Deps;
  ref.deps = deps;
  return deps;
}
