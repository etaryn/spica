/**
 * `post_tick`, hourly: when she's free and something she came across moved her, she makes a post
 * of herself inside it. Code owns every choice (whether, which find, format, pose, the picture);
 * the model only writes the words and checks them. The draft waits for Ethan; nothing reaches her
 * mind until he approves it.
 */
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { readMedia, saveMedia } from "@/mind/platform/media";
import { seededUnit } from "@/mind/platform/seeded-random";
import { DAY, HOUR } from "@/mind/platform/time";
import { blockAt, todaysBlocks } from "@/mind/world/blocks";
import { lifeDate } from "@/mind/world/her-clock";
import { eventRef } from "./appraise";
import {
  choosePose,
  craftSkill,
  eligibleFormats,
  loadFormats,
  loadPoses,
  type Pose,
} from "./post-library";
import { renderStill } from "./post-render";
import { loadManifest, loadReelFormats, type ReelManifest } from "./reel-library";
import { makeReel } from "./reel-render";
import { checkPost, draftPost, type Draft } from "./post-words";
import { publicPersona } from "./public-persona";
import { budgetDayStart, runCoreLoop } from "./runner";
import path from "node:path";
import type { PostCheck } from "@/mind/world/types";

export type PostTickResult =
  | { status: "drafted"; postId: string }
  | {
      status: "skipped";
      reason:
        | "today"
        | "week"
        | "busy"
        | "pending"
        | "no_find"
        | "no_format"
        | "no_pose"
        | "budget"
        | "draft_failed"
        | "no_words"
        | "render_failed";
    };

const skip = (
  reason: Extract<PostTickResult, { status: "skipped" }>["reason"],
): PostTickResult => ({
  status: "skipped",
  reason,
});

export async function postTick(deps: CoreDeps, now: Date): Promise<PostTickResult> {
  const { core, config, log } = deps;
  const cfg = config.posts;
  if ((await core.posts.postsSince(budgetDayStart(config, now))) > 0) return skip("today");
  if ((await core.posts.postsSince(new Date(now.getTime() - 7 * DAY))) >= cfg.max_per_week)
    return skip("week");
  if (blockAt(await todaysBlocks(deps, now), now)) return skip("busy");
  if ((await core.posts.drafts()) >= cfg.max_pending) return skip("pending");

  // Her take is read as a number only; its words are her private memory.
  const since = new Date(now.getTime() - cfg.max_find_age_hours * HOUR);
  let find = null;
  let valence = 0;
  for (const f of await core.posts.unposted(since, cfg.candidate_limit)) {
    const episode = await core.memory.bySourceRef("episode", eventRef(f.world_event_id));
    if (episode && Math.abs(episode.valence) >= cfg.min_valence) {
      find = f;
      valence = episode.valence;
      break;
    }
  }
  if (!find) return skip("no_find");

  const stillSkill = (await craftSkill(deps, "still")).skill;
  const stills = eligibleFormats(loadFormats(cfg.formats_dir, log), cfg.capabilities, stillSkill);
  let manifest: ReelManifest | null = null;
  if (cfg.capabilities.includes("reel")) manifest = loadManifest(cfg.reel.manifest);
  const reels = manifest
    ? eligibleFormats(
        loadReelFormats(cfg.reel.formats_dir, manifest, cfg.reel.max_frames, log),
        cfg.capabilities,
        cfg.craft_skill.reel,
      )
    : [];
  const formats = [...stills, ...reels];
  if (!formats.length) return skip("no_format");
  const format = formats[Math.floor(seededUnit(`${find.id}:format`) * formats.length)]!;
  const skill = format.medium === "still" ? stillSkill : cfg.craft_skill.reel;
  let pose: Pose | null = null;
  if (format.medium === "reel") {
    // Checked before drafting: a reel that can't render would otherwise re-spend a draft call
    // every hour.
    const missing = deps.reelTools.missing();
    if (missing) {
      log.error("reel renderer missing", { find: find.id, file: missing });
      return skip("render_failed");
    }
  }
  if (format.medium === "still") {
    pose = choosePose(loadPoses(cfg.poses_dir), format, seededUnit(`${find.id}:pose`));
    if (!pose) return skip("no_pose");
  }

  // Read before drafting: a missing file would otherwise re-spend a draft call every hour.
  let content: Buffer;
  let posePng: Buffer | null = null;
  try {
    content = await readMedia(find.media_path);
    if (pose) posePng = await readMedia(path.join(cfg.poses_dir, pose.file));
  } catch (error) {
    log.error("post media unreadable", { find: find.id, error: errorName(error) });
    return skip("render_failed");
  }

  const persona = await publicPersona(deps, now);
  const drafted = await runCoreLoop<Draft | null>(deps, "post_draft", now, async (ctx) => {
    const draft = await draftPost(ctx.deps, {
      persona,
      find,
      valence,
      format: {
        name: format.name,
        caption_pattern: format.caption_pattern,
        overlay: { kind: format.medium === "still" ? format.overlay.kind : "none" },
      },
      skill,
    });
    return {
      inputs: { find: find.id, format: format.name, skill },
      outputs: draft,
      promptVersion: config.prompts.post_draft,
    };
  }).catch((error) => {
    log.error("post draft failed", { find: find.id, error: errorName(error) });
    return null;
  });
  if (!drafted) return skip("draft_failed");
  if (drafted.status === "skipped_budget") return skip("budget");
  const draft = drafted.outputs;
  if (!draft) return skip("no_words");

  let media: string;
  let made: string; // the pose, or a reel's clips
  try {
    if (format.medium === "still") {
      const image = await renderStill({
        content,
        format,
        pose: { png: posePng!, facing: pose!.facing, anchor: pose!.anchor },
        overlayText: draft.overlay_text,
        skill,
        seed: find.id,
        posts: cfg,
      });
      media = await saveMedia(cfg.media_dir, `posts/${find.id}.png`, image);
      made = pose!.name;
    } else {
      // Rendered in this job: minutes of Blender, but nothing else waits on the post tick.
      ({ media, clips: made } = await makeReel(deps, {
        format,
        manifest: manifest!,
        find,
        valence,
      }));
    }
  } catch (error) {
    log.error("post render failed", { find: find.id, error: errorName(error) });
    return skip("render_failed");
  }

  let check: PostCheck = "unchecked";
  let reason: string | null = null;
  const checked = await runCoreLoop(deps, "post_check", now, async (ctx) => {
    const verdict = await checkPost(ctx.deps, { draft, find });
    return {
      inputs: { find: find.id },
      outputs: verdict,
      promptVersion: config.prompts.post_check,
    };
  }).catch((error) => {
    log.error("post check failed", { find: find.id, error: errorName(error) });
    return null;
  });
  if (checked?.outputs) {
    check = checked.outputs.ok ? "ok" : "flagged";
    reason = checked.outputs.ok ? null : checked.outputs.reason;
  }

  const postId = await core.posts.insertPost({
    find_id: find.id,
    medium: format.medium,
    format: format.name,
    pose: made,
    caption: draft.caption,
    overlay_text: draft.overlay_text,
    media_path: media,
    skill,
    check,
    check_reason: reason,
    created_at: now,
  });
  return { status: "drafted", postId };
}

/**
 * Ethan's decision on a draft. Approving makes posting something she did: an action in her world,
 * tied to her craft goal, which lands through appraisal like anything else, so she remembers it
 * and decides for herself whether it went well. A rejected draft never happened to her.
 */
export async function decidePost(
  deps: Pick<CoreDeps, "core" | "config" | "clock">,
  postId: string,
  decision: "approve" | "reject",
): Promise<boolean> {
  const { config } = deps;
  const now = deps.clock.now();
  return deps.core.transaction(async (tx) => {
    const post = await tx.posts.lockPost(postId);
    if (!post || post.status !== "draft") return false;
    let actionEventId: string | null = null;
    if (decision === "approve") {
      const find = await tx.posts.getFind(post.find_id);
      const goal = await tx.goals.byTitle(config.posts.craft_goals[post.medium]);
      actionEventId = await tx.world.recordEvent({
        at: now,
        kind: "action",
        content: `Spica posted "${post.caption}" about "${find?.title ?? "something she found"}".`,
        valence: 0,
        stakes: "low",
        agents: [],
        life_day: lifeDate(config.life, now),
        created_at: now,
        goal_ref: goal?.status === "active" ? goal.id : null,
      });
    }
    await tx.posts.decide(postId, {
      status: decision === "approve" ? "approved" : "rejected",
      decided_at: now,
      action_event_id: actionEventId,
    });
    return true;
  });
}
