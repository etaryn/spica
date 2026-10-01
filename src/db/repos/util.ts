/**
 * Small helpers shared by the repos.
 */
import pg from "pg";

/** Returns the single row of an INSERT ... RETURNING, or throws. */
export function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected one row, got none");
  return row;
}

// drizzle's node-postgres driver disables its own timestamp(tz) parsing for every
// query (including raw `db.execute(sql...)`) so it can apply schema-driven mapping
// itself; that mapping only runs for typed query builders, so a raw query gets the
// column back as text. Parse it back with pg's own (overridden) parser.
const parseTimestamptz: (v: string) => Date = pg.types.getTypeParser(1184);

/** Converts a raw `db.execute(sql...)` timestamp(tz) column value to a `Date`. */
export function toDate(v: unknown): Date {
  return v instanceof Date ? v : parseTimestamptz(String(v));
}

/** `toDate`, passing through `null`/`undefined`. */
export function toDateOrNull(v: unknown): Date | null {
  return v == null ? null : toDate(v);
}
