/** Her words for a post: from her public self and the find only, trimmed to fit, then checked. */
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import type { StillFormat } from "@/mind/process/core/post-library";
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
const format = {
  name: "plain",
  medium: "still",
  min_skill: 0,
  aspect: "4:5",
  frame: "none",
  placement: { side: "auto", scale: [0.4, 0.5] },
  poses: ["walking"],
  overlay: { kind: "none", position: "bottom", style: "plain" },
  grain: 0,
  caption_pattern: "PATTERN",
  reviewed: true,
} satisfies StillFormat;
const find = { title: "The Pillars", source: "apod", credit: "NASA" };

test("the draft call sees her public self, the find, the valence and the format; nothing else", async () => {
  const llm = new FakeLLMProvider();
  const out = await draftPost({ llm, config }, { persona, find, valence: 0.6, format, skill: 0.2 });
  expect(out?.caption.length).toBeGreaterThan(0);
  expect(out?.overlay_text).toBeNull();
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

test("the draft and the check see what the picture shows, when the feed says", async () => {
  const llm = new FakeLLMProvider();
  const shown = { ...find, description: "A dome under the Milky Way." };
  await draftPost({ llm, config }, { persona, find: shown, valence: 0.5, format, skill: 0 });
  await draftPost({ llm, config }, { persona, find, valence: 0.5, format, skill: 0 });
  const [withIt, without] = llm.structuredCalls.filter((c) => c.purpose === "post_draft");
  expect(withIt!.input).toContain("What it shows: A dome under the Milky Way.");
  expect(without!.input).not.toContain("What it shows");
  await checkPost({ llm, config }, { draft: { caption: "c", overlay_text: null }, find: shown });
  expect(llm.structuredCalls.find((c) => c.purpose === "post_check")!.input).toContain(
    "What it shows: A dome under the Milky Way.",
  );
});

test("a two-line caption keeps its line break", async () => {
  const llm = new FakeLLMProvider();
  llm.handlers.post_draft = () => ({ caption: "one  line \n\n\n\n two", overlay_text: null });
  const out = await draftPost({ llm, config }, { persona, find, valence: 0.5, format, skill: 0 });
  expect(out!.caption).toBe("one line\n\ntwo");
});

test("captions and overlays are trimmed; an overlay is dropped when the format has none", async () => {
  const llm = new FakeLLMProvider();
  llm.handlers.post_draft = () => ({
    caption: `  ${"x".repeat(500)}  `,
    overlay_text: "y".repeat(200),
  });
  const none = await draftPost({ llm, config }, { persona, find, valence: 0.5, format, skill: 0 });
  expect(none!.caption.length).toBe(config.posts.caption_max_chars);
  expect(none!.overlay_text).toBeNull();
  const label = { ...format, overlay: { ...format.overlay, kind: "label" as const } };
  const withText = await draftPost(
    { llm, config },
    { persona, find, valence: 0.5, format: label, skill: 0 },
  );
  expect(withText!.overlay_text!.length).toBe(config.posts.overlay_max_chars);
  llm.handlers.post_draft = () => ({ caption: "   ", overlay_text: null });
  expect(
    await draftPost({ llm, config }, { persona, find, valence: 0.5, format, skill: 0 }),
  ).toBeNull();
});

test("the check returns the model's verdict", async () => {
  const llm = new FakeLLMProvider();
  expect(
    await checkPost({ llm, config }, { draft: { caption: "hi", overlay_text: null }, find }),
  ).toEqual({
    ok: true,
    reason: expect.any(String),
  });
  llm.handlers.post_check = () => ({ ok: false, reason: "mentions her mood" });
  expect(
    await checkPost({ llm, config }, { draft: { caption: "hi", overlay_text: null }, find }),
  ).toEqual({ ok: false, reason: "mentions her mood" });
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
