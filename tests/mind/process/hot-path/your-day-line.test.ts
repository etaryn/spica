import { afterAll, beforeEach, expect, test } from "vitest";
import { yourDayLines, loadYourDayLine } from "@/mind/process/hot-path/your-day-line";
import { insertLifeDay } from "@/db/repos/world/life-day";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const d = (iso: string) => new Date(iso);
const blocks = [
  {
    key: "a",
    start: d("2026-01-05T02:00:00Z"),
    end: d("2026-01-05T05:00:00Z"),
    block: "busy" as const,
    busy: 0.8,
    label: "rewatching an old film",
  },
  {
    key: "b",
    start: d("2026-01-05T15:00:00Z"),
    end: d("2026-01-05T16:00:00Z"),
    block: "quiet" as const,
    busy: 0.9,
    label: "offline, winding down",
  },
];

test("now, later and the deferred line", () => {
  expect(yourDayLines(blocks, d("2026-01-05T03:00:00Z"), null, [])).toBe(
    "Right now you're rewatching an old film (busy).\nLater: offline, winding down.",
  );
  expect(yourDayLines(blocks, d("2026-01-05T06:00:00Z"), "rewatching an old film", [])).toBe(
    "Right now you're free.\nLater: offline, winding down.\nThey wrote while you were rewatching an old film; you're only getting to it now.",
  );
  expect(yourDayLines([], d("2026-01-05T06:00:00Z"), null, [])).toBeNull();
});

test("a deferred block that is in the plan gives the 'while you were' line", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  await insertLifeDay(deps.db, {
    date: "2026-01-05",
    plan: { blocks: [{ start: "09:00", end: "12:00", kind: "busy", busy: 0.8, label: "reading" }] },
    source: "scripted",
    model: "none",
    prompt_version: "scripted",
    generated_at: d("2026-01-05T01:00:00Z"),
  });
  const line = await loadYourDayLine(deps, d("2026-01-05T13:00:00Z"), "2026-01-05#09:00");
  expect(line).toMatch(/They wrote while you were reading/);
});

test("an unknown deferred block key just drops the 'while you were' line", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const line = await loadYourDayLine(deps, d("2026-01-05T10:00:00Z"), "2026-01-05#03:33");
  expect(line ?? "").not.toContain("They wrote while you were");
});

test("lists what happened earlier today, plain", () => {
  const text = yourDayLines([], new Date("2026-01-10T15:00:00Z"), null, [
    "Spica went to the film club screening of Stalker.",
  ]);
  expect(text).toContain("Earlier today: Spica went to the film club screening of Stalker.");
});
