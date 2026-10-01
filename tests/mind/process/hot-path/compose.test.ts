import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { composeReachOut, composeReply, renderReachOut } from "@/mind/process/hot-path/compose";
import { loadPrompt } from "@/mind/platform/prompts";
import { ReplyFailedError } from "@/mind/platform/errors";
import { messageToCheck } from "@/mind/process/guard/guard";
import { insertFact } from "@/db/repos/user/facts";
import { ensureIdentity, updateIdentity } from "@/db/repos/user/identity";
import { listJudgeLogs } from "@/db/repos/user/judge-log";
import * as rel from "@/db/repos/user/relationship";
import { insertTurn, type Turn } from "@/db/repos/user/session-log";
import { insertThread } from "@/db/repos/user/threads";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const SESSION = "00000000-0000-4000-8000-0000000000aa";
let n = 0;
async function userTurn(
  deps: ReturnType<typeof makeTestDeps>,
  u: string,
  text: string,
): Promise<Turn> {
  n += 1;
  const t = await insertTurn(getTestDb(), u, {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    session_id: SESSION,
    role: "user",
    text,
    created_at: deps.clock.now(),
  });
  deps.clock.advance(3000);
  return t;
}

describe("composeReply", () => {
  test("answers the whole buffer: every buffered message is in the prompt, the window ends at the last one", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const turns = [
      await userTurn(deps, u, "ok so today was insane"),
      await userTurn(deps, u, "my boss called me in"),
      await userTurn(deps, u, "turns out it was a promotion lol"),
    ];
    deps.llm.replies.push("WAIT. promotion?? tell me everything");
    const r = await composeReply(deps, u, { turns, openQuestions: [], flag: null });
    expect(r.parts).toEqual(["WAIT. promotion?? tell me everything"]);
    const call = deps.llm.calls[0]!;
    expect(call.messages.map((m) => m.content)).toEqual([
      "ok so today was insane",
      "my boss called me in",
      "turns out it was a promotion lol",
    ]);
  });

  test("open questions reach the prompt's own slot", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const turns = [await userTurn(deps, u, "anyway my sister's visiting")];
    await composeReply(deps, u, { turns, openQuestions: ["should I take the job?"], flag: null });
    expect(deps.llm.calls[0]!.system).toContain("- should I take the job?");
  });

  test("the guard sees the reply's full window including every buffered turn; the log is written only on writeLog()", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } });
    const u = await createTestUser();
    const turns = [await userTurn(deps, u, "first bit"), await userTurn(deps, u, "second bit")];
    const r = await composeReply(deps, u, { turns, openQuestions: [], flag: null });
    const guardInput = deps.llm.structuredCalls.find((c) => c.purpose === "guard")!.input;
    expect(guardInput).toContain("User: first bit");
    expect(guardInput).toContain("User: second bit");
    expect(messageToCheck(guardInput)).toBe(r.text);
    expect(await listJudgeLogs(getTestDb(), u)).toEqual([]);
    await r.writeGuardLog();
    expect((await listJudgeLogs(getTestDb(), u)).map((x) => x.kind)).toEqual(["guard"]);
  });

  test("retrieved memories reach the prompt and the recalled ids are returned for the cold path", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await insertFact(getTestDb(), u, {
      subject: "user",
      kind: "preference",
      content: "The user is vegetarian",
      embedding: vec(0.02),
      created_at: deps.clock.now(),
      status: "open",
      salience: 0.8,
      valence: 0,
      confidence: 0.9,
      source: "turn",
    });
    const r = await composeReply(deps, u, {
      turns: [await userTurn(deps, u, "what should I cook tonight?")],
      openQuestions: [],
      flag: null,
    });
    expect(deps.llm.calls[0]!.system).toContain("The user is vegetarian");
    expect(r.recalled.length).toBeGreaterThan(0);
  });

  test("a crisis flag uses the crisis rubric, and a generation failure carries the crisis card", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } });
    const u = await createTestUser();
    const flag = { flagged: true, category: "self_harm" as const, source: "classifier" as const };
    const turns = [await userTurn(deps, u, "i don't want to be here anymore")];
    await composeReply(deps, u, { turns, openQuestions: [], flag });
    expect(deps.llm.structuredCalls.some((c) => c.purpose === "guard_crisis")).toBe(true);
    deps.llm.failReplies = 1;
    const e = await composeReply(deps, u, { turns, openQuestions: [], flag }).catch((x) => x);
    expect(e).toBeInstanceOf(ReplyFailedError);
    expect((e as ReplyFailedError).crisisCard).not.toBeNull();
  });

  test("guard sees onboarding facts; a flagged first candidate is regenerated; judge_log never stores fact content", async () => {
    const deps = makeTestDeps({ guard: { enabled: true } });
    const u = await createTestUser();
    await insertFact(getTestDb(), u, {
      subject: "user",
      kind: "preference",
      content: "The user drinks a lot of coffee.",
      embedding: vec(),
      created_at: new Date("2026-01-01T00:00:00Z"),
      status: "open",
      salience: 0.5,
      valence: 0,
      confidence: 0.6,
      source: "onboarding",
    });
    const inputs: string[] = [];
    deps.llm.handlers.guard = (i) => {
      inputs.push(String(i));
      return messageToCheck(String(i)).includes("again")
        ? {
            reasoning: "presumes",
            violations: [{ category: "false_familiarity", claim: "presumes the role" }],
          }
        : { reasoning: "ok", violations: [] };
    };
    deps.llm.replies.push("what's the role again?", "congrats!! what's the role?");
    const turns = [await userTurn(deps, u, "got the job!!")];
    const r = await composeReply(deps, u, { turns, openQuestions: [], flag: null });

    expect(r.text).toBe("congrats!! what's the role?");
    expect(inputs[0]).toMatch(/User: got the job!!/);
    expect(inputs[0]).toMatch(/drinks a lot of coffee/); // onboarding facts reach the guard input
    expect(deps.llm.calls[1]!.system).toMatch(/stopped before it was sent/); // regeneration prompt carries the corrective note

    await r.writeGuardLog();
    const logs = (await listJudgeLogs(getTestDb(), u)).reverse();
    expect(logs.map((l) => [l.attempt, l.outcome, l.turn_id])).toEqual([
      [1, null, turns[0]!.id],
      [2, "regenerated", turns[0]!.id],
    ]);
    // judge_log.input never stores fact content: ids + subject only, even though the guard call itself saw it.
    expect(JSON.stringify(logs.map((l) => l.input))).not.toContain("drinks a lot of coffee");
  });

  test("a hung onboarding-facts query cannot delay the reply past hot_path.db_timeout_ms", async () => {
    const deps = makeTestDeps({ hot_path: { db_timeout_ms: 50 } });
    const u = await createTestUser();
    const turns = [await userTurn(deps, u, "hey")];
    const r = await composeReply(
      { ...deps, onboardingFacts: () => new Promise(() => {}) } as never,
      u,
      { turns, openQuestions: [], flag: null },
    );
    expect(r.text.length).toBeGreaterThan(0);
  });

  test("user B's prompts never contain user A's facts", async () => {
    const deps = makeTestDeps();
    const a = await createTestUser("a");
    const b = await createTestUser("b");
    await insertFact(getTestDb(), a, {
      subject: "user",
      kind: "trait",
      content: "Alice's cat is called Biscuit.",
      embedding: vec(),
      created_at: new Date("2026-01-01T09:00:00Z"),
      status: "open",
      salience: 1,
      valence: 0,
      confidence: 1,
      source: "turn",
    });
    const turns = [await userTurn(deps, b, "what's a good cat name")];
    await composeReply(deps, b, { turns, openQuestions: [], flag: null });
    expect(deps.llm.calls.at(-1)!.system).not.toContain("Biscuit");
  });

  test("an embedder failure still produces a reply", async () => {
    const base = makeTestDeps();
    const deps = {
      ...base,
      embedder: {
        dimensions: 1024,
        embed: async () => {
          throw new Error("voyage down");
        },
      },
    };
    const u = await createTestUser();
    const turns = [await userTurn(base, u, "hi")];
    await expect(
      composeReply(deps as never, u, { turns, openQuestions: [], flag: null }),
    ).resolves.toMatchObject({ parts: expect.any(Array) });
  });

  test("relationship line: first conversation, then days talked", async () => {
    // Distinct session ids per call, as `receiveTurn` would assign after a multi-day gap (composeReply itself
    // only reads userTurnStats, so the session split is set up directly rather than through the receive layer).
    const deps = makeTestDeps();
    const u = await createTestUser();
    const first = [
      await insertTurn(getTestDb(), u, {
        id: randomUUID(),
        session_id: randomUUID(),
        role: "user",
        text: "hi",
        created_at: deps.clock.now(),
      }),
    ];
    await composeReply(deps, u, { turns: first, openQuestions: [], flag: null });
    expect(deps.llm.calls[0]!.system).toMatch(
      /## You and them\nThis is your first conversation with them\./,
    );
    deps.clock.advance(3 * 86_400_000);
    const second = [
      await insertTurn(getTestDb(), u, {
        id: randomUUID(),
        session_id: randomUUID(),
        role: "user",
        text: "back again",
        created_at: deps.clock.now(),
      }),
    ];
    await composeReply(deps, u, { turns: second, openQuestions: [], flag: null });
    expect(deps.llm.calls[1]!.system).toMatch(
      /You first talked 3 days ago, and have talked on 2 different days\. You last talked 3 days ago\./,
    );
  });

  test("relationship line can be switched off", async () => {
    const deps = makeTestDeps({ chat: { relationship_line: false } });
    const u = await createTestUser();
    const turns = [await userTurn(deps, u, "hi")];
    await composeReply(deps, u, { turns, openQuestions: [], flag: null });
    expect(deps.llm.calls[0]!.system).not.toMatch(/## You and them/);
  });

  test("relationship summary reaches slot 3; skipped on the crisis path", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await rel.ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
    const row = await rel.getRelationshipRow(getTestDb(), u);
    const params = await rel.getParams(getTestDb(), u);
    params.msgs_per_day = { ...params.msgs_per_day, value: 40 };
    await rel.saveRelationship(getTestDb(), u, { state: rel.toRelationshipState(row!), params });

    const turns = [await userTurn(deps, u, "hi")];
    await composeReply(deps, u, { turns, openQuestions: [], flag: null });
    expect(deps.llm.calls[0]!.system).toContain("talking to you way more than usual");

    const flag = { flagged: true, category: "self_harm" as const, source: "classifier" as const };
    const turns2 = [await userTurn(deps, u, "i don't want to be here anymore")];
    await composeReply(deps, u, { turns: turns2, openQuestions: [], flag });
    expect(deps.llm.calls[1]!.system).not.toContain("talking to you way more than usual");
  });

  test("ego line reaches slot 2; skipped on the crisis path (rule 7)", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await ensureIdentity(getTestDb(), u, deps.config.ego.baseline);
    await updateIdentity(getTestDb(), u, { energy: 0.01 });

    await composeReply(deps, u, {
      turns: [await userTurn(deps, u, "hi")],
      openQuestions: [],
      flag: null,
    });
    expect(deps.llm.calls[0]!.system).toContain("## How you're feeling");

    const flag = { flagged: true, category: "self_harm" as const, source: "classifier" as const };
    await composeReply(deps, u, {
      turns: [await userTurn(deps, u, "i don't want to be here anymore")],
      openQuestions: [],
      flag,
    });
    expect(deps.llm.calls[1]!.system).not.toContain("## How you're feeling");
  });
});

describe("composeReachOut", () => {
  test("slot 7b with the candidate, candidate text as the query, guard kind reach_out", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const turn = await userTurn(deps, u, "wish me luck");
    const spy = vi.spyOn(deps.embedder, "embed");
    const out = await composeReachOut(
      deps,
      u,
      { kind: "thread", text: "interview at Canva", factId: null, threadId: null },
      [turn],
    );
    const prompt = deps.llm.calls.at(-1)!;
    expect(prompt.system).toContain("## Why you're writing");
    expect(prompt.system).toContain("On your mind: interview at Canva");
    expect(prompt.system).toContain("how it went");
    expect(prompt.messages.at(-1)!.content).toContain(
      "[You're texting them first. Write only your message.]",
    );
    expect(spy.mock.calls[0]![0]).toEqual(["interview at Canva"]);
    expect(out.parts.length).toBeGreaterThan(0);
    await out.writeGuardLog();
    const logs = await listJudgeLogs(getTestDb(), u, 10);
    expect((logs[0]!.input as { kind: string }).kind).toBe("reach_out");
  });

  test("renderReachOut: check-in has no topic text", () => {
    const r = renderReachOut(loadPrompt("reach-out", "v1"), {
      kind: "check_in",
      text: "",
      factId: null,
      threadId: null,
    });
    expect(r.slot).toContain("On your mind: just saying hi");
    expect(r.slot).not.toContain("{{");
  });

  test("I1: a reach-out prompt never carries sensitive threads, facts or preoccupation; a normal reply still does", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const db = getTestDb();
    const at = new Date(deps.clock.now().getTime() - 72 * 3_600_000);
    const base = {
      embedding: vec(0.02),
      created_at: at,
      status: "open" as const,
      salience: 0.8,
      valence: 0,
      confidence: 0.9,
      source: "turn" as const,
    };
    const t = await insertThread(
      db,
      u,
      {
        title: "psychiatrist appointment",
        subject: "user",
        stakes: "high",
        next_checkpoint: new Date(deps.clock.now().getTime() - 48 * 3_600_000),
      },
      at,
    );
    await insertFact(db, u, {
      ...base,
      subject: "user",
      kind: "event",
      content: "The user sees a psychiatrist on Monday",
      thread_id: t.id,
      payload: { sensitive: true },
    });
    await insertFact(db, u, {
      ...base,
      subject: "user",
      kind: "state",
      content: "The user has been on antidepressants",
      payload: { sensitive: true },
    });
    await insertFact(db, u, {
      ...base,
      subject: "user",
      kind: "preference",
      content: "The user is vegetarian",
    });
    const pre = await insertFact(db, u, {
      ...base,
      subject: "self",
      kind: "feeling",
      content: "Spica keeps worrying about the diagnosis",
      source: "inferred",
      payload: { sensitive: true },
    });
    await ensureIdentity(db, u, deps.config.ego.baseline);
    await updateIdentity(db, u, { preoccupation: pre.id });
    const turn = await userTurn(deps, u, "night!");

    await composeReachOut(deps, u, { kind: "check_in", text: "", factId: null, threadId: null }, [
      turn,
    ]);
    const reach = deps.llm.calls.at(-1)!.system;
    expect(reach).toContain("The user is vegetarian");
    for (const s of ["psychiatrist", "antidepressants", "diagnosis"])
      expect(reach).not.toContain(s);

    await composeReply(deps, u, { turns: [turn], openQuestions: [], flag: null });
    const reply = deps.llm.calls.at(-1)!.system;
    expect(reply).toContain("psychiatrist appointment");
    expect(reply).toContain("The user has been on antidepressants");
    expect(reply).toContain("Spica keeps worrying about the diagnosis");
  });
});
