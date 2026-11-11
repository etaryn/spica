/**
 * `pnpm reels:review <image|video|reel.json> [seed]`: one reel for Ethan to watch, with no database
 * and no model call. Given a picture or video, it writes the edit list from the first reviewed reel
 * format; given an edit list (orbit's reel_poc.json, say), it renders that as written, with
 * relative background paths read from the orbit checkout as orbit's scripts read them. Real Blender
 * and ffmpeg; the output lands in .data/reels/<time>/ (reel.json, reel.mp4).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfig, parseConfigOverrides } from "@/mind/platform/config";
import { editList, type EditList } from "@/mind/process/core/reel-edit";
import { loadManifest, loadReelFormats } from "@/mind/process/core/reel-library";
import { renderReel } from "@/mind/process/core/reel-render";
import { createReelTools } from "@/runtime/reel-tools";

const [input, seed] = process.argv.slice(2);
if (!input) throw new Error("usage: pnpm reels:review <image|video|reel.json> [seed]");
const config = loadConfig(parseConfigOverrides(process.env.SPICA_CONFIG));
const posts = config.posts;
const tools = createReelTools(posts.reel);
const manifest = loadManifest(posts.reel.manifest);
const [format] = loadReelFormats(posts.reel.formats_dir, manifest, posts.reel.max_frames, console);
if (!format) throw new Error("no valid reel format");

// reel.py lives at <orbit>/assets/model_v2/build/reel.py.
const orbitRoot = path.resolve(path.dirname(posts.reel.script), "../../..");
let edit: EditList;
if (input.endsWith(".json")) {
  edit = JSON.parse(readFileSync(input, "utf8")) as EditList;
  for (const shot of edit.shots)
    shot.background.file = path.resolve(orbitRoot, shot.background.file);
} else {
  edit = await editList(tools, {
    format,
    manifest,
    seed: seed ?? path.basename(input),
    file: input,
    valence: 0.5,
    posts,
  });
}

const out = path.resolve(".data/reels", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(out, { recursive: true });
const editPath = path.join(out, "reel.json");
writeFileSync(editPath, JSON.stringify(edit, null, 2));
const frames = edit.shots.reduce((n, s) => n + s.frames, 0);
console.log(`${edit.shots.length} shots, ${frames} frames -> ${out}`);

let t = Date.now();
await tools.renderShots(editPath, path.join(out, "frames"));
console.log(`blender: ${((Date.now() - t) / 1000 / frames).toFixed(2)} s per frame`);
t = Date.now();
await renderReel(tools, {
  edit,
  framesDir: path.join(out, "frames"),
  out: path.join(out, "reel.mp4"),
  fps: manifest.fps,
  grain: format.grain,
  seed: seed ?? path.basename(input),
  posts,
});
console.log(`composite + encode: ${((Date.now() - t) / 1000).toFixed(1)} s`);
console.log(path.join(out, "reel.mp4"));
