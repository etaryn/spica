/**
 * What her posts are made from: formats (popular post shapes Ethan reviewed, as data), poses (her
 * body as pre-rendered sprites) and her craft skill (a core goal's progress, which only appraisal
 * moves). A format she isn't good enough for yet, or a medium that isn't built, is never chosen.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Config } from "@/mind/platform/config";
import type { CoreDeps } from "@/mind/platform/deps";
import type { CoreGoal } from "@/mind/state/core/types";
import { errorName } from "@/mind/platform/errors";
import type { Logger } from "@/mind/platform/log";
import { loadPersona, parseSeedGoals } from "@/mind/platform/persona";

const share = z.number().gt(0).max(1);

export const StillFormatSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  medium: z.literal("still"),
  min_skill: z.number().min(0).max(1),
  aspect: z.enum(["1:1", "4:5", "9:16"]),
  frame: z.enum(["none", "polaroid", "screenshot", "border"]),
  placement: z.object({
    side: z.enum(["auto", "left", "right"]),
    scale: z.tuple([share, share]).refine(([lo, hi]) => lo <= hi, "scale must be [low, high]"),
  }),
  poses: z.array(z.string().min(1)).min(1),
  overlay: z.object({
    kind: z.enum(["none", "caption_in_image", "label"]),
    position: z.enum(["top", "bottom"]),
    style: z.enum(["plain", "handwritten"]),
  }),
  grain: z.number().min(0).max(1),
  caption_pattern: z.string().min(1),
  reviewed: z.boolean(),
});
export type StillFormat = z.infer<typeof StillFormatSchema>;

const PoseSchema = z.object({
  name: z.string().min(1),
  file: z.string().regex(/^[\w-]+\.png$/),
  tags: z.array(z.string().min(1)).min(1),
  facing: z.enum(["left", "right"]),
  anchor: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
});
export type Pose = z.infer<typeof PoseSchema>;

/** Every valid format file; an invalid one is logged by file name and skipped, never fatal. */
export function loadFormats(dir: string, log: Logger): StillFormat[] {
  const formats: StillFormat[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    try {
      const format = StillFormatSchema.parse(
        JSON.parse(readFileSync(path.join(dir, file), "utf8")),
      );
      if (`${format.name}.json` !== file) throw new Error("name must match the file name");
      formats.push(format);
    } catch (error) {
      log.info("format skipped", { file, error: errorName(error) });
    }
  }
  return formats;
}

export const eligibleFormats = (
  formats: StillFormat[],
  capabilities: readonly string[],
  skill: number,
) => formats.filter((f) => f.reviewed && capabilities.includes(f.medium) && f.min_skill <= skill);

/** The pose library is an asset Ethan ships, so a broken one fails loudly. */
export function loadPoses(dir: string): Pose[] {
  return z.array(PoseSchema).parse(JSON.parse(readFileSync(path.join(dir, "poses.json"), "utf8")));
}

export function choosePose(poses: Pose[], format: StillFormat, roll: number): Pose | null {
  const fits = poses.filter((p) => p.tags.some((t) => format.poses.includes(t)));
  return fits.length ? fits[Math.floor(roll * fits.length)]! : null;
}

/** Her posting skill is set by Ethan, not earned by her loops; her craft goal is how she sees it. */
export const isCraftGoal = (goal: Pick<CoreGoal, "title">, config: Config) =>
  Object.values(config.posts.craft_goals).includes(goal.title);

/**
 * Her skill at a medium is the configured value: outward improvements are timed by Ethan and read
 * in her world as her learning. The craft goal always exists and mirrors the skill; a dropped one
 * comes back, even past the active-goal cap.
 * ponytail: two concurrent first calls could both create it; post_tick is the only caller.
 */
export async function craftSkill(
  deps: Pick<CoreDeps, "core" | "config" | "embedder" | "log" | "clock">,
  medium: "still",
): Promise<{ goalId: string | null; skill: number }> {
  const { core, config } = deps;
  const skill = config.posts.craft_skill[medium];
  const now = deps.clock.now();
  const title = config.posts.craft_goals[medium];
  const goal = await core.goals.byTitle(title);
  if (goal?.status === "active") {
    if (goal.progress !== skill) await core.goals.setProgress(goal.id, skill, now);
    return { goalId: goal.id, skill };
  }
  const seed = parseSeedGoals(loadPersona(config).seedSelf).find((g) => g.title === title);
  if (!seed) {
    deps.log.info("craft goal not in the persona", { medium });
    return { goalId: null, skill };
  }
  const [embedding] = await deps.embedder.embed([`${seed.title}: ${seed.why}`], "document");
  const goalId = await core.goals.insert({
    ...seed,
    status: "active",
    progress: skill,
    source: "seed",
    source_ref: `persona:${config.prompts.persona}`,
    started_at: now,
    target_at: null,
    embedding: embedding!,
  });
  return { goalId, skill };
}
