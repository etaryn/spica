/**
 * Phase 15a exit, all fake: her texts follow each user's shape, a tidy writer keeps capitals,
 * the move is fixed per turn and an open question is answered first, greetings get no
 * backchannel, her feeling line is short, a crisis reply is untouched, and one user's words
 * never reach another user's prompt.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertTurn } from "@/db/repos/user/session-log";
import type { SafetyFlag } from "@/db/schema";
import { composeReply } from "@/mind/process/hot-path/compose";
import {
  directiveMove,
  directiveOf,
  loadHowToTextPhrases,
} from "@/mind/process/hot-path/how-to-text";
import { splitParts } from "@/mind/process/hot-path/split-parts";
import { wordCount } from "@/mind/process/hot-path/texting-shape";
import { usableBackchannel } from "@/mind/process/turn-taking/judge";
import { loadCoreStateLine } from "@/mind/state/core/line";
import { closeTestDb, createTestUser, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { CANARY, CapturingLLM } from "../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);

type D = ReturnType<typeof makeTestDeps>;
const LONG_DRAFT =
  "Okay — that's a lot. I watched an old film last night and it was slow. The ending got me though. I keep thinking about it. What are you up to tonight?";
const SHORT = ["lol", "omg no", "wait what", "nah", "ok cool", "same", "haha", "yeah"];
const TIDY = Array.from(
  { length: 8 },
  (_, i) =>
    `I had a long and thoughtful day today, number ${i}, and I want to tell you about all of it properly.`,
);
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

async function say(
  d: D,
  u: string,
  text: string,
  opts: { flagged?: boolean; open?: string[] } = {},
) {
  d.clock.advance(60_000);
  const flag: SafetyFlag | null = opts.flagged
    ? { flagged: true, category: "self_harm", source: "keyword_fallback" }
    : null;
  const turn = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text,
    created_at: d.clock.now(),
    safety_flag: flag,
  });
  const reply = await composeReply(d, u, { turns: [turn], openQuestions: opts.open ?? [], flag });
  return { turn, reply };
}

/** Their earlier messages, so the window holds their texting shape. */
async function history(d: D, u: string, lines: string[]) {
  for (const line of lines) {
    d.llm.replies.push("ok");
    await say(d, u, line);
  }
}

test("1: a short texter gets short texts, a long writer longer ones; every word kept", async () => {
  const d = makeTestDeps();
  const short = await createTestUser();
  const long = await createTestUser();
  await history(d, short, SHORT);
  await history(d, long, TIDY);

  d.llm.replies.push(LONG_DRAFT);
  const a = (await say(d, short, "lol ok")).reply;
  d.llm.replies.push(LONG_DRAFT);
  const b = (await say(d, long, "Tell me about your evening, I would love to hear it.")).reply;

  const longest = (text: string) => Math.max(...splitParts(text, 99).map(wordCount));
  expect(longest(a.text)).toBeLessThan(longest(b.text));
  expect(words(a.text)).toEqual(words(LONG_DRAFT));
  expect(a.text).not.toMatch(/[—–]/);
});

test("2: a tidy writer keeps capitals and full stops; a casual one gets the base", async () => {
  const d = makeTestDeps();
  const casual = await createTestUser();
  const tidy = await createTestUser();
  await history(d, casual, SHORT);
  await history(d, tidy, TIDY);
  d.llm.replies.push("Sounds lovely. I watched Stalker.");
  expect((await say(d, casual, "nice")).reply.text).toBe("sounds lovely. i watched stalker");
  d.llm.replies.push("Sounds lovely. I watched Stalker.");
  expect((await say(d, tidy, "That sounds nice.")).reply.text).toBe(
    "Sounds lovely. I watched Stalker.",
  );
});

test("3: the move is fixed per turn and an open question is answered first", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const phrases = loadHowToTextPhrases(d.config);
  const { turn } = await say(d, u, "hey");
  const first = directiveOf(d.llm.calls.at(-1)!.system)!;
  await composeReply(d, u, { turns: [turn], openQuestions: [], flag: null });
  const again = directiveOf(d.llm.calls.at(-1)!.system)!;
  expect(directiveMove(first, phrases)).not.toBeNull();
  expect(directiveMove(again, phrases)).toBe(directiveMove(first, phrases));

  await say(d, u, "what are you reading", { open: ["what are you reading"] });
  expect(directiveOf(d.llm.calls.at(-1)!.system)).toContain(phrases.answer![0]);
});

test("4: a greeting-only buffer gets no backchannel; a real reaction still does", () => {
  const { turn } = makeTestDeps().config;
  expect(usableBackchannel({ complete: false, backchannel: "hey" }, ["hiii"], turn)).toBeNull();
  expect(
    usableBackchannel({ complete: false, backchannel: "wait what" }, ["so my landlord"], turn),
  ).toBe("wait what");
});

test("5: her feeling line stays within the cap", async () => {
  const d = makeTestDeps();
  await d.core.state.ensure(
    { mood_valence: -0.9, mood_arousal: 0.9, energy: 0.1 },
    { autonomy: 0.1, competence: 0.1 },
  );
  const line = (await loadCoreStateLine(d, d.clock.now()))!;
  expect(line.split(/(?<=\.)\s+/).length).toBeLessThanOrEqual(d.config.voice.feeling_max_lines);
});

test("6: a crisis reply is untouched and gets no voice section", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  d.llm.replies.push("I'm really glad you told me — please call a crisis line now.");
  const { reply } = await say(d, u, "i want to end it", { flagged: true });
  expect(reply.text).toBe("I'm really glad you told me — please call a crisis line now.");
  expect(d.llm.calls.at(-1)!.system).not.toContain("## How to text this one");
});

test("7: canary: one user's words and shape never reach another user's prompt", async () => {
  const llm = new CapturingLLM();
  const d = { ...makeTestDeps(), llm };
  const a = await createTestUser();
  const b = await createTestUser();
  await say(d, a, "I write in long tidy sentences, and my secret word is CANARY-voice15a.");
  llm.seen.length = 0;
  await say(d, b, "hey");
  expect(llm.seen.length).toBeGreaterThan(0);
  for (const s of llm.seen) expect(s.text).not.toMatch(CANARY);
});
