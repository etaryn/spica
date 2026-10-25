/** Labels stored by coordinate come back with the piece ids of whatever window shows them. */
import { expect, test } from "vitest";
import { checkLabels, emptyLabels } from "@/mind/memory/user/annotations";
import { numberPieces, type Message } from "@/mind/memory/user/pieces";
import { factIdsByLocal, fromRows, toRows } from "@/mind/memory/user/stored-labels";
import type { AnnotationRow } from "@/db/repos/user/annotations";

const at = new Date("2026-01-07T20:30:00Z");
const msgs: Message[] = [
  { id: "a", speaker: "spica", text: "is it still thursday?", at },
  { id: "b", speaker: "user", text: "yes thursday", at },
];
const labels = checkLabels(
  {
    moves: [{ id: "m1", pieces: ["2.1"], act: "confirms", replies_to: "" }],
    mentions: [],
    times: [
      {
        id: "t1",
        piece: "2.1",
        words: "thursday",
        from: "said",
        unit: "weekday",
        shift: 1,
        weekday: "thursday",
        month: null,
        day_of_month: null,
        part: null,
        clock: "",
        span: "at",
        rough: false,
      },
    ],
    propositions: [
      {
        id: "p1",
        moves: ["m1"],
        subject: "user",
        kind: "event",
        label: "job interview",
        status: "planned",
        times: ["t1"],
        mentions: [],
        thread_id: "",
        new_thread: "",
        updates: "",
        salience: 0.8,
        valence: 0,
        confidence: 0.9,
        claim_kind: null,
      },
    ],
    threads: [],
    idiolect: [],
    relationship: null,
    intimacy: null,
    bid_response: null,
  },
  { pieces: numberPieces(msgs, 1), zone: "UTC", threadIds: [], earlier: emptyLabels() },
);
const stored = (): AnnotationRow[] =>
  toRows(labels, {
    sessionId: "s",
    exchangeRef: "b",
    at,
    factIds: new Map([["p1", "f1"]]),
    entityIds: new Map(),
  }).map(
    (r, i) => ({ ...r, id: `r${i}`, user_id: "u", fact_id: r.fact_id ?? null }) as AnnotationRow,
  );

test("labels round-trip, and a window that grew in front renumbers their pieces", () => {
  const before: Message = { id: "z", speaker: "user", text: "hey", at };
  const back = fromRows(stored(), numberPieces([before, ...msgs], 3));
  expect(back.moves[0]).toMatchObject({ id: "m1", pieces: ["3.1"], speaker: "user" });
  expect(back.times[0]).toMatchObject({ id: "t1", piece: "3.1" });
  expect(back.propositions.map((p) => p.id)).toEqual(["p1"]);
  expect(factIdsByLocal(stored()).get("p1")).toBe("f1");
});

test("a label whose words have left the window is left out of what the call sees", () => {
  const back = fromRows(stored(), numberPieces([msgs[0]!], 1));
  expect(back.moves).toEqual([]);
  expect(back.times).toEqual([]);
  // The memory itself is still listed, so a later one can update it.
  expect(back.propositions.map((p) => p.id)).toEqual(["p1"]);
});
