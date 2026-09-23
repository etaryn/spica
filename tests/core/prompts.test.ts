import { expect, test } from "vitest";
import { loadConfig } from "@/core/config";
import { loadPrompt } from "@/core/prompts";

test("loads the configured reply and classifier prompts", () => {
  const c = loadConfig();
  const reply = loadPrompt("reply", c.prompts.reply);
  expect(reply).toMatch(/at most one or two/i); // memory-use rule (spec §4.1 step 3)
  expect(reply).toMatch(/crisis|988|emergency/i); // crisis instruction
  expect(reply).toMatch(/AI/); // identity disclosure placeholder
  expect(loadPrompt("safety/crisis-classifier", c.prompts.crisis_classifier)).toMatch(/self_harm/);
});

test("rejects path traversal and reports missing prompts", () => {
  expect(() => loadPrompt("../package", "v1")).toThrow(/invalid/);
  expect(() => loadPrompt("reply", "v999")).toThrow(/prompts[\/]reply[\/]v999\.md/);
});
