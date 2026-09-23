/** Returns the single row of an INSERT ... RETURNING, or throws. */
export function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new Error("expected one row, got none");
  return row;
}
