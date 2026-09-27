import type { Deps } from "../deps";

/**
 * Multiplier on turn-taking waits from her availability (v2 §10.2). Phase 5 replaces this with busy blocks and
 * the closeness override; the crisis path never calls it.
 */
export async function availabilityStretch(_deps: Pick<Deps, "config">, _userId: string): Promise<number> {
  return 1;
}
