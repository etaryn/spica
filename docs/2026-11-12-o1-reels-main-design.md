# Orbit O1 stage 6, main side: the reel engine (proof of concept)

Design doc, 2026-11-12. Status: draft, for Ethan.

## Intent

"Start the reel engine on main for Spica's posts." A proof of concept, not shipping: the engine
picks one of her finds as the background, writes a `reel.json` with a few shots, has Blender
render her frames with `orbit`'s `reel.py`, composites her over the find in Node (fill 9:16, pan,
video offset, hard cuts, the stills' tint, rim light and grain) and writes a silent 24 fps H.264
MP4. Reels ship on Instagram only after the reel spec's "Later" list.

## Spec and settled lines

- **The seam** (`orbit:docs/orbit/o1-reels-spec.md`, "The seam"): DECIDED, settled with the orbit
  session. `clips.json` in, `reel.json` out, `shot-NN/NNNN.png` back. No field changes without the
  orbit session.
- **§16a post engine** (Built 14): DECIDED. Code owns every visual choice, the model writes only
  the words; posts are core (no `user_id`); a draft waits for Ethan; formats are reviewed JSON.
- **Edit lists from seeded templates**: Ethan, 2026-11-12. No tokens; the mixed or model-written
  edit list stays possible later (the format names the structure; a later model pick would fill
  the same slots).
- **Wired into `post_tick`, gated off**: Ethan, 2026-11-12. The medium `reel` is only chosen once
  `"reel"` is in `posts.capabilities` (default stays `["still"]`).
- **Her outward growth is Ethan's** (memory): a reel skill is set in config, never earned.
- **Never merge `orbit` into `main`**: `clips.json` is copied by hand; `reel.py` and the `.blend`
  are reached by configured paths.

## Assumptions

| Assumption | Status |
| --- | --- |
| Finds are still images only (Commons, ESO, NOIRLab) | verified: `posts.sources`, §16a. Video backgrounds are handled for the PoC sample; production reels pan across a still. |
| `post_tick` reads a find's `media_path` | verified: `post.ts` |
| `post.medium` is a text column typed `"still"` | verified: `src/db/schema.ts:924`. Widening the type needs no migration. |
| `CoreDeps` has no job queue and no process spawning | verified: `platform/deps.ts:39`. Blender and ffmpeg go behind a dep, like `webSources`. |
| Blender 5.2 is installed | verified: `C:\Program Files\Blender Foundation\Blender 5.2` |
| No ffmpeg installed | Ethan; `ffmpeg-static` gets added |
| `clips.json` does not exist yet | verified: not on `orbit`; the orbit session will message when it's committed |
| Seconds per frame | unknown until `reel.py` renders; the orbit session will report it |
| The caption prompt fits a reel | assumed: `post_draft` v2 says "picture of you standing inside"; close enough for a PoC, so it's reused unchanged. A reel-aware version comes before shipping. |

## Design

### 1. Reel formats (`formats/reels/<name>.json`)

The same idea as still formats, zod-validated, an invalid file logged and skipped, `reviewed`
gating. One starter, `drift`, about 10 seconds:

```json
{
  "name": "drift",
  "medium": "reel",
  "min_skill": 0,
  "shots": [
    { "tags": ["walking"], "framing": "full", "azimuth": [25, 40], "elevation": [0, 0],
      "frames": [60, 84], "pan": [0.3, 0.5] },
    { "tags": ["standing"], "framing": "waist", "azimuth": [5, 15], "elevation": [5, 12],
      "frames": [40, 56], "pan": [0.1, 0.2] },
    { "tags": ["looking_up"], "framing": "face", "azimuth": [0, 10], "elevation": [-5, 0],
      "frames": [40, 56], "pan": [0.1, 0.2] }
  ],
  "faces": { "warm": ["soft_smile", "fond", "wonder"], "low": ["observing", "wistful"] },
  "grain": 0.15,
  "caption_pattern": "short, lowercase, one or two lines, no hashtags",
  "reviewed": true
}
```

The face names wait on `clips.json`; the format loader rejects a face or tag the manifest
doesn't have.

### 2. The edit list (`process/core/reel-edit.ts`, pure)

`editList(format, manifest, find, valence, sides)` → `reel.json`, every choice seeded by
`${find.id}:shot-N:<field>`:

- **clip**: a manifest clip with one of the shot's tags; `start` 0 (or a seeded point in a loop);
  `frames` from the range.
- **face**: from `warm` when valence > 0, else `low`.
- **x and azimuth**: she stands on the quieter side of that shot's background window
  (`quieterSide`, already in `post-render.ts`) and faces the busier one, as in stills.
  `x` is `posts.render.foot_left` or `foot_right` (0.28 or 0.72); the azimuth's sign follows the
  side (on the left she faces right, so the azimuth is negative), its size from the format's range.
- **background**: the find's `media_path`, `offset` 0, `pan` a seeded start and a span drawn from
  the shot's `pan` range, so each cut shows a different part of the find.
- `width` and `height` from `posts.output_width` and 9:16.

### 3. Rendering her (`ReelRenderer` dep, `src/runtime/blender-reel.ts`)

A dep on `CoreDeps`: `renderShots(reelJsonPath, outDir)`. The runtime runs
`blender -b <blend> -P <reel.py> -- <reel.json> <outDir>` and fails on a non-zero exit, with
Blender's last stderr lines in the error. The fake writes the right number of transparent PNGs
with a small opaque figure at `x`, so tests never need Blender. Config `posts.reel.blender`,
`posts.reel.script` and `posts.reel.blend` point at the Blender exe and `orbit`'s files (the
`orbit` checkout for now; copied assets before shipping).

### 4. Compositing and encoding (`process/core/reel-render.ts` + the same dep's `encode`)

For each shot: the background is resized to cover 1080×1920. For a still that's done once per shot;
a video is decoded with ffmpeg from `offset`. Each frame's crop window slides along the
overflowing axis from `pan[0]` to `pan[1]`. Her frame is lit like a still: the tint and rim glow
are computed once per shot from that shot's background, so the light doesn't flicker, using
`post-render.ts`'s code, factored into a shared function. Grain is one seeded layer per shot. Frames go as raw RGB to
`ffmpeg-static` (`libx264`, `yuv420p`, 24 fps, no audio) through the dep's `encode`, so
`src/mind` never spawns a process. Shots end to end means every boundary is a hard cut.

Not ported: the still's soft shadow (no feet anchor in a rendered frame), frames, overlay text,
tilt and crop jitter. Each one is a later format option.

### 5. In `post_tick`

After the gates and the find, the medium is picked: `reel` when `"reel"` is in
`posts.capabilities` and a reel format is eligible (seeded choice between eligible stills and
reels). The reel path is: edit list → caption (`post_draft` v2, unchanged, given the format's
`caption_pattern`, overlay `none`) → render and composite → check (`post_check` v3) → a draft
`post` with `medium: "reel"` and an `.mp4` `media_path`. New skip reason `render_failed` is
reused; `no_format` covers a missing manifest.

**One change from what I offered** (Ethan picked "enqueues a reel render job"): the render runs
inside the `post_tick` job, in the worker, rather than in a second queue. Nothing else waits on
`post_tick` (each pg-boss queue polls on its own), and a second job would need an in-flight state
on `post` so the `today` and `pending` gates count a reel that's still rendering. `post_tick`'s
job expiry goes up to `posts.reel.job_expire_seconds`. A separate queue is worth it when two
renders need to run at once.

**Skill:** `posts.craft_skill.reel` (0) is read from config. Whether reels share her craft goal
"Get better at making posts" or get their own is Ethan's (persona); until then reels reuse it
(`craft_goals.reel` = the same title) and only the still path syncs the goal's progress.

### 6. Inspector

The Posts tab's media route serves `video/mp4` for a reel and the tab shows a `<video controls>`
in place of the `<img>`. Approve and reject are unchanged.

### 7. Dev script

`pnpm reels:review [find id | image path]`: builds the edit list, renders and composites, and
writes `reel.json`, the frames and the MP4 under `.data/reels/<stamp>/`. No model call (no
caption), so it's free and needs no `review-run`. It's how Ethan watches a reel and tunes
the format by eye.

### Config `posts.*` additions

`capabilities` may hold `"reel"`; `craft_skill.reel`, `craft_goals.reel`;
`reel: { formats_dir, manifest, blender, script, blend, fps (24), crf, job_expire_seconds,
max_frames }`. `max_frames` caps a reel's render time once seconds per frame are known.

## Scope and leak check

All core: the find, the format, the manifest and the edit list carry no `user_id`; the renderer
gets only `reel.json`. The leak canary and side-channel test run unchanged; the reel path adds no
user-scoped read.

## Exit test and review run

- **Unit:** `editList` (seeded, reproducible; faces follow valence; x and azimuth sign follow the
  quieter side; frame counts in range; every clip and face in the manifest), the format schema,
  the pan window math.
- **Exit:** `post_tick` with `"reel"` in capabilities, fake LLM, fake `renderShots`, real
  `ffmpeg-static`, small frames: a `reel` draft lands whose MP4 has the sum of the shots' frames
  (read back from ffmpeg's stream info), then the canary and side channel.
- **By eye, free:** `pnpm reels:review` with real Blender on the PoC samples and one real find,
  once `reel.py` renders. Ethan approves from the MP4.

## Out of scope

Everything in the reel spec's "Later" (blended moves, camera moves, travel, music on the beat, a
bigger library), publishing, a reel-aware caption prompt, the soft shadow, overlay text and
frames on reels, a separate render queue. They go to §25 at close.
