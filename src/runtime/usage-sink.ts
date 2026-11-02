/**
 * Books each model call to the user it was for. A reply never waits on this and never fails
 * because of it: a write that fails is logged and the call goes on. Calls for nobody (core) are
 * skipped; their ledger is `core_loop_trace`.
 */
import { insertLlmUsage } from "@/db/repos/user/llm-usage";
import type { Db } from "@/db/client";
import type { Clock } from "@/mind/platform/clock";
import { errorName } from "@/mind/platform/errors";
import type { LlmUsage, UsageSink } from "@/mind/platform/llm/types";
import type { Logger } from "@/mind/platform/log";

export async function recordUsage(
  deps: { db: Db; clock: Clock; log: Logger },
  usage: LlmUsage,
): Promise<void> {
  const { user_id: userId, purpose, ...counts } = usage;
  if (!userId) return;
  try {
    await insertLlmUsage(deps.db, userId, {
      purpose,
      ...counts,
      created_at: deps.clock.now(),
    });
  } catch (e) {
    deps.log.error("llm usage not recorded", { userId, purpose, error: errorName(e) });
  }
}

export const usageSink =
  (deps: { db: Db; clock: Clock; log: Logger }): UsageSink =>
  (usage) => {
    void recordUsage(deps, usage);
  };
