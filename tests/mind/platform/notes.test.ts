/** Her notes as code keeps them: citations become their own lines, her own time words dates. */
import { expect, test } from "vitest";
import {
  noteTimesSchema,
  onlyHers,
  writeNote,
  type Citable,
  type NoteTime,
} from "@/mind/platform/notes";

const now = new Date("2026-01-05T09:00:00Z"); // Monday
const ctx = { now, zone: "UTC" };
const interview: Citable = {
  id: "m1",
  ref: "fact-interview",
  kind: "memory",
  text: "design interview, planned ⟦2026-01-08|day|UTC⟧",
  owner: "theirs",
  at: new Date("2026-01-08T12:00:00Z"),
};
const telescope: Citable = {
  id: "m2",
  ref: "fact-telescope",
  kind: "memory",
  text: "telescope booking, planned",
  owner: "yours",
  at: null,
};
const time = (over: Partial<NoteTime>): NoteTime => ({
  field: "idea",
  words: "tonight",
  from: "",
  unit: "day",
  shift: 0,
  weekday: null,
  month: null,
  day_of_month: null,
  part: "night",
  clock: "",
  span: "at",
  rough: false,
  ...over,
});

test("a citation becomes the item's own line with whose it is, and its ref is kept", () => {
  const note = writeNote({ idea: "Ask how [m1] went." }, [], [interview], ctx);
  expect(note.fields.idea).toBe(
    "Ask how design interview, planned ⟦2026-01-08|day|UTC⟧ (theirs) went.",
  );
  expect(note.memories).toEqual(["fact-interview"]);
  expect(note.cited.map((c) => c.id)).toEqual(["m1"]);
});

test("a note with no citation is written as it is", () => {
  const note = writeNote({ idea: "Send them that song." }, [], [interview], ctx);
  expect(note.fields.idea).toBe("Send them that song.");
  expect(note.cited).toEqual([]);
});

test("an id the note wasn't shown is removed and reported", () => {
  const note = writeNote({ idea: "Ask about [m9] soon." }, [], [interview], ctx);
  expect(note.fields.idea).toBe("Ask about soon.");
  expect(note.dropped).toEqual([{ what: "[m9]", reason: "bad_cite" }]);
});

test("a citation cut off by the length fit is stripped", () => {
  const note = writeNote({ idea: "Ask how [m1" }, [], [interview], ctx);
  expect(note.fields.idea).toBe("Ask how");
});

test("her own time word becomes a token counted from now, keeping her words", () => {
  const note = writeNote({ idea: "Ask how tonight goes." }, [time({})], [], ctx);
  expect(note.fields.idea).toBe("Ask how ⟦2026-01-05|night|UTC|tonight⟧ goes.");
  expect(note.times).toHaveLength(1);
});

test("a time counted from a cited memory counts from its day", () => {
  const note = writeNote(
    { idea: "Ask the day after [m1] how it went." },
    [time({ words: "the day after", from: "m1", shift: 1, part: null })],
    [interview],
    ctx,
  );
  expect(note.fields.idea).toContain("⟦2026-01-09|day|UTC|the day after⟧");
});

test("a time counted from an undated citation is dropped and its words stay", () => {
  const note = writeNote(
    { idea: "The day after [m2] ask." },
    [time({ words: "The day after", from: "m2", shift: 1, part: null })],
    [telescope],
    ctx,
  );
  expect(note.fields.idea).toBe("The day after telescope booking, planned (yours) ask.");
  expect(note.dropped).toEqual([{ what: "The day after", reason: "bad_ref" }]);
});

test("words not in their field, or a meaning that can't resolve, are dropped", () => {
  const note = writeNote(
    { idea: "Ask soon." },
    [
      time({ words: "tomorrow" }),
      time({ words: "soon", unit: "weekday", weekday: null, shift: 1 }),
    ],
    [],
    ctx,
  );
  expect(note.fields.idea).toBe("Ask soon.");
  expect(note.dropped.map((d) => d.reason)).toEqual(["words_missing", "bad_time"]);
});

test("a time labels only its own field, and only the first plain occurrence", () => {
  const note = writeNote(
    { a: "tonight, then tonight again", b: "tonight" },
    [time({ field: "a" })],
    [],
    ctx,
  );
  expect(note.fields.a).toBe("⟦2026-01-05|night|UTC|tonight⟧, then tonight again");
  expect(note.fields.b).toBe("tonight");
});

test("words inside a citation are never read as the note's own", () => {
  const note = writeNote(
    { idea: "[m1] is soon" },
    [time({ words: "m1", unit: "day", shift: 1, part: null })],
    [interview],
    ctx,
  );
  expect(note.fields.idea).toBe("design interview, planned ⟦2026-01-08|day|UTC⟧ (theirs) is soon");
  expect(note.dropped).toEqual([{ what: "m1", reason: "words_missing" }]);
});

test("onlyHers: cited, and every citation hers", () => {
  expect(onlyHers({ cited: [] })).toBe(false);
  expect(onlyHers({ cited: [telescope] })).toBe(true);
  expect(onlyHers({ cited: [telescope, interview] })).toBe(false);
});

test("the times schema takes only the fields it was built for", () => {
  const schema = noteTimesSchema(["idea"]);
  expect(schema.safeParse([time({})]).success).toBe(true);
  expect(schema.safeParse([time({ field: "other" })]).success).toBe(false);
});
