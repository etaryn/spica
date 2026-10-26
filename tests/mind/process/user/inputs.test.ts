/** Her loops' view of open storylines: when the thing happens, apart from when to ask about it. */
import { expect, test } from "vitest";
import { citables, threadLines } from "@/mind/process/user/inputs";
import { tokenDates } from "@/mind/platform/time-anchors";

test("a thread line keeps the event's day apart from when to ask", () => {
  const lines = threadLines(
    [
      {
        title: "half marathon",
        event: "⟦2026-01-11|day|UTC⟧",
        next_checkpoint: new Date("2026-01-12T09:00:00Z"),
      },
      { title: "new flat", event: null, next_checkpoint: null },
    ],
    "UTC",
  );
  expect(lines).toEqual([
    "half marathon (on ⟦2026-01-11|day|UTC⟧; ask after ⟦2026-01-12|day|UTC⟧)",
    "new flat",
  ]);
});

test("an event known only to the week keeps that precision", () => {
  expect(
    threadLines([{ title: "move", event: "⟦2026-01-12|week|UTC⟧", next_checkpoint: null }], "UTC"),
  ).toEqual(["move (on ⟦2026-01-12|week|UTC⟧)"]);
});

test("citables number new memories, then earlier ones, then threads, each with its owner", () => {
  const at = new Date("2026-01-08T12:00:00Z");
  const shown = citables(
    [
      {
        id: "f1",
        subject: "user",
        kind: "event",
        content: 'design interview, planned ⟦2026-01-08|day|UTC⟧ — the user said "thursday"',
        occurred_at: at,
      },
    ],
    [
      {
        id: "f2",
        subject: "self",
        kind: "life",
        content: "Onboarding: likes old films.",
        occurred_at: new Date("2026-01-03T12:00:00Z"),
      },
    ],
    [
      {
        id: "th1",
        title: "half marathon",
        subject: "user",
        event: "⟦2026-01-11|day|UTC⟧",
        next_checkpoint: null,
      },
    ],
    "UTC",
  );
  expect(shown.new_memories.map((m) => m.id)).toEqual(["m1"]);
  expect(shown.earlier_memories.map((m) => m.id)).toEqual(["m2"]);
  expect(shown.open_threads).toEqual([
    { id: "t1", thread: "half marathon (on ⟦2026-01-11|day|UTC⟧)" },
  ]);
  expect(shown.items).toEqual([
    {
      id: "m1",
      ref: "f1",
      kind: "memory",
      text: "design interview, planned ⟦2026-01-08|day|UTC⟧",
      owner: "theirs",
      at,
    },
    {
      id: "m2",
      ref: "f2",
      kind: "memory",
      // A line with no date token of its own takes its row's date.
      text: "Onboarding: likes old films. ⟦2026-01-03|day|UTC⟧",
      owner: "yours",
      at: new Date("2026-01-03T12:00:00Z"),
    },
    {
      id: "t1",
      ref: "th1",
      kind: "thread",
      text: "half marathon (on ⟦2026-01-11|day|UTC⟧)",
      owner: "theirs",
      at: tokenDates("⟦2026-01-11|day|UTC⟧")[0],
    },
  ]);
});
