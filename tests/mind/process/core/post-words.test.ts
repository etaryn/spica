/** Her words for a post: from her public self and the find only, trimmed to fit, then checked. */
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { checkPost, cutAtWord, draftPost } from "@/mind/process/core/post-words";
import type { PublicPersona } from "@/mind/process/core/public-persona";

const config = loadConfig();
const persona: PublicPersona = {
  coreValues: "VALUES",
  publicVoice: "PUBLIC-VOICE",
  version: 1,
  lines: ["SURFACE-LINE"],
  today: { date: "2026-01-05", plan: null, happened: ["read a book"] },
};
const format = { name: "drift", caption_pattern: "PATTERN" };
const find = { title: "The Pillars", source: "apod", credit: "NASA" };

test("the draft call sees her public self, the find, the valence and the format; nothing else", async () => {
  const llm = new FakeLLMProvider();
  const out = await draftPost({ llm, config }, { persona, find, valence: 0.6, format, skill: 0.2 });
  expect(out?.caption.length).toBeGreaterThan(0);
  const [call] = llm.structuredCalls;
  expect(call!.purpose).toBe("post_draft");
  const seen = `${call!.system}\n${call!.input}`;
  for (const s of [
    "VALUES",
    "PUBLIC-VOICE",
    "SURFACE-LINE",
    "The Pillars",
    "0.60",
    "PATTERN",
    "0.20",
  ])
    expect(seen).toContain(s);
});

test("the draft and the check see what the find shows, when the feed says", async () => {
  const llm = new FakeLLMProvider();
  const shown = { ...find, description: "A dome under the Milky Way." };
  await draftPost({ llm, config }, { persona, find: shown, valence: 0.5, format, skill: 0 });
  await draftPost({ llm, config }, { persona, find, valence: 0.5, format, skill: 0 });
  const [withIt, without] = llm.structuredCalls.filter((c) => c.purpose === "post_draft");
  expect(withIt!.input).toContain("What it shows: A dome under the Milky Way.");
  expect(without!.input).not.toContain("What it shows");
  await checkPost({ llm, config }, { draft: { caption: "c" }, find: shown });
  expect(llm.structuredCalls.find((c) => c.purpose === "post_check")!.input).toContain(
    "What it shows: A dome under the Milky Way.",
  );
});

test("a two-line caption keeps its line break", async () => {
  const llm = new FakeLLMProvider();
  llm.handlers.post_draft = () => ({ caption: "one  line \n\n\n\n two" });
  const out = await draftPost({ llm, config }, { persona, find, valence: 0.5, format, skill: 0 });
  expect(out!.caption).toBe("one line\n\ntwo");
});

test("captions are trimmed to the limit; an empty one is no draft", async () => {
  const llm = new FakeLLMProvider();
  llm.handlers.post_draft = () => ({ caption: `  ${"x".repeat(500)}  ` });
  const out = await draftPost({ llm, config }, { persona, find, valence: 0.5, format, skill: 0 });
  expect(out!.caption.length).toBe(config.posts.caption_max_chars);
  llm.handlers.post_draft = () => ({ caption: "   " });
  expect(
    await draftPost({ llm, config }, { persona, find, valence: 0.5, format, skill: 0 }),
  ).toBeNull();
});

test("the check returns the model's verdict", async () => {
  const llm = new FakeLLMProvider();
  expect(await checkPost({ llm, config }, { draft: { caption: "hi" }, find })).toEqual({
    ok: true,
    reason: expect.any(String),
  });
  llm.handlers.post_check = () => ({ ok: false, reason: "mentions her mood" });
  expect(await checkPost({ llm, config }, { draft: { caption: "hi" }, find })).toEqual({
    ok: false,
    reason: "mentions her mood",
  });
  expect(llm.structuredCalls.at(-1)!.input).toContain("The Pillars");
});

test("a long caption is cut at the last whole word", () => {
  expect(cutAtWord("like they were trying to catch it", 26)).toBe("like they were trying to");
});

test("one long word still fits", () => {
  expect(cutAtWord("a".repeat(30), 10)).toBe("a".repeat(10));
});

test("short text is untouched", () => {
  expect(cutAtWord("short", 10)).toBe("short");
});

test("a line break counts as a word boundary", () => {
  expect(cutAtWord("first line\nsecondword", 15)).toBe("first line");
});
