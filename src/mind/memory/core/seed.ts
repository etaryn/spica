/**
 * Her core mind's starting point. Her self snapshot starts as the persona file's seed self
 * (version 0); later versions are written by the nightly core loops. The canon people (her sibling
 * Alcor) are people she has always known, so they're seeded too. Seeding is idempotent and never
 * touches what already exists.
 */
import type { CoreDeps } from "@/mind/platform/deps";
import { loadPersona } from "@/mind/platform/persona";

/** Seeding needs no model, so a CLI can run it with just the database. */
type SeedDeps = Pick<CoreDeps, "core" | "clock" | "config">;

/** True when this call wrote version 0. */
export async function seedSnapshot(deps: SeedDeps): Promise<boolean> {
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

/** Known names keep their first_seen, so a re-seed changes nothing. */
export async function seedCanon(deps: SeedDeps): Promise<void> {
  const world = deps.config.core.world;
  await deps.core.memory.addEntities(world.canon_entities, world.entity_salience, deps.clock.now());
}

/** Run wherever her core mind may be empty: worker start, the eval runner, a self reset. */
export async function seedCore(deps: SeedDeps): Promise<void> {
  await seedSnapshot(deps);
  await seedCanon(deps);
}
