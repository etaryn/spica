/**
 * `core_state_tick`: one hourly step of her core state. Mood and arousal drift toward her
 * baseline, energy follows her daily rhythm and her busy blocks, and an old preoccupation lets go.
 * One row for everyone, so the step is the same whichever user is talking to her.
 */
import type { CoreDeps } from "@/mind/platform/deps";
import { seededUnit } from "@/mind/platform/seeded-random";
import { HOUR } from "@/mind/platform/time";
import { localMidnight } from "@/mind/platform/timezone";
import { todaysBlocks } from "@/mind/world/blocks";
import { lifeDate, lifeHour, lifeTimezone } from "@/mind/world/her-clock";
import { dayLoad, driftStep, energyTarget, moodOf, preoccupationExpired } from "./core-state";

const sameHour = (a: Date | null, b: Date) =>
  !!a && Math.floor(a.getTime() / HOUR) === Math.floor(b.getTime() / HOUR);

export async function coreStateTick(deps: CoreDeps, now: Date): Promise<"not_due" | "done"> {
  const { core, config } = deps;
  const cfg = config.core.state;
  await core.state.ensure(cfg.baseline);
  if (sameHour((await core.state.get())?.last_tick ?? null, now)) return "not_due";

  const day = lifeDate(config.life, now);
  const blocks = await todaysBlocks(deps, now);
  const load = dayLoad(blocks, localMidnight(day, lifeTimezone(config.life, now)), now, cfg);
  const hourIso = new Date(Math.floor(now.getTime() / HOUR) * HOUR).toISOString();
  const noise = (["v", "a", "e"] as const).map(
    (d) => seededUnit(`core:${hourIso}:${d}`) * 2 - 1,
  ) as [number, number, number];

  return core.transaction(async (tx) => {
    const row = await tx.state.lock();
    if (sameHour(row.last_tick, now)) return "not_due";

    const target = {
      mood_valence: row.baseline.mood_valence,
      mood_arousal: row.baseline.mood_arousal,
      energy: energyTarget(row.baseline, lifeHour(config.life, now), load, cfg),
    };
    const next = driftStep(moodOf(row), target, noise, cfg);
    const clear = preoccupationExpired(row.preoccupation_since, now, cfg);
    await tx.state.update({
      ...next,
      last_tick: now,
      ...(clear ? { preoccupation: null, preoccupation_since: null } : {}),
    });
    await tx.traces.insert({
      loop: "core_state_tick",
      inputs: { load, hour: lifeHour(config.life, now) },
      outputs: { ...next, preoccupation_cleared: clear },
      model: null,
      prompt_version: null,
      tokens_in: null,
      tokens_out: null,
      cost: null,
      created_at: now,
    });
    return "done" as const;
  });
}
