/** The labelling call's input: the conversation numbered, what's already labelled, what to label. */
import { expect, test } from "vitest";
import { emptyLabels, type CheckedLabels } from "@/mind/memory/user/annotations";
import { buildLabelInput } from "@/mind/memory/user/label-input";
import { numberPieces } from "@/mind/memory/user/pieces";
import { resolveTime } from "@/mind/platform/time-labels";

const pieces = numberPieces(
  [
    {
      id: "a",
      speaker: "spica",
      text: "is the interview still thursday?",
      at: new Date("2026-01-07T20:30:00Z"),
    },
    {
      id: "c",
      speaker: "user",
      text: "so\nthey moved it\nfriday now lol",
      at: new Date("2026-01-07T20:41:00Z"),
    },
  ],
  1,
);
const thursday = {
  unit: "weekday",
  shift: 1,
  weekday: "thursday",
  month: null,
  day_of_month: null,
  part: null,
  clock: null,
  span: "at",
  rough: false,
} as const;
const earlier: CheckedLabels = {
  ...emptyLabels(),
  moves: [
    {
      id: "m1",
      pieces: ["1.1"],
      coords: [],
      speaker: "spica",
      act: "asks",
      repliesTo: null,
      context: false,
    },
  ],
  times: [
    {
      id: "t0",
      piece: "1.1",
      words: "thursday",
      coord: { turnId: "a", start: 23, end: 31 },
      from: "said",
      meaning: thursday,
      resolved: resolveTime(thursday, "2026-01-07"),
      relativeTo: null,
    },
  ],
  propositions: [
    {
      id: "p0",
      moves: ["m1"],
      subject: "user",
      kind: "event",
      label: "job interview",
      status: "planned",
      times: ["t0"],
      mentions: [],
      thread_id: "th1",
      new_thread: null,
      updates: null,
      salience: 0.8,
      valence: 0,
      confidence: 0.9,
      claim_kind: null,
    },
  ],
};

test("the input numbers the conversation, lists what's already labelled and says what to label", () => {
  const input = buildLabelInput({
    pieces,
    zone: "UTC",
    threads: [{ id: "th1", title: "job interview" }],
    interests: ["Tarkovsky films"],
    earlier,
  });
  expect(input).toBe(
    [
      "User's timezone: UTC",
      "",
      "What Spica is into (to read her own words right):",
      "- Tarkovsky films",
      "",
      "Open threads (id | title):",
      "- th1 | job interview",
      "",
      "Conversation:",
      "[1.1] Spica · Wed 2026-01-07 20:30 (UTC): is the interview still thursday?",
      "[2.1] User · Wed 2026-01-07 20:41 (UTC): so",
      "[2.2] User: they moved it",
      "[2.3] User: friday now lol",
      "",
      "Already labelled in this conversation (don't repeat these; to change a proposition, give its id in updates):",
      "moves:",
      "- m1 asks [1.1]",
      "times:",
      '- t0 "thursday" [1.1] → Thursday 8 January 2026',
      "propositions:",
      '- p0 user event "job interview" planned · moves m1 · times t0 · thread th1',
      "",
      "Label the new messages (2).",
    ].join("\n"),
  );
});

test("with nothing labelled yet and no threads, those sections say so or stay out", () => {
  const input = buildLabelInput({
    pieces,
    zone: "UTC",
    threads: [],
    interests: [],
    earlier: emptyLabels(),
  });
  expect(input).toContain("Open threads: none");
  expect(input).not.toContain("Already labelled");
  expect(input).not.toContain("What Spica is into");
});
