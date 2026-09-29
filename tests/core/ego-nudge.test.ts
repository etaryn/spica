import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { handleColdPath } from "@/core/cold-path";
import { nudgeEgoForExchange } from "@/core/ego/nudge";
import { getIdentityRow } from "@/db/repos/identity";
import { insertTurn } from "@/db/repos/session-log";
import { ego_tick } from "@/db/schema";
import { eq } from "drizzle-orm";
import { closeTestDb, createTestUser, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const now = new Date("2026-01-05T10:00:00Z");

test("moves mood toward the exchange's tone and logs it; crisis and no tone are no-ops", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  expect(await nudgeEgoForExchange(deps.db, deps.config, { userId: u, facts: [{ valence: 0, salience: 1 }], crisis: false, now })).toBe(false);
  expect(await nudgeEgoForExchange(deps.db, deps.config, { userId: u, facts: [{ valence: -1, salience: 1 }], crisis: true, now })).toBe(false);
  expect(await nudgeEgoForExchange(deps.db, deps.config, { userId: u, facts: [{ valence: -1, salience: 1 }], crisis: false, now })).toBe(true);
  const b = deps.config.ego.baseline.mood_valence;
  expect((await getIdentityRow(deps.db, u))?.mood_valence).toBeCloseTo(b + deps.config.ego.exchange_gain * (-1 - b));
  expect((await deps.db.select().from(ego_tick).where(eq(ego_tick.user_id, u))).map((r) => r.reason)).toEqual(["exchange"]);
});

test("the cold path applies the nudge from extracted facts", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  deps.llm.handlers.extract = () => ({ facts: [{ subject: "user", kind: "event", content: "The user lost their job.", occurred_at: null, salience: 0.8, valence: -0.9, confidence: 1, entity_names: [], thread_title: null }], entities: [], threads: [], relationship: null });
  const s = randomUUID();
  const t1 = await insertTurn(deps.db, u, { id: randomUUID(), session_id: s, role: "user", text: "i lost my job", created_at: now });
  const t2 = await insertTurn(deps.db, u, { id: randomUUID(), session_id: s, role: "companion", text: "oh no", created_at: new Date(now.getTime() + 1000), reply_to: t1.id });
  await handleColdPath(deps, { userId: u, turnIds: [t1.id, t2.id], replyTurnId: t2.id });
  expect((await getIdentityRow(deps.db, u))!.mood_valence).toBeLessThan(deps.config.ego.baseline.mood_valence);
});
