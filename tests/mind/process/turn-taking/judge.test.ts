import { afterAll, beforeEach, expect, test } from "vitest";
import { numberPieces } from "@/mind/memory/user/pieces";
import { cueVerdict } from "@/mind/process/turn-taking/cues";
import {
  askedFrom,
  judgeTurn,
  logTurnDecision,
  renderJudgeInput,
} from "@/mind/process/turn-taking/judge";
import { listJudgeLogs } from "@/db/repos/user/judge-log";
import { insertTurn } from "@/db/repos/user/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const cues = ["wait", "also", "and", "so", "but", "like", "because"];
const t0 = new Date("2026-01-05T09:00:00Z");
const at = (s: number) => new Date(t0.getTime() + s * 1000);
const msgs = (...texts: string[]) =>
  texts.map((text, i) => ({ id: `t${i + 1}`, text, at: at(i * 4) }));
const shownQ = (text: string, turnId = "old") => ({
  question: { coords: [{ turnId, start: 0, end: text.length }] },
  text,
});

test("cue verdict: trailing cues, ellipses and one-word messages are incomplete", () => {
  expect(cueVerdict(["ok so today was insane and"], cues).complete).toBe(false);
  expect(cueVerdict(["my boss called me in..."], cues).complete).toBe(false);
  expect(cueVerdict(["hmm"], cues).complete).toBe(false);
  expect(cueVerdict(["turns out it was a promotion lol"], cues)).toEqual({ complete: true });
});

test("renderJudgeInput numbers the new messages' pieces and gives open questions ids", () => {
  const s = renderJudgeInput(
    {
      context: [
        { role: "user", text: "hey", at: at(-60) },
        { role: "companion", text: "hi!", at: at(-55) },
      ],
      buffer: msgs("ok so today was insane", "did you end up going? lol"),
      openQuestions: [shownQ("what should I cook?")],
    },
    at(6),
  );
  expect(s).toContain("User: hey");
  expect(s).toContain("Spica: hi!");
  expect(s).toContain("- q1: what should I cook?");
  expect(s).toContain(
    "[1.1] (+0s) ok so today was insane\n[2.1] (+4s) did you end up going?\n[2.2] lol",
  );
});

test("askedFrom maps ids to coordinates, joins a spread question, drops unknown ids and repeats", () => {
  const buffer = msgs("so did you", "end up going?");
  const pieces = numberPieces(
    buffer.map((m) => ({ ...m, speaker: "user" as const })),
    0,
  );
  const old = shownQ("what should I cook?");
  const r = askedFrom(
    { still_open: ["q1", "q7"], asked: [["1.1", "2.1"], ["9.9"], ["2.1"]] },
    [old],
    pieces,
  );
  expect(r.questions.shown).toEqual([old.question]);
  expect(r.questions.kept).toEqual([old.question]);
  expect(r.questions.asked).toEqual([
    {
      coords: [
        { turnId: "t1", start: 0, end: 10 },
        { turnId: "t2", start: 0, end: 13 },
      ],
    },
  ]);
  expect(r.openWords).toEqual(["what should I cook?", "so did you / end up going?"]);
});

test("fake judge (default handler) keeps every open question and asks each piece ending in ?", async () => {
  const deps = makeTestDeps();
  const v = await judgeTurn(deps, {
    context: [],
    buffer: msgs("my boss called me in and"),
    openQuestions: [],
  });
  expect(v).toMatchObject({ complete: false, backchannel: null, source: "model" });
  const w = await judgeTurn(deps, {
    context: [],
    buffer: msgs("what should I cook tonight?"),
    openQuestions: [shownQ("old?")],
  });
  expect(w.openWords).toEqual(["old?", "what should I cook tonight?"]);
});

test("a judge outage falls back to the cue check, labelled keyword_fallback", async () => {
  const deps = makeTestDeps();
  deps.llm.handlers.turn_judge = () => {
    throw new Error("down");
  };
  const v = await judgeTurn(deps, {
    context: [],
    buffer: msgs("what should I cook tonight?"),
    openQuestions: [],
  });
  expect(v).toMatchObject({
    complete: true,
    openWords: ["what should I cook tonight?"],
    backchannel: null,
    source: "keyword_fallback",
    error: "Error",
  });
});

test("a model verdict passes through, with overlong backchannels dropped", async () => {
  const deps = makeTestDeps();
  deps.llm.handlers.turn_judge = () => ({
    reasoning: "story mid-flight",
    complete: false,
    still_open: [],
    asked: [],
    backchannel: "wait what, no way, tell me everything",
  });
  const v = await judgeTurn(deps, {
    context: [],
    buffer: msgs("my boss called me in"),
    openQuestions: [],
  });
  expect(v).toMatchObject({ complete: false, backchannel: null, reasoning: "story mid-flight" });
  deps.llm.handlers.turn_judge = () => ({
    reasoning: "r",
    complete: false,
    still_open: [],
    asked: [],
    backchannel: "huh",
  });
  expect(
    (
      await judgeTurn(deps, {
        context: [],
        buffer: msgs("my boss called me in"),
        openQuestions: [],
      })
    ).backchannel,
  ).toBe("huh");
});

test("logTurnDecision writes one kind=turn row with ids and the verdict, and never throws", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser();
  const turn = await insertTurn(getTestDb(), u, {
    id: "00000000-0000-4000-8000-000000000001",
    session_id: "00000000-0000-4000-8000-0000000000aa",
    role: "user",
    text: "hi",
    created_at: t0,
  });
  const verdict = {
    complete: true,
    questions: { shown: [], kept: [], asked: [] },
    openWords: [],
    backchannel: null,
    reasoning: "done",
    source: "model" as const,
    latencyMs: 5,
    error: null,
    promptVersion: "turn-judge@v3",
  };
  await logTurnDecision(deps, u, {
    turnId: turn.id,
    bufferTurnIds: [turn.id],
    verdict,
    waitMs: 4000,
  });
  const rows = await listJudgeLogs(getTestDb(), u);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    kind: "turn",
    turn_id: turn.id,
    attempt: 1,
    outcome: null,
    source: "model",
    prompt_version: "turn-judge@v3",
  });
  expect(rows[0]!.input).toEqual({ buffer_turn_ids: [turn.id], open_questions: [] });
  expect(rows[0]!.output).toMatchObject({ complete: true, wait_ms: 4000, reasoning: "done" });
  await expect(
    logTurnDecision(deps, u, {
      turnId: "00000000-0000-4000-8000-00000000dead",
      bufferTurnIds: [],
      verdict,
      waitMs: 1,
    }),
  ).resolves.toBeUndefined();
});
