import { adminDecayFacts } from "@/db/repos/decay-admin";
import type { Deps } from "../deps";

/** One day of decay: inversely proportional to salience, so important memories fade slowly (v2 §7.2). */
export function decayedSalience(s: number, rate: number): number {
  return s * (1 - rate * (1 - s));
}

export async function decayPass(deps: Pick<Deps, "db" | "config" | "log">, now: Date) {
  const out = await adminDecayFacts(deps.db, now, deps.config.decay);
  deps.log.info("decay pass", out);
  return out;
}
