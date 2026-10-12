/**
 * `pnpm posts:review`: today's real finds, every reviewed format, real draft and check calls, and
 * the renders, written to .data/review/<time>/ with a log of every input and output, for Ethan to
 * judge by eye. Reads her public self from the dev database and writes nothing to it: her skill is
 * read straight from the craft goal (0 when it doesn't exist yet) instead of through `craftSkill`,
 * which would insert the goal.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { coreDepsOf } from "@/mind/platform/deps";
import { isFreeLicence } from "@/mind/process/core/browse";
import {
  choosePose,
  eligibleFormats,
  loadFormats,
  loadPoses,
} from "@/mind/process/core/post-library";
import { renderStill } from "@/mind/process/core/post-render";
import { checkPost, draftPost } from "@/mind/process/core/post-words";
import { publicPersona } from "@/mind/process/core/public-persona";
import { lifeDate } from "@/mind/world/her-clock";
import { buildRuntime } from "@/runtime/deps";
import { readEnv } from "@/runtime/env";

const { deps } = buildRuntime(readEnv());
const core = coreDepsOf(deps);
const cfg = deps.config.posts;
const now = deps.clock.now();
const out = path.join(".data", "review", now.toISOString().replace(/[:.]/g, "-"));
mkdirSync(out, { recursive: true });
const persona = await publicPersona(core);
const goal = await deps.core.goals.byTitle(cfg.craft_goals.still);
const skill = goal ? (goal.status === "done" ? 1 : goal.progress) : 0;
// Every reviewed format regardless of skill, so a high-skill format can still be eyeballed.
const formats = eligibleFormats(loadFormats(cfg.formats_dir, deps.log), cfg.capabilities, 1);
const poses = loadPoses(cfg.poses_dir);
const log: unknown[] = [];
for (const [name, source] of Object.entries(deps.webSources)) {
  const item = await source.fetch(lifeDate(deps.config.life, now)).catch((e: Error) => e);
  if (!item || item instanceof Error || !isFreeLicence(item.licence)) {
    log.push({
      source: name,
      skipped: item instanceof Error ? item.message : (item?.licence ?? "none"),
    });
    continue;
  }
  const content = await sharp(item.image)
    .resize(cfg.max_find_px, cfg.max_find_px, { fit: "inside" })
    .png()
    .toBuffer();
  for (const format of formats) {
    const pose = choosePose(poses, format, 0.5);
    if (!pose) continue;
    const find = { title: item.title, source: item.source, credit: item.credit };
    const draft = await draftPost(deps, { persona, find, valence: 0.6, format, skill });
    if (!draft) continue;
    const check = await checkPost(deps, { draft, find });
    const file = path.join(out, `${name}-${format.name}.png`);
    writeFileSync(
      file,
      await renderStill({
        content,
        format,
        pose: {
          png: readFileSync(path.join(cfg.poses_dir, pose.file)),
          facing: pose.facing,
          anchor: pose.anchor,
        },
        overlayText: draft.overlay_text,
        skill,
        seed: `${name}-${format.name}`,
        posts: cfg,
      }),
    );
    log.push({
      source: name,
      item: find,
      format: format.name,
      pose: pose.name,
      skill,
      draft,
      check,
      file,
    });
  }
}
writeFileSync(path.join(out, "log.json"), JSON.stringify({ persona, log }, null, 2));
console.log(`review written to ${out}`);
process.exit(0);
