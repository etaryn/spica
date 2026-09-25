import { describe, expect, test } from "vitest";
import { assemblePrompt, emptyRetrieval, gapLine, relativeDate } from "@/core/chat/assemble";
import { splitParts } from "@/core/chat/parts";
import { resolveSessionId } from "@/core/chat/session";

const now = new Date("2026-01-12T12:00:00Z");
const base = { valuesDoc: "VALUES", egoLine: null, relationshipSummary: null, retrieval: emptyRetrieval(), now };

describe("resolveSessionId", () => {
  const prevAt = new Date("2026-01-12T11:30:00Z");
  const prev = { session_id: "s1", created_at: prevAt };
  test("same session at exactly the idle gap", () => {
    expect(resolveSessionId(prev, new Date(prevAt.getTime() + 30 * 60_000), 30, () => "new")).toBe("s1");
  });
  test("new session just past the gap", () => {
    expect(resolveSessionId(prev, new Date(prevAt.getTime() + 30 * 60_000 + 1), 30, () => "new")).toBe("new");
  });
  test("new session when there is no previous turn", () => {
    expect(resolveSessionId(null, now, 30, () => "new")).toBe("new");
  });
});

describe("assemblePrompt", () => {
  test("Phase 0: system is the values doc only; turns map to user/assistant", () => {
    const p = assemblePrompt({ ...base, recentTurns: [
      { role: "user", text: "hi" }, { role: "companion", text: "hey" }, { role: "user", text: "sup" },
    ] });
    expect(p.system).toBe("VALUES");
    expect(p.messages).toEqual([
      { role: "user", content: "hi" }, { role: "assistant", content: "hey" }, { role: "user", content: "sup" },
    ]);
  });

  test("drops leading companion turns (API requires the first message to be user)", () => {
    const p = assemblePrompt({ ...base, recentTurns: [
      { role: "companion", text: "orphan reply" }, { role: "user", text: "hi" },
    ] });
    expect(p.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  test("renders slots in fixed spec order and skips empty ones", () => {
    const p = assemblePrompt({
      ...base,
      egoLine: "You're a bit tired today.",
      relationshipSummary: "You've been friends for a month.",
      retrieval: {
        facts: {
          user: [{ content: "Their sister Mia starts university in October.", when: new Date("2026-01-11T12:00:00Z") }],
          self: [], shared: [],
        },
        dueThreads: [{ title: "job interview at Acme" }],
        recalled: [],
      },
      recentTurns: [{ role: "user", text: "hi" }],
    });
    const order = ["VALUES", "tired", "friends for a month", "Mia", "job interview"].map((s) => p.system.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(p.system).toContain("(yesterday)");
    expect(p.system).not.toContain("About you");
  });
});

describe("relativeDate", () => {
  test("buckets", () => {
    expect(relativeDate(new Date("2026-01-12T08:00:00Z"), now)).toBe("today");
    expect(relativeDate(new Date("2026-01-11T08:00:00Z"), now)).toBe("yesterday");
    expect(relativeDate(new Date("2026-01-08T08:00:00Z"), now)).toBe("4 days ago");
    expect(relativeDate(new Date("2025-12-20T08:00:00Z"), now)).toBe("3 weeks ago");
    expect(relativeDate(new Date("2025-10-01T08:00:00Z"), now)).toBe("3 months ago");
    expect(relativeDate(new Date("2026-01-20T08:00:00Z"), now)).toBe("in 8 days");
  });
});

describe("gapLine and due-thread detail", () => {
  const n = new Date("2026-01-12T12:00:00Z");
  test("gap buckets", () => {
    expect(gapLine(null, n, 24)).toBeNull();
    expect(gapLine(new Date("2026-01-12T01:00:00Z"), n, 24)).toBeNull();
    expect(gapLine(new Date("2026-01-11T10:00:00Z"), n, 24)).toBe("You last talked yesterday.");
    expect(gapLine(new Date("2026-01-04T12:00:00Z"), n, 24)).toBe("You last talked 8 days ago.");
    expect(gapLine(new Date("2025-12-01T12:00:00Z"), n, 24)).toBe("You last talked about 6 weeks ago.");
  });
  test("due threads render their latest detail", () => {
    const p = assemblePrompt({
      ...base, recentTurns: [{ role: "user", text: "hi" }],
      retrieval: { ...emptyRetrieval(), dueThreads: [{ title: "job interview at Acme", detail: "It was on Friday." }] },
    });
    expect(p.system).toContain("- job interview at Acme (latest: It was on Friday.)");
  });
});

describe("splitParts", () => {
  test("splits on blank lines and trims", () => {
    expect(splitParts("hey\n\n  how are you  ", 4)).toEqual(["hey", "how are you"]);
  });
  test("merges overflow into the last part", () => {
    expect(splitParts("a\n\nb\n\nc", 2)).toEqual(["a", "b\n\nc"]);
  });
  test("never returns empty", () => {
    expect(splitParts("single", 4)).toEqual(["single"]);
  });
});

describe("time-gap markers in the message window", () => {
  const at = (iso: string) => new Date(iso);
  test("the first user message after a gap of at least gapMarkerMinHours carries an elapsed-time marker", () => {
    const p = assemblePrompt({
      ...base, gapMarkerMinHours: 24,
      recentTurns: [
        { role: "user", text: "long day", created_at: at("2026-01-05T09:00:00Z") },
        { role: "companion", text: "oof", created_at: at("2026-01-05T09:00:05Z") },
        { role: "user", text: "and another thing", created_at: at("2026-01-05T09:02:00Z") },
        { role: "companion", text: "go on", created_at: at("2026-01-05T09:02:05Z") },
        { role: "user", text: "back again", created_at: at("2026-01-12T09:00:00Z") },
      ],
    });
    expect(p.messages.map((m) => m.content)).toEqual([
      "long day", "oof", "and another thing", "go on", "[7 days later] back again",
    ]);
  });
  test("no markers without created_at or below the threshold", () => {
    const p = assemblePrompt({ ...base, gapMarkerMinHours: 24, recentTurns: [
      { role: "user", text: "a", created_at: at("2026-01-05T09:00:00Z") },
      { role: "companion", text: "b", created_at: at("2026-01-05T20:00:00Z") },
      { role: "user", text: "c", created_at: at("2026-01-06T08:00:00Z") },
      { role: "user", text: "d" },
    ] });
    expect(p.messages.map((m) => m.content)).toEqual(["a", "b", "c", "d"]);
  });
});
