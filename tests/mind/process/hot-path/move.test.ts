import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { bandShiftOf, biasesFor, moodKeys, pickMove } from "@/mind/process/hot-path/move";

const config = loadConfig();
const weights = config.voice.moves.weights;

test("the same seed always picks the same move", () => {
  for (const seed of ["a", "b", "c", "turn-1"])
    expect(pickMove(seed, weights, [])).toBe(pickMove(seed, weights, []));
});

test("over many seeds every move shows up roughly by weight", () => {
  const counts = { react: 0, share: 0, ask: 0 };
  // Real seeds are turn ids, so the test draws uuid-like ones.
  const seed = (i: number) => `move:${createHash("sha1").update(String(i)).digest("hex")}`;
  for (let i = 0; i < 3000; i++) counts[pickMove(seed(i), weights, [])] += 1;
  const total = weights.react + weights.share + weights.ask;
  for (const m of ["react", "share", "ask"] as const)
    expect(Math.abs(counts[m] / 3000 - weights[m] / total)).toBeLessThan(0.05);
});

test("a bias that zeroes a move removes it", () => {
  for (let i = 0; i < 200; i++)
    expect(pickMove(`s${i}`, weights, [{ share: 0, ask: 0 }])).toBe("react");
});

test("all weights zero falls back to react", () => {
  expect(pickMove("x", { react: 0, share: 0, ask: 0 }, [])).toBe("react");
});

test("mood keys: her core bands, neutral ones left out", () => {
  const keys = moodKeys({ energy: 0.1, mood_valence: 0.6, mood_arousal: 0.5 }, null, config);
  expect(keys).toEqual(expect.arrayContaining(["energy low", "mood_valence high"]));
  expect(keys).not.toContain("mood_arousal high");
});

test("biases and band shift come from config by key", () => {
  const biases = biasesFor(["energy low", "nonsense"], config.voice);
  expect(biases).toHaveLength(1);
  expect(bandShiftOf(biases)).toBe(-1);
});
