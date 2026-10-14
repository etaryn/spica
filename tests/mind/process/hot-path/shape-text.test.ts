import { expect, test } from "vitest";
import { shapeText } from "@/mind/process/hot-path/shape-text";
import { splitParts } from "@/mind/process/hot-path/split-parts";
import { wordCount } from "@/mind/process/hot-path/texting-shape";

const casual = { maxWords: 12, formal: false };
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

test("dashes become commas; capitals and the closing full stop go", () => {
  expect(shapeText("Hey Sam — week's been decent.", casual, 4)).toBe("hey sam, week's been decent");
  expect(shapeText("wait—what", casual, 4)).toBe("wait, what");
});

test("a formal user keeps capitals and full stops, but still loses dashes", () => {
  expect(shapeText("Hey Sam — week's been decent.", { ...casual, formal: true }, 4)).toBe(
    "Hey Sam, week's been decent.",
  );
});

test("acronyms, numbers, ranges, urls and ellipses survive", () => {
  const out = shapeText(
    "I read 3.5 chapters, maybe 3–5 more. GPS says example.com... ok.",
    casual,
    4,
  );
  expect(out).toContain("3.5");
  expect(out).toContain("3–5");
  expect(out).toContain("GPS");
  expect(out).toContain("example.com...");
  expect(out.startsWith("i read")).toBe(true);
});

test("a dash between numbers stays a range; a dash beside one number becomes a clean comma", () => {
  expect(shapeText("Takes 3 – 5 days.", casual, 4)).toBe("takes 3–5 days");
  expect(shapeText("From 2010 — 2015 I lived there.", casual, 4)).toBe(
    "from 2010—2015 i lived there",
  );
  expect(shapeText("I had 5 — no, 6 — cats.", casual, 4)).toBe("i had 5, no, 6, cats");
  expect(shapeText("maybe 3–5 more", casual, 4)).toBe("maybe 3–5 more");
});

test("a long bubble splits at sentence ends into bubbles that fit", () => {
  const text =
    "I watched an old film last night. It was slow but I loved it. The ending got me. Have you seen anything good lately?";
  const parts = splitParts(shapeText(text, { maxWords: 8, formal: false }, 4), 4);
  expect(parts.length).toBeGreaterThan(1);
  for (const p of parts) expect(wordCount(p)).toBeLessThanOrEqual(8);
});

test("one long sentence with no sentence end stays whole", () => {
  const text = "this is a very long single sentence that just keeps going and going with no stop";
  expect(splitParts(shapeText(text, { maxWords: 5, formal: false }, 4), 4)).toHaveLength(1);
});

test("overflow past max parts merges into the last bubble and keeps every word", () => {
  const text = ["One.", "Two.", "Three.", "Four.", "Five."].join("\n\n");
  const out = shapeText(text, casual, 3);
  expect(splitParts(out, 3)).toHaveLength(3);
  expect(words(out)).toEqual(words(text));
});

test("every word is kept, always", () => {
  const text =
    "Okay — no warmup, straight for the throat. What happened?\n\nI'm not gonna pretend it didn't land. Seriously.";
  expect(words(shapeText(text, { maxWords: 4, formal: false }, 4))).toEqual(words(text));
});

test("empty in, empty out", () => {
  expect(shapeText("", casual, 4)).toBe("");
});
