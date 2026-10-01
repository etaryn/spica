/**
 * Her self snapshot starts as the persona file's seed self (version 0). Later versions are written
 * by the nightly core loops; seeding never touches a snapshot that already exists.
 */
import type { CoreDeps } from "@/mind/platform/deps";
import { loadPersona } from "@/mind/platform/persona";

/** True when this call wrote version 0. */
export async function seedSnapshot(deps: CoreDeps): Promise<boolean> {
  if (await deps.core.memory.latestSnapshot()) return false;
  return deps.core.memory.insertSnapshot({
    version: 0,
    content: loadPersona(deps.config).seedSelf,
    sections: {},
    source_ids: [],
    rendered_at: deps.clock.now(),
    model: "seed",
    prompt_version: deps.config.prompts.persona,
  });
}
