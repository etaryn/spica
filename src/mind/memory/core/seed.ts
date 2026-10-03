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
  const persona = loadPersona(deps.config);
  const existing = await deps.core.memory.snapshot(0);
  if (!existing && (await deps.core.memory.latestSnapshot())) return false;
  const content = existing?.content ?? persona.seedSelf;
  const fixed = await deps.core.memory.selfLines(null);
  const seeded = await deps.core.memory.selfLines(0);
  const bullets = (text: string) =>
    text
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim());
  const fixedTexts = fixed.length ? [] : bullets(persona.coreValues);
  const seedTexts = seeded.length ? [] : bullets(content);
  const needsEmbedding = !existing?.embedding;
  const texts = [...(needsEmbedding ? [content] : []), ...fixedTexts, ...seedTexts];
  const vectors = texts.length ? await deps.embedder.embed(texts, "document") : [];
  const embedding = needsEmbedding ? vectors.shift()! : existing!.embedding!;
  return deps.core.transaction(async (tx) => {
    await tx.lock("core_seed_snapshot");
    const inserted = await tx.memory.insertSnapshot({
      version: 0,
      content,
      embedding,
      sections: {},
      source_ids: [],
      rendered_at: deps.clock.now(),
      model: "seed",
      prompt_version: deps.config.prompts.persona,
    });
    await tx.memory.backfillSnapshotEmbedding(0, embedding);
    if (!(await tx.memory.selfLines(null)).length)
      await tx.memory.insertSelfLines(
        fixedTexts.map((text, index) => ({ version: null, text, embedding: vectors[index]! })),
      );
    if (!(await tx.memory.selfLines(0)).length)
      await tx.memory.insertSelfLines(
        seedTexts.map((text, index) => ({
          version: 0,
          text,
          embedding: vectors[fixedTexts.length + index]!,
        })),
      );
    return inserted;
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
