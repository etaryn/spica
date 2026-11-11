/**
 * What her reels are made from: reel formats (a reel's shots as ranges, reviewed by Ethan) and the
 * manifest of clips, faces and framings orbit's renderer can play. A format asking for something
 * she can't be rendered doing, or longer than a reel may be, is skipped, never rendered.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { errorName } from "@/mind/platform/errors";
import type { Logger } from "@/mind/platform/log";

const range = (lo: number, hi: number) =>
  z
    .tuple([z.number().min(lo).max(hi), z.number().min(lo).max(hi)])
    .refine(([a, b]) => a <= b, "range must be [low, high]");

const ShotSlotSchema = z.object({
  tags: z.array(z.string().min(1)).min(1),
  framing: z.string().min(1),
  // Degrees round her; code turns her toward the busier side, so only the size is given here.
  azimuth: range(0, 180),
  elevation: range(-30, 30),
  frames: z
    .tuple([z.number().int().min(1), z.number().int().min(1)])
    .refine(([a, b]) => a <= b, "frames must be [low, high]"),
  // How far across the find the shot pans, as a share of its overflow.
  pan: range(0, 1),
});
export type ShotSlot = z.infer<typeof ShotSlotSchema>;

export const ReelFormatSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  medium: z.literal("reel"),
  min_skill: z.number().min(0).max(1),
  shots: z.array(ShotSlotSchema).min(1),
  // Faces for a find that moved her warmly, or that weighed on her.
  faces: z.object({ warm: z.array(z.string()).min(1), low: z.array(z.string()).min(1) }),
  grain: z.number().min(0).max(1),
  caption_pattern: z.string().min(1),
  reviewed: z.boolean(),
});
export type ReelFormat = z.infer<typeof ReelFormatSchema>;

const ManifestSchema = z.object({
  fps: z.number().int().positive(),
  clips: z
    .array(
      z.object({
        name: z.string().min(1),
        frames: z.number().int().min(1),
        loops: z.boolean(),
        tags: z.array(z.string()),
      }),
    )
    .min(1),
  faces: z.array(z.string()).min(1),
  framings: z.array(z.string()).min(1),
});
export type ReelManifest = z.infer<typeof ManifestSchema>;

/** The manifest is an asset copied from orbit, so a broken one fails loudly. */
export const loadManifest = (file: string): ReelManifest =>
  ManifestSchema.parse(JSON.parse(readFileSync(file, "utf8")));

function misfit(f: ReelFormat, m: ReelManifest, maxFrames: number): string | null {
  for (const [i, s] of f.shots.entries()) {
    if (!m.clips.some((c) => c.tags.some((t) => s.tags.includes(t))))
      return `shot ${i + 1}: no clip tagged ${s.tags.join("/")}`;
    if (!m.framings.includes(s.framing)) return `shot ${i + 1}: unknown framing ${s.framing}`;
  }
  const face = [...f.faces.warm, ...f.faces.low].find((x) => !m.faces.includes(x));
  if (face) return `unknown face ${face}`;
  const longest = f.shots.reduce((n, s) => n + s.frames[1], 0);
  return longest > maxFrames ? `up to ${longest} frames, over ${maxFrames}` : null;
}

/** Every valid reel format; an invalid one is logged by file name and skipped, never fatal. */
export function loadReelFormats(
  dir: string,
  manifest: ReelManifest,
  maxFrames: number,
  log: Logger,
): ReelFormat[] {
  const formats: ReelFormat[] = [];
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    try {
      const format = ReelFormatSchema.parse(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
      if (`${format.name}.json` !== file) throw new Error("name must match the file name");
      const wrong = misfit(format, manifest, maxFrames);
      if (wrong) throw new Error(wrong);
      formats.push(format);
    } catch (error) {
      log.info("format skipped", { file, error: errorName(error) });
    }
  }
  return formats;
}
