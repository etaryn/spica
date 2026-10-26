/** Scripted labels: a script's memories land on the new message holding their words. */
import { expect, test } from "vitest";
import {
  checkLabels,
  emptyLabels,
  PropositionsSchema,
  ReadingSchema,
  SignalsSchema,
} from "@/mind/memory/user/annotations";
import { buildLabelInput } from "@/mind/memory/user/label-input";
import { numberPieces } from "@/mind/memory/user/pieces";
import { newMessages, scriptedLabels } from "@/mind/platform/llm/fake-labels";

const at = new Date("2026-01-05T10:00:00Z");
const pieces = numberPieces(
  [
    { id: "a", speaker: "spica", text: "hey", at },
    { id: "b", speaker: "user", text: "i have an interview thursday. kind of nervous", at },
  ],
  1,
);
const input = buildLabelInput({
  pieces,
  zone: "UTC",
  threads: [],
  interests: [],
  earlier: emptyLabels(),
});

test("new messages are read from the input with their pieces", () => {
  expect(newMessages(input)).toEqual([
    {
      message: 2,
      speaker: "user",
      pieces: ["2.1", "2.2"],
      text: "i have an interview thursday. kind of nervous",
    },
  ]);
});

test("a scripted memory checks clean against the transcript", () => {
  const h = scriptedLabels({
    memories: [
      {
        said: "interview thursday",
        label: "job interview",
        status: "planned",
        time: { words: "thursday", unit: "weekday", shift: 1, weekday: "thursday" },
      },
    ],
    relationship: { warmth: 0.3, hurt: null },
    bid: "toward",
  });
  const labels = checkLabels(
    {
      ...ReadingSchema.parse(h.labels_read(input)),
      ...PropositionsSchema.parse(h.labels_meaning(input)),
      ...SignalsSchema.parse(h.labels_signals(input)),
    },
    { pieces, zone: "UTC", threadIds: [], earlier: emptyLabels() },
  );
  expect(labels.drops).toEqual([]);
  expect(labels.propositions.map((p) => p.label)).toEqual(["job interview"]);
  expect(labels.times[0]?.resolved?.date).toBe("2026-01-08");
  expect(labels.bid_response?.response).toBe("toward");
});

test("with no script, every new message still gets a move and nothing else", () => {
  const h = scriptedLabels({});
  const read = ReadingSchema.parse(h.labels_read(input));
  expect(read.moves).toHaveLength(1);
  expect(PropositionsSchema.parse(h.labels_meaning(input)).propositions).toEqual([]);
  expect(SignalsSchema.parse(h.labels_signals(input)).relationship).toBeNull();
});
