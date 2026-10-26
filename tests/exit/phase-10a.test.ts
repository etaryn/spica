/**
 * Phase 10a exit, all fake: closeness grows only from moments of opening up and being met, up
 * to a ceiling that rises with time together; a long deep conversation counts once; afterglow
 * is per conversation; her openness steers the reply and a crisis fixes it; nothing reaches
 * core or another user.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { ensureRelationship, getParams, getRelationshipRow } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import type { SafetyFlag } from "@/db/schema";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { composeReply } from "@/mind/process/hot-path/compose";
import { closenessCeiling } from "@/mind/state/user/relationship/closeness";
import { tickUser } from "@/mind/state/user/relationship/daily-tick";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { newMessages, scriptedLabels } from "@/mind/platform/llm/fake-labels";

beforeEach(resetDb);
afterAll(closeTestDb);

const MIN = 60_000;
// Short hours so one run crosses every level; a fast-moving baseline so it takes days, not weeks.
const OVERRIDES = {
  relationship: {
    hours: { casual: 3, friend: 6, close: 12, session_min_minutes: 5 },
    baseline_alpha: 0.8,
  },
};
const CRISIS: SafetyFlag = { flagged: true, category: "self_harm", source: "classifier" };

const CORE_TABLES = [
  "core_memory",
  "core_entity",
  "core_state",
  "core_goal",
  "core_snapshot",
  "world_event",
  "life_event_log",
  "core_loop_trace",
  "core_budget_day",
  "life_day",
  "drift_log",
  "core_self_line",
];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(
      sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x`),
    );
    parts.push(...res.rows.map((r) => String(r.j)).sort());
  }
  return parts.join("\n");
}

/** Scripted labels: "DEEP" is a real disclosure, "WARM" is warm small talk. */
function deps() {
  const d = makeTestDeps(OVERRIDES);
  Object.assign(
    d.llm.handlers,
    scriptedLabels((input) => {
      const latest = newMessages(input)
        .map((m) => m.text)
        .join(" ");
      return {
        memories: latest.includes("WARM")
          ? [{ said: "WARM", label: "nice lunch", salience: 0.3, valence: 0.8 }]
          : [],
        intimacy: { user_disclosure: latest.includes("DEEP") ? 0.9 : 0, user_responsiveness: null },
      };
    }),
  );
  return d;
}

/** One user turn and her stored reply in `session`, `gapMin` minutes after the last. */
async function exchange(
  d: ReturnType<typeof deps>,
  userId: string,
  session: string,
  text: string,
  gapMin = 10,
  openness = { disclosure: 0.5, responsiveness: 0.9 },
) {
  d.clock.advance(gapMin * MIN);
  const ut = await insertTurn(d.db, userId, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text,
    created_at: d.clock.now(),
  });
  const ct = await insertTurn(d.db, userId, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: "mm",
    created_at: d.clock.now(),
    reply_to: ut.id,
    openness,
  });
  await runColdPath(d, { userId, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] });
}

async function setup() {
  const d = deps();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, d.clock.now(), d.config.relationship);
  return { d, u };
}

const setParam = (u: string, names: string[], value: number) =>
  getTestDb().execute(
    sql`UPDATE relationship_param SET value = ${value} WHERE user_id = ${u} AND name IN ${sql.raw(
      `(${names.map((n) => `'${n}'`).join(", ")})`,
    )}`,
  );

test("warm small talk, however much, leaves closeness where it was", async () => {
  const { d, u } = await setup();
  const before = (await getParams(d.db, u)).closeness.value;
  const s = randomUUID();
  for (let i = 0; i < 30; i++) await exchange(d, u, s, `WARM ${i}`);
  expect((await getParams(d.db, u)).closeness.value).toBe(before);
  expect((await getRelationshipRow(d.db, u))!.hours_together).toBeGreaterThan(4);
});

test("day after day of opening up, closeness passes casual, friend and close, never above the ceiling", async () => {
  const { d, u } = await setup();
  const cfg = d.config.relationship;
  const levels = [cfg.ceiling.casual, cfg.ceiling.friend, cfg.ceiling.close].map((c) => c - 0.05);
  const passed: number[] = [];
  for (let day = 0; day < 40 && passed.length < levels.length; day++) {
    const s = randomUUID();
    for (let i = 0; i < 6; i++) await exchange(d, u, s, `DEEP day ${day} ${i}`);
    const row = (await getRelationshipRow(d.db, u))!;
    const closeness = (await getParams(d.db, u)).closeness.value;
    // Params are stored as float4, so allow its rounding.
    expect(closeness).toBeLessThanOrEqual(closenessCeiling(row.hours_together, cfg) + 1e-6);
    while (passed.length < levels.length && closeness >= levels[passed.length]!) passed.push(day);
    // Next morning, after her tick: the baseline catches up, so diminishing returns ease.
    const next = new Date(d.clock.now());
    next.setUTCDate(next.getUTCDate() + 1);
    next.setUTCHours(cfg.tick_local_hour + 1, 0, 0, 0);
    d.clock.advance(next.getTime() - d.clock.now().getTime());
    await tickUser(d, u, d.clock.now());
  }
  expect(passed).toHaveLength(3);
}, 120_000);

test("a deep conversation boosts once; afterglow doesn't pile up across exchanges", async () => {
  const { d, u } = await setup();
  const s = randomUUID();
  for (let i = 0; i < 12; i++) await exchange(d, u, s, "DEEP WARM");
  const n = await getTestDb().execute(
    sql`SELECT count(*)::int AS n FROM relationship_event
        WHERE user_id = ${u} AND cause = 'deep_session' AND param = 'trust'`,
  );
  expect(Number(n.rows[0]!.n)).toBe(1);
  const glow = (await getParams(d.db, u)).afterglow.value;
  expect(glow).toBeGreaterThan(0);
  expect(glow).toBeLessThanOrEqual(d.config.relationship.affect.afterglow_gain + 1e-9);
});

test("a hurt, tired her reads guarded; a close, rested her reads open; a crisis is fixed", async () => {
  const { d, u } = await setup();
  const ask = async (flag: SafetyFlag | null = null) => {
    const turn = await insertTurn(d.db, u, {
      id: randomUUID(),
      session_id: randomUUID(),
      role: "user",
      text: "hey",
      created_at: d.clock.now(),
    });
    const r = await composeReply(d, u, { turns: [turn], openQuestions: [], flag });
    return { openness: r.openness!, system: d.llm.calls.at(-1)!.system };
  };
  await setParam(u, ["hurt"], 0.7);
  await setParam(u, ["tension"], 0.5);
  const guarded = await ask();
  expect(guarded.system).toContain("You're closed off right now");

  await setParam(u, ["hurt", "tension"], 0);
  await setParam(u, ["closeness", "trust", "affect_valence", "user_disclosure"], 0.95);
  const open = await ask();
  expect(open.openness.disclosure).toBeGreaterThan(guarded.openness.disclosure);
  expect(open.system).toContain("You feel open with them");

  const crisis = await ask(CRISIS);
  expect(crisis.openness).toEqual({ disclosure: 0, responsiveness: 1 });
  expect(crisis.system).toContain("Just be there for them.");
});

test("a crisis exchange credits nothing", async () => {
  const { d, u } = await setup();
  const before = await getParams(d.db, u);
  const s = randomUUID();
  d.clock.advance(10 * MIN);
  const ut = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: s,
    role: "user",
    text: "DEEP i want to die",
    created_at: d.clock.now(),
    safety_flag: CRISIS,
  });
  const ct = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: s,
    role: "companion",
    text: "i'm here",
    created_at: d.clock.now(),
    reply_to: ut.id,
    openness: { disclosure: 0, responsiveness: 1 },
  });
  await runColdPath(d, { userId: u, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] });
  const after = await getParams(d.db, u);
  expect(after.closeness.value).toBe(before.closeness.value);
  expect(after.user_disclosure.value).toBe(before.user_disclosure.value);
  expect((await getRelationshipRow(d.db, u))!.hours_together).toBe(0);
});

test("one user's intimacy never moves core or another user's openness", async () => {
  const { d, u: alice } = await setup();
  const bob = await createTestUser("bob");
  await ensureRelationship(d.db, bob, d.clock.now(), d.config.relationship);
  const ask = async () => {
    const turn = await insertTurn(d.db, bob, {
      id: randomUUID(),
      session_id: randomUUID(),
      role: "user",
      text: "hey",
      created_at: d.clock.now(),
    });
    return (await composeReply(d, bob, { turns: [turn], openQuestions: [], flag: null })).openness;
  };
  const core = await coreDump();
  const bobBefore = await ask();
  const s = randomUUID();
  // No clock movement, so Bob's day and fades are identical at both asks.
  for (let i = 0; i < 10; i++) await exchange(d, alice, s, `DEEP CANARY-a1b2 ${i}`, 0);
  expect((await getParams(d.db, alice)).closeness.value).toBeGreaterThan(
    d.config.relationship.initial.closeness,
  );
  expect(await coreDump()).toBe(core);
  expect(await ask()).toEqual(bobBefore);
  expect(d.llm.calls.at(-1)!.system).not.toMatch(/CANARY-/);
});
