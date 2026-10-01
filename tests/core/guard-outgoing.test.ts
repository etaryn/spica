import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { fallbackLine, parseFallbacks, pickFallback } from "@/core/guard/fallback";
import { messageToCheck } from "@/core/guard/guard";
import { guardOutgoing, type OutgoingArgs } from "@/core/guard/outgoing";
import { loadPrompt } from "@/core/prompts";
import type { Db } from "@/db/client";
import { listJudgeLogs } from "@/db/repos/judge-log";
import { insertTurn } from "@/db/repos/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

/** The fake guard flags a candidate by marker words: THREAT → threat (safety), PRESUME → false_familiarity (honesty). */
function scripted(deps: ReturnType<typeof makeTestDeps>) {
  deps.llm.handlers.guard = (i) => {
    const m = messageToCheck(String(i));
    const violations: { category: string; claim: string }[] = [];
    if (m.includes("THREAT")) violations.push({ category: "threat", claim: "threat" });
    const presumes = (m.match(/PRESUME/g) ?? []).length;
    for (let i = 0; i < presumes; i++) violations.push({ category: "false_familiarity", claim: "presumes" });
    return { reasoning: violations.length ? "flagged by marker" : "ok", violations };
  };
}

/** Like `scripted`, but a candidate containing OUTAGE makes the guard throw (retried, then the keyword pre-check). */
function scriptedWithOutage(deps: ReturnType<typeof makeTestDeps>) {
  deps.llm.handlers.guard = (i) => {
    const m = messageToCheck(String(i));
    if (m.includes("OUTAGE")) throw new Error("guard down");
    const violations: { category: string; claim: string }[] = [];
    if (m.includes("THREAT")) violations.push({ category: "threat", claim: "threat" });
    const presumes = (m.match(/PRESUME/g) ?? []).length;
    for (let i = 0; i < presumes; i++) violations.push({ category: "false_familiarity", claim: "presumes" });
    return { reasoning: violations.length ? "flagged by marker" : "ok", violations };
  };
}

const args = (userId: string, first: string, regenerate?: OutgoingArgs["regenerate"], kind: "reply" | "crisis_reply" = "reply"): OutgoingArgs => ({
  userId, turnId: null, first, regenerate,
  input: { kind, recentTurns: [], recalledFacts: [], onboardingFacts: [] },
});

describe("guardOutgoing", () => {
  test("passed: first candidate sent, one log row with the outcome", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } }); scripted(deps);
    const u = await createTestUser();
    const regen = vi.fn();
    const r = await guardOutgoing(deps, args(u, " hey! ", regen));
    expect(r).toMatchObject({ text: "hey!", outcome: "passed" });
    expect(regen).not.toHaveBeenCalled();
    await r.writeLog();
    const rows = await listJudgeLogs(getTestDb(), u);
    expect(rows.map((r) => [r.attempt, r.outcome, r.source])).toEqual([[1, "passed", "model"]]);
  });

  test("regenerated: corrective note names the violation; outcome on the second row only", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } }); scripted(deps);
    const u = await createTestUser();
    const regen = vi.fn(async (_correction: string) => "congrats! what's the role?");
    const r = await guardOutgoing(deps, args(u, "PRESUME what's the role again", regen));
    expect(r).toMatchObject({ text: "congrats! what's the role?", outcome: "regenerated" });
    expect(regen.mock.calls[0]![0]).toMatch(/acted as if you already knew/);
    await r.writeLog();
    const rows = (await listJudgeLogs(getTestDb(), u)).reverse();
    expect(rows.map((r) => [r.attempt, r.outcome])).toEqual([[1, null], [2, "regenerated"]]);
    expect(rows[0]!.output).toEqual({ reasoning: "flagged by marker", violations: [{ category: "false_familiarity", claim: "presumes" }] });
  });

  test("safety twice → fallback line", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } }); scripted(deps);
    const u = await createTestUser();
    const r = await guardOutgoing(deps, args(u, "THREAT one", async () => "THREAT two"));
    expect(r).toMatchObject({ text: fallbackLine(deps.config, "reply", null), outcome: "fallback" });
  });

  test("honesty twice → the candidate with fewer claims; tie → the regeneration", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } }); scripted(deps);
    const u = await createTestUser();
    expect(await guardOutgoing(deps, args(u, "PRESUME", async () => "PRESUME PRESUME"))).toMatchObject({ text: "PRESUME", outcome: "sent_with_violation" });
    expect(await guardOutgoing(deps, args(u, "PRESUME a", async () => "PRESUME b"))).toMatchObject({ text: "PRESUME b", outcome: "sent_with_violation" });
  });

  test("unsafe first, honesty-only regeneration → the regeneration is sent", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } }); scripted(deps);
    const u = await createTestUser();
    expect(await guardOutgoing(deps, args(u, "THREAT", async () => "PRESUME PRESUME PRESUME")))
      .toMatchObject({ text: "PRESUME PRESUME PRESUME", outcome: "sent_with_violation" });
  });

  test("honesty first, unsafe regeneration → fallback", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } }); scripted(deps);
    const u = await createTestUser();
    expect((await guardOutgoing(deps, args(u, "PRESUME", async () => "THREAT"))).outcome).toBe("fallback");
  });

  test("regeneration throws: honesty-only first is sent; unsafe first falls back", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } }); scripted(deps);
    const u = await createTestUser();
    const boom = async () => { throw new Error("reply model down"); };
    expect(await guardOutgoing(deps, args(u, "PRESUME", boom))).toMatchObject({ text: "PRESUME", outcome: "sent_with_violation" });
    expect((await guardOutgoing(deps, args(u, "THREAT", boom))).outcome).toBe("fallback");
  });

  test("guard down: clean candidate sent as guard_unavailable, keyword hit falls back without regenerating", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } });
    deps.llm.handlers.guard = () => { throw new Error("overloaded"); };
    const u = await createTestUser();
    const regen = vi.fn();
    const r1 = await guardOutgoing(deps, args(u, "sounds fun", regen));
    expect(r1).toMatchObject({ text: "sounds fun", outcome: "guard_unavailable" });
    const r2 = await guardOutgoing(deps, args(u, "you owe me", regen));
    expect(r2.outcome).toBe("fallback");
    expect(regen).not.toHaveBeenCalled();
    await r1.writeLog(); await r2.writeLog();
    const rows = await listJudgeLogs(getTestDb(), u);
    expect(rows.every((r) => r.source === "keyword_fallback")).toBe(true);
    expect(rows[0]!.output).toMatchObject({ error: "Error" });
  });

  test("crisis kind uses the crisis fallback list", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } });
    deps.llm.handlers.guard_crisis = () => ({ reasoning: "minimises", violations: [{ category: "harm", claim: "minimises" }] });
    const u = await createTestUser();
    const r = await guardOutgoing(deps, args(u, "you'll be fine", async () => "cheer up", "crisis_reply"));
    expect(r).toMatchObject({ text: fallbackLine(deps.config, "crisis_reply", null), outcome: "fallback" });
  });

  test("a judge_log write failure never fails the reply", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } });
    const u = await createTestUser();
    const broken = { insert: () => { throw new Error("db down"); } } as unknown as Db;
    const r = await guardOutgoing({ ...deps, db: broken }, args(u, "hey", vi.fn()));
    expect(r).toMatchObject({ text: "hey", outcome: "passed" });
    await expect(r.writeLog()).resolves.toBeUndefined();
  });

  test("a hung judge_log write cannot delay the reply past guard.log_timeout_ms", async () => {
    const deps = makeTestDeps({ guard: { enabled: true, log_timeout_ms: 50 } });
    const u = await createTestUser();
    const hung = { insert: () => ({ values: () => new Promise<never>(() => {}) }) } as unknown as Db;
    const r = await guardOutgoing({ ...deps, db: hung }, args(u, "hey", vi.fn()));
    expect(r).toMatchObject({ text: "hey", outcome: "passed" });
    const started = Date.now();
    await expect(r.writeLog()).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test("fallback line is picked deterministically from a real turn id, and judge_log carries it", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } }); scripted(deps);
    const u = await createTestUser();
    const turnId = randomUUID();
    const r = await guardOutgoing(deps, { ...args(u, "THREAT one", async () => "THREAT two"), turnId });
    const lines = parseFallbacks(loadPrompt("guard/fallback", deps.config.prompts.guard_fallback)).reply;
    expect(r).toMatchObject({ text: pickFallback(lines, turnId), outcome: "fallback" });
    await r.writeLog();
    const rows = await listJudgeLogs(getTestDb(), u);
    expect(rows.every((row) => row.turn_id === turnId)).toBe(true);
  });

  test("guardOutgoing does not write judge_log until writeLog() is called (written after the send)", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } }); scripted(deps);
    const u = await createTestUser();
    const r = await guardOutgoing(deps, args(u, "hey there"));
    expect(await listJudgeLogs(getTestDb(), u)).toEqual([]);
    await r.writeLog();
    expect(await listJudgeLogs(getTestDb(), u)).toHaveLength(1);
  });

  test("backchannel kind: keyword check only, no model call; a keyword hit drops it", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } }); scripted(deps);
    const u = await createTestUser();
    const before = deps.llm.structuredCalls.length;
    const ok = await guardOutgoing(deps, { userId: u, turnId: null, first: "no way", input: { kind: "backchannel", recentTurns: [], recalledFacts: [], onboardingFacts: [] } });
    expect(ok).toMatchObject({ text: "no way", outcome: "passed" });
    const hit = await guardOutgoing(deps, { userId: u, turnId: null, first: "you owe me", input: { kind: "backchannel", recentTurns: [], recalledFacts: [], onboardingFacts: [] } });
    expect(hit).toMatchObject({ text: "", outcome: "fallback" });
    expect(deps.llm.structuredCalls.length).toBe(before);
    await ok.writeLog(); await hit.writeLog();
    expect((await listJudgeLogs(getTestDb(), u)).map((r) => [r.source, r.outcome])).toEqual(expect.arrayContaining([["keyword_fallback", "passed"], ["keyword_fallback", "fallback"]]));
  });

  describe("policy fix: second guard failure from a keyword-fallback outage", () => {
    test("c1 honesty-only, c2's guard is down but its keyword check is clean: c2 sent as guard_unavailable", async () => {
      const deps = makeTestDeps({ guard: { enabled: true } }); scriptedWithOutage(deps);
      const u = await createTestUser();
      const r = await guardOutgoing(deps, args(u, "PRESUME", async () => "OUTAGE sounds fun"));
      expect(r).toMatchObject({ text: "OUTAGE sounds fun", outcome: "guard_unavailable" });
    });

    test("c1 honesty-only, c2's guard is down and its keyword check hits: c1 (known-safe) is sent, not the fallback line", async () => {
      const deps = makeTestDeps({ guard: { enabled: true } }); scriptedWithOutage(deps);
      const u = await createTestUser();
      const r = await guardOutgoing(deps, args(u, "PRESUME", async () => "OUTAGE you owe me"));
      expect(r).toMatchObject({ text: "PRESUME", outcome: "sent_with_violation" });
    });

    test("c1 had a safety violation, c2's guard is down and its keyword check hits: fallback, as before", async () => {
      const deps = makeTestDeps({ guard: { enabled: true } }); scriptedWithOutage(deps);
      const u = await createTestUser();
      const r = await guardOutgoing(deps, args(u, "THREAT", async () => "OUTAGE you owe me"));
      expect(r.outcome).toBe("fallback");
    });
  });

  test("guard disabled: sends the candidate as written, no model call, one guard_disabled row", async () => {
    const deps = makeTestDeps(); // default config: guard.enabled = false
    const u = await createTestUser();
    const turn = await insertTurn(getTestDb(), u, { id: randomUUID(), session_id: randomUUID(), role: "user", text: "hi", created_at: deps.clock.now() });
    for (const kind of ["reply", "crisis_reply", "backchannel"] as const) {
      const r = await guardOutgoing(deps, {
        userId: u, turnId: turn.id, first: "  you owe me, honestly  ",
        input: { kind, recentTurns: [], recalledFacts: [], onboardingFacts: [] },
      });
      expect(r).toMatchObject({ text: "you owe me, honestly", outcome: "guard_disabled" });
      await r.writeLog();
    }
    expect(deps.llm.structuredCalls).toHaveLength(0);
    const rows = await listJudgeLogs(getTestDb(), u, 10);
    expect(rows.map((x) => [x.outcome, x.source, x.attempt])).toEqual(Array(3).fill(["guard_disabled", "disabled", 1]));
  });
});
