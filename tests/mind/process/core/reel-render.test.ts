/** A whole reel for a find: the edit list kept, her frames laid over it, an MP4 of every frame. */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { saveMedia } from "@/mind/platform/media";
import { loadManifest, loadReelFormats } from "@/mind/process/core/reel-library";
import { makeReel } from "@/mind/process/core/reel-render";
import type { EditList } from "@/mind/process/core/reel-edit";
import { fakeReelTools, mp4Frames } from "../../../helpers/reel";
import { fixturePng, tmpMediaDir } from "../../../helpers/web";

const config = loadConfig({ posts: { output_width: 108, media_dir: tmpMediaDir() } });
const manifest = loadManifest(config.posts.reel.manifest);
const [format] = loadReelFormats("formats/reels", manifest, 360, {
  info() {},
  error() {},
} as never);

async function find(id: string) {
  const media = await saveMedia(config.posts.media_dir, `finds/${id}.png`, await fixturePng());
  return { id, media_path: media };
}

test("makes the reel: edit list kept, frames cleared, an MP4 of every shot's frames", async () => {
  const reelTools = fakeReelTools(config);
  const f = await find("find-a");
  const { media, clips } = await makeReel(
    { reelTools, config },
    { format: format!, manifest, find: f, valence: 0.5 },
  );
  expect(media.replace(/\\/g, "/")).toMatch(/posts\/find-a\.mp4$/);
  const dir = path.join(config.posts.media_dir, "reels", "find-a");
  const edit = JSON.parse(readFileSync(path.join(dir, "reel.json"), "utf8")) as EditList;
  expect(clips).toBe(edit.shots.map((s) => s.clip).join("+"));
  expect(reelTools.rendered).toHaveLength(1);
  expect(existsSync(path.join(dir, "frames"))).toBe(false);
  expect(await mp4Frames(media)).toEqual({
    frames: edit.shots.reduce((n, s) => n + s.frames, 0),
    width: 108,
    height: 192,
  });
});

test("a failed render leaves no MP4", async () => {
  const reelTools = fakeReelTools(config, {
    renderShots: () => Promise.reject(new Error("blender exited 1: shot 2: unknown face")),
  });
  const f = await find("find-b");
  await expect(
    makeReel({ reelTools, config }, { format: format!, manifest, find: f, valence: 0.5 }),
  ).rejects.toThrow(/unknown face/);
  expect(existsSync(path.join(config.posts.media_dir, "posts", "find-b.mp4"))).toBe(false);
});
