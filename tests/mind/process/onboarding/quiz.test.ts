import path from "node:path";
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  answersSchema,
  loadQuiz,
  normalizeAnswer,
  parseQuiz,
  type Quiz,
} from "@/mind/process/onboarding/quiz";

const ROOT = path.join(process.cwd(), "prompts");

function small(): Quiz {
  return parseQuiz({
    intro: "hi",
    no_common: "none",
    dimensions: [
      {
        id: "d",
        left: "L",
        right: "R",
        her: 70,
        basis: "b",
        click: "c",
        clash: "x",
        fact_left: "fl",
        fact_right: "fr",
        fact_middle: "fm",
      },
    ],
    questions: [
      {
        kind: "choice",
        id: "q1",
        prompt: "p",
        options: [
          { label: "a", weights: { d: -1 } },
          { label: "b", weights: { d: 1 } },
        ],
        her: 1,
      },
      {
        kind: "choice",
        id: "q2",
        prompt: "p",
        options: [
          { label: "a", weights: { d: -1 } },
          { label: "b", weights: { d: 1 } },
        ],
        her: 0,
      },
      {
        kind: "open",
        id: "o1",
        prompt: "p",
        max_words: 2,
        her: "old films",
        fact: "They like {answer}.",
        her_fact: "You like old films.",
      },
    ],
  });
}

test("the shipped v1 quiz loads and every config number validates", () => {
  const quiz = loadQuiz(loadConfig().onboarding.quiz_version, ROOT);
  expect(quiz.dimensions).toHaveLength(6);
  expect(quiz.questions.length).toBeGreaterThanOrEqual(10);
  expect(quiz.questions.length).toBeLessThanOrEqual(15);
});

test("rejects a dimension weighted by fewer than two questions", () => {
  const raw = structuredClone(small()) as unknown as { questions: { kind: string }[] };
  raw.questions = raw.questions.filter((q, i) => i !== 1);
  expect(() => parseQuiz(raw)).toThrow(/two questions/);
});

test("rejects her pick out of range, an unknown dimension and her open answer over the word limit", () => {
  const base = small();
  const pick = structuredClone(base);
  (pick.questions[0] as { her: number }).her = 5;
  expect(() => parseQuiz(pick)).toThrow(/her pick/);

  const unknown = structuredClone(base);
  (unknown.questions[0] as { options: { weights: Record<string, number> }[] }).options[0]!.weights =
    { nope: 1 };
  expect(() => parseQuiz(unknown)).toThrow(/unknown dimension/);

  const wordy = structuredClone(base);
  (wordy.questions[2] as { her: string }).her = "really old films";
  expect(() => parseQuiz(wordy)).toThrow(/words/);
});

test("answers: every question once, choice in range, open answers short and normalized", () => {
  const schema = answersSchema(small(), 40);
  expect(schema.parse({ q1: 0, q2: 1, o1: "  Old   Films " })).toEqual({
    q1: 0,
    q2: 1,
    o1: "Old Films",
  });
  expect(schema.safeParse({ q1: 0, q2: 1 }).success).toBe(false); // missing
  expect(schema.safeParse({ q1: 0, q2: 1, o1: "x", extra: 1 }).success).toBe(false);
  expect(schema.safeParse({ q1: 2, q2: 1, o1: "x" }).success).toBe(false); // out of range
  expect(schema.safeParse({ q1: 0, q2: 1, o1: "   " }).success).toBe(false); // blank
  expect(schema.safeParse({ q1: 0, q2: 1, o1: "one two three" }).success).toBe(false);
  expect(schema.safeParse({ q1: 0, q2: 1, o1: "a".repeat(41) }).success).toBe(false);
  expect(schema.safeParse({ q1: "0", q2: 1, o1: "x" }).success).toBe(false); // wrong type
});

test("normalizeAnswer trims and collapses whitespace", () => {
  expect(normalizeAnswer("  a \t b\n")).toBe("a b");
  // Invisible characters would otherwise pass as a word and store a blank answer.
  expect(normalizeAnswer("\u200b\u200d\ufeff")).toBe("");
  expect(normalizeAnswer("st\u200bars")).toBe("stars");
});
