/** The review's detector for time words left unlabelled in stored text. */
import { expect, test } from "vitest";
import { relativeWords } from "../../evals/lib/relative-words";

test("finds relative day words, lowercased", () => {
  expect(relativeWords("Sister visits tomorrow, coming Today.")).toEqual(["tomorrow", "today"]);
  expect(relativeWords("Interview on Thursday 8 January.")).toEqual([]);
});
