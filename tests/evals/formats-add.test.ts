/** A drafted format is never live: forced unreviewed, named after its file, and validated. */
import { expect, test } from "vitest";
import { formatFromDraft } from "../../evals/scripts/formats-add";

const raw = {
  aspect: "4:5",
  frame: "polaroid",
  placement: { side: "left", scale: [0.3, 0.5] },
  poses: ["standing"],
  overlay: { kind: "label", position: "bottom", style: "handwritten" },
  grain: 0.4,
  caption_pattern: "lowercase diary line",
  min_skill: 0.3,
  reviewed: true,
  name: "ignored",
};

test("forced unreviewed and named", () => {
  expect(formatFromDraft("film-diary", raw)).toMatchObject({
    name: "film-diary",
    medium: "still",
    reviewed: false,
    frame: "polaroid",
  });
});

test("an invalid draft throws", () => {
  expect(() => formatFromDraft("x", { ...raw, aspect: "3:2" })).toThrow();
});
