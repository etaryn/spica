/** Labelling one stretch: three calls, each seeing what the calls before it labelled. */
import { expect, test } from "vitest";
import { emptyLabels } from "@/mind/memory/user/annotations";
import { labelStretch, LABEL_PURPOSES } from "@/mind/memory/user/label";
import { numberPieces } from "@/mind/memory/user/pieces";
import { makeTestDeps } from "../../../helpers/deps";

const at = new Date("2026-01-07T20:30:00Z");
const pieces = numberPieces(
  [
    { id: "a", speaker: "spica", text: "how did it go?", at },
    { id: "b", speaker: "user", text: "the interview went well", at },
  ],
  1,
);
const stretch = { pieces, zone: "UTC", threads: [], interests: [], earlier: emptyLabels() };

function scripted() {
  const d = makeTestDeps();
  d.llm.handlers.labels_read = () => ({
    moves: [{ id: "m1", pieces: ["2.1"], act: "answers", replies_to: "" }],
    mentions: [],
    times: [],
  });
  d.llm.handlers.labels_meaning = (input: string) => {
    // The reading call's move is already labelled when the propositions call runs.
    expect(input).toContain("m1 answers [2.1]");
    return {
      propositions: [
        {
          id: "p1",
          moves: ["m1"],
          subject: "user",
          kind: "event",
          label: "job interview",
          status: "happened",
          times: [],
          mentions: [],
          thread_id: "",
          new_thread: "",
          updates: "",
          salience: 0.8,
          valence: 0.6,
          confidence: 0.9,
          claim_kind: null,
        },
      ],
      threads: [],
    };
  };
  d.llm.handlers.labels_signals = (input: string) => {
    expect(input).toContain('p1 user event "job interview"');
    return {
      idiolect: [],
      relationship: null,
      intimacy: { user_disclosure: 0.2, user_responsiveness: null, moves: ["m1"] },
      bid_response: { response: "toward", move: "m1" },
    };
  };
  return d;
}

test("three calls in order, and the labels come back checked", async () => {
  const d = scripted();
  const out = await labelStretch(d, stretch);
  expect(d.llm.structuredCalls.map((c) => c.purpose)).toEqual([...LABEL_PURPOSES]);
  expect(out.moves.map((m) => m.id)).toEqual(["m1"]);
  expect(out.propositions.map((p) => p.label)).toEqual(["job interview"]);
  expect(out.bid_response).toEqual({ response: "toward", move: "m1" });
  expect(out.drops).toEqual([]);
});

test("a bad value in one call drops one label, and the other calls still run", async () => {
  const d = scripted();
  d.llm.handlers.labels_read = () => ({
    moves: [
      { id: "m1", pieces: ["2.1"], act: "answers", replies_to: "" },
      { id: "m2", pieces: ["1.1"], act: "wonders", replies_to: "" },
    ],
    mentions: [],
    times: [],
  });
  const out = await labelStretch(d, stretch);
  expect(out.moves.map((m) => m.id)).toEqual(["m1"]);
  expect(out.drops).toContainEqual({ layer: "moves", id: "m2", reason: "bad_value", ref: "act" });
  expect(out.propositions).toHaveLength(1);
});

test("a call that throws fails the labelling: nothing is asked again", async () => {
  const d = scripted();
  d.llm.handlers.labels_meaning = () => {
    throw new Error("Failed to parse structured output");
  };
  await expect(labelStretch(d, stretch)).rejects.toThrow("labels_meaning");
  expect(d.llm.structuredCalls.map((c) => c.purpose)).toEqual(["labels_read", "labels_meaning"]);
});
