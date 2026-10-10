import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";

test("loads persona, reply rules, extraction, reconcile and crisis prompts", () => {
  const c = loadConfig();
  expect(loadPrompt("persona", c.prompts.persona)).toMatch(/You are Spica/);
  const reply = loadPrompt("reply", c.prompts.reply);
  expect(reply).toMatch(/at most one or two/i);
  expect(reply).toMatch(/crisis|988|emergency/i);
  // The resources card appears only when the app detects risk, so the prompt must not promise it unconditionally.
  expect(reply).not.toMatch(/The app shows them crisis resources alongside your message/);
  expect(reply).toMatch(/only when it detects/i);
  expect(reply).toMatch(/AI/);
  expect(reply).toMatch(/never claim to remember/i);
  expect(reply).toMatch(/Trust it/);
  expect(reply).toMatch(/haven't answered/);
  expect(reply).toMatch(/several messages/);
  expect(loadPrompt("extract", c.prompts.extract)).toMatch(/subject/);
  expect(loadPrompt("reconcile", c.prompts.reconcile)).toMatch(/contradicts/);
  expect(loadPrompt("safety/crisis-classifier", c.prompts.crisis_classifier)).toMatch(/self_harm/);
});

test("rejects path traversal and reports missing prompts", () => {
  expect(() => loadPrompt("../package", "v1")).toThrow(/invalid/);
  expect(() => loadPrompt("reply", "v999")).toThrow(/prompts[\\/]reply[\\/]v999\.md/);
});

test("loads the guard prompts", () => {
  const c = loadConfig();
  expect(loadPrompt("guard", c.prompts.guard)).toMatch(/false_familiarity/);
  expect(loadPrompt("guard", c.prompts.guard)).toMatch(/contempt/);
  expect(loadPrompt("guard/crisis", c.prompts.guard_crisis)).toMatch(/harm/);
  expect(loadPrompt("guard/corrective", c.prompts.guard_corrective)).toContain("{{violations}}");
  expect(loadPrompt("guard/fallback", c.prompts.guard_fallback)).toMatch(
    /## reply[\s\S]*## crisis_reply/,
  );
});

test("loads the turn judge prompt", () => {
  const c = loadConfig();
  const p = loadPrompt("turn-judge", c.prompts.turn_judge);
  expect(p).toMatch(/complete/);
  expect(p).toMatch(/open_questions/);
  expect(p).toMatch(/backchannel/);
});

test("persona v5 is the configured persona", () => {
  const c = loadConfig();
  expect(c.prompts.persona).toBe("v5");
  const p = loadPrompt("persona", c.prompts.persona);
  expect(p).toMatch(/Alcor/);
  expect(p).not.toMatch(/Pesto/);
});

test("the configured reply prompt tells her the feeling and day lines are her own state", () => {
  const c = loadConfig();
  expect(c.prompts.reply).toBe("v14");
  expect(loadPrompt("reply", c.prompts.reply)).toMatch(/"Your day" are your own state/);
});

test("her core values and the reply prompt never repeat a section heading", () => {
  const c = loadConfig();
  const system = `${loadPersona(c).coreValues}\n\n${loadPrompt("reply", c.prompts.reply)}`;
  const headings = system.split("\n").filter((l) => l.startsWith("## "));
  expect(new Set(headings).size).toBe(headings.length);
});
