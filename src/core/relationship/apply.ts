import type { Db } from "@/db/client";
import * as rel from "@/db/repos/relationship";
import type { Turn } from "@/db/repos/session-log";
import { getTimezone } from "@/db/repos/users";
import type { Deps } from "../deps";
import { isValidTimeZone } from "../timezone";
import { buildCadence } from "./cadence";
import type { Signals } from "./signals";
import { applyExchange } from "./transitions";

const DAY = 86_400_000;

/** Cold path, after applyExtraction, inside the job's transaction (a savepoint). */
export async function applyRelationship(
  tx: Db,
  deps: Pick<Deps, "config" | "clock">,
  a: {
    userId: string;
    turns: Turn[];
    signals: Signals | null;
    crisis: boolean;
    hurtFactId: string | null;
  },
): Promise<void> {
  const cfg = deps.config.relationship;
  const now = deps.clock.now();
  await rel.ensureRelationship(tx, a.userId, now, cfg);
  const row = await rel.lockRelationship(tx, a.userId);
  const params = await rel.getParams(tx, a.userId);
  const tzRaw = await getTimezone(tx, a.userId);
  const tz = tzRaw && isValidTimeZone(tzRaw) ? tzRaw : "UTC";
  const msgs24h = await rel.countUserTurnsBetween(tx, a.userId, new Date(now.getTime() - DAY), now);
  const replies = a.turns.filter((t) => t.role === "companion" && t.reply_to).length;
  const userTurns = a.turns.filter((x) => x.role === "user");
  const lastUser = userTurns.at(-1);
  // stamp end_pending_since with the exchange's own turn time, the same clock last_contact
  // uses below, not the cold path's processing clock. Falls back to `now` when the exchange has no user
  // turn (shouldn't happen for a scored exchange, but keeps this total).
  const exchangeAt = lastUser?.created_at ?? now;
  const t = applyExchange(
    rel.toRelState(row),
    params,
    {
      now,
      exchangeAt,
      signals: a.signals,
      crisis: a.crisis,
      hurtFactId: a.hurtFactId,
      replies,
      msgs24h,
    },
    cfg,
  );
  const since = new Date(now.getTime() - cfg.history_days * DAY);
  const cadence = buildCadence(
    {
      msgs24h,
      msgs7d: await rel.countUserTurnsBetween(tx, a.userId, new Date(now.getTime() - 7 * DAY), now),
      starts: await rel.userSessionStarts(tx, a.userId, cfg.cadence_sessions + 1, since),
      activeHours: await rel.userActiveHours(tx, a.userId, tz, since),
    },
    cfg,
  );
  const lastContact =
    lastUser && (!row.last_contact || lastUser.created_at > row.last_contact)
      ? lastUser.created_at
      : row.last_contact;
  await rel.saveRelationship(tx, a.userId, {
    state: t.state,
    params: t.params,
    cadence,
    last_contact: lastContact,
  });
  await rel.insertRelationshipEvents(tx, a.userId, t.events, { turnId: lastUser?.id ?? null, now });
}
