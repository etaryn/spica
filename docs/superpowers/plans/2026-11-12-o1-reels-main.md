# O1 reels, main side: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline, per
> CLAUDE.md). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Her reel engine as a gated-off proof of concept. `post_tick` can choose the medium `reel`.
It writes `reel.json` from a seeded reel format, has Blender render her frames, composites them
over her find with the stills' tint, rim light and grain, and stores a silent 24 fps H.264 MP4 as a
draft post.

**Architecture:** The pure choices live in `src/mind/process/core/` (`reel-library.ts`: formats and
manifest; `reel-edit.ts`: the edit list; `reel-render.ts`: compositing). Everything that spawns a
process (Blender, ffmpeg) sits behind a `ReelTools` dep, which `src/runtime/reel-tools.ts`
implements, as `webSources` does for the web. ffmpeg does the background work: fill, eased pan,
video offset and retime to 24 fps, all in one filter graph, for images and videos alike. sharp
lays her over it.

**Tech stack:** TypeScript, sharp, `ffmpeg-static` (new), Blender 5.2 headless, Vitest, pg-boss.

**Spec:** `docs/2026-11-12-o1-reels-main-design.md`. The seam is `git show orbit:docs/orbit/o1-reels-spec.md`
and the compositing recipe is `git show orbit:assets/model_v2/build/reel_review.py`.

## Global constraints

- The seam is fixed: `reel.json` fields `width, height, shots[{clip, start, frames, face, azimuth,
  elevation, framing, x, background{file, offset, pan}}]`. Ranges: azimuth -180..180, elevation
  -30..30, x 0..1, width and height even, `start` < clip frames, `frames` >= 1.
- Azimuth convention: -32 is the stills' "facing right". She faces the busier side, so on the left
  (`x` 0.28) her azimuth is negative and on the right it is positive.
- Pan: the crop's start along the overflowing axis is `pan × overflow` (0 shows the left or top
  edge), eased between the shot's first and last frame. A video starts `offset` seconds in, is
  retimed to 24 fps, and a video shorter than its shot fails, naming the shot.
- Core only: no `user_id` anywhere on this path. Code owns every visual choice; no new model call.
- Every number in config (`posts.reel.*`); no spec citations in code comments; every file starts
  with a plain-English header.
- `reel` stays out of `posts.capabilities` by default.
- Never merge `orbit`; `clips.json` is copied by hand into `assets/reels/clips.json`.

## Review focus

1. A reel format naming a tag, face or framing the manifest lacks is skipped and logged, never
   rendered (Task 1 test).
2. Blender failing (missing exe, a bad edit list) throws an error that carries Blender's last
   stderr lines, and `post_tick` returns `render_failed` with the find still eligible (Task 2 and
   Task 5 tests).
3. A video background shorter than its shot fails, naming the shot (Task 2 test).
4. The edit list is reproducible for the same find, and the azimuth sign always matches the side
   (Task 3 test).
5. The MP4 has exactly the sum of the shots' frames at the edit list's size (Task 4 and Task 5
   tests).

---

### Task 0: Branch

- [ ] `git switch -c o1-reels-main` in `C:\Users\ethan\projects\spica-main` (never in the orbit
  checkout).

### Task 1: Config, manifest, reel formats

**Files:**
- Modify: `src/mind/platform/config.ts` (the `posts` schema), `config/default.json`
- Create: `assets/reels/clips.json` (from `git show orbit:assets/model_v2/clips.json`),
  `formats/reels/drift.json`, `src/mind/process/core/reel-library.ts`
- Modify: `src/mind/process/core/post-library.ts` (`eligibleFormats` generic)
- Test: `tests/mind/process/core/reel-library.test.ts`

**Interfaces (produces):**
```ts
export type ReelManifest = { fps: number; clips: { name: string; frames: number; loops: boolean; tags: string[] }[]; faces: string[]; framings: string[] };
export type ReelFormat = z.infer<typeof ReelFormatSchema>; // medium "reel", shots: ShotSlot[], faces {warm, low}, grain, caption_pattern, min_skill, reviewed
export type ShotSlot = { tags: string[]; framing: string; azimuth: [number, number]; elevation: [number, number]; frames: [number, number]; pan: [number, number] };
export function loadManifest(file: string): ReelManifest; // throws: an asset Ethan ships
export function loadReelFormats(dir: string, manifest: ReelManifest, maxFrames: number, log: Logger): ReelFormat[];
export const eligibleFormats: <F extends { reviewed: boolean; medium: string; min_skill: number }>(formats: F[], capabilities: readonly string[], skill: number) => F[];
```

- [ ] **Config schema** (`config.ts`, in `posts`):
```ts
  capabilities: z.array(z.enum(["still", "reel"])).min(1),
  craft_goals: z.object({ still: text, reel: text }),
  craft_skill: z.object({ still: unit, reel: unit }),
  // Reels: her frames come from Blender (orbit's renderer), the edit and the MP4 from here.
  reel: z.object({
    formats_dir: text,
    manifest: text,
    blender: text,
    script: text,
    blend: text,
    crf: z.number().int().min(0).max(51),
    // A reel renders in the post_tick job, at seconds per frame; the job must outlive it.
    job_expire_seconds: positiveInt,
    // The longest reel a format may plan, in frames: render time grows with it.
    max_frames: positiveInt,
  }),
```
  `default.json`: `"craft_goals": { "still": "Get better at making posts", "reel": "Get better at
  making posts" }`, `"craft_skill": { "still": 0, "reel": 0 }`, and
```json
    "reel": {
      "formats_dir": "formats/reels",
      "manifest": "assets/reels/clips.json",
      "blender": "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe",
      "script": "../spica/assets/model_v2/build/reel.py",
      "blend": "../spica/assets/model_v2/spica-v2-clips.blend",
      "crf": 18,
      "job_expire_seconds": 3600,
      "max_frames": 360
    },
```
- [ ] **Failing tests** (`reel-library.test.ts`): the manifest at `assets/reels/clips.json` loads;
  `drift` loads and is eligible at skill 0 with `["reel"]`; a format in a tmp dir with tag
  `"dancing"`, face `"grin"`, framing `"wide"`, or a max total frames over `maxFrames` is skipped,
  and `log.info` is called with `"format skipped"`; a `still` format isn't eligible when
  capabilities are `["reel"]`.
- [ ] Run `pnpm test tests/mind/process/core/reel-library.test.ts`: FAIL (module missing).
- [ ] **Implement** `reel-library.ts`:
```ts
/**
 * What her reels are made from: reel formats (a reel's shots as ranges, reviewed by Ethan) and the
 * clip manifest orbit's renderer can play. A format asking for a clip, face or framing she doesn't
 * have, or longer than a reel may be, is skipped, never rendered.
 */
const range = (lo: number, hi: number) =>
  z.tuple([z.number().min(lo).max(hi), z.number().min(lo).max(hi)]).refine(([a, b]) => a <= b, "range must be [low, high]");
const ShotSlotSchema = z.object({
  tags: z.array(z.string().min(1)).min(1),
  framing: z.string().min(1),
  azimuth: range(0, 180),
  elevation: range(-30, 30),
  frames: z.tuple([z.number().int().min(1), z.number().int().min(1)]).refine(([a, b]) => a <= b),
  pan: range(0, 1),
});
export const ReelFormatSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  medium: z.literal("reel"),
  min_skill: z.number().min(0).max(1),
  shots: z.array(ShotSlotSchema).min(1),
  faces: z.object({ warm: z.array(z.string()).min(1), low: z.array(z.string()).min(1) }),
  grain: z.number().min(0).max(1),
  caption_pattern: z.string().min(1),
  reviewed: z.boolean(),
});
const ManifestSchema = z.object({
  fps: z.number().int().positive(),
  clips: z.array(z.object({ name: z.string().min(1), frames: z.number().int().min(1), loops: z.boolean(), tags: z.array(z.string()) })).min(1),
  faces: z.array(z.string()).min(1),
  framings: z.array(z.string()).min(1),
});
export const loadManifest = (file: string): ReelManifest => ManifestSchema.parse(JSON.parse(readFileSync(file, "utf8")));

function misfit(f: ReelFormat, m: ReelManifest, maxFrames: number): string | null {
  for (const [i, s] of f.shots.entries()) {
    if (!m.clips.some((c) => c.tags.some((t) => s.tags.includes(t)))) return `shot ${i + 1}: no clip tagged ${s.tags.join("/")}`;
    if (!m.framings.includes(s.framing)) return `shot ${i + 1}: unknown framing ${s.framing}`;
  }
  const face = [...f.faces.warm, ...f.faces.low].find((x) => !m.faces.includes(x));
  if (face) return `unknown face ${face}`;
  const longest = f.shots.reduce((n, s) => n + s.frames[1], 0);
  return longest > maxFrames ? `up to ${longest} frames, over ${maxFrames}` : null;
}
```
  `loadReelFormats` reads `*.json` sorted, parses, checks the name matches the file and `misfit`
  is null, otherwise `log.info("format skipped", { file, error })`, the same as `loadFormats`.
  `eligibleFormats` in `post-library.ts` becomes generic over `{ reviewed, medium, min_skill }`
  (body unchanged).
- [ ] `formats/reels/drift.json`, faces checked against the manifest:
```json
{
  "name": "drift",
  "medium": "reel",
  "min_skill": 0,
  "shots": [
    { "tags": ["walking"], "framing": "full", "azimuth": [25, 40], "elevation": [0, 0], "frames": [60, 84], "pan": [0.3, 0.5] },
    { "tags": ["standing"], "framing": "waist", "azimuth": [5, 15], "elevation": [5, 12], "frames": [40, 56], "pan": [0.1, 0.2] },
    { "tags": ["looking_up"], "framing": "face", "azimuth": [0, 10], "elevation": [-5, 0], "frames": [40, 56], "pan": [0.1, 0.2] }
  ],
  "faces": { "warm": ["soft_smile", "fond", "wonder", "curious"], "low": ["observing", "thinking", "sigh"] },
  "grain": 0.15,
  "caption_pattern": "short, lowercase, one or two lines, no hashtags",
  "reviewed": true
}
```
- [ ] Run the test: PASS. `pnpm typecheck`.
- [ ] Commit `feat(posts): reel formats and the clip manifest`.

### Task 2: `ReelTools`: Blender and ffmpeg behind a dep

**Files:**
- Create: `src/mind/platform/reel-tools.ts` (type and `isStill`), `src/runtime/reel-tools.ts`,
  `tests/helpers/reel.ts`
- Modify: `src/mind/platform/deps.ts` (`reelTools` on `Deps` and `CoreDeps`),
  `src/runtime/deps.ts`, `tests/helpers/deps.ts`, `package.json` (+ `ffmpeg-static`),
  `pnpm-workspace.yaml` (`allowBuilds: ffmpeg-static: true`)
- Test: `tests/runtime/reel-tools.test.ts`

**Interfaces (produces):**
```ts
// src/mind/platform/reel-tools.ts
export type BackgroundOptions = { offset: number; frames: number; fps: number; width: number; height: number; pan: [number, number] };
export type ReelTools = {
  /** Her shots for an edit list file, as <outDir>/shot-NN/NNNN.png; throws with the renderer's last words. */
  renderShots(editListPath: string, outDir: string): Promise<void>;
  /** The background for one shot: filled, panned (eased) and, for a video, from `offset` at `fps`; raw RGB frames of width×height. */
  background(file: string, opts: BackgroundOptions): AsyncIterable<Buffer>;
  /** Raw RGB frames to a silent H.264 MP4. */
  encode(frames: AsyncIterable<Buffer>, opts: { width: number; height: number; fps: number; crf: number; out: string }): Promise<void>;
};
export const isStill = (file: string) => /\.(png|jpe?g|webp)$/i.test(file);
// tests/helpers/reel.ts
export function fakeReelTools(config: Config): ReelTools & { rendered: string[] }; // real ffmpeg, fake Blender
export async function mp4Frames(file: string): Promise<{ frames: number; width: number; height: number }>;
```

- [ ] `pnpm add ffmpeg-static` and add `ffmpeg-static: true` under `allowBuilds`; check that
  `node -e "console.log(require('ffmpeg-static'))"` prints a path that exists.
- [ ] **Failing tests** (`tests/runtime/reel-tools.test.ts`, real ffmpeg, a 64×112 frame):
  1. `encode` of 10 solid frames → `mp4Frames` gives `{ frames: 10, width: 64, height: 112 }`.
  2. `background` of a 400×100 PNG that's red on the left half and blue on the right, pan `[0, 1]`
     over 5 frames: frame 0 is mostly red, frame 4 mostly blue, each `64*112*3` bytes.
  3. `background` of an 8-frame MP4 (made with `encode`) asked for 12 frames throws
     `/too short/`.
  4. `renderShots` with `blender: "no-such-blender"` rejects with an error naming the exe.
- [ ] Run: FAIL.
- [ ] **Implement** `src/runtime/reel-tools.ts`:
```ts
/**
 * The reel's outside tools: Blender renders her frames with orbit's reel.py; ffmpeg fills and pans
 * the background and encodes the MP4. Each failure carries the tool's last stderr lines.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";

function run(exe: string, args: string[], stdin?: AsyncIterable<Buffer>) — spawns, keeps the last
  2 KB of stderr, rejects on spawn error (`${exe}: ${err.message}`) or a non-zero exit
  (`${path.basename(exe)} exited ${code}: ${tail}`); writes stdin with backpressure
  (await once(proc.stdin, "drain") when write returns false) and ends it.

renderShots(editList, outDir) → run(config.blender, ["-b", resolve(blend), "--python-exit-code", "1",
  "-P", resolve(script), "--", resolve(editList), resolve(outDir)]).

background(file, o): the eased pan as an ffmpeg expression with no commas,
  s = `(n/${max(o.frames - 1, 1)})`, e = `${s}*${s}*(3-2*${s})`,
  p = `(${a}+${b - a}*${e})` with a and b at toFixed(6);
  vf = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-ow)*${p}:(ih-oh)*${p}`
  input = isStill(file) ? ["-loop", "1", "-framerate", fps, "-i", file]
                        : ["-ss", offset, "-i", file, "-vf" prefix "fps=24,"]
  args = [...input, "-vf", vf, "-frames:v", frames, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
  Yields stdout in frames of W*H*3 bytes; after exit, fewer than `frames` frames throws
  `background ${file} too short: ${got} of ${frames} frames`.

encode(frames, o) → run(ffmpeg, ["-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`,
  "-r", fps, "-i", "-", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", crf,
  "-movflags", "+faststart", out], frames).
```
  The "too short" error gets its shot number from `renderReel` (Task 4), which wraps it in
  `shot ${n}: ...`.
  `createReelTools(cfg: Config["posts"]["reel"]): ReelTools`; `src/runtime/deps.ts` adds
  `reelTools: createReelTools(config.posts.reel)`; `CoreDeps` picks `reelTools`.
- [ ] `tests/helpers/reel.ts`: `fakeReelTools(config)` returns the real tools with `renderShots`
  replaced. The fake reads the edit list and, for each shot, writes `frames` transparent PNGs
  (sharp `create` plus a white 20%-wide, 40%-tall rect centred at `x`) and records the path.
  `mp4Frames` runs ffmpeg with `-i file -map 0:v:0 -c copy -f null -` and parses the last
  `frame=\s*(\d+)` and `(\d{2,})x(\d{2,})` from stderr. `makeTestDeps` gains a `reelTools`
  parameter that defaults to `fakeReelTools(config)`.
- [ ] Run: PASS. `pnpm typecheck` (every `Deps` literal now needs `reelTools`).
- [ ] Commit `feat(posts): Blender and ffmpeg behind ReelTools`.

### Task 3: Shared lighting and the edit list

**Files:**
- Modify: `src/mind/process/core/post-render.ts` (extract `lightOf`, `lightHer`, export `grain`)
- Create: `src/mind/process/core/reel-edit.ts`
- Test: `tests/mind/process/core/reel-edit.test.ts`; `post-render.test.ts` unchanged and still
  passing

**Interfaces (produces):**
```ts
// post-render.ts
export type Light = { mean: Rgb; rim: Rgb; luma: number };
export async function lightOf(base: Buffer): Promise<Light>;          // stats mean, dominant, luma
export async function lightHer(her: Buffer, light: Light, rd: Config["posts"]["render"]): Promise<{ tinted: Buffer; glow: Buffer }>;
export async function grain(width: number, height: number, amount: number, seed: string): Promise<Buffer>;
// reel-edit.ts
export type ReelShot = { clip: string; start: number; frames: number; face: string; azimuth: number; elevation: number; framing: string; x: number; background: { file: string; offset: number; pan: [number, number] } };
export type EditList = { width: number; height: number; shots: ReelShot[] };
export const reelSize = (width: number) => ({ width, height: 2 * Math.round((width * 16) / 9 / 2) });
export async function editList(tools: ReelTools, input: { format: ReelFormat; manifest: ReelManifest; seed: string; file: string; valence: number; posts: Config["posts"] }): Promise<EditList>;
```

- [ ] Refactor `renderStill` onto `lightOf` and `lightHer`, moving the same code without changing
  it. Run `pnpm test tests/mind/process/core/post-render.test.ts`: PASS.
- [ ] **Failing tests** (`reel-edit.test.ts`, using `fakeReelTools(loadConfig(...))` with
  `output_width` 108, `drift`, the real manifest and `fixturePng({ busy: "left" })` saved to a tmp
  file):
  1. Same seed → the same list; a different seed → a different one.
  2. Every shot passes the seam's checks: clip in the manifest with a slot tag, face in `warm` for
     valence 0.6 and in `low` for -0.6, frames in the slot range, `start` < clip frames (0 for
     `look_up`), width 108, height 192.
  3. A busy-left still puts every shot at `x` = `foot_right` with a positive azimuth; busy-right
     gives `foot_left` and a negative azimuth.
  4. An image's `offset` is 0; a video's (an `.mp4` made with `encode`, long enough) is the shots
     before it, in seconds.
- [ ] Run: FAIL.
- [ ] **Implement** `editList`. For shot i: `u = (k) => seededUnit(`${seed}:shot-${i}:${k}`)`,
  `lerp = ([a, b], t) => a + (b - a) * t`, `pick = (xs, k) => xs[Math.floor(u(k) * xs.length)]!`.
  - The clip is picked from the manifest clips that carry a slot tag; `frames` is
    `Math.round(lerp(slot.frames, u("frames")))`; `start` is
    `clip.loops ? Math.floor(u("start") * clip.frames) : 0`; the face comes from `warm` when
    valence > 0, else `low`.
  - `span = lerp(slot.pan, u("span"))`, `from = u("from") * (1 - span)`,
    `pan = u("dir") < 0.5 ? [from, from + span] : [from + span, from]`, each rounded to 3 places.
  - `offset = isStill(file) ? 0 : framesBefore / manifest.fps`.
  - The side comes from the shot's first frame: one frame from
    `tools.background(file, { offset, frames: 1, fps, ...size, pan: [pan[0], pan[0]] })`, raw RGB
    to PNG with sharp, then `quieterSide`.
  - `x` is `side === "left" ? render.foot_left : render.foot_right`;
    `mag = lerp(slot.azimuth, u("azimuth"))`; `azimuth = side === "left" ? -mag : mag`, rounded
    to 1 place; `elevation = lerp(slot.elevation, u("elevation"))`, rounded to 1 place.
  - `background.file` is `path.resolve(file)` (Blender and ffmpeg both get absolute paths).
- [ ] Run: PASS. Commit `feat(posts): reel edit lists from seeded formats`.

### Task 4: Compositing and the MP4

**Files:**
- Create: `src/mind/process/core/reel-render.ts`
- Test: `tests/mind/process/core/reel-render.test.ts`

**Interfaces (produces):**
```ts
export async function renderReel(tools: ReelTools, input: { edit: EditList; framesDir: string; out: string; fps: number; grain: number; seed: string; posts: Config["posts"] }): Promise<void>;
/** The whole reel for a find: edit list, Blender, composite, MP4; returns the MP4 path and the clips, joined "+". */
export async function makeReel(deps: Pick<CoreDeps, "reelTools" | "config">, input: { format: ReelFormat; manifest: ReelManifest; find: { id: string; media_path: string }; valence: number }): Promise<{ media: string; clips: string }>;
```

- [ ] **Failing tests:** `makeReel` with the fake tools, a tmp `media_dir`, `drift` at
  `output_width` 108: the returned `media` ends `posts/<findId>.mp4`. `mp4Frames` equals the sum of
  `reel.json`'s shot frames at 108×192, `reel.json` exists next to the frames under
  `reels/<findId>/`, and the frames dir is gone afterwards. A `renderShots` that throws makes
  `makeReel` reject and leaves no MP4.
- [ ] Run: FAIL.
- [ ] **Implement** `renderReel`. For each shot n:
  - Start `tools.background(...)` with the shot's offset, frames, the manifest's fps, the edit
    list's size and its pan. Read her frames from `shot-NN/NNNN.png` (padStart 2 and 4).
  - On the first background frame: `light = await lightOf(png of it)`; the grain layer is made once
    per shot when `grain > 0`, as `grain(W, H, amount, `${seed}:${n}`)`.
  - Each frame:
    `sharp(bg, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: glow }, { input: tinted }, grainLayer && { input: grainLayer, blend: "soft-light" }]).removeAlpha().raw().toBuffer()`.
  - Yield it into `tools.encode`.
  - Wrap a shot's error as `shot ${n}: ${message}`.

  `makeReel`:
  - Writes `reel.json` under `${media_dir}/reels/${find.id}/` with `saveMedia`.
  - Calls `renderShots(abs(reel.json), abs(dir/frames))`, then `renderReel` into
    `${media_dir}/posts/${find.id}.mp4`.
  - Removes `frames/` with `rm({ recursive: true, force: true })` in a `finally`.
  - Returns `{ media, clips }`.
- [ ] Run: PASS. Commit `feat(posts): reels composited over her find and encoded`.

### Task 5: Into `post_tick`, the queue, the inspector, the exit test

**Files:**
- Modify: `src/mind/process/core/post.ts`, `post-words.ts` (the `DraftInput.format` type),
  `src/db/schema.ts` (`medium` `$type<"still" | "reel">`, no migration),
  `src/mind/world/types.ts` if `NewPost` restates medium, `src/worker/world-jobs.ts`,
  `src/app/inspector/posts/page.tsx`, `src/app/inspector/posts/[postId]/image/route.ts`
- Test: `tests/mind/process/core/post-tick.test.ts` (+2), `tests/exit/phase-14.test.ts`
  (+ test 8)

- [ ] **Failing tests** (`post-tick.test.ts`, setup with
  `posts: { capabilities: ["reel"], output_width: 108 }`):
  - A landed find drafts a post with `medium: "reel"`, `format: "drift"`, `pose` the shots' clips
    joined with `+`, a `media_path` ending in `.mp4` that exists, and a caption.
  - With `renderShots` throwing, it returns `render_failed`, no post row is written, and the next
    tick with working tools drafts it.
- [ ] Exit `phase-14.test.ts` test 8: `setup()` takes config overrides; with
  `capabilities: ["reel"]` the day of posting drafts a reel whose MP4 has the edit list's frames.
  The canary token isn't in `reel.json`, the rows or the post-model calls.
- [ ] Run: FAIL.
- [ ] **Implement in `post.ts`.**
  - After `no_find`, the still and reel candidates are joined:
    - `stills = eligibleFormats(loadFormats(...), caps, stillSkill)`.
    - `reels`: when `caps.includes("reel")`, `manifest = loadManifest(cfg.reel.manifest)` and
      `eligibleFormats(loadReelFormats(cfg.reel.formats_dir, manifest, cfg.reel.max_frames, log), caps, cfg.craft_skill.reel)`;
      otherwise `[]`.
    - `formats = [...stills, ...reels]`; empty means `no_format`; the seeded pick is unchanged.
  - Still branch: the pose and media read as today (`no_pose`, `render_failed`).
  - Reel branch: no pose; `skill = cfg.craft_skill.reel`.
  - The draft is shared. Pass
    `format: { name, caption_pattern, overlay: { kind: format.medium === "still" ? format.overlay.kind : "none" } }`
    (the `DraftInput.format` type narrows to those fields).
  - The render runs per branch inside the existing try/catch: `renderStill` + `saveMedia`, or
    `makeReel(deps, { format, manifest, find, valence })`.
  - The check is shared. `insertPost` takes `medium: format.medium`,
    `pose: still ? pose.name : edit clips joined "+"`, `skill`. `makeReel` returns
    `{ media, clips }` for that.
- [ ] `world-jobs.ts`, before `boss.work(POST_TICK_QUEUE…)`:
```ts
  // A reel renders inside the tick (minutes per reel), so the job outlives the default expiry.
  const tick = { retryLimit: 0, expireInSeconds: deps.config.posts.reel.job_expire_seconds };
  await boss.createQueue(POST_TICK_QUEUE, tick);
  await boss.updateQueue(POST_TICK_QUEUE, tick);
```
- [ ] **Inspector:**
  - The route serves `video/mp4` when `media_path` ends in `.mp4`.
  - `page.tsx` shows `<video src=… controls width={240} />` for `p.medium === "reel"`, else the
    `<img>`.
  - `pnpm build` compiles.
- [ ] Run the targeted tests: PASS. Then `pnpm typecheck`, `pnpm lint`.
- [ ] Commit `feat(posts): post_tick can make a reel (gated off)`.

### Task 6: Dev script, a real render, write-back, close

**Files:**
- Create: `evals/scripts/reels-review.ts`
- Modify: `package.json` (`"reels:review": "tsx --env-file-if-exists=.env evals/scripts/reels-review.ts"`),
  `spica-design-spec-v3.md` (§16a, §25.12), `DECISIONS.md`, `CLAUDE.md` (current phase line)

- [ ] **The script:** `pnpm reels:review <image|video|reel.json> [seed]`. No DB, no model.
  - Given a `reel.json`, it renders that edit list as written, e.g. orbit's `reel_poc.json` with
    its paths resolved against the orbit checkout, so the output compares with orbit's review
    reel.
  - Otherwise it builds an edit list from the first eligible reel format (seed defaults to the
    file name).
  - Either way it renders through the real `createReelTools`, into `.data/reels/<stamp>/`
    (`reel.json`, `reel.mp4`), and prints the timing per shot.
- [ ] **Real run** (free: no model; about 25 min of GPU): first `reel_poc.json`, then one real find
  from `.data/media/finds/`. Watch both MP4s and send Ethan the paths.
- [ ] **Write-back:**
  - §16a gets a "Reels (O1 stage 6, proof of concept)" bullet: flow, `ReelTools`, reel formats,
    config keys `posts.reel.*`, `craft_*.reel`, the medium `reel`, the inline render and why.
  - §25.12 gets the backlog: the reel spec's Later list, a reel-aware caption prompt, shadow,
    overlay and frames on reels, a separate render queue, and Blender assets on main before
    shipping.
  - `DECISIONS.md` rows: ffmpeg does fill and pan; linear-vs-eased (eased, as orbit's review);
    machine paths in `posts.reel`; reels share the craft goal; frames deleted after encode.
- [ ] **Close** with `spica-close`: full suite, leak canary, `scope-reviewer` on the branch diff.
  Commit, then ask Ethan before merging into main.
