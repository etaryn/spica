import { afterAll, beforeEach, expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { loadPrompt } from "@/mind/platform/prompts";
import { parseSummaryPhrases } from "@/mind/platform/phrases";
import { band, coreStateLine, loadCoreStateLine } from "@/mind/state/core/line";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const c = loadConfig();
const phrases = parseSummaryPhrases(loadPrompt("core-state/line", c.prompts.core_state_line));

test("bands", () => {
  expect(band(0.2, [0.35, 0.7])).toBe("low");
  expect(band(0.5, [0.35, 0.7])).toBe("neutral");
  expect(band(0.7, [0.35, 0.7])).toBe("high");
});

test("neutral state → no line; non-neutral dimensions → one phrase each, no numbers", () => {
  expect(
    coreStateLine(
      { mood_valence: 0.1, mood_arousal: 0.4, energy: 0.5 },
      c.core.state,
      phrases,
      "s",
    ),
  ).toBeNull();
  const line = coreStateLine(
    { mood_valence: 0.6, mood_arousal: 0.4, energy: 0.2 },
    c.core.state,
    phrases,
    "s",
  )!;
  expect(phrases["energy low"]!.some((p) => line.includes(p))).toBe(true);
  expect(phrases["mood_valence high"]!.some((p) => line.includes(p))).toBe(true);
  expect(line).not.toMatch(/\d/);
});

test("the line is the same for every user at the same hour", async () => {
  const deps = makeTestDeps();
  await deps.core.state.ensure({ mood_valence: -0.9, mood_arousal: 0.9, energy: 0.1 });
  const now = new Date("2026-01-05T11:20:00Z");
  expect(await loadCoreStateLine(deps, now)).toBe(await loadCoreStateLine(deps, now));
  expect(await loadCoreStateLine(deps, now)).not.toBeNull();
});
