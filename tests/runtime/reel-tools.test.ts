/** The reel's ffmpeg and Blender calls: frames in and out, the pan's direction, and failures named. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { createReelTools } from "@/runtime/reel-tools";
import { mp4Frames } from "../helpers/reel";

const W = 64;
const H = 112;
const cfg = loadConfig().posts.reel;
const tools = createReelTools(cfg);
const dir = () => mkdtempSync(path.join(tmpdir(), "reel-tools-"));

async function* solid(n: number, grey = 128) {
  for (let i = 0; i < n; i++) yield Buffer.alloc(W * H * 3, grey);
}

const collect = async (frames: AsyncIterable<Buffer>) => {
  const out: Buffer[] = [];
  for await (const f of frames) out.push(f);
  return out;
};

/** Mean red minus mean blue of a raw RGB frame. */
const redness = (f: Buffer) => {
  let d = 0;
  for (let i = 0; i < f.length; i += 3) d += f[i]! - f[i + 2]!;
  return d / (f.length / 3);
};

test("encode writes every frame at the given size", async () => {
  const out = path.join(dir(), "a.mp4");
  await tools.encode(solid(10), { width: W, height: H, fps: 24, crf: 18, out });
  expect(await mp4Frames(out)).toEqual({ frames: 10, width: W, height: H });
});

test("a wide still is filled and panned from its left edge to its right", async () => {
  const file = path.join(dir(), "wide.png");
  await sharp({ create: { width: 400, height: 100, channels: 3, background: "#ff0000" } })
    .composite([
      {
        input: { create: { width: 200, height: 100, channels: 3, background: "#0000ff" } },
        left: 200,
        top: 0,
      },
    ])
    .png()
    .toFile(file);
  const frames = await collect(
    tools.background(file, { offset: 0, frames: 5, fps: 24, width: W, height: H, pan: [0, 1] }),
  );
  expect(frames).toHaveLength(5);
  expect(frames.every((f) => f.length === W * H * 3)).toBe(true);
  expect(redness(frames[0]!)).toBeGreaterThan(200);
  expect(redness(frames[4]!)).toBeLessThan(-200);
});

test("a video shorter than its shot fails, saying so", async () => {
  const file = path.join(dir(), "short.mp4");
  await tools.encode(solid(8), { width: W, height: H, fps: 24, crf: 18, out: file });
  await expect(
    collect(
      tools.background(file, { offset: 0, frames: 12, fps: 24, width: W, height: H, pan: [0, 0] }),
    ),
  ).rejects.toThrow(/too short: 8 of 12/);
});

test("a missing Blender fails naming the exe", async () => {
  const broken = createReelTools({ ...cfg, blender: "no-such-blender" });
  await expect(broken.renderShots("x.json", dir())).rejects.toThrow(/no-such-blender/);
});

test("an encode that ffmpeg can't write fails with ffmpeg's reason, not a broken pipe", async () => {
  const out = path.join(dir(), "missing-folder", "x.mp4");
  await expect(
    tools.encode(solid(200), { width: W, height: H, fps: 24, crf: 18, out }),
  ).rejects.toThrow(/exited/);
});

test("a frame source that fails stops the encode with its own error", async () => {
  async function* failing() {
    yield* solid(3);
    throw new Error("frame 4 broke");
  }
  const out = path.join(dir(), "b.mp4");
  await expect(
    tools.encode(failing(), { width: W, height: H, fps: 24, crf: 18, out }),
  ).rejects.toThrow("frame 4 broke");
});

test("missing names a renderer file that isn't there; none missing is null", () => {
  expect(createReelTools({ ...cfg, blend: "no/such.blend" }).missing()).toMatch(
    /no[\/]such\.blend/,
  );
  const here = createReelTools({
    ...cfg,
    blender: "package.json",
    script: "package.json",
    blend: "package.json",
  });
  expect(here.missing()).toBeNull();
});
