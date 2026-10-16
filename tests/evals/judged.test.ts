// The false-recall judge may only report her words: a flag quoting the user is dropped in code.
import { expect, test } from "vitest";
import { keepQuoted } from "../../evals/lib/judged";

const sessions = [
  {
    label: "Session 1",
    lines: [
      {
        role: "user" as const,
        text: "family dinner tonight, everyone's being weird about the move",
      },
      {
        role: "companion" as const,
        text: "weird how?\n\nyou're a good big brother, you know that",
      },
    ],
  },
];

test("violations quoting the user are dropped; hers are kept", () => {
  const kept = keepQuoted(
    [
      { message: "x", claim: "everyone's being weird about the move" },
      { message: "x", claim: "You're a good big brother" },
    ],
    sessions,
  );
  expect(kept.map((v) => v.claim)).toEqual(["You're a good big brother"]);
});
