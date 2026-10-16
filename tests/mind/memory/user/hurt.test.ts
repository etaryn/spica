// A repaired hurt becomes past: the open hurt memory is superseded by a resolved past-tense copy.
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { settleHurtFacts } from "@/mind/memory/user/hurt";
import { pastHurtContent } from "@/mind/state/user/relationship/signals";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../../../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);
const at = new Date("2026-01-10T15:00:00Z");

test("past tense keeps the cause, whatever the content looks like", () => {
  expect(
    pastHurtContent(
      "Spica felt hurt because the user said her star talk gets a bit much.",
      "apology",
    ),
  ).toBe("Spica was hurt because the user said her star talk gets a bit much; they made up.");
  expect(pastHurtContent("Spica felt hurt because the user said 'k.' and left.", "fade")).toBe(
    "Spica was hurt because the user said 'k.' and left; it has passed.",
  );
  expect(pastHurtContent("Spica was upset about the film thing.", "fade")).toBe(
    "Spica was upset about the film thing; it has passed.",
  );
});

test("settling supersedes each open hurt fact with a resolved copy, for this user only", async () => {
  const db = getTestDb();
  const [u, other] = [await createTestUser(), await createTestUser()];
  const hurt = (userId: string) =>
    insertFact(db, userId, {
      subject: "self",
      kind: "feeling",
      content: "Spica felt hurt because the user said her star talk gets a bit much.",
      embedding: vec(),
      created_at: at,
      status: "open",
      salience: 0.6,
      valence: -0.25,
      confidence: 0.8,
      source: "inferred",
    });
  const mine = await hurt(u);
  const theirs = await hurt(other);
  expect(await settleHurtFacts(db, u, "apology", at)).toBe(1);
  const rows = await db.execute(
    sql`SELECT id, status, content, superseded_by FROM fact WHERE user_id = ${u}`,
  );
  const old = rows.rows.find((r) => r.id === mine.id)!;
  expect(old.status).toBe("superseded");
  const copy = rows.rows.find((r) => r.id === old.superseded_by)!;
  expect(copy).toMatchObject({ status: "resolved" });
  expect(String(copy.content)).toMatch(/^Spica was hurt because .*; they made up\.$/);
  const untouched = await db.execute(sql`SELECT status FROM fact WHERE id = ${theirs.id}`);
  expect(untouched.rows[0]!.status).toBe("open");
});
