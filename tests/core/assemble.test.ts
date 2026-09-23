import { describe, expect, test } from "vitest";
import { assemblePrompt, emptyRetrieval, relativeDate } from "@/core/chat/assemble";
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
