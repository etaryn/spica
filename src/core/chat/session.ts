/** A new session starts when the gap since the user's previous turn exceeds the idle gap (design §4.3.1). */
export function resolveSessionId(
  prev: { session_id: string; created_at: Date } | null,
  now: Date,
  idleGapMinutes: number,
  newId: () => string,
): string {
  if (prev && now.getTime() - prev.created_at.getTime() <= idleGapMinutes * 60_000) return prev.session_id;
  return newId();
}
