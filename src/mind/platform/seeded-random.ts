/**
 * Deterministic randomness: the same seed always gives the same number, so evals, retries and
 * hourly ticks behave identically every time they run.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** A number in [0, 1) derived from `seed` (FNV-1a hash). */
export function seededUnit(seed: string): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0) / 2 ** 32;
}
