import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { howToText, loadHowToTextPhrases } from "@/mind/process/hot-path/how-to-text";
import { moveFollowed, renderVoiceReport, voiceStats } from "../../evals/lib/voice-report";

const config = loadConfig();
const phrases = loadHowToTextPhrases(config);

test("stats count the tells of written-not-texted", () => {
  const s = voiceStats("Hey Sam — week's been decent.\n\n(slow clap) how's yours?");
  expect(s.words).toEqual([5, 4]);
  expect(s.dashes).toBe(1);
  expect(s.capitals).toBe(2);
  expect(s.endStops).toBe(1);
  expect(s.endsInQuestion).toBe(true);
  expect(s.stageDirections).toBe(1);
});

test("move followed: ask has a question, react and share don't end on one", () => {
  expect(moveFollowed("ask", "what are you reading?")).toBe(true);
  expect(moveFollowed("react", "lol no")).toBe(true);
  expect(moveFollowed("react", "lol what happened?")).toBe(false);
  expect(moveFollowed("share", "i watched stalker last night")).toBe(true);
  expect(moveFollowed("share", "nice")).toBe(false);
});

test("the report lists each reply with its directive and totals", () => {
  const directive = howToText(
    {
      shape: { band: config.voice.bands[0]!, formal: false, emoji: false },
      move: "react",
      mustAnswer: false,
    },
    phrases,
  );
  const text = renderVoiceReport(
    [{ prompt: `x\n\n## How to text this one\n${directive}`, draft: "Lol no." }],
    ["lol no"],
    phrases,
  ).join("\n");
  expect(text).toContain("### Voice");
  expect(text).toContain("band few");
  expect(text).toContain("move react (followed)");
  expect(text).toContain("totals");
});
