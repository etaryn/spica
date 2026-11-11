/**
 * Writes a reel's edit list from a reel format: each shot's clip, face, camera and pan, drawn from
 * the format's ranges and seeded by the find, so the same find always gives the same reel. As in
 * her stills, she stands on the quieter side of what's behind her and turns toward the busier one;
 * her face follows how the find made her feel.
 */
import path from "node:path";
import sharp from "sharp";
import type { Config } from "@/mind/platform/config";
import { isStill, type ReelTools } from "@/mind/platform/reel-tools";
import { seededUnit } from "@/mind/platform/seeded-random";
import { quieterSide } from "./post-render";
import type { ReelFormat, ReelManifest } from "./reel-library";

export type ReelShot = {
  clip: string;
  start: number;
  frames: number;
  face: string;
  azimuth: number;
  elevation: number;
  framing: string;
  x: number;
  background: { file: string; offset: number; pan: [number, number] };
};
export type EditList = { width: number; height: number; shots: ReelShot[] };

/** 9:16 at the given width, the height kept even for H.264. */
export const reelSize = (width: number) => ({
  width,
  height: 2 * Math.round((width * 16) / 9 / 2),
});

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;
const lerp = ([a, b]: [number, number], t: number) => a + (b - a) * t;

export async function editList(
  tools: ReelTools,
  input: {
    format: ReelFormat;
    manifest: ReelManifest;
    seed: string;
    file: string;
    valence: number;
    posts: Config["posts"];
  },
): Promise<EditList> {
  const { format, manifest, posts } = input;
  const size = reelSize(posts.output_width);
  const file = path.resolve(input.file);
  const faces = input.valence > 0 ? format.faces.warm : format.faces.low;
  const shots: ReelShot[] = [];
  let before = 0;
  for (const [i, slot] of format.shots.entries()) {
    const u = (key: string) => seededUnit(`${input.seed}:shot-${i}:${key}`);
    const pick = <T>(xs: T[], key: string) => xs[Math.floor(u(key) * xs.length)]!;
    const clip = pick(
      manifest.clips.filter((c) => c.tags.some((t) => slot.tags.includes(t))),
      "clip",
    );
    const frames = Math.round(lerp(slot.frames, u("frames")));
    const span = lerp(slot.pan, u("span"));
    const from = u("from") * (1 - span);
    const pan: [number, number] =
      u("dir") < 0.5
        ? [round(from, 3), round(from + span, 3)]
        : [round(from + span, 3), round(from, 3)];
    const offset = isStill(file) ? 0 : before / manifest.fps;
    const side = await quieterSide(
      await firstFrame(tools, file, offset, pan[0], size, manifest.fps),
    );
    const azimuth = round(lerp(slot.azimuth, u("azimuth")), 1);
    shots.push({
      clip: clip.name,
      start: clip.loops ? Math.floor(u("start") * clip.frames) : 0,
      frames,
      face: pick(faces, "face"),
      azimuth: side === "left" ? -azimuth : azimuth,
      elevation: round(lerp(slot.elevation, u("elevation")), 1),
      framing: slot.framing,
      x: side === "left" ? posts.render.foot_left : posts.render.foot_right,
      background: { file, offset, pan },
    });
    before += frames;
  }
  return { ...size, shots };
}

/** The shot's opening frame as a PNG, to see where it's busy. */
async function firstFrame(
  tools: ReelTools,
  file: string,
  offset: number,
  at: number,
  size: { width: number; height: number },
  fps: number,
): Promise<Buffer> {
  for await (const raw of tools.background(file, {
    offset,
    frames: 1,
    fps,
    ...size,
    pan: [at, at],
  }))
    return sharp(raw, { raw: { ...size, channels: 3 } })
      .png()
      .toBuffer();
  throw new Error(`background ${file} has no frames`);
}
