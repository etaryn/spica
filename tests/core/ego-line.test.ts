import { expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { band, egoLine } from "@/core/ego/line";
import { loadPrompt } from "@/core/prompts";
import { parseSummaryPhrases } from "@/core/relationship/summary";

const c = loadConfig();
const phrases = parseSummaryPhrases(loadPrompt("ego/line", c.prompts.ego_line));

test("bands", () => {
  expect(band(0.2, [0.35, 0.7])).toBe("low");
  expect(band(0.5, [0.35, 0.7])).toBe("neutral");
  expect(band(0.7, [0.35, 0.7])).toBe("high");
});

test("neutral state → no line; non-neutral dimensions → one phrase each, no numbers", () => {
  expect(egoLine({ mood_valence: 0.1, mood_arousal: 0.4, energy: 0.5 }, c.ego, phrases, "s")).toBeNull();
  const line = egoLine({ mood_valence: 0.6, mood_arousal: 0.4, energy: 0.2 }, c.ego, phrases, "s")!;
  expect(phrases["energy low"]!.some((p) => line.includes(p))).toBe(true);
  expect(phrases["mood_valence high"]!.some((p) => line.includes(p))).toBe(true);
  expect(line).not.toMatch(/\d/);
});
