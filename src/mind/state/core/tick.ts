/**
 * `core_state_tick`: one hourly step of her core state. Mood and arousal drift toward her
 * baseline, energy runs as a battery her busy blocks drain, she logs off when it runs low and
 * comes back once it has recovered, an old preoccupation lets go,
 * unmet needs slowly deplete, and a feeling fades after a few hours.
 * One row for everyone, so the step is the same whichever user is talking to her.
 */
import type { CoreDeps } from "@/mind/platform/deps";
import { seededUnit } from "@/mind/platform/seeded-random";
import { HOUR } from "@/mind/platform/time";
import { blocksForDay, todaysBlocks } from "@/mind/world/blocks";
import { lifeDate } from "@/mind/world/her-clock";
import {
  baselineNeeds,
  depleteNeeds,
  driftStep,
  emotionExpired,
  energyStep,
  hourLoad,
  nextOffline,
  preoccupationExpired,
} from "./core-state";

const sameHour = (a: Date | null, b: Date) =>
  !!a && Math.floor(a.getTime() / HOUR) === Math.floor(b.getTime() / HOUR);

export async function coreStateTick(deps: CoreDeps, now: Date): Promise<"not_due" | "done"> {
  const { core, config } = deps;
  const cfg = config.core.state;
  await core.state.ensure(cfg.baseline, baselineNeeds(cfg));
  if (sameHour((await core.state.get())?.last_tick ?? null, now)) return "not_due";

  // The hour just past can start on yesterday's plan: a block running to midnight still drains.
  const hourAgo = new Date(now.getTime() - HOUR);
  const today = lifeDate(config.life, now);
  const yesterday = lifeDate(config.life, hourAgo);
  const blocks = [
    ...(await todaysBlocks(deps, now)),
    ...(yesterday === today
      ? []
      : blocksForDay(config.life, yesterday, await core.world.plan(yesterday))),
  ];
  const hour = hourLoad(blocks, hourAgo, now);
  const hourIso = new Date(Math.floor(now.getTime() / HOUR) * HOUR).toISOString();
  const noise = (["v", "a", "e"] as const).map(
    (d) => seededUnit(`core:${hourIso}:${d}`) * 2 - 1,
  ) as [number, number, number];

  return core.transaction(async (tx) => {
    const row = await tx.state.lock();
    if (sameHour(row.last_tick, now)) return "not_due";

    const offline = row.offline_since !== null;
    const next = {
      ...driftStep(row, row.baseline, [noise[0], noise[1]], cfg),
      energy: energyStep(row.energy, hour, offline, noise[2], cfg),
    };
    const offlineSince = nextOffline(row.offline_since, next.energy, now, cfg);
    const clear = preoccupationExpired(row.preoccupation_since, now, cfg);
    await tx.state.update({
      ...next,
      needs: depleteNeeds(row.needs, cfg),
      ...(emotionExpired(row.emotion, now, cfg) ? { emotion: null } : {}),
      last_tick: now,
      offline_since: offlineSince,
      ...(clear ? { preoccupation: null, preoccupation_since: null } : {}),
    });
    await tx.traces.insert({
      loop: "core_state_tick",
      inputs: { load: hour.load, covered: hour.covered, offline },
      outputs: {
        ...next,
        offline: offlineSince !== null,
        needs: depleteNeeds(row.needs, cfg),
        preoccupation_cleared: clear,
        emotion_cleared: emotionExpired(row.emotion, now, cfg),
      },
      model: null,
      prompt_version: null,
      tokens_in: null,
      tokens_out: null,
      cost: null,
      calls: 0,
      status: "done",
      error: null,
      created_at: now,
    });
    return "done" as const;
  });
}
