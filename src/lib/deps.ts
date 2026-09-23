import "server-only";
import { buildRuntime } from "@/runtime/deps";
import { readEnv } from "@/runtime/env";

const g = globalThis as unknown as { __spicaRuntime?: ReturnType<typeof buildRuntime> };

/** One runtime per server process (survives dev hot reloads). */
export function getRuntime() {
  g.__spicaRuntime ??= buildRuntime(readEnv());
  return g.__spicaRuntime;
}

export const getDeps = () => getRuntime().deps;
