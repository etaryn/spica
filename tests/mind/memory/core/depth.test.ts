import { expect, test } from "vitest";
import { depthOf, sectionDepths, snapshotSection, snapshotWithin } from "@/mind/memory/core/depth";

const snap = "### Lately\n- a film kick\n- missing Alcor badly\n\n### Habits of speech\n- says ngl";

test("labels map to tiers; anything else falls back", () => {
  expect(depthOf("surface", 2)).toBe(1);
  expect(depthOf("personal", 3)).toBe(2);
  expect(depthOf("intimate", 1)).toBe(3);
  expect(depthOf(null, 2)).toBe(2);
  expect(depthOf(undefined, 3)).toBe(3);
});

test("a snapshot keeps only lines within the limit; unknown lines stay; empty sections go", () => {
  const lines = [
    { text: "a film kick", depth: 1 },
    { text: "missing Alcor badly", depth: 3 },
    { text: "says ngl", depth: 3 },
  ];
  expect(snapshotWithin(snap, lines, 1)).toBe("### Lately\n- a film kick");
  expect(snapshotWithin(snap, lines, 3)).toBe(snap);
  expect(snapshotWithin(snap, [], 1)).toBe(snap);
});

test("prose before or inside a section is kept", () => {
  const withProse = "Intro line.\n\n### Lately\nSome prose.\n- deep thing";
  expect(snapshotWithin(withProse, [{ text: "deep thing", depth: 3 }], 1)).toBe("Intro line.");
});

test("seed bullets take their section's depth; an unlisted section is surface", () => {
  expect(sectionDepths(snap, { Lately: 2 })).toEqual([
    { text: "a film kick", depth: 2 },
    { text: "missing Alcor badly", depth: 2 },
    { text: "says ngl", depth: 1 },
  ]);
});

test("a line stored at two depths is held to the deeper one", () => {
  const content = "### Lately\n- I miss Alcor.";
  const lines = [
    { text: "I miss Alcor.", depth: 3 },
    { text: "I miss Alcor.", depth: 1 },
  ];
  expect(snapshotWithin(content, lines, 1)).toBe("");
});

test("snapshotSection returns one section's bullets, or none", () => {
  const s = "### Lately\n- found orion\n\n### Interests\n- old films, Stalker\n- reading";
  expect(snapshotSection(s, "Interests")).toEqual(["old films, Stalker", "reading"]);
  expect(snapshotSection(s, "Goals")).toEqual([]);
});
