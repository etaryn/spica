/** One hourly core thinking pass, in order, with each loop free to fail independently. */
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { coreAnticipate } from "./anticipate";
import { coreRuminate } from "./ruminate";
import { coreWander } from "./wander";
import type { ThinkingResult } from "./thoughts";

export async function coreMindTick(
  deps: CoreDeps,
  now: Date,
): Promise<Record<"anticipate" | "ruminate" | "wander", ThinkingResult>> {
  async function run(
    name: "anticipate" | "ruminate" | "wander",
    loop: typeof coreAnticipate,
  ): Promise<ThinkingResult> {
    try {
      return await loop(deps, now);
    } catch (error) {
      deps.log.error("core thinking failed", { loop: name, error: errorName(error) });
      return { status: "failed", applied: false, ids: [] };
    }
  }

  return {
    anticipate: await run("anticipate", coreAnticipate),
    ruminate: await run("ruminate", coreRuminate),
    wander: await run("wander", coreWander),
  };
}
