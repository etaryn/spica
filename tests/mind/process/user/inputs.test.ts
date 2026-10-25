/** Her loops' view of open storylines: when the thing happens, apart from when to ask about it. */
import { expect, test } from "vitest";
import { threadLines } from "@/mind/process/user/inputs";

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
