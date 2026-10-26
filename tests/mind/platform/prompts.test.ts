import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { loadPersona } from "@/mind/platform/persona";
import { loadPrompt } from "@/mind/platform/prompts";

test("loads persona, reply rules, extraction, reconcile and crisis prompts", () => {
  const c = loadConfig();
  expect(loadPrompt("persona", c.prompts.persona)).toMatch(/You are Spica/);
  const reply = loadPrompt("reply", c.prompts.reply);
  expect(reply).toMatch(/at most one memory/i);
  expect(reply).toMatch(/crisis|988|emergency/i);
  // The resources card appears only when the app detects risk, so the prompt must not promise it unconditionally.
  expect(reply).not.toMatch(/The app shows them crisis resources alongside your message/);
  expect(reply).toMatch(/only when it detects/i);
  expect(reply).toMatch(/AI/);
  expect(reply).toMatch(/never claim to remember/i);
  expect(reply).toMatch(/Trust it/);
  expect(reply).toMatch(/haven't answered/);
  expect(reply).toMatch(/several messages/);
  expect(loadPrompt("labels", c.prompts.labels)).toMatch(/subject/);
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
  expect(loadPrompt("guard/fallback", c.prompts.guard_fallback)).toMatch(
    /## reply[\s\S]*## crisis_reply/,
  );
});

test("loads the turn judge prompt", () => {
  const c = loadConfig();
  const p = loadPrompt("turn-judge", c.prompts.turn_judge);
  expect(p).toMatch(/complete/);
  expect(p).toMatch(/still_open/);
  expect(p).toMatch(/asked/);
  expect(p).toMatch(/backchannel/);
});

test("persona v7 is the configured persona", () => {
  const c = loadConfig();
  expect(c.prompts.persona).toBe("v7");
  const p = loadPrompt("persona", c.prompts.persona);
  expect(p).toMatch(/Alcor/);
  expect(p).not.toMatch(/Pesto/);
  // Her digital body: no sleep and no meeting in person, so neither reads as invented.
  expect(p).toMatch(/can't meet anyone in person/);
});

test("the configured reply prompt tells her the feeling and day lines are her own state", () => {
  const c = loadConfig();
  expect(c.prompts.reply).toBe("v19");
  expect(loadPrompt("reply", c.prompts.reply)).toMatch(/"Your day" are your own state/);
});

test("her core values and the reply prompt never repeat a section heading", () => {
  const c = loadConfig();
  const system = `${loadPersona(c).coreValues}\n\n${loadPrompt("reply", c.prompts.reply)}`;
  const headings = system.split("\n").filter((l) => l.startsWith("## "));
  expect(new Set(headings).size).toBe(headings.length);
});

test("her user-mind prompts take stock plainly and keep plans and pronouns honest", () => {
  const c = loadConfig();
  for (const [name, version] of [
    ["user-mind/summarise", c.prompts.user_summarise],
    ["user-mind/reflect", c.prompts.user_reflect],
    ["user-mind/model", c.prompts.user_model],
    ["user-mind/ideate", c.prompts.user_ideate],
  ] as const) {
    const p = loadPrompt(name, version);
    expect(p).not.toMatch(/something important just happened/);
    expect(p).toMatch(/hasn't happened until a memory says it did/);
    expect(p).toMatch(/they\/them/);
  }
});

test("reply v18 uses the card's pronouns and names or they for everyone else", () => {
  const c = loadConfig();
  expect(loadPrompt("reply", c.prompts.reply)).toMatch(/use their name or they\/them/);
});

test("labels v1 labels pieces in layers and never asks for a date", () => {
  const p = loadPrompt("labels", "v1");
  for (const section of [
    "## moves",
    "## mentions",
    "## times",
    "## propositions",
    "## threads",
    "## idiolect",
    "## relationship",
    "## intimacy",
    "## bid_response",
  ]) {
    expect(p).toContain(section);
  }
  expect(p).toMatch(/replies_to/);
  expect(p).toMatch(/Never work out a date/);
  expect(p).not.toMatch(/when_direction/);
  // A correction or repeat still makes a memory, and a memory's times come from its own moves.
  expect(p).toMatch(/a correction is stored as the corrected version/);
  expect(p).toMatch(/A proposition's times come from the words its own moves cover/);
});
