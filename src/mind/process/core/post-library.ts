/**
 * Her posts' goal ("Find friends and share her life", Ethan's): a seed goal in her persona that
 * her approved posts count toward, so she remembers why she posts. It always exists: a dropped one
 * comes back, even past the active-goal cap. Reflection can't drop it and it never completes; her
 * appraisal of how each post landed moves its progress. How good her posts are is Ethan's dial
 * (`posts.skill`), not this goal.
 */
import type { Config } from "@/mind/platform/config";
import type { CoreDeps } from "@/mind/platform/deps";
import type { CoreGoal } from "@/mind/state/core/types";
import { loadPersona, parseSeedGoals } from "@/mind/platform/persona";

export const isPostGoal = (goal: Pick<CoreGoal, "title">, config: Config) =>
  goal.title === config.posts.goal;

/**
 * The live goal's id, re-created from the persona when it isn't active; null (logged) when the
 * persona has no such goal.
 * ponytail: two concurrent first calls could both create it; post_tick is the only caller.
 */
export async function postGoal(
  deps: Pick<CoreDeps, "core" | "config" | "embedder" | "log" | "clock">,
): Promise<string | null> {
  const { core, config } = deps;
  const title = config.posts.goal;
  const goal = await core.goals.byTitle(title);
  if (goal?.status === "active") return goal.id;
  const seed = parseSeedGoals(loadPersona(config).seedSelf).find((g) => g.title === title);
  if (!seed) {
    deps.log.info("post goal not in the persona", { title });
    return null;
  }
  const [embedding] = await deps.embedder.embed([`${seed.title}: ${seed.why}`], "document");
  return core.goals.insert({
    ...seed,
    status: "active",
    progress: 0,
    source: "seed",
    source_ref: `persona:${config.prompts.persona}`,
    started_at: deps.clock.now(),
    target_at: null,
    embedding: embedding!,
  });
}
