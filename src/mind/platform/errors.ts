import type { CrisisCard } from "./config";

/** The user's input is unusable (empty, too long). Maps to HTTP 400. */
export class InputError extends Error {}

/** The client message id belongs to a different user. Maps to HTTP 409. */
export class ConflictError extends Error {}

/** Reply generation failed; the user turn is stored and can be retried. Maps to HTTP 503. */
export class ReplyFailedError extends Error {
  constructor(
    message: string,
    readonly crisisCard: CrisisCard | null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms}ms`);
  }
}

/** Postgres unique_violation (23505), whether raw or wrapped by Drizzle. */
export function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let i = 0; i < 3 && cur; i++) {
    if (typeof cur === "object" && cur !== null && (cur as { code?: unknown }).code === "23505")
      return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The class name of the innermost cause (e.g. drizzle wraps pg's DatabaseError in DrizzleQueryError).
 * Only the name: pg `detail` and drizzle's query params can hold row contents, which must not reach logs.
 */
export function errorName(e: unknown): string {
  let err = e;
  const seen = new Set<unknown>([err]);
  while (err instanceof Error && err.cause instanceof Error && !seen.has(err.cause)) {
    err = err.cause;
    seen.add(err);
  }
  return err instanceof Error ? err.constructor.name : "UnknownError";
}
