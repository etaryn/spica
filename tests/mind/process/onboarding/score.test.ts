import { expect, test } from "vitest";
import { ScriptedEmbedder } from "@/mind/platform/embedder/scripted";
import { parseQuiz, type Quiz } from "@/mind/process/onboarding/quiz";
import { cardView, commonTopics, positionOf, scoreCard } from "@/mind/process/onboarding/score";

const dim = (id: string, her: number) => ({
  id,
  left: `${id}-L`,
  right: `${id}-R`,
  her,
  basis: "b",
  click: `${id} click`,
  clash: `${id} clash`,
  fact_left: "fl",
  fact_right: "fr",
  fact_middle: "fm",
});
const choice = (id: string, weights: Record<string, number>[]) => ({
  kind: "choice",
  id,
  prompt: id,
  options: weights.map((w, i) => ({ label: `o${i}`, weights: w })),
  her: 0,
});
const open = (id: string, her: string) => ({
  kind: "open",
  id,
  prompt: `${id}?`,
  max_words: 2,
  her,
  fact: "{answer}",
  her_fact: her,
});

const quiz: Quiz = parseQuiz({
  intro: "i",
  no_common: "nothing in common. good, honestly.",
  dimensions: [dim("a", 90), dim("b", 50), dim("c", 10)],
  questions: [
    choice("q1", [{ a: -1 }, { a: 1 }, { a: 0, b: 1 }]),
    choice("q2", [{ a: -1 }, { a: 1 }]),
    choice("q3", [{ b: -1 }, { b: 1 }]),
    choice("q4", [{ c: -1 }, { c: 1 }]),
    choice("q5", [{ c: -1 }, { c: 1 }]),
    open("o1", "old films"),
    open("o2", "stargazing"),
  ],
});
const cfg = { click_gap: 20, clash_gap: 50 };

test("a position is the mean weight of the picks over the questions that weigh it", () => {
  const answers = { q1: 1, q2: 1, q3: 0, q4: 0, q5: 1, o1: "x", o2: "y" };
  expect(positionOf(quiz, answers, "a")).toBe(100);
  // q1 option 1 has no weight for b, so it counts as 0: mean(0, -1) = -0.5 -> 25
  expect(positionOf(quiz, answers, "b")).toBe(25);
  expect(positionOf(quiz, answers, "c")).toBe(50);
});

test("lines: click under click_gap, clash over clash_gap, nothing between", () => {
  const answers = { q1: 1, q2: 1, q3: 0, q4: 0, q5: 1, o1: "x", o2: "y" };
  const byId = Object.fromEntries(scoreCard(quiz, answers, cfg).map((d) => [d.id, d]));
  expect(byId.a).toMatchObject({ her: 90, you: 100, gap: 10, line: "a click" });
  expect(byId.b).toMatchObject({ you: 25, gap: 25, line: null });
  expect(byId.c).toMatchObject({ you: 50, gap: 40, line: null });
  const far = scoreCard(quiz, { ...answers, q4: 1, q5: 1 }, cfg).find((d) => d.id === "c")!;
  expect(far).toMatchObject({ you: 100, gap: 90, line: "c clash" });
});

test("topics: exact match ignores case and spacing; unrelated words never match", async () => {
  const embedder = new ScriptedEmbedder(1024); // unregistered texts are near-orthogonal
  const topics = await commonTopics(
    quiz,
    { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, o1: "Old  Films ", o2: "knitting" },
    embedder,
    0.6,
  );
  expect(topics).toEqual([{ yours: "Old  Films ", hers: "old films" }]);
});

test("topics: similar words count at or above the threshold", async () => {
  const embedder = new ScriptedEmbedder(1024)
    .set("astronomy", ScriptedEmbedder.near(1024, 3, 4, 0.7))
    .set("stargazing", ScriptedEmbedder.axis(1024, 3))
    .set("knitting", ScriptedEmbedder.near(1024, 3, 5, 0.5));
  const answers = { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, o1: "astronomy", o2: "knitting" };
  expect(await commonTopics(quiz, answers, embedder, 0.6)).toEqual([
    { yours: "astronomy", hers: "stargazing" },
  ]);
});

test("the results view shows both cards, and the no-common line only when nothing matched", () => {
  const answers = { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, o1: "knitting", o2: "chess" };
  const none = cardView(quiz, answers, [], cfg);
  expect(none.noCommon).toBe("nothing in common. good, honestly.");
  expect(none.hers).toEqual([
    { prompt: "o1?", answer: "old films" },
    { prompt: "o2?", answer: "stargazing" },
  ]);
  expect(none.yours).toEqual([
    { prompt: "o1?", answer: "knitting" },
    { prompt: "o2?", answer: "chess" },
  ]);
  const some = cardView(quiz, answers, [{ yours: "chess", hers: "stargazing" }], cfg);
  expect(some.noCommon).toBeNull();
  expect(some.dimensions).toHaveLength(3);
});
