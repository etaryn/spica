/** Her memories as a core loop is shown them: numbered, each cited as its own date. */
import { expect, test } from "vitest";
import { coreCitables, lineText } from "@/mind/memory/core/citables";
import type { CoreMemoryItem } from "@/mind/memory/core/types";
import { writeNote } from "@/mind/platform/notes";
import { dateToken } from "@/mind/platform/time-anchors";

const at = new Date("2026-01-06T12:00:00Z");
const item = (over: Partial<CoreMemoryItem>): CoreMemoryItem => ({
  id: "row-1",
  kind: "episode",
  content: "She rewatched Solaris.",
  payload: null,
  entity_refs: [],
  occurred_at: at,
  created_at: at,
  last_recalled_at: null,
  status: "resolved",
  salience: 0.5,
  valence: 0,
  depth: 2,
  source: "world",
  source_ref: null,
  ...over,
});

test("each memory is numbered and cited as its date; an intention as its plan's moment", () => {
  const plan = new Date("2026-01-09T19:00:00Z");
  const { lines, items } = coreCitables(
    [item({}), item({ id: "row-2", kind: "intention", payload: { event_at: plan.toISOString() } })],
    "UTC",
  );
  expect(lines[0]).toEqual({
    id: "m1",
    kind: "episode",
    content: "She rewatched Solaris.",
    when: dateToken(at, "UTC"),
  });
  expect(items[1]).toMatchObject({
    id: "m2",
    ref: "row-2",
    owner: null,
    text: dateToken(plan, "UTC", "time"),
    at: plan,
  });
  expect(lineText(lines[0]!)).toBe(`[m1] She rewatched Solaris. (${dateToken(at, "UTC")})`);
});

test("a memory whose words carry a date shows none beside them, but its cite still dates it", () => {
  const content = `Booked the telescope for ${dateToken(at, "UTC")}.`;
  const { lines, items } = coreCitables([item({ content })], "UTC");
  expect(lines[0]!.when).toBeNull();
  expect(lineText(lines[0]!)).toBe(`[m1] ${content}`);
  expect(items[0]!.text).toBe(dateToken(at, "UTC"));
});

test("a memory with no date of its own takes the day it was written", () => {
  const { items } = coreCitables([item({ occurred_at: null })], "UTC");
  expect(items[0]!.text).toBe(dateToken(at, "UTC"));
});

test("a citation in her note reads as the cited memory's date", () => {
  const { items } = coreCitables([item({})], "UTC");
  const note = writeNote({ thought: "Solaris [m1] still stays with her" }, [], items, {
    now: new Date("2026-01-08T09:00:00Z"),
    zone: "UTC",
  });
  expect(note.fields.thought).toBe(`Solaris (${dateToken(at, "UTC")}) still stays with her`);
  expect(note.memories).toEqual(["row-1"]);
});
