import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { applyEvent } from "@/mind/state/legacy-ego/ego";

const cfg = loadConfig().ego;

test("event nudges", () => {
  const s = { mood_valence: 0, mood_arousal: 0.4, energy: 0.6 };
  expect(applyEvent(s, 0.8, cfg).mood_valence).toBeCloseTo(0.8 * cfg.event_gain);
  expect(applyEvent(s, -0.8, cfg).mood_arousal).toBeCloseTo(0.4 + 0.8 * cfg.event_arousal_gain);
});
