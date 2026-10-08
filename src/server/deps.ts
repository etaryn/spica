/**
 * One runtime per server process for the Next app, kept across dev hot reloads.
 */
import "server-only";
import { PgBossQueue } from "@/runtime/pg-boss-jobs";
import { buildRuntime } from "@/runtime/deps";
import { readEnv, vapidPublicKey } from "@/runtime/env";

const g = globalThis as unknown as { __spicaRuntime?: ReturnType<typeof buildRuntime> };

/** One runtime per server process (survives dev hot reloads). */
function getRuntime() {
  if (!g.__spicaRuntime) {
    const runtime = buildRuntime(readEnv());
    g.__spicaRuntime = runtime;
    // Warm the producer queue now, not inline on the first chat request.
    const { queue, log } = runtime.deps;
    if (queue instanceof PgBossQueue) {
      queue
        .start()
        .catch((e) =>
          log.error("pg-boss warm-up failed", { error: String((e as Error)?.name ?? "Error") }),
        );
    }
  }
  return g.__spicaRuntime;
}

export const getDeps = () => getRuntime().deps;
export const getVapidPublicKey = () => vapidPublicKey(readEnv());
