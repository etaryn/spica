import { afterAll, beforeEach, expect, test } from "vitest";
import { yourDayLines, loadYourDayLine } from "@/mind/process/hot-path/your-day-line";
import { insertFact } from "@/db/repos/user/facts";
import { fact } from "@/db/schema";
import { eq } from "drizzle-orm";
import { closeTestDb, createTestUser, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);
const d = (iso: string) => new Date(iso);
const blocks = [
  {
    id: "a",
    start: d("2026-01-05T02:00:00Z"),
    end: d("2026-01-05T05:00:00Z"),
    block: "busy" as const,
    busy: 0.8,
    label: "rewatching an old film",
  },
  {
    id: "b",
    start: d("2026-01-05T15:00:00Z"),
    end: d("2026-01-05T16:00:00Z"),
    block: "quiet" as const,
    busy: 0.9,
    label: "offline, winding down",
  },
];

test("now, later and the deferred line", () => {
  expect(yourDayLines(blocks, d("2026-01-05T03:00:00Z"), null)).toBe(
    "Right now you're rewatching an old film (busy).\nLater: offline, winding down.",
  );
  expect(yourDayLines(blocks, d("2026-01-05T06:00:00Z"), "rewatching an old film")).toBe(
    "Right now you're free.\nLater: offline, winding down.\nThey wrote while you were rewatching an old film; you're only getting to it now.",
  );
  expect(yourDayLines([], d("2026-01-05T06:00:00Z"), null)).toBeNull();
});

test("a deleted deferred fact degrades to no deferred line (review focus 5)", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const u = await createTestUser();
  const f = await insertFact(deps.db, u, {
    subject: "self",
    kind: "event",
    content: "Spica's morning: reading.",
    payload: {
      start: "2026-01-05T09:00:00.000Z",
      end: "2026-01-05T12:00:00.000Z",
      block: "busy",
      busy: 0.8,
      label: "reading",
      life_day: "2026-01-05",
      shared: true,
    },
    embedding: vec(),
    created_at: d("2026-01-05T01:00:00Z"),
    status: "open",
    salience: 0.2,
    valence: 0,
    confidence: 1,
    source: "generated",
  });
  const at = d("2026-01-05T10:00:00Z");
  expect(await loadYourDayLine(deps, u, at, f.id)).toMatch(/They wrote while you were reading/);
  await deps.db.delete(fact).where(eq(fact.id, f.id));
  expect(await loadYourDayLine(deps, u, at, f.id)).toBeNull();
});
