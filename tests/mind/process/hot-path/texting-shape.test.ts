import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { bandFor, textingShape, wordCount } from "@/mind/process/hot-path/texting-shape";

const cfg = loadConfig().voice;
const short = ["lol", "omg no", "wait what", "nah", "ok cool", "same", "haha", "yeah"];
const long = [
  "I had the strangest day at work, my manager moved every meeting to the afternoon.",
  "Then the train was cancelled, so I walked home in the rain, which was honestly nice.",
  "Do you ever just enjoy getting caught in the rain? It feels like a reset button.",
  "Anyway, I made soup when I got home and now I am very warm and very sleepy.",
  "Tomorrow is going to be a lot, though. Three deadlines and a dentist appointment.",
  "I keep telling myself I will plan the week on Sunday and then I never actually do.",
  "What did you get up to today? I feel like I have been talking about myself a lot.",
  "Also I finally started that book you mentioned, the one with the lighthouse keeper.",
];

test("wordCount ignores emoji and stray punctuation", () => {
  expect(wordCount("omg no 😂")).toBe(2);
  expect(wordCount("😂 ??")).toBe(0);
});

test("a new user gets her base band", () => {
  const shape = textingShape([], cfg);
  expect(shape.band).toEqual(bandFor(cfg.base_words_per_bubble, cfg.bands));
  expect(shape.formal).toBe(false);
  expect(shape.emoji).toBe(false);
});

test("a short texter gets the shortest band, a long one the longest", () => {
  expect(textingShape(short, cfg).band.key).toBe(cfg.bands[0]!.key);
  expect(textingShape(long, cfg).band.key).toBe(cfg.bands.at(-1)!.key);
});

test("tidy writers read as formal; lowercase texters don't", () => {
  expect(textingShape(long, cfg).formal).toBe(true);
  expect(textingShape(short, cfg).formal).toBe(false);
});

test("phone autocapitals alone don't make a casual texter formal", () => {
  const autocapped = [
    "Yeah lol",
    "Ok sure",
    "Haha what",
    "No way",
    "Same",
    "Lol",
    "Wait what",
    "Nah",
  ];
  expect(textingShape(autocapped, cfg).formal).toBe(false);
});

test("one tidy message from a new user doesn't make them formal", () => {
  expect(textingShape(["Hello there."], cfg).formal).toBe(false);
});

test("emoji-only messages keep the base length and count as emoji", () => {
  const shape = textingShape(Array<string>(cfg.window_messages).fill("😂"), cfg);
  expect(shape.band).toEqual(bandFor(cfg.base_words_per_bubble, cfg.bands));
  expect(shape.emoji).toBe(true);
});

test("a band shift moves down a band and clamps at the ends", () => {
  const middle = cfg.bands[1]!;
  expect(bandFor(middle.max_words, cfg.bands, -1)).toEqual(cfg.bands[0]);
  expect(bandFor(1, cfg.bands, -5)).toEqual(cfg.bands[0]);
  expect(bandFor(10_000, cfg.bands, 5)).toEqual(cfg.bands.at(-1));
});

test("bands must ascend", () => {
  expect(() =>
    loadConfig({
      voice: {
        bands: [
          { key: "a", max_words: 9 },
          { key: "b", max_words: 3 },
        ],
      },
    }),
  ).toThrow();
});
