/**
 * Who she is in public: her daily life, her outward personality and the AI side of her, so she
 * reads as what she is. Her deeper thoughts stay hers: never her memories, the snapshot prose,
 * her needs, mood or goals. Read from core only, so nothing public can carry a user.
 */
import type { LifePlan } from "@/db/schema";
import type { CoreDeps } from "@/mind/platform/deps";
import { loadPersona } from "@/mind/platform/persona";
import { lifeDate } from "@/mind/world/her-clock";

/** The shallowest of the three depths (surface, personal, intimate). */
const SURFACE = 1;

export type PublicPersona = {
  coreValues: string;
  publicVoice: string | null;
  version: number | null;
  lines: string[];
  /** Her day as it went: the plan and what has happened so far, nothing pending. */
  today: { date: string; plan: LifePlan | null; happened: string[] };
};

export async function publicPersona(
  deps: Pick<CoreDeps, "core" | "config" | "clock">,
): Promise<PublicPersona> {
  const { memory, world } = deps.core;
  const now = deps.clock.now();
  const date = lifeDate(deps.config.life, now);
  const version = (await memory.latestSnapshot())?.version ?? null;
  const lines = [
    ...(await memory.selfLines(null)),
    ...(version === null ? [] : await memory.selfLines(version)),
  ];
  const persona = loadPersona(deps.config);
  return {
    coreValues: persona.coreValues,
    publicVoice: persona.publicVoice,
    version,
    lines: lines.filter((l) => l.depth <= SURFACE).map((l) => l.text),
    today: {
      date,
      plan: await world.plan(date),
      happened: (await world.events(date))
        // Landed and didn't fall through: a surprise or what she did instead carries no outcome.
        .filter((e) => e.appraised_at !== null && e.outcome !== "fell_through")
        .map((e) => e.content),
    },
  };
}
