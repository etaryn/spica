/** Pieces: messages numbered into addresses, and cited words mapped back to where they sit. */
import { expect, test } from "vitest";
import {
  coordinate,
  findPhrase,
  numberPieces,
  renderPieces,
  splitRanges,
  type Message,
} from "@/mind/memory/user/pieces";

const msg = (
  id: string,
  speaker: Message["speaker"],
  text: string,
  iso = "2026-01-07T20:41:00Z",
): Message => ({ id, speaker, text, at: new Date(iso) });
const texts = (text: string) => splitRanges(text).map(([s, e]) => text.slice(s, e));

test("a message splits at its line breaks and after sentence ends, trimmed", () => {
  expect(texts("hey sam\n\nthe half marathon week, right? nerves or excitement or both")).toEqual([
    "hey sam",
    "the half marathon week, right?",
    "nerves or excitement or both",
  ]);
  expect(texts("nervous more than ready tbh. and no half marathon yet lol, that's sunday")).toEqual(
    ["nervous more than ready tbh.", "and no half marathon yet lol, that's sunday"],
  );
  expect(texts("wait...")).toEqual(["wait..."]);
  expect(texts("   ")).toEqual([]);
});

test("pieces are numbered by message, keep their ranges and know whether they are new", () => {
  const pieces = numberPieces(
    [
      msg("a", "spica", "is it thursday?"),
      msg("b", "user", "   "),
      msg("c", "user", "yep. moved to friday"),
    ],
    1,
  );
  expect(pieces.map((p) => [p.id, p.text, p.isNew])).toEqual([
    ["1.1", "is it thursday?", false],
    ["3.1", "yep.", true],
    ["3.2", "moved to friday", true],
  ]);
  expect(coordinate(pieces[2]!)).toEqual({ turnId: "c", start: 5, end: 20 });
});

test("a phrase is found inside its piece whatever its case and spacing, or not at all", () => {
  const [piece] = numberPieces(
    [msg("m", "user", "and no half marathon yet lol, that's sunday")],
    0,
  );
  const found = findPhrase(piece!, "That's   Sunday")!;
  expect(found.turnId).toBe("m");
  expect(piece!.message.text.slice(found.start, found.end)).toBe("that's sunday");
  expect(findPhrase(piece!, "saturday")).toBeNull();
  expect(findPhrase(piece!, "lol?")).toBeNull();
  expect(findPhrase(piece!, "  ")).toBeNull();
});

test("the call reads a message's first piece with its speaker and time, the rest with the speaker", () => {
  const pieces = numberPieces(
    [msg("a", "user", "so\nthey moved it"), msg("b", "spica", "noo why", "2026-01-07T20:42:00Z")],
    0,
  );
  expect(renderPieces(pieces, "UTC")).toBe(
    [
      "[1.1] User · Wed 2026-01-07 20:41 (UTC): so",
      "[1.2] User: they moved it",
      "[2.1] Spica · Wed 2026-01-07 20:42 (UTC): noo why",
    ].join("\n"),
  );
});

test("a straight or a curly apostrophe is the same letter", () => {
  const [piece] = numberPieces([msg("m", "user", "i don’t know, it’s sunday")], 0);
  expect(findPhrase(piece!, "don't know")).not.toBeNull();
  const [straight] = numberPieces([msg("n", "user", "i don't know")], 0);
  expect(findPhrase(straight!, "don’t know")).not.toBeNull();
});
