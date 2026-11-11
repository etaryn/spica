/**
 * `post_tick`, hourly: when she's free and something she came across moved her, she makes a reel
 * of herself inside it. Code owns every choice (whether, which find, the format, every shot); the
 * model only writes the caption and checks it. The draft waits for Ethan; nothing reaches her mind
 * until he approves it.
 */
import { existsSync } from "node:fs";
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { seededUnit } from "@/mind/platform/seeded-random";
import { DAY, HOUR } from "@/mind/platform/time";
import { blockAt, todaysBlocks } from "@/mind/world/blocks";
import { lifeDate } from "@/mind/world/her-clock";
import { eventRef } from "./appraise";
import { postGoal } from "./post-library";
import { checkPost, draftPost, type Draft } from "./post-words";
import { publicPersona } from "./public-persona";
import { eligibleFormats, loadManifest, loadReelFormats } from "./reel-library";
import { makeReel } from "./reel-render";
import { budgetDayStart, runCoreLoop } from "./runner";
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

  await postGoal(deps);
  const skill = cfg.skill;
  const manifest = loadManifest(cfg.reel.manifest);
  const formats = eligibleFormats(
    loadReelFormats(cfg.reel.formats_dir, manifest, cfg.reel.max_frames, log),
    skill,
  );
  if (!formats.length) return skip("no_format");
  const format = formats[Math.floor(seededUnit(`${find.id}:format`) * formats.length)]!;

  // Checked before drafting: a reel that can't render would otherwise re-spend a draft call
  // every hour.
  const missing = existsSync(find.media_path) ? deps.reelTools.missing() : find.media_path;
  if (missing) {
    log.error("post media missing", { find: find.id, file: missing });
    return skip("render_failed");
  }

  const persona = await publicPersona(deps, now);
  const drafted = await runCoreLoop<Draft | null>(deps, "post_draft", now, async (ctx) => {
    const draft = await draftPost(ctx.deps, {
      persona,
      find,
      valence,
      format,
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

  let reel: { media: string; clips: string };
  try {
    // Rendered in this job: minutes of Blender, but nothing else waits on the post tick.
    reel = await makeReel(deps, { format, manifest, find, valence });
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
    format: format.name,
    clips: reel.clips,
    caption: draft.caption,
    media_path: reel.media,
    skill,
    check,
    check_reason: reason,
    created_at: now,
  });
  return { status: "drafted", postId };
}

/**
 * Ethan's decision on a draft. Approving makes posting something she did: an action in her world,
 * tied to her posts' goal, which lands through appraisal like anything else, so she remembers it
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
      const goal = await tx.goals.byTitle(config.posts.goal);
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
