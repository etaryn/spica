import { afterAll, beforeEach, expect, test } from "vitest";
import { cueVerdict } from "@/mind/process/turn-taking/cues";
import { judgeTurn, logTurnDecision, renderJudgeInput } from "@/mind/process/turn-taking/judge";
import { listJudgeLogs } from "@/db/repos/judge-log";
import { insertTurn } from "@/db/repos/session-log";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const cues = ["wait", "also", "and", "so", "but", "like", "because"];
const t0 = new Date("2026-01-05T09:00:00Z");
const at = (s: number) => new Date(t0.getTime() + s * 1000);

test("cue verdict: trailing cues, ellipses and one-word messages are incomplete; questions become open", () => {
  expect(cueVerdict(["ok so today was insane and"], [], cues).complete).toBe(false);
  expect(cueVerdict(["my boss called me in..."], [], cues).complete).toBe(false);
  expect(cueVerdict(["hmm"], [], cues).complete).toBe(false);
  expect(cueVerdict(["turns out it was a promotion lol"], [], cues).complete).toBe(true);
  expect(cueVerdict(["what should I cook tonight?"], ["old?"], cues)).toEqual({
    complete: true,
    open_questions: ["old?", "what should I cook tonight?"],
    backchannel: null,
  });
  expect(cueVerdict(["I passed"], [], cues).complete).toBe(true);
});

test("renderJudgeInput shows context, open questions and the buffer with gaps", () => {
  const s = renderJudgeInput(
    {
      context: [
        { role: "user", text: "hey", at: at(-60) },
        { role: "companion", text: "hi!", at: at(-55) },
      ],
      buffer: [
        { text: "ok so today was insane", at: at(0) },
        { text: "my boss called me in", at: at(6) },
      ],
      openQuestions: ["what should I cook?"],
    },
    at(6),
  );
  expect(s).toContain("User: hey");
  expect(s).toContain("Spica: hi!");
  expect(s).toContain("- what should I cook?");
  expect(s).toContain("- (+0s) ok so today was insane\n- (+6s) my boss called me in");
});

test("fake judge (default handler) applies the cue check to the rendered buffer", async () => {
  const deps = makeTestDeps();
  const v = await judgeTurn(deps, {
    context: [],
    buffer: [{ text: "my boss called me in and", at: t0 }],
    openQuestions: [],
  });
  expect(v).toMatchObject({ complete: false, backchannel: null, source: "model" });
});

test("a judge outage falls back to the cue check, labelled keyword_fallback", async () => {
  const deps = makeTestDeps();
  deps.llm.handlers.turn_judge = () => {
    throw new Error("down");
  };
  const v = await judgeTurn(deps, {
    context: [],
    buffer: [{ text: "what should I cook tonight?", at: t0 }],
    openQuestions: [],
  });
  expect(v).toMatchObject({
    complete: true,
    open_questions: ["what should I cook tonight?"],
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
    open_questions: [],
    backchannel: "wait what, no way, tell me everything",
  });
  const v = await judgeTurn(deps, {
    context: [],
    buffer: [{ text: "my boss called me in", at: t0 }],
    openQuestions: [],
  });
  expect(v).toMatchObject({ complete: false, backchannel: null, reasoning: "story mid-flight" });
  deps.llm.handlers.turn_judge = () => ({
    reasoning: "r",
    complete: false,
    open_questions: [],
    backchannel: "huh",
  });
  expect(
    (
      await judgeTurn(deps, {
        context: [],
        buffer: [{ text: "my boss called me in", at: t0 }],
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
    open_questions: [],
    backchannel: null,
    reasoning: "done",
    source: "model" as const,
    latencyMs: 5,
    error: null,
    promptVersion: "turn-judge@v1",
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
    prompt_version: "turn-judge@v1",
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
