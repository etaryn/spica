/**
 * The cold path's relationship step: applies one exchange's signals to this user's relationship
 * and saves the result with its events and a refreshed cadence. Runs after memory is encoded,
 * inside the cold path's transaction (in its own savepoint).
 */
import type { Db } from "@/db/client";
import * as relationshipRepo from "@/db/repos/user/relationship";
import type { Turn } from "@/db/repos/user/session-log";
import { getTimezone } from "@/db/repos/user/users";
import type { Deps } from "@/mind/platform/deps";
import { isValidTimeZone } from "@/mind/platform/timezone";
import { applyAffect } from "./affect";
import { buildCadence } from "./cadence";
import type { Signals } from "./signals";
import { relationshipAfterExchange } from "./transitions";

const DAY = 86_400_000;
const WEEK = 7 * DAY;

export type RelationshipUpdate = {
  userId: string;
  turns: Turn[];
  signals: Signals | null;
  crisis: boolean;
  hurtFactId: string | null;
  tone: number | null;
};

export async function updateRelationship(
  tx: Db,
  deps: Pick<Deps, "config" | "clock">,
  update: RelationshipUpdate,
): Promise<void> {
  const settings = deps.config.relationship;
  const now = deps.clock.now();
  const { userId } = update;

  await relationshipRepo.ensureRelationship(tx, userId, now, settings);
  const row = await relationshipRepo.lockRelationship(tx, userId);
  const params = await relationshipRepo.getParams(tx, userId);

  const msgs24h = await relationshipRepo.countUserTurnsBetween(
    tx,
    userId,
    new Date(now.getTime() - DAY),
    now,
  );
  const replies = update.turns.filter((t) => t.role === "companion" && t.reply_to).length;
  const lastUserTurn = update.turns.filter((t) => t.role === "user").at(-1);
  // The exchange's own time, on the same clock as last_contact below. `now` only covers an
  // exchange with no user turn, which a scored exchange never is.
  const exchangeAt = lastUserTurn?.created_at ?? now;

  const transition = relationshipAfterExchange(
    relationshipRepo.toRelationshipState(row),
    params,
    {
      now,
      exchangeAt,
      signals: update.signals,
      crisis: update.crisis,
      hurtFactId: update.hurtFactId,
      replies,
      msgs24h,
    },
    settings,
  );

  // Her feelings toward them follow the exchange's tone; a crisis exchange carries none.
  const affect =
    update.tone !== null && !update.crisis
      ? applyAffect(transition.params, update.tone, now, settings)
      : { params: transition.params, events: [] };

  const cadence = await currentCadence(tx, userId, now, msgs24h, deps);
  const lastContact =
    lastUserTurn && (!row.last_contact || lastUserTurn.created_at > row.last_contact)
      ? lastUserTurn.created_at
      : row.last_contact;

  await relationshipRepo.saveRelationship(tx, userId, {
    state: transition.state,
    params: affect.params,
    cadence,
    last_contact: lastContact,
  });
  await relationshipRepo.insertRelationshipEvents(
    tx,
    userId,
    [...transition.events, ...affect.events],
    {
      turnId: lastUserTurn?.id ?? null,
      now,
    },
  );
}

async function currentCadence(
  tx: Db,
  userId: string,
  now: Date,
  msgs24h: number,
  deps: Pick<Deps, "config">,
): Promise<relationshipRepo.Cadence> {
  const settings = deps.config.relationship;
  const rawZone = await getTimezone(tx, userId);
  const zone = rawZone && isValidTimeZone(rawZone) ? rawZone : "UTC";
  const since = new Date(now.getTime() - settings.history_days * DAY);

  return buildCadence(
    {
      msgs24h,
      msgs7d: await relationshipRepo.countUserTurnsBetween(
        tx,
        userId,
        new Date(now.getTime() - WEEK),
        now,
      ),
      starts: await relationshipRepo.userSessionStarts(
        tx,
        userId,
        settings.cadence_sessions + 1,
        since,
      ),
      activeHours: await relationshipRepo.userActiveHours(tx, userId, zone, since),
    },
    settings,
  );
}
