import { describe, expect, test } from "vitest";
import {
  assemblePrompt as assembleBlocks,
  gapLine,
  relationshipLine,
} from "@/mind/process/hot-path/assemble";
import { systemText } from "@/mind/platform/llm/types";
import { relativeDate } from "@/mind/platform/relative-date";
import { emptyRetrieval } from "@/mind/memory/shared/types";
import { splitParts } from "@/mind/process/hot-path/split-parts";
import { resolveSessionId } from "@/mind/process/receive/session";

const now = new Date("2026-01-12T12:00:00Z");
const base = {
  valuesDoc: "VALUES",
  snapshot: null,
  coreMemories: [],
  feelingLine: null,
  relationshipSummary: null,
  retrieval: emptyRetrieval(),
  now,
  timezone: "UTC",
};

describe("resolveSessionId", () => {
  const prevAt = new Date("2026-01-12T11:30:00Z");
  const prev = { session_id: "s1", created_at: prevAt };
  test("same session at exactly the idle gap", () => {
    expect(resolveSessionId(prev, new Date(prevAt.getTime() + 30 * 60_000), 30, () => "new")).toBe(
      "s1",
    );
  });
  test("new session just past the gap", () => {
    expect(
      resolveSessionId(prev, new Date(prevAt.getTime() + 30 * 60_000 + 1), 30, () => "new"),
    ).toBe("new");
  });
  test("new session when there is no previous turn", () => {
    expect(resolveSessionId(null, now, 30, () => "new")).toBe("new");
  });
});

/** The prompt with its system blocks joined, the way the model reads it. */
function assemblePrompt(input: Parameters<typeof assembleBlocks>[0]) {
  const p = assembleBlocks(input);
  return { ...p, system: systemText(p.system) };
}

describe("assemblePrompt", () => {
  test("values and snapshot are the cached prefix; everything else follows uncached", () => {
    const p = assembleBlocks({
      ...base,
      snapshot: "SNAP",
      feelingLine: "FEEL",
      recentTurns: [{ role: "user", text: "hi" }],
    });
    expect(p.system).toEqual([
      { text: "VALUES\n\n## Who you are lately\nSNAP", cache: true },
      { text: "## How you're feeling\nFEEL" },
    ]);
  });

  test("system is the values doc only; turns map to user/assistant", () => {
    const p = assemblePrompt({
      ...base,
      recentTurns: [
        { role: "user", text: "hi" },
        { role: "companion", text: "hey" },
        { role: "user", text: "sup" },
      ],
    });
    expect(p.system).toBe("VALUES");
    expect(p.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hey" },
      { role: "user", content: "sup" },
    ]);
  });

  test("drops leading companion turns (API requires the first message to be user)", () => {
    const p = assemblePrompt({
      ...base,
      recentTurns: [
        { role: "companion", text: "orphan reply" },
        { role: "user", text: "hi" },
      ],
    });
    expect(p.messages).toEqual([{ role: "user", content: "hi" }]);
  });

  test("renders slots in fixed slot order and skips empty ones", () => {
    const p = assemblePrompt({
      ...base,
      feelingLine: "You're a bit tired today.",
      relationshipSummary: "You've been friends for a month.",
      retrieval: {
        facts: {
          user: [
            {
              id: "f1",
              content: "Their sister Mia starts university in October.",
              when: new Date("2026-01-11T12:00:00Z"),
            },
          ],
          self: [],
          shared: [],
        },
        dueThreads: [{ id: "t1", title: "job interview at Acme" }],
        recalled: [],
      },
      recentTurns: [{ role: "user", text: "hi" }],
    });
    const order = ["VALUES", "tired", "friends for a month", "Mia", "job interview"].map((s) =>
      p.system.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(p.system).toContain("(yesterday)");
    expect(p.system).not.toContain("### About you");
  });
});

describe("the summary section", () => {
  test("her read on them follows the summary, three lines", () => {
    const { system } = assemblePrompt({
      ...base,
      summary: { where_things_stand: "Stand.", whats_live: "Live.", how_i_feel: "Feel." },
      read: { how_they_are: "Tired.", what_they_want: "Space.", what_lands: "Jokes." },
      recentTurns: [{ role: "user", text: "hi" }],
    });
    const i = system.indexOf(
      "## Your read on them\n- How they are: Tired.\n- What they want: Space.\n- What lands: Jokes.",
    );
    expect(i).toBeGreaterThan(system.indexOf("## Where things stand with them"));
    expect(assemblePrompt({ ...base, read: null, recentTurns: [] }).system).not.toContain(
      "Your read on them",
    );
  });
  test("sits between you-and-them and what you remember", () => {
    const { system } = assemblePrompt({
      ...base,
      relationshipSummary: "You're close.",
      summary: { where_things_stand: "Stand.", whats_live: "Live.", how_i_feel: "Feel." },
      retrieval: {
        facts: {
          user: [{ id: "f1", content: "Likes tea.", when: new Date("2026-01-11T12:00:00Z") }],
          self: [],
          shared: [],
        },
        dueThreads: [],
        recalled: [],
      },
      recentTurns: [{ role: "user", text: "hi" }],
    });
    const i = system.indexOf("## Where things stand with them\n- Stand.\n- Live.\n- Feel.");
    expect(i).toBeGreaterThan(system.indexOf("## You and them"));
    expect(i).toBeLessThan(system.indexOf("## What you remember"));
  });

  test("no summary, no section", () => {
    expect(assemblePrompt({ ...base, summary: null, recentTurns: [] }).system).not.toContain(
      "Where things stand",
    );
  });
});

describe("relativeDate", () => {
  test("buckets", () => {
    expect(relativeDate(new Date("2026-01-12T08:00:00Z"), now, "UTC")).toBe("today");
    expect(relativeDate(new Date("2026-01-11T08:00:00Z"), now, "UTC")).toBe("yesterday");
    expect(relativeDate(new Date("2026-01-08T08:00:00Z"), now, "UTC")).toBe("4 days ago");
    expect(relativeDate(new Date("2025-12-20T08:00:00Z"), now, "UTC")).toBe("3 weeks ago");
    expect(relativeDate(new Date("2025-10-01T08:00:00Z"), now, "UTC")).toBe("3 months ago");
    expect(relativeDate(new Date("2026-01-20T08:00:00Z"), now, "UTC")).toBe("in 8 days");
  });
});

describe("gapLine and due-thread detail", () => {
  const n = new Date("2026-01-12T12:00:00Z");
  test("gap buckets", () => {
    expect(gapLine(null, n, 24)).toBeNull();
    expect(gapLine(new Date("2026-01-12T01:00:00Z"), n, 24)).toBeNull();
    expect(gapLine(new Date("2026-01-11T10:00:00Z"), n, 24)).toBe("You last talked yesterday.");
    expect(gapLine(new Date("2026-01-04T12:00:00Z"), n, 24)).toBe("You last talked 8 days ago.");
    expect(gapLine(new Date("2025-12-01T12:00:00Z"), n, 24)).toBe(
      "You last talked about 6 weeks ago.",
    );
  });
  test("due threads render their latest detail", () => {
    const p = assemblePrompt({
      ...base,
      recentTurns: [{ role: "user", text: "hi" }],
      retrieval: {
        ...emptyRetrieval(),
        dueThreads: [{ id: "t1", title: "job interview at Acme", detail: "It was on Friday." }],
      },
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
      ...base,
      gapMarkerMinHours: 24,
      recentTurns: [
        { role: "user", text: "long day", created_at: at("2026-01-05T09:00:00Z") },
        { role: "companion", text: "oof", created_at: at("2026-01-05T09:00:05Z") },
        { role: "user", text: "and another thing", created_at: at("2026-01-05T09:02:00Z") },
        { role: "companion", text: "go on", created_at: at("2026-01-05T09:02:05Z") },
        { role: "user", text: "back again", created_at: at("2026-01-12T09:00:00Z") },
      ],
    });
    expect(p.messages.map((m) => m.content)).toEqual([
      "long day",
      "oof",
      "and another thing",
      "go on",
      "[7 days later] back again",
    ]);
  });
  test("no markers without created_at or below the threshold", () => {
    const p = assemblePrompt({
      ...base,
      gapMarkerMinHours: 24,
      recentTurns: [
        { role: "user", text: "a", created_at: at("2026-01-05T09:00:00Z") },
        { role: "companion", text: "b", created_at: at("2026-01-05T20:00:00Z") },
        { role: "user", text: "c", created_at: at("2026-01-06T08:00:00Z") },
        { role: "user", text: "d" },
      ],
    });
    expect(p.messages.map((m) => m.content)).toEqual(["a", "b", "c", "d"]);
  });
  test("turns before the latest gap of at least windowGapHours are left out", () => {
    const p = assemblePrompt({
      ...base,
      now: at("2026-01-10T09:00:30Z"),
      gapMarkerMinHours: 24,
      windowGapHours: 72,
      recentTurns: [
        { role: "user", text: "old news", created_at: at("2026-01-01T09:00:00Z") },
        { role: "companion", text: "old reply", created_at: at("2026-01-01T09:00:05Z") },
        { role: "user", text: "two days on", created_at: at("2026-01-03T09:00:00Z") },
        { role: "companion", text: "hey", created_at: at("2026-01-03T09:00:05Z") },
        { role: "user", text: "back after a week", created_at: at("2026-01-10T09:00:00Z") },
      ],
    });
    expect(p.messages.map((m) => m.content)).toEqual(["back after a week"]);
  });
  test("a gap under windowGapHours keeps the old turns and the marker", () => {
    const p = assemblePrompt({
      ...base,
      now: at("2026-01-03T09:00:30Z"),
      gapMarkerMinHours: 24,
      windowGapHours: 72,
      recentTurns: [
        { role: "user", text: "a", created_at: at("2026-01-01T09:00:00Z") },
        { role: "companion", text: "b", created_at: at("2026-01-01T09:00:05Z") },
        { role: "user", text: "c", created_at: at("2026-01-03T09:00:00Z") },
      ],
    });
    expect(p.messages.map((m) => m.content)).toEqual(["a", "b", "[2 days later] c"]);
  });
  test("a reply to her reach-out after a silence keeps the reach-out it answers", () => {
    const p = assemblePrompt({
      ...base,
      now: at("2026-01-06T10:00:30Z"),
      gapMarkerMinHours: 24,
      windowGapHours: 72,
      recentTurns: [
        { role: "user", text: "old", created_at: at("2026-01-01T09:00:00Z") },
        { role: "companion", text: "old reply", created_at: at("2026-01-01T09:00:05Z") },
        {
          role: "companion",
          text: "how did the interview go?",
          created_at: at("2026-01-06T09:00:00Z"),
          trigger: "reach_out",
        },
        { role: "user", text: "yeah it went ok!", created_at: at("2026-01-06T10:00:00Z") },
      ],
    });
    expect(p.messages).toEqual([
      { role: "user", content: "[You wrote to them first]" },
      { role: "assistant", content: "how did the interview go?" },
      { role: "user", content: "yeah it went ok!" },
    ]);
  });
  test("a reply whose buffer is days old still carries its user turn", () => {
    const p = assemblePrompt({
      ...base,
      now: at("2026-01-10T09:00:00Z"),
      windowGapHours: 72,
      recentTurns: [{ role: "user", text: "late", created_at: at("2026-01-07T08:00:00Z") }],
    });
    expect(p.messages).toEqual([{ role: "user", content: "late" }]);
  });
  test("a reach-out after an unanswered one keeps the first, even days later", () => {
    const p = assemblePrompt({
      ...base,
      windowGapHours: 72,
      now: at("2026-01-12T09:00:00Z"),
      recentTurns: [
        { role: "user", text: "old", created_at: at("2026-01-01T09:00:00Z") },
        { role: "companion", text: "old reply", created_at: at("2026-01-01T09:00:05Z") },
        {
          role: "companion",
          text: "thinking of you",
          created_at: at("2026-01-06T09:00:00Z"),
          trigger: "reach_out",
        },
      ],
      reachOut: { slot: "why", cue: "CUE" },
    });
    expect(p.messages).toEqual([
      { role: "user", content: "[You wrote to them first]" },
      { role: "assistant", content: "thinking of you" },
      { role: "user", content: "CUE" },
    ]);
  });
  test("a reach-out after a long gap has no old turns and still ends on its cue", () => {
    const p = assemblePrompt({
      ...base,
      windowGapHours: 72,
      now: at("2026-01-10T09:00:00Z"),
      recentTurns: [
        { role: "user", text: "old", created_at: at("2026-01-01T09:00:00Z") },
        { role: "companion", text: "older reply", created_at: at("2026-01-01T09:00:05Z") },
      ],
      reachOut: { slot: "why", cue: "CUE" },
    });
    expect(p.messages).toEqual([{ role: "user", content: "CUE" }]);
  });
});

test("open questions fill their own slot after due threads, only when present", () => {
  const base = {
    valuesDoc: "V",
    snapshot: null,
    coreMemories: [],
    feelingLine: null,
    relationshipSummary: null,
    retrieval: emptyRetrieval(),
    recentTurns: [{ role: "user" as const, text: "hi" }],
    now: new Date(),
    timezone: "UTC",
  };
  expect(assemblePrompt(base).system).not.toMatch(/haven't answered/);
  const s = assemblePrompt({ ...base, openQuestions: ["what should I cook tonight?"] }).system;
  expect(s).toContain("## They asked and you haven't answered yet\n- what should I cook tonight?");
});

test("relationshipLine: first conversation, same day, then days and first-contact date", () => {
  const now = new Date("2026-01-20T09:00:00Z");
  expect(relationshipLine({ sessions: 1, days: 1, first: now }, now, "UTC")).toBe(
    "This is your first conversation with them.",
  );
  expect(relationshipLine({ sessions: 0, days: 0, first: null }, now, "UTC")).toBe(
    "This is your first conversation with them.",
  );
  expect(relationshipLine({ sessions: 2, days: 1, first: now }, now, "UTC")).toBe(
    "You've already talked earlier today.",
  );
  expect(
    relationshipLine({ sessions: 4, days: 3, first: new Date("2026-01-06T09:00:00Z") }, now, "UTC"),
  ).toBe("You first talked 2 weeks ago, and have talked on 3 different days.");
});

test("'Your day' sits before 'You and them'; the preoccupation is labelled", () => {
  const r = emptyRetrieval();
  const onMind = {
    id: "p",
    content: "Spica got the telescope images.",
    when: new Date("2026-01-05T09:00:00Z"),
    onMind: true,
  };
  const { system } = assemblePrompt({
    valuesDoc: "V",
    snapshot: null,
    coreMemories: [onMind],
    feelingLine: "You're in a good mood.",
    relationshipSummary: "R",
    yourDay: "Right now you're free.",
    retrieval: r,
    recentTurns: [],
    now: new Date("2026-01-05T10:00:00Z"),
    timezone: "UTC",
  });
  expect(system.indexOf("## How you're feeling")).toBeLessThan(system.indexOf("## You and them"));
  expect(system.indexOf("## How you're feeling")).toBeLessThan(system.indexOf("## Your day"));
  expect(system.indexOf("## Your day")).toBeLessThan(system.indexOf("## You and them"));
  expect(system.indexOf("## You and them")).toBeLessThan(system.indexOf("## What you remember"));
  expect(system).toContain("Spica got the telescope images. (today) (on your mind lately)");
});

describe("reach-out slot 7b", () => {
  test("slot 7b sits after open questions and a trailing user cue ends the messages", () => {
    const p = assemblePrompt({
      ...base,
      openQuestions: ["q?"],
      reachOut: { slot: "S", cue: "[cue]" },
      recentTurns: [
        { role: "user", text: "hi" },
        { role: "companion", text: "hey" },
      ],
    });
    expect(p.system.indexOf("## Why you're writing\nS")).toBeGreaterThan(
      p.system.indexOf("## They asked"),
    );
    expect(p.messages.at(-1)).toEqual({ role: "user", content: "[cue]" });
  });

  test("the cue merges into a trailing user turn and stands alone with no history", () => {
    const b = { ...base, reachOut: { slot: "S", cue: "[cue]" } };
    expect(assemblePrompt({ ...b, recentTurns: [{ role: "user", text: "hi" }] }).messages).toEqual([
      { role: "user", content: "hi\n\n[cue]" },
    ]);
    expect(assemblePrompt({ ...b, recentTurns: [] }).messages).toEqual([
      { role: "user", content: "[cue]" },
    ]);
  });
});

test("sections come in the two-mind order", () => {
  const { system } = assemblePrompt({
    valuesDoc: "VALUES",
    snapshot: "SNAPSHOT",
    feelingLine: "FEELING",
    yourDay: "DAY",
    relationshipSummary: "US",
    retrieval: {
      facts: {
        user: [{ id: "u", content: "USERFACT", when: now }],
        self: [{ id: "s", content: "TOLDTHEM", when: now }],
        shared: [],
      },
      dueThreads: [],
      recalled: [],
    },
    coreMemories: [{ id: "c", content: "HERLIFE", when: now, onMind: true }],
    recentTurns: [],
    now,
    timezone: "UTC",
  });
  const order = [
    "VALUES",
    "SNAPSHOT",
    "FEELING",
    "DAY",
    "US",
    "USERFACT",
    "TOLDTHEM",
    "HERLIFE",
  ].map((s) => system.indexOf(s));
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(system).toContain("## Who you are lately\nSNAPSHOT");
  expect(system).toContain("### What you've told them");
  expect(system).toContain("### From your own life");
  expect(system).toContain("HERLIFE (today) (on your mind lately)");
});

describe("ideas slot", () => {
  test("ideas render under their own heading after unanswered questions", () => {
    const { system } = assemblePrompt({
      ...base,
      recentTurns: [],
      openQuestions: ["where?"],
      ideas: ["Ask about the audition."],
    });
    expect(system).toContain("## Things you want to bring up\n- Ask about the audition.");
    expect(system.indexOf("## Things you want to bring up")).toBeGreaterThan(
      system.indexOf("## They asked and you haven't answered yet"),
    );
  });

  test("no ideas, no heading", () => {
    expect(assemblePrompt({ ...base, recentTurns: [], ideas: [] }).system).not.toContain(
      "bring up",
    );
  });
});

test("the openness line sits right after You and them", () => {
  const { system } = assemblePrompt({
    ...base,
    recentTurns: [],
    relationshipSummary: "You feel close.",
    summary: { where_things_stand: "w", whats_live: "l", how_i_feel: "f" },
    openness: "You feel open with them.",
  });
  expect(system).toContain("## How open you feel\nYou feel open with them.");
  const at = system.indexOf("## How open you feel");
  expect(at).toBeGreaterThan(system.indexOf("## You and them"));
  expect(at).toBeLessThan(system.indexOf("## Where things stand with them"));
});

test("her items carry share tags, theirs carry origin marks; held back has its own slot", () => {
  const when = new Date("2026-01-12T11:00:00Z");
  const { system } = assemblePrompt({
    ...base,
    recentTurns: [],
    retrieval: {
      ...emptyRetrieval(),
      facts: {
        user: [
          { id: "u1", content: "They hate mornings.", when, origin: "onboarding" },
          { id: "u2", content: "They seem lonely.", when, origin: "guess" },
          { id: "u3", content: "They have a dog.", when },
        ],
        self: [],
        shared: [],
      },
    },
    coreMemories: [
      { id: "c1", content: "She fears being forgotten.", when, share: "hint" },
      { id: "c2", content: "She loves Paper Moon.", when, share: "known" },
      { id: "c3", content: "She misses Alcor.", when, share: "hinted" },
    ],
    heldBack: "There's something here you're not ready to share with them yet.",
  });
  expect(system).toContain(
    "- They hate mornings. (today) (from their profile card, a first impression)",
  );
  expect(system).toContain("- They seem lonely. (today) (your own guess, they never said this)");
  expect(system).toContain("- They have a dog. (today)\n");
  expect(system).toContain("- She fears being forgotten. (today) (only hint at this)");
  expect(system).toContain("- She loves Paper Moon. (today) (they already know this)");
  expect(system).toContain("- She misses Alcor. (today) (you've hinted at this before)");
  expect(system).toContain(
    "## Not ready to share\nThere's something here you're not ready to share with them yet.",
  );
  expect(system.indexOf("## Not ready to share")).toBeGreaterThan(
    system.indexOf("## What you remember"),
  );
});

test("where you are with them sits right after you and them, before how open you feel", () => {
  const { system } = assemblePrompt({
    ...base,
    recentTurns: [],
    relationshipSummary: "You feel close.",
    stage: "You're close.",
    openness: "You feel open with them.",
  });
  expect(system).toContain("## Where you are with them\nYou're close.");
  const at = system.indexOf("## Where you are with them");
  expect(at).toBeGreaterThan(system.indexOf("## You and them"));
  expect(at).toBeLessThan(system.indexOf("## How open you feel"));
});

test("how to text this one is the last section before why you're writing", () => {
  const { system } = assemblePrompt({
    ...base,
    recentTurns: [{ role: "user", text: "hi" }],
    openQuestions: ["what are you reading"],
    howToText: "Keep each text short.",
    reachOut: { slot: "topic", cue: "cue" },
  });
  expect(system).toContain("## How to text this one\nKeep each text short.");
  expect(system.indexOf("## How to text this one")).toBeLessThan(
    system.indexOf("## Why you're writing"),
  );
  expect(system.indexOf("## How to text this one")).toBeGreaterThan(
    system.indexOf("## They asked and you haven't answered yet"),
  );
});
