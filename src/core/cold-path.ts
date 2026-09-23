import type { Deps } from "./deps";
import type { ColdPathJob } from "./queue";

/**
 * Cold path entry point (spec §4.2): extract → reconcile → update state.
 * Phase 0 deliberately does nothing, so turns stay `extracted = false` and
 * Phase 1's extractor processes the whole Phase 0 history.
 */
export async function handleColdPath(deps: Deps, job: ColdPathJob): Promise<void> {
  deps.log.info("cold_path received (phase 0: no-op)", { userId: job.userId, turns: job.turnIds.length });
}
