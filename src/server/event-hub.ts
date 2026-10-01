import "server-only";
import { consoleLogger } from "@/mind/platform/log";
import { EventHub } from "@/runtime/event-hub";
import { readEnv } from "@/runtime/env";
import { getDeps } from "./deps";

const g = globalThis as unknown as { __spicaEventHub?: EventHub };

/** One LISTEN connection per server process (survives dev hot reloads). */
export function getEventHub(): EventHub {
  g.__spicaEventHub ??= new EventHub(
    readEnv().DATABASE_URL,
    getDeps().config.events.channel,
    consoleLogger,
  );
  return g.__spicaEventHub;
}
