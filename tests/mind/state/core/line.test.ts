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
      {
        mood_valence: 0.1,
        mood_arousal: 0.4,
        energy: 0.5,
        emotion: null,
        needs: { autonomy: 0.6, competence: 0.6 },
      },
      c.core.state,
      phrases,
      "s",
      c.voice.feeling_max_lines,
    ),
  ).toBeNull();
  const line = coreStateLine(
    {
      mood_valence: 0.6,
      mood_arousal: 0.4,
      energy: 0.2,
      emotion: null,
      needs: { autonomy: 0.6, competence: 0.6 },
    },
    c.core.state,
    phrases,
    "s",
    c.voice.feeling_max_lines,
  )!;
  expect(phrases["energy low"]!.some((p) => line.includes(p))).toBe(true);
  expect(phrases["mood_valence high"]!.some((p) => line.includes(p))).toBe(true);
  expect(line).not.toMatch(/\d/);
});

test("the line is the same for every user at the same hour", async () => {
  const deps = makeTestDeps();
  await deps.core.state.ensure(
    { mood_valence: -0.9, mood_arousal: 0.9, energy: 0.1 },
    { autonomy: 0.6, competence: 0.6 },
  );
  const now = new Date("2026-01-05T11:20:00Z");
  expect(await loadCoreStateLine(deps, now)).toBe(await loadCoreStateLine(deps, now));
  expect(await loadCoreStateLine(deps, now)).not.toBeNull();
});

const calm = { mood_valence: 0.1, mood_arousal: 0.4, energy: 0.5 };

test("a current emotion is in the line, with what it's about", () => {
  const line = coreStateLine(
    {
      ...calm,
      needs: { autonomy: 0.6, competence: 0.6 },
      emotion: {
        label: "giddy",
        valence: 0.6,
        arousal: 0.7,
        phrase: "the telescope images",
        about: null,
        since: "2026-01-05T00:00:00Z",
      },
    },
    c.core.state,
    phrases,
    "s",
    c.voice.feeling_max_lines,
  )!;
  expect(line).toContain("giddy");
  expect(line).toContain("the telescope images");
});

test("a low need gets its phrase", () => {
  const line = coreStateLine(
    { ...calm, emotion: null, needs: { autonomy: 0.1, competence: 0.6 } },
    c.core.state,
    phrases,
    "s",
    c.voice.feeling_max_lines,
  )!;
  expect(phrases["autonomy low"]!.some((p) => line.includes(p))).toBe(true);
});

test("the line is capped, emotion first, then the state furthest past its band", () => {
  const line = coreStateLine(
    {
      mood_valence: -0.9,
      mood_arousal: 0.75,
      energy: 0.3,
      needs: { autonomy: 0.1, competence: 0.1 },
      emotion: {
        label: "flat",
        valence: -0.5,
        arousal: 0.2,
        phrase: null,
        about: null,
        since: "2026-01-05T00:00:00Z",
      },
    },
    c.core.state,
    phrases,
    "s",
    2,
  )!;
  expect(line.startsWith("You're feeling flat.")).toBe(true);
  expect(phrases["mood_valence low"]!.some((p) => line.includes(p))).toBe(true);
  expect(phrases["energy low"]!.some((p) => line.includes(p))).toBe(false);
});
