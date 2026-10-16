import path from "node:path";
import { expect, test } from "vitest";
import { cardFacts } from "@/mind/process/onboarding/card-facts";
import { loadQuiz } from "@/mind/process/onboarding/quiz";

const quiz = loadQuiz("v1", path.join(process.cwd(), "prompts"));
const cfg = { neutral_band: 15, salience: 0.5, max_name_chars: 60 };

/** Picks option `i` for every choice question and the given words for every open one. */
function answers(i: number, words: string[]) {
  let w = 0;
  return Object.fromEntries(
    quiz.questions.map((q) => [
      q.id,
      q.kind === "choice" ? Math.min(i, q.options.length - 1) : words[w++]!,
    ]),
  );
}

test("their card: name at full salience, one impression per dimension, one per open answer", () => {
  const facts = cardFacts(quiz, answers(0, ["chess", "jazz", "tea"]), "Sam", "woman", cfg);
  const theirs = facts.filter((f) => f.subject === "user");
  expect(theirs[0]).toEqual({
    subject: "user",
    kind: "trait",
    content: "Their name is Sam.",
    salience: 1,
  });
  // Name and gender come first, at full weight.
  const traits = theirs.filter((f) => f.kind === "trait").slice(2);
  expect(traits).toHaveLength(quiz.dimensions.length);
  expect(traits.every((f) => f.salience === 0.5)).toBe(true);
  expect(traits.map((f) => f.content)).toContain(
    "On their profile card they came across as more of a homebody.",
  );
  expect(theirs.filter((f) => f.kind === "preference").map((f) => f.content)).toEqual([
    "On their profile card they said they could talk about chess for hours.",
    "On their profile card they said they're into jazz lately.",
    "On their profile card they said their comfort thing is tea.",
  ]);
});

test("a middle score reads as somewhere between", () => {
  // Option 1 is the middle pick for most dimensions in v1.
  const facts = cardFacts(quiz, answers(1, ["a", "b", "c"]), "Sam", "woman", cfg);
  expect(facts.map((f) => f.content)).toContain(
    "On their profile card they came across as somewhere between easy banter and deep talk.",
  );
});

test("her card: one self fact per open question and per choice question that has one", () => {
  const facts = cardFacts(quiz, answers(0, ["a", "b", "c"]), "Sam", "woman", cfg);
  const hers = facts.filter((f) => f.subject === "self");
  const expected = quiz.questions.filter((q) => q.her_fact).map((q) => q.her_fact);
  expect(hers.map((f) => f.content)).toEqual(expected);
  expect(hers.every((f) => f.salience === 0.5)).toBe(true);
});

test("their name is trimmed and capped; a blank name writes no name fact", () => {
  const capped = { ...cfg, max_name_chars: 10 };
  const long = cardFacts(
    quiz,
    answers(0, ["a", "b", "c"]),
    `  ${"x".repeat(50)}  `,
    "woman",
    capped,
  );
  expect(long[0]!.content).toBe(`Their name is ${"x".repeat(10)}.`);
  const blank = cardFacts(quiz, answers(0, ["a", "b", "c"]), "   ", "woman", capped);
  expect(blank.some((f) => f.content.startsWith("Their name is"))).toBe(false);
});

test("an answer with $ patterns is stored as typed", () => {
  const facts = cardFacts(quiz, answers(0, ["$`$&", "b", "c"]), "Sam", "woman", cfg);
  expect(facts.map((f) => f.content)).toContain(
    "On their profile card they said they could talk about $`$& for hours.",
  );
});

test("their gender is a card fact at full weight, next to the name", () => {
  const facts = cardFacts(quiz, answers(0, ["a", "b", "c"]), "Sam", "unspecified", cfg);
  expect(facts[1]).toEqual({
    subject: "user",
    kind: "trait",
    content: "They didn't say their gender; use they/them for them.",
    salience: 1,
  });
});
