import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  directiveMove,
  directiveOf,
  howToText,
  loadHowToTextPhrases,
} from "@/mind/process/hot-path/how-to-text";

const config = loadConfig();
const phrases = loadHowToTextPhrases(config);
const shape = { band: config.voice.bands[0]!, formal: false, emoji: false };

test("every band and move has a phrase", () => {
  for (const b of config.voice.bands) expect(phrases[`band ${b.key}`]?.length).toBeTruthy();
  for (const m of ["react", "share", "ask"]) expect(phrases[`move ${m}`]?.length).toBeTruthy();
  for (const k of ["more", "formal", "emoji", "answer"]) expect(phrases[k]?.length).toBeTruthy();
});

test("the directive phrases band and move in words, never numbers", () => {
  const text = howToText({ shape, move: "react", mustAnswer: false }, phrases);
  expect(text).toContain(phrases["band few"]![0]);
  expect(text).toContain(phrases["move react"]![0]);
  expect(text).not.toMatch(/\d/);
  expect(text).not.toContain(phrases.answer![0]);
});

test("a question to answer comes before the move; formal and emoji only when they apply", () => {
  const text = howToText(
    { shape: { ...shape, formal: true, emoji: true }, move: "share", mustAnswer: true },
    phrases,
  );
  expect(text.indexOf(phrases.answer![0]!)).toBeLessThan(text.indexOf(phrases["move share"]![0]!));
  expect(text).toContain(phrases.formal![0]);
  expect(text).toContain(phrases.emoji![0]);
});

test("a question to answer drops the react move, which would forbid answering with her news", () => {
  const text = howToText({ shape, move: "react", mustAnswer: true }, phrases);
  expect(text).toContain(phrases.answer![0]);
  expect(text).not.toContain(phrases["move react"]![0]);
});

test("no move: no move line (reach-outs)", () => {
  const text = howToText({ shape, move: null, mustAnswer: false }, phrases);
  for (const m of ["react", "share", "ask"]) expect(text).not.toContain(phrases[`move ${m}`]![0]);
});

test("the directive and its move read back out of a recorded prompt", () => {
  const directive = howToText({ shape, move: "ask", mustAnswer: false }, phrases);
  const prompt = `values\n\n## How to text this one\n${directive}\n\n## Why you're writing\nx`;
  expect(directiveOf(prompt)).toBe(directive);
  expect(directiveMove(directive, phrases)).toBe("ask");
  expect(directiveOf("no section here")).toBeNull();
});
