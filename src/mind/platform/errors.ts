/**
 * The errors the mind throws on purpose, and two helpers for errors it didn't: spotting a
 * duplicate insert, and naming an error without leaking row contents into logs.
 */
import type { CrisisCard } from "./config";

/** The user's input is unusable (empty, too long). Maps to HTTP 400. */
export class InputError extends Error {}

/** The client message id belongs to a different user. Maps to HTTP 409. */
export class ConflictError extends Error {}

/** Reply generation failed; the user's turn is stored and can be retried. Maps to HTTP 503. */
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

const UNIQUE_VIOLATION = "23505";
const MAX_CAUSE_DEPTH = 3;

/** Postgres unique_violation, whether raw or wrapped by Drizzle. */
export function isUniqueViolation(e: unknown): boolean {
  let current: unknown = e;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
    const code = typeof current === "object" ? (current as { code?: unknown }).code : undefined;
    if (code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * The class name of the innermost cause (Drizzle wraps pg's DatabaseError in DrizzleQueryError).
 * Only the name: pg `detail` and Drizzle's query params can hold row contents, which must never
 * reach logs.
 */
export function errorName(e: unknown): string {
  let innermost = e;
  const seen = new Set<unknown>([innermost]);

  while (
    innermost instanceof Error &&
    innermost.cause instanceof Error &&
    !seen.has(innermost.cause)
  ) {
    innermost = innermost.cause;
    seen.add(innermost);
  }

  return innermost instanceof Error ? innermost.constructor.name : "UnknownError";
}
