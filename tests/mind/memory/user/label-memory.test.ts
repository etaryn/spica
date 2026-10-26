/** From checked labels to the memories the cold path writes, with code-built words. */
import { expect, test } from "vitest";
import { checkLabels, emptyLabels, mergeLabels } from "@/mind/memory/user/annotations";
import { buildLabelInput } from "@/mind/memory/user/label-input";
import { answeredBy, hurtCause, memoryPlans, signalsOf } from "@/mind/memory/user/label-memory";
import { coordinate, numberPieces } from "@/mind/memory/user/pieces";
import { scriptedLabels, type LabelScript } from "@/mind/platform/llm/fake-labels";
import { loadConfig } from "@/mind/platform/config";
import { PropositionsSchema, ReadingSchema, SignalsSchema } from "@/mind/memory/user/annotations";

const config = loadConfig();
const at = new Date("2026-01-05T10:00:00Z");
const pieces = numberPieces(
  [
    { id: "a", speaker: "spica", text: "how's the week looking", at },
    { id: "b", speaker: "user", text: "interview thursday at 10. my sis is visiting too", at },
  ],
  1,
);
const ctx = { pieces, zone: "UTC", threadIds: [], earlier: emptyLabels() };
function labelled(script: LabelScript) {
  const input = buildLabelInput({
    pieces,
    zone: "UTC",
    threads: [],
    interests: [],
    earlier: emptyLabels(),
  });
  const h = scriptedLabels(script);
  return checkLabels(
    {
      ...ReadingSchema.parse(h.labels_read(input)),
      ...PropositionsSchema.parse(h.labels_meaning(input)),
      ...SignalsSchema.parse(h.labels_signals(input)),
    },
    ctx,
  );
}

test("a memory's content is its line; it is dated by its first time", () => {
  const labels = labelled({
    memories: [
      {
        said: "interview thursday",
        label: "job interview",
        status: "planned",
        time: {
          words: "thursday at 10",
          unit: "weekday",
          shift: 1,
          weekday: "thursday",
          clock: "10:00",
        },
      },
    ],
  });
  const [plan] = memoryPlans(
    labels,
    mergeLabels(emptyLabels(), labels),
    pieces,
    "UTC",
    config.extraction,
  );
  expect(plan).toMatchObject({
    subject: "user",
    kind: "event",
    content:
      'job interview, planned ⟦2026-01-08T10:00|time|UTC⟧ — the user said "interview thursday at 10. / my sis is visiting too"',
    embedText: "job interview: interview thursday at 10. / my sis is visiting too",
  });
  expect(plan!.occurred_at?.toISOString()).toBe("2026-01-08T10:00:00.000Z");
});

test("idiolect is shared, worded by its pieces, and started by whoever said it first", () => {
  const labels = labelled({ idiolect: [{ said: "my sis", type: "nickname" }] });
  const [plan] = memoryPlans(labels, labels, pieces, "UTC", config.extraction);
  expect(plan).toMatchObject({
    kind: "idiolect",
    subject: "shared",
    salience: config.extraction.idiolect.salience,
    idiolect: { type: "nickname", started_by: "user", established_at: null },
  });
  expect(plan!.content).toContain('"interview thursday at 10. / my sis is visiting too"');
});

test("her hurt is worded by the moves that hurt her, or by all their new moves when none is named", () => {
  const named = labelled({ relationship: { hurt: { amount: 0.6, said: "my sis" } } });
  expect(hurtCause(named, named, pieces, 160)).toBe(
    'the user said "interview thursday at 10. / my sis is visiting too"',
  );
  const unnamed = labelled({ relationship: { hurt: { amount: 0.6 } } });
  expect(hurtCause(unnamed, unnamed, pieces, 160)).toBe(
    'the user said "interview thursday at 10. / my sis is visiting too"',
  );
});

test("a hurt never loses its words: named moves that aren't theirs fall back to their new moves", () => {
  const labels = labelled({ relationship: { hurt: { amount: 0.6, said: "my sis" } } });
  labels.relationship!.hurt!.moves = ["m-hers"];
  expect(hurtCause(labels, labels, pieces, 160)).toBe(
    'the user said "interview thursday at 10. / my sis is visiting too"',
  );
  // With no move of theirs at all, it still names where it came from.
  const none = { ...labels, moves: [] };
  expect(hurtCause(none, none, pieces, 160)).toBe("something the user said");
});

test("a memory whose mention refers to an open thread joins that thread", () => {
  const labels = labelled({
    memories: [
      {
        said: "interview thursday",
        label: "job interview",
        mention: { words: "interview", name: "interview" },
      },
    ],
  });
  labels.mentions[0]!.refers_to = "thread-1";
  const [plan] = memoryPlans(labels, labels, pieces, "UTC", config.extraction);
  expect(plan!.threadId).toBe("thread-1");
});

test("answeredBy gives the words of each user move one of her new moves replies to", () => {
  const coord = (turnId: string) => ({ turnId, start: 0, end: 5 });
  const move = (id: string, speaker: "user" | "spica", repliesTo: string | null) => ({
    id,
    pieces: [],
    coords: [coord(id)],
    speaker,
    act: "asks" as const,
    repliesTo,
    context: false,
  });
  const earlier = { ...emptyLabels(), moves: [move("m1", "user", null)] };
  const labels = {
    ...emptyLabels(),
    moves: [
      move("m2", "user", null),
      move("m3", "spica", "m1"),
      move("m4", "spica", "m3"), // to her own move: not a question of theirs
      move("m5", "user", "m2"), // their own follow-up: never closes
    ],
  };
  expect(answeredBy(labels, mergeLabels(earlier, labels))).toEqual([coord("m1")]);
});

test("toward and against need a reply to her; away needs that nothing answered her last message", () => {
  const shown = numberPieces(
    [
      { id: "h", speaker: "spica", text: "guess what, I got the part", at },
      { id: "u", speaker: "user", text: "no way!!", at },
    ],
    1,
  );
  const move = (
    id: string,
    speaker: "user" | "spica",
    piece: string,
    repliesTo: string | null,
  ) => ({
    id,
    pieces: [piece],
    coords: [coordinate(shown.find((p) => p.id === piece)!)],
    speaker,
    act: "bids" as const,
    repliesTo,
    context: false,
  });
  const hers = move("m1", "spica", "1.1", null);
  const read = (theirs: ReturnType<typeof move>, response: "toward" | "away" | "against") => {
    const labels = {
      ...emptyLabels(),
      moves: [theirs],
      bid_response: { response, move: theirs.id },
    };
    const all = mergeLabels({ ...emptyLabels(), moves: [hers] }, labels);
    return signalsOf(labels, all, shown, 80).bid;
  };
  expect(read(move("m2", "user", "2.1", "m1"), "toward")).toBe("toward");
  expect(read(move("m2", "user", "2.1", "m1"), "against")).toBe("against");
  expect(read(move("m2", "user", "2.1", null), "toward")).toBeNull();
  expect(read(move("m2", "user", "2.1", null), "away")).toBe("away");
  expect(read(move("m2", "user", "2.1", "m1"), "away")).toBeNull();
});
