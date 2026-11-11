/**
 * Makes a reel of her inside a find: the edit list, her frames from the renderer, each laid over
 * the find (filled, panned, hard cuts between shots) and lit like her stills (tint, rim light,
 * grain), then encoded as a silent MP4. No model: the same find and format give the same reel.
 */
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { Config } from "@/mind/platform/config";
import type { CoreDeps } from "@/mind/platform/deps";
import { saveMedia } from "@/mind/platform/media";
import type { ReelTools } from "@/mind/platform/reel-tools";
import { grain, lightHer, lightOf, type Light } from "./post-render";
import { editList, type EditList } from "./reel-edit";
import type { ReelFormat, ReelManifest } from "./reel-library";

const pad = (n: number, width: number) => String(n).padStart(width, "0");

type RenderInput = {
  edit: EditList;
  framesDir: string;
  out: string;
  fps: number;
  grain: number;
  seed: string;
  posts: Config["posts"];
};

async function* composite(tools: ReelTools, input: RenderInput): AsyncIterable<Buffer> {
  const { edit, posts } = input;
  const size = { width: edit.width, height: edit.height };
  for (const [n, shot] of edit.shots.entries()) {
    const dir = path.join(input.framesDir, `shot-${pad(n + 1, 2)}`);
    // Light and grain are set once a shot, so nothing flickers within it.
    const grainLayer =
      input.grain > 0
        ? await grain(size.width, size.height, input.grain, `${input.seed}:${n}`)
        : null;
    let light: Light | null = null;
    let i = 0;
    try {
      for await (const bg of tools.background(shot.background.file, {
        offset: shot.background.offset,
        frames: shot.frames,
        fps: input.fps,
        ...size,
        pan: shot.background.pan,
      })) {
        const base = sharp(bg, { raw: { ...size, channels: 3 } });
        light ??= await lightOf(await base.clone().png().toBuffer());
        const her = await readFile(path.join(dir, `${pad(++i, 4)}.png`));
        const { tinted, glow } = await lightHer(her, light, posts.render);
        yield await base
          .composite([
            { input: glow },
            { input: tinted },
            ...(grainLayer ? [{ input: grainLayer, blend: "soft-light" as const }] : []),
          ])
          .removeAlpha()
          .raw()
          .toBuffer();
      }
    } catch (error) {
      throw new Error(`shot ${n + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function renderReel(tools: ReelTools, input: RenderInput): Promise<void> {
  await tools.encode(composite(tools, input), {
    width: input.edit.width,
    height: input.edit.height,
    fps: input.fps,
    crf: input.posts.reel.crf,
    out: input.out,
  });
}

/** The whole reel for a find; returns the MP4's path and its clips, joined "+". */
export async function makeReel(
  deps: Pick<CoreDeps, "reelTools" | "config">,
  input: {
    format: ReelFormat;
    manifest: ReelManifest;
    find: { id: string; media_path: string };
    valence: number;
  },
): Promise<{ media: string; clips: string }> {
  const posts = deps.config.posts;
  const { find, manifest } = input;
  const edit = await editList(deps.reelTools, {
    format: input.format,
    manifest,
    seed: find.id,
    file: find.media_path,
    valence: input.valence,
    posts,
  });
  const editPath = await saveMedia(
    posts.media_dir,
    `reels/${find.id}/reel.json`,
    Buffer.from(JSON.stringify(edit, null, 2)),
  );
  const framesDir = path.resolve(path.dirname(editPath), "frames");
  const out = path.join(posts.media_dir, "posts", `${find.id}.mp4`);
  try {
    await deps.reelTools.renderShots(path.resolve(editPath), framesDir);
    await mkdir(path.dirname(out), { recursive: true });
    await renderReel(deps.reelTools, {
      edit,
      framesDir,
      out,
      fps: manifest.fps,
      grain: input.format.grain,
      seed: find.id,
      posts,
    });
  } catch (error) {
    await rm(out, { force: true });
    throw error;
  } finally {
    // Her frames are scratch (megabytes each); the edit list stays to show how it was made.
    await rm(framesDir, { recursive: true, force: true });
  }
  return { media: out, clips: edit.shots.map((s) => s.clip).join("+") };
}
