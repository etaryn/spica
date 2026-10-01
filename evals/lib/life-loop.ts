import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { SimClock } from "@/mind/platform/clock";
import type { Deps } from "@/mind/platform/deps";
import { egoTick } from "@/mind/state/legacy-ego/tick";
import { lifeDate } from "@/mind/world/her-clock";
import { ensurePlans } from "@/mind/world/day-plan";
import { lifeTick } from "@/mind/world/legacy-life-tick/tick";
import { outreachTick } from "@/mind/process/outreach/tick";
import type { RecordingQueue } from "@/mind/platform/jobs";
import { HOUR } from "@/mind/platform/time";
import { nextLocalDate } from "@/mind/platform/timezone";
import { receiveMessage } from "@/mind/process/turn-taking/receive-message";
import { insertLifeDay } from "@/db/repos/life-day";
import { session_log } from "@/db/schema";
import { runDueJobs } from "./scheduler";
import { BASE, type LifeScript, type OutreachScript } from "./script";

const DAY = 86_400_000;

/** Run the outreach tick and due reach-out sends in the loop, and answer reach-outs per the script. */
export type LoopOutreach = {
  queue: RecordingQueue;
  script: OutreachScript;
  userIds: () => string[];
};

/**
 * Runs the production hourly life jobs (plan, life tick, ego tick) at every whole simulated hour between
 * sessions, never moving the clock backwards. Scripted plans are inserted instead of generated.
 * With `outreach`, each hour first runs due jobs (reach-out sends, simulated replies' turn timers),
 * then the script's auto-replies to reach-outs, then the life jobs and the outreach tick.
 */
export function makeLifeLoop(
  deps: Deps,
  clock: SimClock,
  life: LifeScript,
  start: Date,
  outreach?: LoopOutreach,
) {
  const cfg = deps.config.life;
  const day0 = lifeDate(cfg, new Date(BASE));
  const dayIndex = (d: string) =>
    Math.round((Date.parse(`${d}T00:00:00Z`) - Date.parse(`${day0}T00:00:00Z`)) / DAY);
  const inject = (_userId: string, day: string) => {
    const hit = life.inject.find((x) => x.day === dayIndex(day));
    return hit ? { content: hit.content, valence: hit.valence } : null;
  };
  let hours = 0;
  let cursor = start.getTime();
  /** Reach-out turns already answered by the simulated user. */
  const handled = new Set<string>();

  /** Answers every reach-out whose reply is due by `t` (policy `{ after_hours }`), in time order. */
  async function autoReplies(o: LoopOutreach, t: number) {
    const policy = o.script.user_replies;
    if (policy === "never") return;
    const ids = o.userIds();
    if (!ids.length) return;
    const ros = await deps.db
      .select({
        id: session_log.id,
        user_id: session_log.user_id,
        created_at: session_log.created_at,
      })
      .from(session_log)
      .where(and(inArray(session_log.user_id, ids), eq(session_log.trigger, "reach_out")))
      .orderBy(asc(session_log.created_at));
    for (const r of ros) {
      if (handled.has(r.id)) continue;
      const at = r.created_at.getTime() + policy.after_hours * HOUR;
      if (at > t) continue;
      await runDueJobs(deps, o.queue, clock, new Date(at));
      if (at > clock.now().getTime()) clock.set(new Date(at));
      await receiveMessage(deps, r.user_id, {
        clientMessageId: randomUUID(),
        text: o.script.reply_text,
      });
      handled.add(r.id);
    }
    await runDueJobs(deps, o.queue, clock, new Date(t));
  }

  async function scriptedPlans(now: Date) {
    const today = lifeDate(cfg, now);
    for (const d of [today, nextLocalDate(today)]) {
      const blocks = life.plans[String(dayIndex(d))] ?? life.plans["*"];
      if (!blocks) continue;
      await insertLifeDay(deps.db, {
        date: d,
        source: "scripted",
        model: "none",
        prompt_version: "scripted",
        generated_at: now,
        plan: {
          blocks: blocks.map((b) => ({
            ...b,
            busy: b.kind === "quiet" ? cfg.quiet_busy : b.kind === "downtime" ? 0 : b.busy,
          })),
        },
      });
    }
  }

  async function runAt(t: number) {
    if (t > clock.now().getTime()) clock.set(new Date(t));
    const now = new Date(t);
    if (life.plan === "scripted") await scriptedPlans(now);
    else await ensurePlans(deps, now);
    const lt = await lifeTick(deps, now, { inject });
    if (lt.failed > 0) throw new Error(`life tick failed for ${lt.failed} of ${lt.users} user(s)`);
    const et = await egoTick(deps, now);
    if (et.failed > 0) throw new Error(`ego tick failed for ${et.failed} of ${et.users} user(s)`);
    if (outreach) {
      const ot = await outreachTick(deps, now);
      if (ot.failed > 0)
        throw new Error(`outreach tick failed for ${ot.failed} of ${ot.users} user(s)`);
    }
    hours += 1;
  }

  return {
    /** Once at the script start, so day 0 has a plan and blocks before session 1. */
    async start() {
      await runAt(start.getTime());
    },
    /** Every whole hour after the later of the cursor and the clock, up to and including `to`. */
    async advance(to: Date) {
      cursor = Math.max(cursor, clock.now().getTime());
      for (let t = (Math.floor(cursor / HOUR) + 1) * HOUR; t <= to.getTime(); t += HOUR) {
        if (outreach) {
          await runDueJobs(deps, outreach.queue, clock, new Date(t));
          await autoReplies(outreach, t);
        }
        await runAt(t);
      }
      cursor = Math.max(cursor, to.getTime());
    },
    get hours() {
      return hours;
    },
  };
}
