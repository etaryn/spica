/**
 * Whether one of her world events has landed with her yet, for the inspector's life tab. Events
 * are recorded ahead of their time and appraised when it comes, so "recorded" isn't "happened".
 */
export function eventStatus(e: { appraised_at: Date | null }): string {
  return e.appraised_at
    ? `landed ${e.appraised_at.toISOString().replace("T", " ").slice(0, 16)}`
    : "pending";
}
