/** A memory as every reader sees it: label, status, dates as tokens, then the words it rests on. */
import { expect, test } from "vitest";
import { embedText, memoryLine, quoted } from "@/mind/memory/user/memory-line";

const interview = {
  date: "2026-01-08",
  precision: "day",
  part: null,
  clock: null,
  span: "at",
  rough: false,
} as const;

test("label, status, date token, then each move quoted with its speaker", () => {
  const line = memoryLine(
    { label: "train ticket", status: "happened" },
    [
      { speaker: "spica", act: "asks", text: "and did you book the train" },
      { speaker: "user", act: "confirms", text: "and yes booked" },
    ],
    [interview],
    "UTC",
    160,
  );
  expect(line).toBe(
    'train ticket, happened ⟦2026-01-08|day|UTC⟧ — Spica asked "and did you book the train"; the user confirmed "and yes booked"',
  );
});

test("a long quote is cut at a word, and token characters in their words can't break the grammar", () => {
  const text = "it went ⟦really⟧ well | i think, and then we talked about the studio for ages";
  expect(quoted([{ speaker: "user", act: "states", text }], 30)).toBe(
    'the user said "it went really well i think…"',
  );
});

test("no status and no time: just the label and the words", () => {
  expect(
    memoryLine(
      { label: "cat juniper", status: null },
      [{ speaker: "user", act: "states", text: "my cat juniper" }],
      [],
      "UTC",
      160,
    ),
  ).toBe('cat juniper — the user said "my cat juniper"');
});

test("what gets embedded: the label and the words, no dates", () => {
  expect(
    embedText("job interview", [{ speaker: "user", act: "answers", text: "it went well" }], 160),
  ).toBe("job interview: it went well");
});
