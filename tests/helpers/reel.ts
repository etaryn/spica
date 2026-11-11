/** Reel tools for tests: real ffmpeg, a stand-in for Blender, and a frame count read back from an MP4. */
import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";
import type { Config } from "@/mind/platform/config";
import type { ReelTools } from "@/mind/platform/reel-tools";
import { createReelTools } from "@/runtime/reel-tools";

type Edit = { width: number; height: number; shots: { frames: number; x: number }[] };

/** Her frames as a white block at the shot's `x` on a transparent frame, one PNG per frame. */
export function fakeReelTools(
  config: Config,
  over: Partial<ReelTools> = {},
): ReelTools & { rendered: string[] } {
  const rendered: string[] = [];
  return {
    ...createReelTools(config.posts.reel),
    rendered,
    missing: () => null,
    async renderShots(editListPath, outDir) {
      rendered.push(editListPath);
      const edit = JSON.parse(await readFile(editListPath, "utf8")) as Edit;
      const { width: W, height: H } = edit;
      const w = Math.round(W * 0.2);
      const h = Math.round(H * 0.4);
      for (const [n, shot] of edit.shots.entries()) {
        const dir = path.join(outDir, `shot-${String(n + 1).padStart(2, "0")}`);
        await mkdir(dir, { recursive: true });
        const png = await sharp({
          create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        })
          .composite([
            {
              input: { create: { width: w, height: h, channels: 4, background: "#ffffff" } },
              left: Math.round(shot.x * W - w / 2),
              top: Math.round((H - h) / 2),
            },
          ])
          .png()
          .toBuffer();
        for (let i = 1; i <= shot.frames; i++)
          await sharp(png).toFile(path.join(dir, `${String(i).padStart(4, "0")}.png`));
      }
    },
    ...over,
  };
}

/** Frame count and size of a video, read from ffmpeg's own decode. */
export async function mp4Frames(file: string) {
  const proc = spawn(ffmpegStatic!, ["-stats", "-i", file, "-map", "0:v:0", "-f", "null", "-"]);
  let err = "";
  proc.stderr.on("data", (d: Buffer) => (err += d.toString()));
  await new Promise((resolve) => proc.on("close", resolve));
  const frames = [...err.matchAll(/frame=\s*(\d+)/g)].at(-1)?.[1];
  const size = /, (\d{2,})x(\d{2,})/.exec(err);
  return { frames: Number(frames), width: Number(size?.[1]), height: Number(size?.[2]) };
}
