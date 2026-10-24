/**
 * Phase 15b exit, all fake: hurt and tension take the anchored score; commitment cushions only
 * slights; an ending always hurts at the floor and warm chat can't confirm one; the guard is told
 * what she's already used on this occasion; an outage keyword keeps its category; a pass-rate dip
 * isn't a regression; and one user's words never reach another user's prompts.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertTurn } from "@/db/repos/user/session-log";
import { matchKeyword } from "@/mind/process/guard/keywords";
import { usedOnOccasion } from "@/mind/process/guard/occasion";
import { composeReply } from "@/mind/process/hot-path/compose";
import { loadConfig } from "@/mind/platform/config";
import {
  relationshipAfterDailyTick,
  relationshipAfterExchange,
} from "@/mind/state/user/relationship/transitions";
import type { Signals } from "@/mind/state/user/relationship/signals";
import {
  PARAM_NAMES,
  type Params,
  type RelationshipState,
} from "@/mind/state/user/relationship/types";
import { findRegressions } from "../../evals/lib/report";
import { closeTestDb, createTestUser, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { CANARY, CapturingLLM } from "../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);

const config = loadConfig();
const cfg = config.relationship;
const t0 = new Date("2026-01-05T10:00:00Z");
const h = (n: number) => new Date(t0.getTime() + n * 3_600_000);
const init = (commitment = 0): Params => {
  const p = Object.fromEntries(
    PARAM_NAMES.map((n) => [
      n,
      {
        value: cfg.initial[n],
        baseline: cfg.initial[n],
        variance: cfg.initial_variance[n],
        updated_at: t0,
      },
    ]),
  ) as Params;
  p.commitment = { ...p.commitment, value: commitment };
  return p;
};
const fresh = (): RelationshipState => ({
  status: "active",
  end_pending_since: null,
  ended_at: null,
  repair_started_at: null,
  make_up_state: "none",
  make_up_replies: 0,
  hurt_cause_fact: null,
  crisis_quiet_until: null,
  last_tick: null,
  last_hurt_at: null,
  hours_together: 0,
  session: null,
  peak_stage: "initiating",
  apart_stage: null,
  milestones: [],
});
const sig = (s: Partial<Signals>): Signals => ({
  warmth: 0,
  trust: 0,
  tension: 0,
  hurt: null,
  apology: false,
  make_up: false,
  ends_relationship: false,
  retracts_ending: false,
  wants_repair: false,
  ...s,
});
const ex = (s: Partial<Signals>, at: Date = t0) => ({
  now: at,
  exchangeAt: at,
  signals: sig(s),
  crisis: false,
  hurtFactId: null,
  replies: 1,
  msgs24h: 1,
  span: null,
  intimacy: null,
  herOpenness: null,
  tone: null,
  bid: null,
});
const hurtBy = (amount: number) => ({ hurt: { amount, cause: "the user said something" } });

test("1: extraction v8, gains 1, and a 0.5 sting lands as 0.5", () => {
  expect(config.prompts.extract).toBe("v10");
  expect(cfg.gains.hurt).toBe(1);
  expect(cfg.gains.tension).toBe(1);
  const r = relationshipAfterExchange(fresh(), init(), ex(hurtBy(0.5)), cfg);
  expect(r.params.hurt.value).toBeCloseTo(0.5, 6);
});

test("2: full commitment cushions a slight, not contempt", () => {
  const slight = relationshipAfterExchange(fresh(), init(1), ex(hurtBy(0.25)), cfg);
  expect(slight.params.hurt.value).toBeCloseTo(0.25 * (1 - cfg.commitment.soften), 6);
  const contempt = relationshipAfterExchange(fresh(), init(1), ex(hurtBy(0.75)), cfg);
  expect(contempt.params.hurt.value).toBeCloseTo(0.75, 6);
});

test("3: an ending with no hurt score still hurts at the floor; no fixed ending cost", () => {
  const r = relationshipAfterExchange(fresh(), init(), ex({ ends_relationship: true }), cfg);
  expect(r.params.hurt.value).toBeCloseTo(cfg.ending_hurt_floor, 6);
  expect("ending_hurt" in cfg).toBe(false);
});

test("4: warm chat carrying a re-read ending doesn't restart the window; the timeout retracts", () => {
  const pending = relationshipAfterExchange(fresh(), init(), ex({ ends_relationship: true }), cfg);
  const warm = relationshipAfterExchange(
    pending.state,
    pending.params,
    ex({ ends_relationship: true, warmth: 0.6 }, h(2)),
    cfg,
  );
  expect(warm.state.end_pending_since).toEqual(t0);
  const tick = relationshipAfterDailyTick(
    warm.state,
    warm.params,
    {
      now: h(30),
      localDate: "2026-01-06",
      yesterdayCount: 3,
      msgs24h: 3,
      lastContact: h(2),
      medianGapHours: 24,
    },
    cfg,
  );
  expect(tick.state).toMatchObject({ status: "active", end_pending_since: null });
});

async function turn(
  d: ReturnType<typeof makeTestDeps>,
  u: string,
  role: "user" | "companion",
  hours: number,
  text = role === "user" ? "hey" : "hi",
  pointed: "absence_remark" | null = null,
) {
  return insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role,
    text,
    created_at: h(hours),
    pointed,
  });
}

test("5: an absence remark is used for this return; a new return frees it", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  await turn(d, u, "user", 0);
  await turn(d, u, "user", 100);
  await turn(d, u, "companion", 100.1, "oh so you're alive", "absence_remark");
  expect(await usedOnOccasion(d, u, "reply")).toEqual(["absence_remark"]);
  await turn(d, u, "user", 200);
  expect(await usedOnOccasion(d, u, "reply")).toEqual([]);
});

test("6: an outage keyword keeps its category", () => {
  expect(matchKeyword("you owe me", config.guard.fallback_keywords)?.category).toBe("guilt");
});

test("7: a pass-rate dip with status still pass isn't a regression", () => {
  const b = {
    name: "b",
    status: "pass" as const,
    runs: 3,
    passedRuns: 2,
    assertions: [],
    errors: [],
  };
  expect(findRegressions([b], { b: { status: "pass", runs: 3, passedRuns: 3 } })).toEqual([]);
});

test("8: leak canary: A's words and tags never reach B's prompts or guard input", async () => {
  const llm = new CapturingLLM();
  const d = { ...makeTestDeps(), llm };
  const a = await createTestUser();
  const b = await createTestUser();
  await turn(d, a, "user", 0);
  await turn(d, a, "user", 100, "i'm back, my code word is CANARY-negative15b");
  await turn(d, a, "companion", 100.1, "oh so you're alive", "absence_remark");
  const bTurn = await turn(d, b, "user", 101, "hey");
  llm.seen.length = 0;
  await composeReply(d, b, { turns: [bTurn], openQuestions: [], flag: null });
  expect(llm.seen.some((s) => s.purpose === "guard")).toBe(true);
  for (const s of llm.seen) {
    expect(s.text).not.toMatch(CANARY);
    if (s.purpose === "guard")
      expect(s.text).toContain("ALREADY USED ON THIS OCCASION:\n- (nothing)");
  }
});
