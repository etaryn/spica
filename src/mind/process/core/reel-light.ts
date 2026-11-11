/**
 * How she's lit inside what she found: where it's quieter (she stands there, facing the busier
 * side), its light (she's tinted toward its mean colour and rim-lit in its brightest), and seeded
 * grain. No model: pure functions of the picture and the seed, so a reel can be redone exactly.
 */
import sharp from "sharp";
import type { Config } from "@/mind/platform/config";
import { clamp } from "@/mind/platform/math";
import { seededUnit } from "@/mind/platform/seeded-random";

type Rgb = { r: number; g: number; b: number };

/** Edge energy of the left and right thirds; she stands where there's less going on. */
export async function quieterSide(image: Buffer): Promise<"left" | "right"> {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const third = Math.floor(info.width / 3);
  const at = (x: number, y: number) => data[y * info.width + x]!;
  // Neighbour differences, summed: enough to tell a busy third from a calm one. (sharp's
  // convolve saturates on this kernel, so the gradient is computed here.)
  const energy = (from: number) => {
    let sum = 0;
    for (let y = 0; y < info.height - 1; y++)
      for (let x = from; x < from + third - 1; x++)
        sum += Math.abs(at(x, y) - at(x + 1, y)) + Math.abs(at(x, y) - at(x, y + 1));
    return sum;
  };
  return energy(0) <= energy(info.width - third) ? "left" : "right";
}

const solid = (width: number, height: number, c: Rgb, alpha = 1) =>
  sharp({ create: { width, height, channels: 4, background: { ...c, alpha } } })
    .png()
    .toBuffer();

/** Seeded grain: a grey noise layer, the same for the same seed. */
export async function grain(width: number, height: number, amount: number, seed: string) {
  let state = Math.floor(seededUnit(`${seed}:grain`) * 2 ** 32) >>> 0;
  const next = () => {
    // mulberry32: tiny, fast and deterministic.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  const px = Buffer.alloc(width * height);
  const spread = 255 * amount * 0.5;
  for (let i = 0; i < px.length; i++)
    px[i] = clamp(Math.round(128 + (next() * 2 - 1) * spread), 0, 255);
  return sharp(px, { raw: { width, height, channels: 1 } })
    .toColourspace("srgb")
    .png()
    .toBuffer();
}

/** The content's light: its mean colour (her tint), brightest colour (her rim) and brightness. */
export type Light = { mean: Rgb; rim: Rgb; luma: number };

export async function lightOf(base: Buffer): Promise<Light> {
  const stats = await sharp(base).stats();
  const [r, g, b] = stats.channels.map((c) => c.mean);
  const mean = { r: r!, g: g!, b: b! };
  return { mean, rim: stats.dominant, luma: 0.299 * mean.r + 0.587 * mean.g + 0.114 * mean.b };
}

/** Her frame lit by the content: tinted toward its mean colour, and a rim glow in its brightest. */
export async function lightHer(her: Buffer, light: Light, rd: Config["posts"]["render"]) {
  const { width: w, height: h } = await sharp(her).metadata();
  const tinted = await sharp(her)
    .modulate({ brightness: clamp(light.luma / rd.tint_luma_divisor, ...rd.tint_brightness) })
    .composite([
      { input: await solid(w!, h!, light.mean), blend: "soft-light" },
      { input: her, blend: "dest-in" },
    ])
    .png()
    .toBuffer();
  const glow = await sharp(await solid(w!, h!, light.rim))
    .composite([{ input: her, blend: "dest-in" }])
    .blur(rd.glow_blur)
    .png()
    .toBuffer();
  return { tinted, glow };
}
