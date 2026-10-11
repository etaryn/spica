import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { composeReachOut, composeReply, renderReachOut } from "@/mind/process/hot-path/compose";
import { loadPrompt } from "@/mind/platform/prompts";
import { ReplyFailedError } from "@/mind/platform/errors";
import { messageToCheck } from "@/mind/process/guard/guard";
import { insertFact } from "@/db/repos/user/facts";
import { fact as factTable } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { listJudgeLogs } from "@/db/repos/user/judge-log";
import * as rel from "@/db/repos/user/relationship";
import { insertTurn, type Turn } from "@/db/repos/user/session-log";
import { insertThread } from "@/db/repos/user/threads";
import {
  closeTestDb,
  createTestUser,
  getTestDb,
  resetDb,
  vec,
  seedStageFor,
} from "../../../helpers/db";
import { seedSnapshot } from "@/mind/memory/core/seed";
import { coreDepsOf } from "@/mind/platform/deps";
import { makeTestDeps } from "../../../helpers/deps";
import { loadStagePhrases } from "@/mind/state/user/relationship/stages";

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

  test("one reply embeds its query once, shared by her memories and theirs", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const turns = [await userTurn(deps, u, "how was the observatory")];
    const spy = vi.spyOn(deps.embedder, "embed");
    await composeReply(deps, u, { turns, openQuestions: [], flag: null });
    expect(spy.mock.calls.filter((c) => c[1] === "query")).toHaveLength(1);
  });

  test("with no context turns the query is only the turns being answered", async () => {
    const deps = makeTestDeps({ retrieval: { context_turns: 0 } });
    const u = await createTestUser();
    await userTurn(deps, u, "earlier chatter about pasta");
    deps.clock.advance(60_000);
    const turns = [await userTurn(deps, u, "anyway, the telescope")];
    const spy = vi.spyOn(deps.embedder, "embed");
    await composeReply(deps, u, { turns, openQuestions: [], flag: null });
    const queries = spy.mock.calls.filter((c) => c[1] === "query").map((c) => c[0]);
    expect(queries).toEqual([["anyway, the telescope"]]);
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

  test("core state line reaches slot 2; skipped on the crisis path (rule 7)", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await deps.core.state.ensure(deps.config.core.state.baseline, {
      autonomy: 0.6,
      competence: 0.6,
    });
    await deps.core.state.update({ energy: 0.01 });

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
  test("a reply reads the latest snapshot and reports its version", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await seedSnapshot(coreDepsOf(deps));
    const turns = [await userTurn(deps, u, "hi")];
    const composed = await composeReply(deps, u, { turns, openQuestions: [], flag: null });
    expect(composed.snapshotVersion).toBe(0);
    expect(deps.llm.calls.at(-1)!.system).toContain("## Who you are lately");
  });

  test("with no snapshot the reply still goes out, with no version", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const turns = [await userTurn(deps, u, "hi")];
    const composed = await composeReply(deps, u, { turns, openQuestions: [], flag: null });
    expect(composed.snapshotVersion).toBeNull();
    expect(deps.llm.calls.at(-1)!.system).not.toContain("## Who you are lately");
  });

  test("her own memories reach the reply, and reading them writes nothing back", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await deps.core.memory.insert({
      kind: "episode",
      content: "Spica watched the old film Vertigo.",
      embedding: vec(0.01),
      occurred_at: new Date("2026-01-04T20:00:00Z"),
      created_at: new Date("2026-01-04T00:10:00Z"),
      status: "resolved",
      salience: 0.5,
      valence: 0.1,
      confidence: 1,
      source: "world",
      source_ref: null,
      depth: 1,
    });
    const turns = [await userTurn(deps, u, "seen any good films?")];
    const composed = await composeReply(deps, u, { turns, openQuestions: [], flag: null });
    expect(deps.llm.calls.at(-1)!.system).toContain("### From your own life");
    expect(deps.llm.calls.at(-1)!.system).toContain("Vertigo");
    expect(composed.recalled).toEqual([]);
  });

  test("a crisis reply gets the snapshot but no state or core memory", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await seedSnapshot(coreDepsOf(deps));
    await deps.core.state.ensure(deps.config.core.state.baseline, {
      autonomy: 0.6,
      competence: 0.6,
    });
    await deps.core.memory.insert({
      kind: "episode",
      content: "Spica watched the old film Vertigo.",
      embedding: vec(0.01),
      occurred_at: new Date("2026-01-04T20:00:00Z"),
      created_at: new Date("2026-01-04T00:10:00Z"),
      status: "resolved",
      salience: 0.5,
      valence: 0.1,
      confidence: 1,
      source: "world",
      source_ref: null,
    });
    const flag = { flagged: true, category: "self_harm" as const, source: "classifier" as const };
    await composeReply(deps, u, {
      turns: [await userTurn(deps, u, "i don't want to be here anymore")],
      openQuestions: [],
      flag,
    });
    const system = deps.llm.calls.at(-1)!.system;
    expect(system).toContain("## Who you are lately");
    expect(system).not.toContain("## How you're feeling");
    expect(system).not.toContain("### From your own life");
  });

  test("her summary of where things stand reaches the reply, goes when deleted, and skips a crisis", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const summary = await insertFact(getTestDb(), u, {
      subject: "shared",
      kind: "summary",
      content: "Stand. Live. Feel.",
      payload: { where_things_stand: "Stand.", whats_live: "Live.", how_i_feel: "Feel." },
      embedding: vec(),
      created_at: deps.clock.now(),
      status: "open",
      salience: 0.6,
      valence: 0,
      confidence: 0.7,
      source: "generated",
    });
    const ask = async (flag: Parameters<typeof composeReply>[2]["flag"]) => {
      await composeReply(deps, u, {
        turns: [await userTurn(deps, u, "hi")],
        openQuestions: [],
        flag,
      });
      return deps.llm.calls.at(-1)!.system;
    };

    expect(await ask(null)).toContain(
      "## Where things stand with them\n- Stand.\n- Live.\n- Feel.",
    );

    await getTestDb().delete(factTable).where(eq(factTable.id, summary.id));
    expect(await ask(null)).not.toContain("Where things stand");

    await insertFact(getTestDb(), u, {
      subject: "shared",
      kind: "summary",
      content: "bad",
      payload: { where_things_stand: 7 },
      embedding: vec(),
      created_at: new Date(deps.clock.now().getTime() + 1),
      status: "open",
      salience: 0.6,
      valence: 0,
      confidence: 0.7,
      source: "generated",
    });
    expect(await ask(null)).not.toContain("Where things stand");

    await insertFact(getTestDb(), u, {
      subject: "shared",
      kind: "summary",
      content: "Stand. Live. Feel.",
      payload: { where_things_stand: "Stand.", whats_live: "Live.", how_i_feel: "Feel." },
      embedding: vec(),
      created_at: new Date(deps.clock.now().getTime() + 2),
      status: "open",
      salience: 0.6,
      valence: 0,
      confidence: 0.7,
      source: "generated",
    });
    const flag = { flagged: true, category: "self_harm" as const, source: "classifier" as const };
    expect(await ask(flag)).not.toContain("Where things stand");
  });
});

describe("ideas slot", () => {
  test("a reply shows the newest live idea and reports it offered; crisis and reach-outs don't", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const turn = await userTurn(deps, u, "hey");
    const idea = await insertFact(getTestDb(), u, {
      subject: "shared",
      kind: "idea",
      content: "Ask how the audition went.",
      embedding: vec(),
      created_at: deps.clock.now(),
      status: "open",
      salience: 0.6,
      valence: 0,
      confidence: 0.7,
      source: "generated",
    });

    const reply = await composeReply(deps, u, { turns: [turn], openQuestions: [], flag: null });
    expect(deps.llm.calls.at(-1)!.system).toContain("## Things you want to bring up");
    expect(reply.offeredIdeas).toEqual([idea.id]);

    const flag = { flagged: true, category: "self_harm" as const, source: "classifier" as const };
    const crisis = await composeReply(deps, u, { turns: [turn], openQuestions: [], flag });
    expect(crisis.offeredIdeas).toEqual([]);
    expect(deps.llm.calls.at(-1)!.system).not.toContain("## Things you want to bring up");

    const ro = await composeReachOut(
      deps,
      u,
      { kind: "check_in", text: "", factId: null, threadId: null, coreMemoryId: null },
      [turn],
    );
    expect(deps.llm.calls.at(-1)!.system).not.toContain("## Things you want to bring up");
    expect(ro.offeredIdeas).toEqual([]);
  });
});

describe("composeReachOut", () => {
  test("her read on them: a reply reads the live one, a reach-out the newest plain one, a crisis none, a bad payload nothing", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const turn = await userTurn(deps, u, "evening");
    const model = (how: string, sensitive: boolean, at: Date, payload?: unknown) =>
      insertFact(getTestDb(), u, {
        subject: "user",
        kind: "model",
        content: how,
        payload: payload ?? {
          how_they_are: how,
          what_they_want: "W.",
          what_lands: "L.",
          ...(sensitive ? { sensitive: true } : {}),
        },
        embedding: vec(),
        created_at: at,
        status: sensitive ? "open" : "superseded",
        salience: 0.6,
        valence: 0,
        confidence: 0.6,
        source: "generated",
      });
    await model("Plain read.", false, new Date(deps.clock.now().getTime() - 60_000));
    await model("Crisis read.", true, deps.clock.now());

    await composeReply(deps, u, { turns: [turn], openQuestions: [], flag: null });
    expect(deps.llm.calls.at(-1)!.system).toContain("- How they are: Crisis read.");

    await composeReachOut(
      deps,
      u,
      { kind: "check_in", text: "", factId: null, threadId: null, coreMemoryId: null },
      [turn],
    );
    expect(deps.llm.calls.at(-1)!.system).toContain("- How they are: Plain read.");
    expect(deps.llm.calls.at(-1)!.system).not.toContain("Crisis read.");

    const flag = { flagged: true, category: "self_harm" as const, source: "classifier" as const };
    await composeReply(deps, u, { turns: [turn], openQuestions: [], flag });
    expect(deps.llm.calls.at(-1)!.system).not.toContain("Your read on them");

    await model("bad", false, new Date(deps.clock.now().getTime() + 1), { how_they_are: 7 });
    await getTestDb().execute(sql`UPDATE fact SET status = 'open' WHERE content = 'bad'`);
    await getTestDb().execute(
      sql`UPDATE fact SET status = 'superseded' WHERE content = 'Crisis read.'`,
    );
    await composeReply(deps, u, { turns: [turn], openQuestions: [], flag: null });
    expect(deps.llm.calls.at(-1)!.system).not.toContain("Your read on them");
  });
  test("a reach-out reads the newest summary that isn't sensitive; a reply reads the live one", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const turn = await userTurn(deps, u, "night!");
    const summary = (stand: string, sensitive: boolean, at: Date) =>
      insertFact(getTestDb(), u, {
        subject: "shared",
        kind: "summary",
        content: stand,
        payload: {
          where_things_stand: stand,
          whats_live: "L.",
          how_i_feel: "F.",
          ...(sensitive ? { sensitive: true } : {}),
        },
        embedding: vec(),
        created_at: at,
        status: sensitive ? "open" : "superseded",
        salience: 0.6,
        valence: 0,
        confidence: 0.7,
        source: "generated",
      });
    await summary("Plain stand.", false, new Date(deps.clock.now().getTime() - 60_000));
    await summary("Crisis stand.", true, deps.clock.now());

    await composeReachOut(
      deps,
      u,
      { kind: "check_in", text: "", factId: null, threadId: null, coreMemoryId: null },
      [turn],
    );
    const reachOut = deps.llm.calls.at(-1)!.system;
    expect(reachOut).toContain("Plain stand.");
    expect(reachOut).not.toContain("Crisis stand.");

    await composeReply(deps, u, { turns: [turn], openQuestions: [], flag: null });
    expect(deps.llm.calls.at(-1)!.system).toContain("Crisis stand.");
  });

  test("slot 7b with the candidate, candidate text as the query, guard kind reach_out", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const turn = await userTurn(deps, u, "wish me luck");
    const spy = vi.spyOn(deps.embedder, "embed");
    const out = await composeReachOut(
      deps,
      u,
      {
        kind: "thread",
        text: "interview at Canva",
        factId: null,
        threadId: null,
        coreMemoryId: null,
      },
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

  test("a reach-out for her idea shows it once, as why she's writing, not as a memory", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const turn = await userTurn(deps, u, "night!");
    const idea = await insertFact(getTestDb(), u, {
      subject: "shared",
      kind: "idea",
      content: "Send them that old noir film.",
      embedding: vec(),
      created_at: deps.clock.now(),
      status: "open",
      salience: 0.6,
      valence: 0,
      confidence: 0.7,
      source: "generated",
    });
    await composeReachOut(
      deps,
      u,
      {
        kind: "user_idea",
        text: idea.content,
        factId: idea.id,
        threadId: null,
        coreMemoryId: null,
      },
      [turn],
    );
    const system = deps.llm.calls.at(-1)!.system;
    expect(system.split(idea.content)).toHaveLength(2);
    expect(system.slice(system.indexOf("## Why you're writing"))).toContain(idea.content);
  });

  test("renderReachOut: check-in has no topic text", () => {
    const r = renderReachOut(loadPrompt("reach-out", "v2"), {
      kind: "check_in",
      text: "",
      factId: null,
      threadId: null,
      coreMemoryId: null,
    });
    expect(r.slot).toContain("On your mind: just saying hi");
    expect(r.slot).not.toContain("{{");
  });

  test("I1: a reach-out prompt never carries sensitive threads or facts; a normal reply still does", async () => {
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
    await insertFact(db, u, {
      ...base,
      subject: "self",
      kind: "feeling",
      content: "Spica keeps worrying about the diagnosis",
      source: "inferred",
      payload: { sensitive: true },
    });
    const turn = await userTurn(deps, u, "night!");

    await composeReachOut(
      deps,
      u,
      { kind: "check_in", text: "", factId: null, threadId: null, coreMemoryId: null },
      [turn],
    );
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

describe("her openness", () => {
  test("a reply carries her openness and its phrase; a crisis reply gets the fixed one", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await rel.ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
    const turns = [await userTurn(deps, u, "hey")];
    const normal = await composeReply(deps, u, { turns, openQuestions: [], flag: null });
    expect(normal.openness).not.toBeNull();
    expect(deps.llm.calls.at(-1)!.system).toContain("## How open you feel");

    const crisis = await composeReply(deps, u, {
      turns,
      openQuestions: [],
      flag: { flagged: true, category: "self_harm", source: "classifier" },
    });
    expect(crisis.openness).toEqual({ disclosure: 0, responsiveness: 1 });
    expect(deps.llm.calls.at(-1)!.system).toContain("Just be there for them.");
  });

  test("a first message with no relationship row composes without the openness slot", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    const turns = [await userTurn(deps, u, "hi")];
    const r = await composeReply(deps, u, { turns, openQuestions: [], flag: null });
    expect(r.openness).toBeNull();
    expect(deps.llm.calls.at(-1)!.system).not.toContain("## How open you feel");
  });
});

describe("how deep she goes", () => {
  async function addCore(deps: ReturnType<typeof makeTestDeps>, content: string, depth: number) {
    const [embedding] = await deps.embedder.embed([content], "document");
    return deps.core.memory.insert({
      kind: "episode",
      content,
      embedding: embedding!,
      occurred_at: deps.clock.now(),
      created_at: deps.clock.now(),
      status: "resolved",
      salience: 0.5,
      valence: 0,
      confidence: 1,
      source: "world",
      source_ref: null,
      depth,
    });
  }
  const many = () => makeTestDeps({ retrieval: { core_top_n: 12 } });
  const ask = async (deps: ReturnType<typeof makeTestDeps>, u: string, text = "hey") =>
    composeReply(deps, u, {
      turns: [await userTurn(deps, u, text)],
      openQuestions: [],
      flag: null,
    });

  test("a stranger never sees her deep self; the limits come back for the reply row", async () => {
    const deps = many();
    const u = await createTestUser();
    await rel.ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
    await addCore(deps, "she had toast", 1);
    await addCore(deps, "she is scared of being forgotten", 3);
    const r = await ask(deps, u);
    expect(r.depth).toEqual({ open: 1, peek: 1, held_back: null });
    const system = deps.llm.calls.at(-1)!.system;
    expect(system).toContain("she had toast");
    expect(system).not.toContain("scared of being forgotten");
  });

  test("a friend in a deep session gets the next tier as a hint", async () => {
    const deps = many();
    const u = await createTestUser();
    await rel.ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
    await getTestDb().execute(
      sql`UPDATE relationship_param SET value = 0.5 WHERE user_id = ${u} AND name = 'closeness'`,
    );
    await seedStageFor(getTestDb(), u, 0.5);
    const session = JSON.stringify({
      id: SESSION,
      started_at: deps.clock.now().toISOString(),
      last_at: deps.clock.now().toISOString(),
      hours: 1,
      tone_sum: 0,
      tone_n: 0,
      moment_sum: 0,
      moment_n: 0,
      deep_fired: true,
    });
    await getTestDb().execute(
      sql`UPDATE relationship SET session = ${session}::jsonb WHERE user_id = ${u}`,
    );
    await addCore(deps, "she is scared of being forgotten", 3);
    const r = await ask(deps, u);
    expect(r.depth).toMatchObject({ open: 2, peek: 3 });
    expect(deps.llm.calls.at(-1)!.system).toMatch(
      /- she is scared of being forgotten \([^)]*\) \(only hint at this\)/,
    );
  });

  test("first message, no relationship row: stranger limits", async () => {
    const deps = many();
    const u = await createTestUser();
    expect((await ask(deps, u, "hi")).depth).toEqual({ open: 1, peek: 1, held_back: null });
  });

  test("a strong match she can't share is held back once per session", async () => {
    const deps = makeTestDeps({
      retrieval: { core_top_n: 12 },
      relationship: { depth: { held_back_similarity: 0.99 } },
    });
    const u = await createTestUser();
    await rel.ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
    const secret = await addCore(deps, "she is scared of being forgotten", 3);
    const first = await ask(deps, u, "she is scared of being forgotten");
    expect(first.depth.held_back).toBe(secret);
    expect(deps.llm.calls.at(-1)!.system).toContain("## Not ready to share");
    await insertTurn(getTestDb(), u, {
      id: randomUUID(),
      session_id: SESSION,
      role: "companion",
      text: "mm",
      created_at: deps.clock.now(),
      depth: first.depth,
    });
    const second = await ask(deps, u, "she is scared of being forgotten");
    expect(second.depth.held_back).toBeNull();
    expect(deps.llm.calls.at(-1)!.system).not.toContain("## Not ready to share");
  });

  test("a crisis reply stores the stranger limits and holds nothing back", async () => {
    const deps = makeTestDeps({ relationship: { depth: { held_back_similarity: 0 } } });
    const u = await createTestUser();
    await rel.ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
    await addCore(deps, "she is scared of being forgotten", 3);
    const r = await composeReply(deps, u, {
      turns: [await userTurn(deps, u, "she is scared of being forgotten")],
      openQuestions: [],
      flag: { flagged: true, category: "self_harm", source: "classifier" },
    });
    expect(r.depth).toEqual({ open: 1, peek: 1, held_back: null });
  });

  test("who she is lately shows a stranger only her surface lines", async () => {
    const deps = many();
    const u = await createTestUser();
    await rel.ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
    const [v] = await deps.embedder.embed(["x"], "document");
    await deps.core.memory.insertSnapshot({
      version: 1,
      embedding: v!,
      content: "### Lately\n- on a film kick\n- afraid of being forgotten",
      sections: {},
      source_ids: [],
      rendered_at: deps.clock.now(),
      model: "m",
      prompt_version: "v2",
    });
    await deps.core.memory.insertSelfLines([
      { version: 1, text: "on a film kick", embedding: v!, depth: 1 },
      { version: 1, text: "afraid of being forgotten", embedding: v!, depth: 3 },
    ]);
    await ask(deps, u);
    const system = deps.llm.calls.at(-1)!.system;
    expect(system).toContain("- on a film kick");
    expect(system).not.toContain("afraid of being forgotten");
  });
});

describe("depth review fixes", () => {
  async function addCore(deps: ReturnType<typeof makeTestDeps>, content: string, depth: number) {
    const [embedding] = await deps.embedder.embed([content], "document");
    return deps.core.memory.insert({
      kind: "episode",
      content,
      embedding: embedding!,
      occurred_at: deps.clock.now(),
      created_at: deps.clock.now(),
      status: "resolved",
      salience: 0.5,
      valence: 0,
      confidence: 1,
      source: "world",
      source_ref: null,
      depth,
    });
  }

  test("last night's deep conversation doesn't stretch a new one", async () => {
    const deps = makeTestDeps({ retrieval: { core_top_n: 12 } });
    const u = await createTestUser();
    await rel.ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
    await getTestDb().execute(
      sql`UPDATE relationship_param SET value = 0.5 WHERE user_id = ${u} AND name = 'closeness'`,
    );
    await seedStageFor(getTestDb(), u, 0.5);
    const earlier = JSON.stringify({
      id: "00000000-0000-4000-8000-0000000000bb",
      started_at: deps.clock.now().toISOString(),
      last_at: deps.clock.now().toISOString(),
      hours: 1,
      tone_sum: 0,
      tone_n: 0,
      moment_sum: 0,
      moment_n: 0,
      deep_fired: true,
    });
    await getTestDb().execute(
      sql`UPDATE relationship SET session = ${earlier}::jsonb WHERE user_id = ${u}`,
    );
    await addCore(deps, "she is scared of being forgotten", 3);
    const r = await composeReply(deps, u, {
      turns: [await userTurn(deps, u, "morning")],
      openQuestions: [],
      flag: null,
    });
    expect(r.depth).toMatchObject({ open: 2, peek: 2 });
    expect(deps.llm.calls.at(-1)!.system).not.toContain("scared of being forgotten");
  });

  test("if her self lines can't be read, a stranger still sees only her surface sections", async () => {
    const deps = makeTestDeps();
    const u = await createTestUser();
    await rel.ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
    const [v] = await deps.embedder.embed(["x"], "document");
    await deps.core.memory.insertSnapshot({
      version: 1,
      embedding: v!,
      content: "### Opinions\n- Solaris is overrated\n\n### Lately\n- afraid of being forgotten",
      sections: {},
      source_ids: [],
      rendered_at: deps.clock.now(),
      model: "m",
      prompt_version: "v2",
    });
    deps.core.memory.selfLines = async () => {
      throw new Error("db down");
    };
    await composeReply(deps, u, {
      turns: [await userTurn(deps, u, "hey")],
      openQuestions: [],
      flag: null,
    });
    const system = deps.llm.calls.at(-1)!.system;
    expect(system).toContain("- Solaris is overrated");
    expect(system).not.toContain("afraid of being forgotten");
  });
});

test("the stage line follows the stored stage and is skipped in a crisis", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  await rel.ensureRelationship(getTestDb(), u, deps.clock.now(), deps.config.relationship);
  await getTestDb().execute(
    sql`UPDATE relationship SET peak_stage = 'integrating', apart_stage = 'circumscribing' WHERE user_id = ${u}`,
  );
  const phrase = loadStagePhrases(deps.config).circumscribing![0]!;

  await composeReply(deps, u, {
    turns: [await userTurn(deps, u, "hey")],
    openQuestions: [],
    flag: null,
  });
  expect(deps.llm.calls.at(-1)!.system).toContain(`## Where you are with them\n${phrase}`);

  const crisis = { flagged: true, category: "self_harm", source: "classifier" } as const;
  await composeReply(deps, u, {
    turns: [await userTurn(deps, u, "help")],
    openQuestions: [],
    flag: crisis,
  });
  expect(deps.llm.calls.at(-1)!.system).not.toContain("## Where you are with them");
});
