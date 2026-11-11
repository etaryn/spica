/**
 * Puts her inside what she's looking at: the content cropped to the format, her sprite on the
 * quieter side facing the busier one, tinted and rim-lit from the content's colours, then the
 * format's frame, text and grain, and a homemade tilt that fades as her skill grows. No model:
 * a pure function of its inputs and seed, so a render can be reproduced exactly.
 */
import sharp, { type OverlayOptions } from "sharp";
import type { Config } from "@/mind/platform/config";
import { clamp } from "@/mind/platform/math";
import { seededUnit } from "@/mind/platform/seeded-random";
import type { StillFormat } from "./post-library";

export type PoseSprite = { png: Buffer; facing: "left" | "right"; anchor: [number, number] };
export type RenderInput = {
  content: Buffer;
  format: StillFormat;
  pose: PoseSprite;
  overlayText: string | null;
  skill: number;
  seed: string;
  posts: Config["posts"];
};

type Rgb = { r: number; g: number; b: number };
const ASPECT = { "1:1": 1, "4:5": 5 / 4, "9:16": 16 / 9 } as const;
// Frame proportions are part of each frame's look, not tuning knobs.
const BORDER = 0.03;
const POLAROID_BOTTOM = 4;
const TITLE_BAR = 0.06;

export const roughness = (skill: number) => clamp(1 - skill, 0, 1);

export function canvasSize(format: StillFormat, width: number) {
  return { width, height: Math.round(width * ASPECT[format.aspect]) };
}

function frameInsets(format: StillFormat, width: number) {
  const b = Math.round(width * BORDER);
  switch (format.frame) {
    case "none":
      return { top: 0, bottom: 0, left: 0, right: 0 };
    case "border":
      return { top: b, bottom: b, left: b, right: b };
    case "polaroid":
      return { top: b, bottom: b * POLAROID_BOTTOM, left: b, right: b };
    case "screenshot":
      return { top: Math.round(width * TITLE_BAR), bottom: 0, left: 0, right: 0 };
  }
}

export function framedSize(format: StillFormat, width: number) {
  const c = canvasSize(format, width);
  const i = frameInsets(format, width);
  return { width: c.width + i.left + i.right, height: c.height + i.top + i.bottom };
}

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

/** Escapes text for Pango markup, which sharp's text input parses. */
const pango = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

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

/** Her sprite lit by the content: tinted toward its mean colour, and a rim glow in its brightest. */
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

export async function renderStill(input: RenderInput): Promise<Buffer> {
  const { format, posts, seed } = input;
  const rd = posts.render;
  const rough = roughness(input.skill);
  const u = (key: string) => seededUnit(`${seed}:${key}`);
  const signed = (key: string) => u(key) * 2 - 1;
  const { width: W, height: H } = canvasSize(format, posts.output_width);

  // Crop: a slightly zoomed, slightly off-centre frame when she's new at this.
  const zoom = 1 + posts.jitter.crop * rough;
  const zw = Math.round(W * zoom);
  const zh = Math.round(H * zoom);
  const base = await sharp(input.content)
    .removeAlpha()
    .resize(zw, zh, { fit: "cover" })
    .extract({
      left: Math.round((zw - W) * u("crop-x")),
      top: Math.round((zh - H) * u("crop-y")),
      width: W,
      height: H,
    })
    .png()
    .toBuffer();

  const side = format.placement.side === "auto" ? await quieterSide(base) : format.placement.side;
  const light = await lightOf(base);
  const { mean } = light;
  const dark = {
    r: mean.r * rd.shadow_darkness,
    g: mean.g * rd.shadow_darkness,
    b: mean.b * rd.shadow_darkness,
  };

  // Her: scaled into the format's range, facing the busier side.
  const [lo, hi] = format.placement.scale;
  const original = await sharp(input.pose.png).metadata();
  // A sprite wider than the canvas is scaled down to fit, so placement offsets can't go negative.
  const height = Math.min(
    Math.round(H * (lo + (hi - lo) * u("scale"))),
    Math.floor((W * original.height!) / original.width!),
  );
  const k = height / original.height!;
  const facing = side === "right" ? "left" : "right";
  let sprite = sharp(input.pose.png).resize({ height });
  if (input.pose.facing !== facing) sprite = sprite.flop();
  const her = await sprite.png().toBuffer();
  const herMeta = await sharp(her).metadata();
  const w = herMeta.width!;
  const ax = input.pose.facing !== facing ? w - input.pose.anchor[0] * k : input.pose.anchor[0] * k;
  const ay = input.pose.anchor[1] * k;

  const { tinted, glow } = await lightHer(her, light, rd);

  const footX =
    W *
    ((side === "right" ? rd.foot_right : rd.foot_left) + posts.jitter.place * rough * signed("x"));
  const footY = H * (rd.floor_line + posts.jitter.place * rough * signed("y"));
  const left = Math.round(clamp(footX - ax, 0, W - w));
  const top = Math.round(clamp(footY - ay, 0, H - height));
  const shadow = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><filter id="s"><feGaussianBlur stdDeviation="${rd.shadow_blur}"/></filter></defs><ellipse cx="${left + ax}" cy="${top + ay}" rx="${w * 0.35}" ry="${height * 0.025}" fill="rgb(${dark.r | 0},${dark.g | 0},${dark.b | 0})" fill-opacity="${rd.shadow_opacity}" filter="url(#s)"/></svg>`,
  );

  const layers: OverlayOptions[] = [
    { input: shadow, left: 0, top: 0 },
    { input: glow, left, top },
    { input: tinted, left, top },
  ];
  if (format.grain > 0)
    layers.push({ input: await grain(W, H, format.grain, seed), blend: "soft-light" });
  if (input.overlayText && format.overlay.kind !== "none")
    layers.push(...(await overlay(input.overlayText, format, posts, W, H)));
  let image: Buffer = await sharp(base).composite(layers).png().toBuffer();

  image = await frame(image, format, W, H);

  // Tilt last. The rotated picture is scaled up just enough that the centred, original-size
  // region lies fully inside it, so the rotation never shows its corners.
  const deg = posts.jitter.tilt_deg * rough * signed("tilt");
  if (deg !== 0) {
    const size = framedSize(format, W);
    const rad = (Math.abs(deg) * Math.PI) / 180;
    const f =
      Math.cos(rad) + Math.sin(rad) * Math.max(size.width / size.height, size.height / size.width);
    const rotated = await sharp(image).rotate(deg, { background: "#000" }).png().toBuffer();
    const rm = await sharp(rotated).metadata();
    const zw2 = Math.round(rm.width! * f);
    const zh2 = Math.round(rm.height! * f);
    image = await sharp(rotated)
      .resize(zw2, zh2)
      .extract({
        left: Math.floor((zw2 - size.width) / 2),
        top: Math.floor((zh2 - size.height) / 2),
        width: size.width,
        height: size.height,
      })
      .png()
      .toBuffer();
  }
  return image;
}

async function overlay(
  text: string,
  format: StillFormat,
  posts: Config["posts"],
  W: number,
  H: number,
): Promise<OverlayOptions[]> {
  const rd = posts.render;
  const font = posts.fonts[format.overlay.style];
  const label = format.overlay.kind === "label";
  const rendered = await sharp({
    text: {
      text: `<span foreground="${label ? "#1b1b24" : "white"}">${pango(text)}</span>`,
      font: `${font.family} ${label ? rd.label_font_size : rd.caption_font_size}`,
      fontfile: font.file,
      width: Math.round(W * rd.text_width_share),
      align: "centre",
      rgba: true,
      dpi: rd.text_dpi,
    },
  })
    .png()
    .toBuffer();
  const m = await sharp(rendered).metadata();
  const tw = Math.min(m.width!, W);
  const th = Math.min(m.height!, H);
  const pad = Math.round(W * rd.overlay_pad_share);
  const y = format.overlay.position === "top" ? pad : H - th - pad;
  const text0 = { input: rendered, left: Math.round((W - tw) / 2), top: y };
  if (label) return [text0];
  // A caption in the image sits on a translucent band, the way phone editors do it.
  const band = await solid(W, th + pad, { r: 0, g: 0, b: 0 }, rd.band_alpha);
  return [{ input: band, left: 0, top: Math.max(0, y - Math.round(pad / 2)) }, text0];
}

async function frame(image: Buffer, format: StillFormat, W: number, H: number): Promise<Buffer> {
  const i = frameInsets(format, W);
  if (format.frame === "screenshot") {
    const bar = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${i.top}"><rect width="100%" height="100%" fill="#e9e9ee"/>${[0, 1, 2].map((n) => `<circle cx="${i.top * (0.6 + n * 0.55)}" cy="${i.top / 2}" r="${i.top * 0.17}" fill="${["#ff5f57", "#febc2e", "#28c840"][n]}"/>`).join("")}</svg>`,
    );
    return sharp({ create: { width: W, height: H + i.top, channels: 3, background: "#e9e9ee" } })
      .composite([
        { input: bar, left: 0, top: 0 },
        { input: image, left: 0, top: i.top },
      ])
      .png()
      .toBuffer();
  }
  if (format.frame === "none") return image;
  const paper = format.frame === "polaroid" ? "#fbfaf6" : "#f4f1ea";
  return sharp(image)
    .extend({ ...i, background: paper })
    .png()
    .toBuffer();
}
