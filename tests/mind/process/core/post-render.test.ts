/** Rendering: she stands on the quieter side, the output has the format's size, and a seed repeats. */
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { seededUnit } from "@/mind/platform/seeded-random";
import type { StillFormat } from "@/mind/process/core/post-library";
import {
  canvasSize,
  framedSize,
  quieterSide,
  renderStill,
  roughness,
} from "@/mind/process/core/post-render";
import { fixturePng } from "../../../helpers/web";

const posts = loadConfig().posts;
const pose = {
  png: readFileSync("assets/poses/walk-01.png"),
  facing: "right" as const,
  anchor: [200, 980] as [number, number],
};
const format: StillFormat = {
  name: "t",
  medium: "still",
  min_skill: 0,
  aspect: "4:5",
  frame: "none",
  placement: { side: "auto", scale: [0.4, 0.5] },
  poses: ["walking"],
  overlay: { kind: "none", position: "bottom", style: "plain" },
  grain: 0.2,
  caption_pattern: "short",
  reviewed: true,
};
const input = async (over: Partial<Parameters<typeof renderStill>[0]> = {}) => ({
  content: await fixturePng(),
  format,
  pose,
  overlayText: null,
  skill: 0.2,
  seed: "post-1",
  posts,
  ...over,
});

test("sizes by aspect and frame", () => {
  expect(canvasSize(format, 1080)).toEqual({ width: 1080, height: 1350 });
  expect(canvasSize({ ...format, aspect: "1:1" }, 1080)).toEqual({ width: 1080, height: 1080 });
  expect(canvasSize({ ...format, aspect: "9:16" }, 1080)).toEqual({ width: 1080, height: 1920 });
  expect(framedSize(format, 1080)).toEqual({ width: 1080, height: 1350 });
  const polaroid = framedSize({ ...format, frame: "polaroid" }, 1080);
  expect(polaroid.height - 1350).toBeGreaterThan(polaroid.width - 1080);
});

test("the quieter side is the one without detail", async () => {
  expect(await quieterSide(await fixturePng({ busy: "left" }))).toBe("right");
  expect(await quieterSide(await fixturePng({ busy: "right" }))).toBe("left");
});

test("roughness falls with skill", () => {
  expect(roughness(0)).toBe(1);
  expect(roughness(0.75)).toBeCloseTo(0.25);
  expect(roughness(2)).toBe(0);
});

test("a render has the framed size and repeats byte for byte for the same seed", async () => {
  for (const frame of ["none", "border", "polaroid", "screenshot"] as const) {
    const f = { ...format, frame };
    const out = await renderStill(await input({ format: f }));
    const meta = await sharp(out).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual(framedSize(f, posts.output_width));
    expect(meta.format).toBe("png");
  }
  const a = await renderStill(await input());
  const b = await renderStill(await input());
  expect(a.equals(b)).toBe(true);
  const c = await renderStill(await input({ seed: "post-2" }));
  expect(a.equals(c)).toBe(false);
});

test("she lands on the quieter side", async () => {
  const flat = await fixturePng({ busy: "none" });
  const base = await sharp(
    await renderStill(
      await input({
        content: await fixturePng({ busy: "left" }),
        skill: 1,
        format: { ...format, grain: 0 },
      }),
    ),
  )
    .raw()
    .toBuffer({ resolveWithObject: true });
  const empty = await sharp(
    await renderStill(
      await input({
        content: flat,
        skill: 1,
        format: { ...format, grain: 0 },
        pose: {
          ...pose,
          png: await sharp({
            create: {
              width: 400,
              height: 1000,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
          })
            .png()
            .toBuffer(),
        },
      }),
    ),
  )
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Her silhouette is dark: the right half of the busy-left render is darker than without her.
  const darkness = (img: typeof base, fromX: number, toX: number) => {
    let sum = 0;
    for (let y = 0; y < img.info.height; y += 4)
      for (let x = fromX; x < toX; x += 4)
        sum += 255 - img.data[(y * img.info.width + x) * img.info.channels]!;
    return sum;
  };
  const w = base.info.width;
  expect(darkness(base, w / 2, w)).toBeGreaterThan(darkness(empty, w / 2, w));
});

test("overlay text with markup characters renders literally without throwing", async () => {
  const f = {
    ...format,
    overlay: {
      kind: "caption_in_image" as const,
      position: "top" as const,
      style: "plain" as const,
    },
  };
  const out = await renderStill(await input({ format: f, overlayText: "stars & films <3" }));
  expect((await sharp(out).metadata()).width).toBe(posts.output_width);
});

test("a tilted render never shows the rotation's black corners", async () => {
  const f = { ...format, frame: "border" as const };
  const seed = ["a", "b", "c", "d", "e", "f"]
    .map((s) => `tilt-${s}`)
    .find((s) => Math.abs((seededUnit(`${s}:tilt`) * 2 - 1) * posts.jitter.tilt_deg) > 1)!;
  const out = await sharp(await renderStill(await input({ format: f, skill: 0, seed })))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: ch } = out.info;
  const pts = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
    [w >> 1, 0],
    [w >> 1, h - 1],
    [0, h >> 1],
    [w - 1, h >> 1],
  ];
  // The picture itself is dark blue (about 55 and up); the wedges would be near 0.
  for (const [x, y] of pts)
    for (let c = 0; c < 3; c++) expect(out.data[(y! * w + x!) * ch + c]!).toBeGreaterThan(30);
});
