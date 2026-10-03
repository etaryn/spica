/**
 * Her core mind's starting point. Her self snapshot starts as the persona file's seed self
 * (version 0); later versions are written by the nightly core loops. The canon people (her sibling
 * Alcor) are people she has always known, so they're seeded too, and so are the goals her persona
 * starts her with. Seeding is idempotent and never touches what already exists.
 */
import type { CoreDeps } from "@/mind/platform/deps";
import { loadPersona, parseSeedGoals } from "@/mind/platform/persona";

/** Seeding needs no reply model; goals are embedded, so the embedder comes along. */
type SeedDeps = Pick<CoreDeps, "core" | "clock" | "config" | "embedder">;

/** True when this call wrote version 0. */
export async function seedSnapshot(deps: SeedDeps): Promise<boolean> {
  if (await deps.core.memory.latestSnapshot()) return false;
  const content = loadPersona(deps.config).seedSelf;
  const [embedding] = await deps.embedder.embed([content], "document");
  return deps.core.memory.insertSnapshot({
    version: 0,
    content,
    embedding: embedding!,
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

/** Her persona's goals, the first time only: once she has any goal, reflect owns them. */
export async function seedGoals(deps: SeedDeps): Promise<number> {
  if ((await deps.core.goals.count()) > 0) return 0;
  const goals = parseSeedGoals(loadPersona(deps.config).seedSelf).slice(
    0,
    deps.config.core.goals.max_active,
  );
  if (!goals.length) return 0;
  const vectors = await deps.embedder.embed(
    goals.map((goal) => `${goal.title}: ${goal.why}`),
    "document",
  );
  const now = deps.clock.now();
  for (const [i, goal] of goals.entries()) {
    await deps.core.goals.insert({
      ...goal,
      status: "active",
      progress: 0,
      source: "seed",
      source_ref: `persona:${deps.config.prompts.persona}`,
      started_at: now,
      target_at: null,
      embedding: vectors[i]!,
    });
  }
  return goals.length;
}

/** Run wherever her core mind may be empty: worker start, the eval runner, a self reset. */
export async function seedCore(deps: SeedDeps): Promise<void> {
  await seedSnapshot(deps);
  await seedCanon(deps);
  await seedGoals(deps);
}
