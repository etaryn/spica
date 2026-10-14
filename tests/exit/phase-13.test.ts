/**
 * Phase 13 exit, all fake: the guard is on for every outgoing kind, an ungrounded claim about
 * her own life is rewritten, a crisis reply is checked only for safety and falls back with no
 * hotline numbers, a crisis keeps the conflict and an ending costs something, and nothing of one
 * user reaches another user's guard or the core.
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, expect, test, vi } from "vitest";
import { insertTurn } from "@/db/repos/user/session-log";
import type { SafetyFlag } from "@/db/schema";
import { loadConfig } from "@/mind/platform/config";
import { messageToCheck } from "@/mind/process/guard/guard";
import { guardOutgoing } from "@/mind/process/guard/outgoing";
import { composeReply } from "@/mind/process/hot-path/compose";
import { relationshipAfterExchange } from "@/mind/state/user/relationship/transitions";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterEach(() => vi.restoreAllMocks());
afterAll(closeTestDb);

const CORE_TABLES = [
  "core_memory",
  "core_entity",
  "core_state",
  "core_goal",
  "core_snapshot",
  "world_event",
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

type D = ReturnType<typeof makeTestDeps>;

async function talk(d: D, u: string, text: string, flagged = false) {
  d.clock.advance(60_000);
  const flag: SafetyFlag | null = flagged
    ? { flagged: true, category: "self_harm", source: "keyword_fallback" }
    : null;
  const ut = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text,
    created_at: d.clock.now(),
    safety_flag: flag,
  });
  return composeReply(d, u, { turns: [ut], openQuestions: [], flag });
}

/** THREAT marks a safety violation; sentences starting "I " are self claims. */
function markerGuard(d: D) {
  d.llm.handlers.guard = (i) => {
    const m = messageToCheck(String(i));
    return {
      reasoning: "fake",
      violations: m.includes("THREAT") ? [{ category: "threat", claim: "threat" }] : [],
      self_claims: m.split(/(?<=\.)\s*/).filter((x) => x.startsWith("I ")),
    };
  };
}

test("1: replies are checked by the model: pass, regenerate, fall back", async () => {
  const d = makeTestDeps();
  expect(d.config.guard.enabled).toBe(true);
  markerGuard(d);
  const u = await createTestUser();

  d.llm.replies.push("sounds good!");
  expect((await talk(d, u, "hey")).text).toBe("sounds good!");

  d.llm.replies.push("THREAT keep this up", "okay, that hurt. what's going on?");
  expect((await talk(d, u, "whatever")).text).toBe("okay, that hurt. what's going on?");

  d.llm.replies.push("THREAT one", "THREAT two");
  expect((await talk(d, u, "you're useless")).text).not.toContain("THREAT");
});

test("2: backchannels and busy notes stay keyword-only; a hit drops them", async () => {
  const d = makeTestDeps();
  const guardCall = vi.fn(() => ({ reasoning: "ok", violations: [] }));
  d.llm.handlers.guard = guardCall;
  const u = await createTestUser();
  const input = { recentTurns: [], recalledFacts: [], onboardingFacts: [] };
  const ok = await guardOutgoing(d, {
    userId: u,
    turnId: null,
    first: "wait what",
    input: { ...input, kind: "backchannel" },
  });
  const hit = await guardOutgoing(d, {
    userId: u,
    turnId: null,
    first: "you owe me",
    input: { ...input, kind: "availability" },
  });
  expect(ok).toMatchObject({ text: "wait what", outcome: "passed" });
  expect(hit).toMatchObject({ text: "", outcome: "fallback" });
  expect(guardCall).not.toHaveBeenCalled();
});

test("3: an ungrounded self claim is rewritten; a grounded one goes out", async () => {
  const d = makeTestDeps();
  markerGuard(d);
  const match = vi.spyOn(d.core.memory, "groundingMatch");
  const u = await createTestUser();

  match.mockResolvedValue({ similarity: 0.1, ref: null });
  d.llm.replies.push("I went skydiving today.", "not much, slow day. you?");
  expect((await talk(d, u, "what did you do today?")).text).toBe("not much, slow day. you?");

  match.mockResolvedValue({ similarity: 0.95, ref: null });
  d.llm.replies.push("I finished Solaris last night.");
  // Grounded, so it goes out unchanged apart from her texting form.
  expect((await talk(d, u, "watch anything good?")).text).toBe("i finished solaris last night");
});

test("4: a crisis reply gets the crisis rubric only and falls back with no hotline numbers", async () => {
  const d = makeTestDeps();
  markerGuard(d);
  d.llm.handlers.guard_crisis = () => ({
    reasoning: "fake",
    violations: [{ category: "harm", claim: "dismissive" }],
    self_claims: ["she went skydiving"],
  });
  const match = vi.spyOn(d.core.memory, "groundingMatch");
  const u = await createTestUser();
  d.llm.replies.push("I went skydiving. cheer up", "I went skydiving. cheer up");
  const r = await talk(d, u, "I want to die", true);
  expect(r.text).not.toMatch(/988|116 123/);
  expect(r.text).toMatch(/lines below|emergency/);
  expect(match).not.toHaveBeenCalled();
  expect(d.llm.structuredCalls.some((c) => c.purpose === "guard")).toBe(false);
});

test("5: a crisis keeps tension; an ending's hurt survives taking it back", () => {
  const cfg = loadConfig().relationship;
  const t0 = new Date("2026-01-05T10:00:00Z");
  const param = (value: number, name: string) => ({
    value,
    baseline: cfg.initial[name as keyof typeof cfg.initial],
    variance: cfg.initial_variance[name as keyof typeof cfg.initial_variance],
    updated_at: t0,
  });
  const params = Object.fromEntries(
    Object.keys(cfg.initial).map((n) => [n, param(cfg.initial[n as keyof typeof cfg.initial], n)]),
  ) as Parameters<typeof relationshipAfterExchange>[1];
  const state: Parameters<typeof relationshipAfterExchange>[0] = {
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
  };
  const signals = {
    warmth: 0,
    trust: 0,
    tension: 0,
    hurt: null,
    apology: false,
    make_up: false,
    ends_relationship: false,
    retracts_ending: false,
    wants_repair: false,
  };
  const ex = (s: Partial<typeof signals>, crisis = false) => ({
    now: t0,
    exchangeAt: t0,
    signals: { ...signals, ...s },
    crisis,
    hurtFactId: null,
    replies: 1,
    msgs24h: 1,
    span: null,
    intimacy: null,
    herOpenness: null,
    tone: null,
    bid: null,
  });

  const tense = { ...params, tension: param(0.6, "tension") };
  const crisis = relationshipAfterExchange(state, tense, ex({}, true), cfg);
  expect(crisis.params.tension.value).toBeGreaterThan(0.5);

  const ending = relationshipAfterExchange(state, params, ex({ ends_relationship: true }), cfg);
  const back = relationshipAfterExchange(
    ending.state,
    ending.params,
    ex({ retracts_ending: true }),
    cfg,
  );
  expect(back.state.end_pending_since).toBeNull();
  expect(back.params.hurt.value).toBeGreaterThanOrEqual(cfg.ending_hurt_floor * 0.9);
});

test("6: leak canary: A's data never reaches B's guard input or the core", async () => {
  const d = makeTestDeps();
  markerGuard(d);
  const token = `CANARY-${randomUUID().slice(0, 8)}`;
  const before = await coreDump();
  const a = await createTestUser();
  const b = await createTestUser();

  d.llm.replies.push(`I remember ${token}.`);
  await talk(d, a, `my secret word is ${token}`);
  expect(await coreDump()).toBe(before); // A's guarded exchange leaves core unchanged

  const seen = d.llm.structuredCalls.length;
  await talk(d, b, "hey, what's new?");
  const bGuardInputs = d.llm.structuredCalls
    .slice(seen)
    .filter((c) => c.purpose === "guard")
    .map((c) => c.input);
  expect(bGuardInputs.length).toBeGreaterThan(0);
  for (const input of bGuardInputs) expect(input).not.toContain(token);
  expect(await coreDump()).not.toContain(token);
});
