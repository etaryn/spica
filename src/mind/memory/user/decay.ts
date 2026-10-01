/**
 * Daily memory decay: each memory's weight fades a little every day, slowly for important ones
 * and quickly for trivia, until it goes `stale`. Nothing is ever deleted.
 */
import { adminDecayFacts } from "@/db/repos/decay-admin";
import type { Deps } from "@/mind/platform/deps";

/** One day of decay. The loss shrinks as salience grows, so important memories fade slowly. */
export function decayedSalience(salience: number, rate: number): number {
  return salience * (1 - rate * (1 - salience));
}

export async function decayPass(deps: Pick<Deps, "db" | "config" | "log">, now: Date) {
  const outcome = await adminDecayFacts(deps.db, now, deps.config.decay);
  deps.log.info("decay pass", outcome);
  return outcome;
}
