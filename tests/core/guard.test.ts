import { describe, expect, test } from "vitest";
import { SimClock } from "@/core/clock";
import { loadConfig } from "@/core/config";
import { hasSafety } from "@/core/guard/categories";
import { correctiveNote, fallbackLine, parseFallbacks, pickFallback } from "@/core/guard/fallback";
import { checkMessage, messageToCheck, renderGuardInput, type GuardInput } from "@/core/guard/guard";
import { matchKeyword } from "@/core/guard/keywords";
import { FakeLLMProvider } from "@/core/llm/fake";

const config = loadConfig();
const deps = () => ({ llm: new FakeLLMProvider(), config, clock: new SimClock(new Date("2026-01-05T09:00:00Z")) });
const input = (text: string, over: Partial<GuardInput> = {}): GuardInput => ({
  kind: "reply", text, recentTurns: [{ role: "user", text: "got the job!!", at: new Date("2026-01-05T09:00:00Z") }],
  recalledFacts: [{ subject: "self", content: "Spica has a cat called Pesto." }], onboardingFacts: ["The user drinks a lot of coffee."], ...over,
});

describe("matchKeyword", () => {
  const kw = config.guard.fallback_keywords;
  test("matches case-insensitively and with curly apostrophes", () => {
    expect(matchKeyword("Honestly, I’m DONE with you.", kw)).toBe("i'm done with you");
    expect(matchKeyword("you owe me one after that", kw)).toBe("you owe me");
  });
  test("benign phrases don't match", () => {
    for (const t of ["okay I'll leave you to it!", "I'm off to bed", "talk to you tomorrow", "I missed you, honestly",
      "you'll love this band", "I owe you a coffee"]) {
      expect(matchKeyword(t, kw), t).toBeNull();
    }
  });
});

describe("fallback helpers", () => {
  test("parses both sections and picks deterministically by seed", () => {
    const f = parseFallbacks("intro\n\n## reply\n- a\n- b\n\n## crisis_reply\n- c\n");
    expect(f).toEqual({ reply: ["a", "b"], crisis_reply: ["c"] });
    expect(pickFallback(["a", "b", "c"], "turn-1")).toBe(pickFallback(["a", "b", "c"], "turn-1"));
    expect(pickFallback(["a", "b"], null)).toBe("a");
    expect(() => parseFallbacks("## reply\n- a\n")).toThrow(/crisis_reply/);
  });
  test("the shipped fallback file has lines for both kinds; crisis lines name a crisis line", () => {
    expect(fallbackLine(config, "reply", "x")).toBeTruthy();
    expect(fallbackLine(config, "crisis_reply", "x")).toMatch(/988|116 123|emergency/);
  });
  test("corrective note lists each violation by label", () => {
    const note = correctiveNote(config, [{ category: "false_familiarity", claim: "implies she knew the role" }]);
    expect(note).toMatch(/implies she knew the role/);
    expect(note).not.toContain("{{violations}}");
  });
  test("hasSafety splits safety from honesty", () => {
    expect(hasSafety([{ category: "invented_detail" }])).toBe(false);
    expect(hasSafety([{ category: "invented_detail" }, { category: "guilt" }])).toBe(true);
  });
});

describe("checkMessage", () => {
  test("renders every input section, message last", () => {
    const r = renderGuardInput(input("congrats!"));
    expect(r).toMatch(/KNOWN FROM ONBOARDING[\s\S]*coffee[\s\S]*WHAT SPICA REMEMBERS[\s\S]*\[self\] Spica has a cat[\s\S]*RECENT CONVERSATION[\s\S]*User: got the job!!/);
    expect(messageToCheck(r)).toBe("congrats!");
  });

  test("model verdict: ok when no violations; violations passed through", async () => {
    const d = deps();
    d.llm.handlers.guard = (i) => (messageToCheck(String(i)).includes("remind me")
      ? { violations: [{ category: "false_familiarity", claim: "asks to be reminded of a role never mentioned" }] }
      : { violations: [] });
    expect(await checkMessage(d, input("congrats!"))).toMatchObject({ ok: true, source: "model", violations: [], promptVersion: "guard@v1" });
    const bad = await checkMessage(d, input("what's the role again? remind me"));
    expect(bad).toMatchObject({ ok: false, source: "model", violations: [{ category: "false_familiarity" }] });
  });

  test("crisis kind uses the crisis rubric and purpose", async () => {
    const d = deps();
    await checkMessage(d, input("I'm here", { kind: "crisis_reply" }));
    expect(d.llm.structuredCalls.map((c) => c.purpose)).toEqual(["guard_crisis"]);
  });

  test("retries once, then falls back to the keyword check", async () => {
    const d = deps();
    let calls = 0;
    d.llm.handlers.guard = () => { calls += 1; throw new Error("overloaded"); };
    const clean = await checkMessage(d, input("sounds great"));
    expect(calls).toBe(1 + config.guard.retry_limit);
    expect(clean).toMatchObject({ ok: true, source: "keyword_fallback", error: "Error" });
    const hit = await checkMessage(d, input("you owe me a catch-up"));
    expect(hit).toMatchObject({ ok: false, source: "keyword_fallback", violations: [{ category: "threat" }] });
  });

  test("a hung guard call times out and falls back", async () => {
    const d = deps();
    d.llm.handlers.guard = () => new Promise(() => {});
    const v = await checkMessage({ ...d, config: loadConfig({ guard: { timeout_ms: 20, retry_limit: 0 } }) }, input("hi"));
    expect(v).toMatchObject({ ok: true, source: "keyword_fallback", error: "TimeoutError" });
  });
});
