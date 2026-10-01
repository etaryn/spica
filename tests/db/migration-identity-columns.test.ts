/**
 * The identity table's unused value columns are dropped by migration, and existing ego rows
 * survive it.
 */
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getTestDb } from "../helpers/db";

describe("identity value columns", () => {
  it("are gone after migration", async () => {
    const db = getTestDb();
    const result = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'identity'
        AND column_name IN ('traits','stances','boundaries','humor_style','verbal_tics','speech_rules')
    `);
    expect(result.rows).toEqual([]);
  });
});
