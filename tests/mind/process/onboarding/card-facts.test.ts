import path from "node:path";
import { expect, test } from "vitest";
import { cardFacts } from "@/mind/process/onboarding/card-facts";
import { loadQuiz } from "@/mind/process/onboarding/quiz";

const quiz = loadQuiz("v1", path.join(process.cwd(), "prompts"));
const cfg = { neutral_band: 15, salience: 0.5 };

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
  const facts = cardFacts(quiz, answers(0, ["chess", "jazz", "tea"]), "Sam", cfg);
  const theirs = facts.filter((f) => f.subject === "user");
  expect(theirs[0]).toEqual({
    subject: "user",
    kind: "trait",
    content: "Their name is Sam.",
    salience: 1,
  });
  const traits = theirs.filter((f) => f.kind === "trait").slice(1);
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
  const facts = cardFacts(quiz, answers(1, ["a", "b", "c"]), "Sam", cfg);
  expect(facts.map((f) => f.content)).toContain(
    "On their profile card they came across as somewhere between easy banter and deep talk.",
  );
});

test("her card: one self fact per open question and per choice question that has one", () => {
  const facts = cardFacts(quiz, answers(0, ["a", "b", "c"]), "Sam", cfg);
  const hers = facts.filter((f) => f.subject === "self");
  const expected = quiz.questions.filter((q) => q.her_fact).map((q) => q.her_fact);
  expect(hers.map((f) => f.content)).toEqual(expected);
  expect(hers.every((f) => f.salience === 0.5)).toBe(true);
});
