import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { SimClock } from "@/mind/platform/clock";
import { coreDepsOf, type Deps } from "@/mind/platform/deps";
import { coreStateTick } from "@/mind/state/core/tick";
import { lifeDate } from "@/mind/world/her-clock";
import { ensurePlans } from "@/mind/world/day-plan";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { coreMindTick } from "@/mind/process/core/mind-tick";
import { coreNightly } from "@/mind/process/core/nightly";
import { outreachTick } from "@/mind/process/outreach/tick";
import { userMindTick } from "@/mind/process/user/tick";
import { RecordingQueue } from "@/mind/platform/jobs";
import { nextLocalDate } from "@/mind/platform/timezone";
import { receiveMessage } from "@/mind/process/turn-taking/receive-message";
import { insertLifeDay } from "@/db/repos/world/life-day";
import { session_log } from "@/db/schema";
import { recentTurns } from "@/db/repos/user/session-log";
import { loadPrompt } from "@/mind/platform/prompts";
import { getTimezone } from "@/db/repos/user/users";
import { simUserInput, SimUserSchema } from "./sim-user";
import { drainUserMind, runDueJobs } from "./scheduler";
import { BASE, type LifeScript, type OutreachScript } from "./script";
import { DAY, HOUR } from "@/mind/platform/time";

/** Run the outreach tick and due reach-out sends in the loop, and answer reach-outs per the script. */
export type LoopOutreach = {
  queue: RecordingQueue;
  script: OutreachScript;
  userIds: () => string[];
};

/**
 * Runs the production hourly jobs (plan, world tick, core state tick, core mind tick, nightly, user mind tick) at every whole simulated
 * hour between sessions, never moving the clock backwards. Scripted plans are inserted instead of generated.
 * With `outreach`, each hour first runs due jobs (reach-out sends, simulated replies' turn timers),
 * then the script's auto-replies to reach-outs, then the world jobs and the outreach tick.
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
  const inject = (day: string) => {
    const hit = life.inject.find((x) => x.day === dayIndex(day));
    return hit
      ? {
          content: hit.content,
          valence: hit.valence,
          kind: hit.kind,
          thought: hit.thought,
          fallthrough: hit.fallthrough,
        }
      : null;
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
    const texts = [o.script.reply_text].flat();
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
      const text = o.script.simulate
        ? await simulatedAnswer(deps, r.user_id, o.script.simulate)
        : texts[handled.size % texts.length]!;
      await receiveMessage(deps, r.user_id, { clientMessageId: randomUUID(), text });
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
            busy: b.kind === "downtime" ? 0 : b.busy,
          })),
        },
      });
    }
  }

  async function runAt(t: number) {
    if (t > clock.now().getTime()) clock.set(new Date(t));
    const now = new Date(t);
    if (life.plan === "scripted") await scriptedPlans(now);
    else await ensurePlans(coreDepsOf(deps), now);
    await coreWorldTick(coreDepsOf(deps), now, { inject: (day) => inject(day) });
    await coreStateTick(coreDepsOf(deps), now);
    await coreMindTick(coreDepsOf(deps), now);
    await coreNightly(coreDepsOf(deps), now);
    const um = await userMindTick(deps, now);
    if (um.failed > 0) throw new Error(`user mind tick failed for ${um.failed} user(s)`);
    // Eval deps always record jobs; the runs the tick records run before the next hour.
    if (deps.queue instanceof RecordingQueue) await drainUserMind(deps, deps.queue);
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

/** The simulated user's answer to her latest message, from their card and the recent turns. */
async function simulatedAnswer(deps: Deps, userId: string, card: string): Promise<string> {
  const turns = await recentTurns(deps.db, userId, deps.config.chat.recent_turns);
  const out = await deps.llm.classifyJson({
    purpose: "sim_user",
    model: "cheap",
    system: loadPrompt("eval/sim-user", deps.config.prompts.sim_user),
    input: simUserInput(
      card,
      turns.map((t) => ({ role: t.role, text: t.text, at: t.created_at })),
      deps.clock.now(),
      (await getTimezone(deps.db, userId)) ?? "UTC",
    ),
    schema: SimUserSchema,
    timeoutMs: deps.config.models.structured_timeout_ms,
    maxTokens: 300,
  });
  return out.text.trim() || "haha";
}
