import "server-only";
import { PgBossQueue } from "@/queue/pg-boss-queue";
import { buildRuntime } from "@/runtime/deps";
import { readEnv } from "@/runtime/env";

const g = globalThis as unknown as { __spicaRuntime?: ReturnType<typeof buildRuntime> };

/** One runtime per server process (survives dev hot reloads). */
export function getRuntime() {
  if (!g.__spicaRuntime) {
    const runtime = buildRuntime(readEnv());
    g.__spicaRuntime = runtime;
    // Warm the producer queue now, not inline on the first chat request.
    const { queue, log } = runtime.deps;
    if (queue instanceof PgBossQueue) {
      queue.start().catch((e) => log.error("pg-boss warm-up failed", { error: String((e as Error)?.name ?? "Error") }));
    }
  }
  return g.__spicaRuntime;
}

export const getDeps = () => getRuntime().deps;
