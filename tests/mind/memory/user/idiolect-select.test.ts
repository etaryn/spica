/** Which of their things she may use: established ones that fit, as the stage allows. */
import { expect, test } from "vitest";
import type { IdiolectCandidate } from "@/db/repos/user/facts";
import { loadConfig } from "@/mind/platform/config";
import { selectIdiolect } from "@/mind/memory/user/idiolect";

const settings = loadConfig().relationship.idiolect;
const item = (
  id: string,
  started_by: "user" | "spica",
  sim: number,
  salience = 0.5,
): IdiolectCandidate => ({
  id,
  content: id,
  salience,
  sim,
  payload: { type: "joke", started_by, established_at: "2026-10-01T00:00:00.000Z" },
});

test("none, theirs only, or all of it, as the stage allows", () => {
  const items = [item("theirs", "user", 0.8), item("hers", "spica", 0.9)];
  expect(selectIdiolect(items, "none", settings)).toEqual([]);
  expect(selectIdiolect(items, "theirs", settings).map((i) => i.id)).toEqual(["theirs"]);
  expect(selectIdiolect(items, "all", settings).map((i) => i.id)).toEqual(["hers", "theirs"]);
});

test("a weak match is dropped and at most max_items come back, best first", () => {
  const items = [
    item("a", "user", 0.1),
    item("b", "user", 0.5, 0.2),
    item("c", "user", 0.6, 0.9),
    item("d", "user", 0.7, 0.9),
  ];
  expect(selectIdiolect(items, "all", settings).map((i) => i.id)).toEqual(["d", "c"]);
});
