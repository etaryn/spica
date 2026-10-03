/** Claim one local night before running independent core reflection, consolidation and self checks. */
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { baselineNeeds } from "@/mind/state/core/core-state";
import { lifeDate, lifeHour } from "@/mind/world/her-clock";
import { coreConsolidate } from "./consolidate";
import { coreDriftWatch } from "./drift-watch";
import { coreReflect } from "./reflect";
import { coreRenderSnapshot } from "./render-snapshot";

/** True when this invocation won the date claim, regardless of individual loop outcomes. */
export async function coreNightly(deps: CoreDeps, now: Date): Promise<boolean> {
  const { core, config } = deps;
  if (lifeHour(config.life, now) < config.core.nightly.local_hour) return false;
  const day = lifeDate(config.life, now);
  await core.state.ensure(config.core.state.baseline, baselineNeeds(config.core.state));
  const claimed = await core.transaction(async (tx) => {
    const state = await tx.state.lock();
    if (state.last_nightly_day && state.last_nightly_day >= day) return false;
    await tx.state.update({ last_nightly_day: day });
    return true;
  });
  if (!claimed) return false;

  async function run(name: string, loop: () => Promise<unknown>): Promise<boolean> {
    try {
      await loop();
      return true;
    } catch (error) {
      deps.log.error("core nightly loop failed", { loop: name, error: errorName(error) });
      return false;
    }
  }

  await run("core_reflect", () => coreReflect(deps, now));
  await run("core_consolidate", () => coreConsolidate(deps, now));
  let version: number | undefined;
  await run("core_render_snapshot", async () => {
    const previousVersion = (await core.memory.latestSnapshot())?.version ?? -1;
    const status = await coreRenderSnapshot(deps, now);
    if (status !== "done") return;
    const currentVersion = (await core.memory.latestSnapshot())?.version;
    if (currentVersion !== undefined && currentVersion > previousVersion) version = currentVersion;
  });
  const renderedVersion = version;
  if (renderedVersion !== undefined)
    await run("core_drift_watch", () => coreDriftWatch(deps, now, renderedVersion));
  return true;
}
