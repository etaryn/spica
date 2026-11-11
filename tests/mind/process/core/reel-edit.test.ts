/** Edit lists: seeded and reproducible, within the seam's ranges, and she faces the busier side. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { loadManifest, loadReelFormats } from "@/mind/process/core/reel-library";
import { editList } from "@/mind/process/core/reel-edit";
import { fakeReelTools } from "../../../helpers/reel";
import { fixturePng } from "../../../helpers/web";

const config = loadConfig({ posts: { output_width: 108 } });
const tools = fakeReelTools(config);
const manifest = loadManifest(config.posts.reel.manifest);
const [format] = loadReelFormats("formats/reels", manifest, 360, {
  info() {},
  error() {},
} as never);
const dir = mkdtempSync(path.join(tmpdir(), "reel-edit-"));

/** Wide by default; a tall one overflows only downwards, so every shot sees its full width. */
async function still(busy: "left" | "right", shape: "wide" | "tall" = "wide") {
  const file = path.join(dir, `${busy}-${shape}.png`);
  const size = shape === "wide" ? { width: 1600, height: 1000 } : { width: 400, height: 1000 };
  writeFileSync(file, await fixturePng({ ...size, busy }));
  return file;
}

const make = async (over: { seed?: string; file?: string; valence?: number } = {}) =>
  editList(tools, {
    format: format!,
    manifest,
    seed: over.seed ?? "find-1",
    file: over.file ?? (await still("left")),
    valence: over.valence ?? 0.6,
    posts: config.posts,
  });

test("the same seed gives the same list; another seed, another list", async () => {
  expect(await make()).toEqual(await make());
  expect(await make({ seed: "find-2" })).not.toEqual(await make());
});

test("every shot is within the seam and the format's ranges", async () => {
  for (const valence of [0.6, -0.6]) {
    const edit = await make({ valence });
    expect(edit).toMatchObject({ width: 108, height: 192 });
    expect(edit.shots).toHaveLength(format!.shots.length);
    for (const [i, shot] of edit.shots.entries()) {
      const slot = format!.shots[i]!;
      const clip = manifest.clips.find((c) => c.name === shot.clip)!;
      expect(clip.tags.some((t) => slot.tags.includes(t))).toBe(true);
      expect(shot.start).toBeLessThan(clip.frames);
      if (!clip.loops) expect(shot.start).toBe(0);
      expect(shot.frames).toBeGreaterThanOrEqual(slot.frames[0]);
      expect(shot.frames).toBeLessThanOrEqual(slot.frames[1]);
      expect(valence > 0 ? format!.faces.warm : format!.faces.low).toContain(shot.face);
      expect(shot.framing).toBe(slot.framing);
      expect(Math.abs(shot.azimuth)).toBeGreaterThanOrEqual(slot.azimuth[0]);
      expect(Math.abs(shot.azimuth)).toBeLessThanOrEqual(slot.azimuth[1]);
      expect(shot.elevation).toBeGreaterThanOrEqual(slot.elevation[0]);
      expect(shot.elevation).toBeLessThanOrEqual(slot.elevation[1]);
      expect(Math.abs(shot.background.pan[1] - shot.background.pan[0])).toBeGreaterThanOrEqual(
        slot.pan[0] - 0.001,
      );
      expect(path.isAbsolute(shot.background.file)).toBe(true);
    }
  }
});

test("she stands on the quieter side and faces the busier one", async () => {
  const { foot_left, foot_right } = config.posts.render;
  for (const busy of ["left", "right"] as const) {
    const quiet = busy === "left" ? foot_right : foot_left;
    expect((await make({ file: await still(busy, "tall") })).shots.map((s) => s.x)).toEqual(
      format!.shots.map(() => quiet),
    );
    // Whatever a wide find's pan shows, her azimuth turns her toward the other side.
    for (const shot of (await make({ file: await still(busy) })).shots) {
      expect([foot_left, foot_right]).toContain(shot.x);
      expect(Math.sign(shot.azimuth)).toBe(shot.x === foot_left ? -1 : 1);
    }
  }
});

test("a still starts every shot at 0; a video plays on across the cuts", async () => {
  expect((await make()).shots.every((s) => s.background.offset === 0)).toBe(true);
  const video = path.join(dir, "v.mp4");
  async function* grey() {
    for (let i = 0; i < 240; i++) yield Buffer.alloc(108 * 192 * 3, 90);
  }
  await tools.encode(grey(), { width: 108, height: 192, fps: 24, crf: 30, out: video });
  const edit = await make({ file: video });
  let before = 0;
  for (const shot of edit.shots) {
    expect(shot.background.offset).toBeCloseTo(before / manifest.fps, 5);
    before += shot.frames;
  }
});
