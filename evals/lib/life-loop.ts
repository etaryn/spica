import type { SimClock } from "@/core/clock";
import type { Deps } from "@/core/deps";
import { egoTick } from "@/core/ego/tick";
import { lifeDate } from "@/core/life/clock";
import { ensurePlans } from "@/core/life/plan";
import { lifeTick } from "@/core/life/tick";
import { HOUR } from "@/core/time";
import { nextLocalDate } from "@/core/timezone";
import { insertLifeDay } from "@/db/repos/life-day";
import { BASE, type LifeScript } from "./script";

const DAY = 86_400_000;

/**
 * Runs the production hourly life jobs (plan, life tick, ego tick) at every whole simulated hour between
 * sessions (design §9.3), never moving the clock backwards. Scripted plans are inserted instead of generated.
 */
export function makeLifeLoop(deps: Deps, clock: SimClock, life: LifeScript, start: Date) {
  const cfg = deps.config.life;
  const day0 = lifeDate(cfg, new Date(BASE));
  const dayIndex = (d: string) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${day0}T00:00:00Z`)) / DAY);
  const inject = (_userId: string, day: string) => {
    const hit = life.inject.find((x) => x.day === dayIndex(day));
    return hit ? { content: hit.content, valence: hit.valence } : null;
  };
  let hours = 0;
  let cursor = start.getTime();

  async function scriptedPlans(now: Date) {
    const today = lifeDate(cfg, now);
    for (const d of [today, nextLocalDate(today)]) {
      const blocks = life.plans[String(dayIndex(d))] ?? life.plans["*"];
      if (!blocks) continue;
      await insertLifeDay(deps.db, {
        date: d, source: "scripted", model: "none", prompt_version: "scripted", generated_at: now,
        plan: { blocks: blocks.map((b) => ({ ...b, busy: b.kind === "quiet" ? cfg.quiet_busy : b.kind === "downtime" ? 0 : b.busy })) },
      });
    }
  }

  async function runAt(t: number) {
    if (t > clock.now().getTime()) clock.set(new Date(t));
    const now = new Date(t);
    if (life.plan === "scripted") await scriptedPlans(now); else await ensurePlans(deps, now);
    const lt = await lifeTick(deps, now, { inject });
    if (lt.failed > 0) throw new Error(`life tick failed for ${lt.failed} of ${lt.users} user(s)`);
    const et = await egoTick(deps, now);
    if (et.failed > 0) throw new Error(`ego tick failed for ${et.failed} of ${et.users} user(s)`);
    hours += 1;
  }

  return {
    /** Once at the script start, so day 0 has a plan and blocks before session 1. */
    async start() { await runAt(start.getTime()); },
    /** Every whole hour after the later of the cursor and the clock, up to and including `to`. */
    async advance(to: Date) {
      cursor = Math.max(cursor, clock.now().getTime());
      for (let t = (Math.floor(cursor / HOUR) + 1) * HOUR; t <= to.getTime(); t += HOUR) await runAt(t);
      cursor = Math.max(cursor, to.getTime());
    },
    get hours() { return hours; },
  };
}
