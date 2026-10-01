import { adminListLifeUsers } from "@/db/repos/admin/life";
import { sql } from "drizzle-orm";
import {
  ensureIdentity,
  getIdentityRow,
  lockIdentity,
  updateIdentity,
  type IdentityRow,
} from "@/db/repos/user/identity";
import { getLifeDay } from "@/db/repos/world/life-day";
import { insertLifeEventLogs } from "@/db/repos/user/life-event-log";
import type { Deps } from "@/mind/platform/deps";
import { nudgeEgoForEvent } from "@/mind/state/legacy-ego/nudge";
import { errorName } from "@/mind/platform/errors";
import { encodeExtraction } from "@/mind/memory/user/encode";
import { lifeDate, lifeHour } from "@/mind/world/her-clock";
import { generateEvents, type InjectedEvent } from "./events";

export type { InjectedEvent } from "./events";
/** Eval seam: force a scripted candidate as a day's first event attempt. */
export type LifeTickOptions = { inject?: (userId: string, day: string) => InjectedEvent | null };

const DAY = 86_400_000;
const due = (row: IdentityRow | null, day: string) =>
  !row?.life_last_date || row.life_last_date < day;

/**
 * `life_tick` for one user: once per her local date, at or after `life.tick_local_hour` in her
 * zone. Generation (LLM, embeddings, reconcile decisions) runs outside the transaction; the apply holds the cold
 * path's per-user advisory lock and the identity row lock, re-checks, and writes `life_last_date` last, so a
 * failure rolls back everything and the next hourly run retries from scratch.
 */
export async function lifeTickUser(
  deps: Deps,
  userId: string,
  now: Date,
  opts: LifeTickOptions = {},
): Promise<"not_due" | "done"> {
  const { config } = deps;
  const cfg = config.life;
  if (lifeHour(cfg, now) < cfg.tick_local_hour) return "not_due";
  const day = lifeDate(cfg, now);
  if (!due(await getIdentityRow(deps.db, userId), day)) return "not_due";

  const lifeDay = await getLifeDay(deps.db, day);
  const events = await generateEvents(deps, userId, day, lifeDay?.plan ?? null, now, opts.inject);

  await deps.db.transaction(async (tx) => {
    // Bound the wait for a busy cold path: a timeout fails this user (retried next hour) instead of stalling
    // the batch. SET LOCAL takes no bind parameters; the value is a zod-validated positive integer.
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = ${Math.trunc(cfg.lock_timeout_ms)}`));
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cold_path:${userId}`}))`);
    await ensureIdentity(tx, userId, config.ego.baseline);
    let row = await lockIdentity(tx, userId);
    if (!due(row, day)) return; // a concurrent run already ticked this date
    const factIds = new Map<string, string>();
    for (const e of events.accepted) {
      const occurred = e.fact.occurred_at!;
      const out = await encodeExtraction(tx, config, {
        userId,
        now,
        exchangeAt: now,
        entities: [],
        facts: [
          { fact: e.fact, embedding: e.embedding, decision: e.decision, source: "generated" },
        ],
        threads:
          e.candidate.stakes === "high"
            ? [
                {
                  action: "open",
                  title: e.fact.content,
                  subject: "self",
                  stakes: "high",
                  next_checkpoint: new Date(
                    occurred.getTime() + cfg.high_stakes_checkpoint_days * DAY,
                  ),
                  thread_id: null,
                },
              ]
            : [],
        sensitive: false,
        sourceRef: `life_day:${day}`,
        recalled: [],
        replyTurnId: null,
        turnIds: [],
      });
      const id = out.factIds[0] ?? null;
      if (id) factIds.set(e.key, id);
      row = await nudgeEgoForEvent(tx, config, {
        userId,
        row,
        factId: id,
        valence: e.fact.valence,
        now,
      });
    }
    await insertLifeEventLogs(
      tx,
      userId,
      events.attempts.map((a) => ({
        life_day: day,
        attempt: a.attempt,
        candidate: { ...(a.candidate as object), source: a.source },
        decision: a.decision,
        target_fact_id: a.targetFactId,
        fact_id: factIds.get(a.key) ?? null,
        model: a.source === "model" ? config.models.life : "injected",
        prompt_version: a.source === "model" ? config.prompts.life_event : "injected",
        created_at: now,
      })),
    );
    await updateIdentity(tx, userId, { life_last_date: day });
  });
  return "done";
}

export async function lifeTick(
  deps: Deps,
  now: Date,
  opts: LifeTickOptions = {},
): Promise<{ users: number; failed: number }> {
  const users = await adminListLifeUsers(deps.db);
  let failed = 0;
  for (const userId of users) {
    try {
      await lifeTickUser(deps, userId, now, opts);
    } catch (e) {
      failed += 1;
      deps.log.error("life tick failed", { userId, error: errorName(e) });
    }
  }
  deps.log.info("life tick", { users: users.length, failed });
  return { users: users.length, failed };
}
