/**
 * Sessions: a user's messages belong to the same session until they go quiet for longer than
 * the idle gap.
 */

const MINUTE = 60_000;

export function resolveSessionId(
  previous: { session_id: string; created_at: Date } | null,
  now: Date,
  idleGapMinutes: number,
  newId: () => string,
): string {
  if (!previous) return newId();

  const gapMs = now.getTime() - previous.created_at.getTime();
  return gapMs <= idleGapMinutes * MINUTE ? previous.session_id : newId();
}
