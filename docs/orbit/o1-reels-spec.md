# Orbit O1 v2: reels

What O1 stage 6 builds: her clips rendered to order from an edit list, and a review reel that lays
them over content, so the reel engine on `main` has a seam to build against.
Nov 11, 2026. Status: built Nov 12 as a proof of concept, waiting for Ethan's review of `renders/reel/reel.mp4`. Where the
build went a different way, this list and `DECISIONS.md` win.

## What changed while building it

- **Placeholder video** is a CC0 timelapse in `.webm` at 25 fps (`reel_samples/SOURCES.txt`). The Sequencer plays a video
  frame for frame without retiming, so the review allows 5% off 24 fps (25 runs 4% slow) and fails beyond; `main` retimes
  with ffmpeg.
- **Checks:** the face-framing check measures the whole head bone inside the frame; the frames check wants transparent
  bottom corners only for `full` (closer in, her hoodie fills the bottom); the wrap check uses `walk`, because `idle` moves
  too little to tell neighbouring frames apart.
- **Pans ease in and out** (Blender's default keys); `main` matches with smoothstep.
- **The review writes one still per shot** beside the MP4 (`reel-shot-NN.png`) for the sheet.
- **Render time** is measured below.

## Goal

A proof of concept for reels. `main`'s engine writes an edit list; Blender renders her shots from it
as transparent frames; a review script lays them over a background and writes an MP4 Ethan can
watch. Done means the checks pass and Ethan has approved the review reel from the video.

Reels ship on Instagram only at the end product (see Later), not at this stage.

## Choices (Ethan, Nov 11)

- **Assets plus a review reel.** `orbit` renders her and makes one review reel; editing lives on
  `main`. Complete reels on `orbit` were ruled out: editing logic on a branch that never merges.
- **Rendered on demand, not pre-rendered.** The library will be large, with many transitions and more
  than one camera angle; a pre-rendered library is too restrictive and too heavy, and a pre-rendered
  clip exists at one angle only, which is not acceptable.
- **She stays put and the content moves.** Her walk is in place; the background pans behind her.
- **A sequence of shots with hard cuts.** Every clip starts from her stance, so cuts line up, and a
  cut is where her face changes.
- **Camera per shot:** angle round her, height, and framing (`full`, `waist`, `face`); orthographic,
  the toon look of the stills.
- **Turning is a rig movement**, a clip, never a camera move: the camera is where the viewer stands,
  a turn is something she does. A `turn` clip is a later library addition.
- **Backgrounds are a flat backdrop**, image or video, also when shipping. A 3D backdrop is open for
  later. `main` chooses them: they are her finds.
- **Silent.**
- **Seam: approach 1 of 3.** Blender renders her alone, transparent; `main` composites in 2D.
  Weighed against Blender staging the whole shot (content as screens in her 3D world: real light,
  occlusion and camera moves, but every staging change re-renders) and an alpha video in place of
  PNGs (a storage variant of 1 with fiddly codecs). Ethan: a flat backdrop is good enough to ship.

## The seam

Three things cross between the branches.

**1. Clip manifest, `orbit` to `main`, copied by hand.** `clips.py` writes
`assets/model_v2/clips.json` (committed) next to the `.blend`. `main` writes edit lists from it.

```json
{
  "fps": 24,
  "clips": [{ "name": "walk", "frames": 96, "loops": true, "tags": ["walking"] }],
  "faces": ["observing", "soft_smile", "..."],
  "framings": ["full", "waist", "face"]
}
```

`frames` is the clip's length (one cycle for a loop), `tags` are the still tags (`sprites.TAGS`),
`faces` are the 32 of `expr2_defs.py`.

**2. Edit list, `main` to the renderer.** `reel.json`, one entry per shot, in order:

```json
{
  "width": 1080,
  "height": 1920,
  "shots": [
    {
      "clip": "walk",
      "start": 0,
      "frames": 72,
      "face": "soft_smile",
      "azimuth": -32,
      "elevation": 0,
      "framing": "full",
      "x": 0.35,
      "background": { "file": "C:/.../find.mp4", "offset": 2.0, "pan": [0.2, 0.6] }
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `clip`, `start`, `frames` | The shot is `frames` long, from clip frame `start` (0 is the clip's first frame). A looping clip wraps; a one-shot clip holds its last frame. |
| `face` | One of the 32. |
| `azimuth` | Degrees round her, `sprites.py`'s convention: 0 is her front, -32 is the stills' "facing right". -180 to 180. |
| `elevation` | Degrees; positive looks down on her. -30 to 30. |
| `framing` | `full`, `waist` or `face`. |
| `x` | Where her centre sits across the frame, 0 to 1. `main` picks the quieter side, as for stills. |
| `background` | Ignored by the renderer; for `main` and the review script. `file` is an image or video; `offset` is where a video starts, in seconds (default 0); `pan` (required, no default; agreed with `main` Nov 12) is the crop centre, 0 to 1, moving from the first value to the second over the shot, along whichever axis the content overflows 9:16 (sideways for wide content, down for tall). |

`width` and `height` are 1080 and 1920 for now; the renderer takes them as given.

**3. Frames, the renderer to `main`.** `<out>/shot-01/0001.png ...`: transparent RGBA at
`width`×`height`, with her framed and placed by the camera, so `main` overlays whole frames with no
scaling and no anchor.

## The renderer

`assets/model_v2/build/reel.py`:
`blender -b assets/model_v2/spica-v2-clips.blend -P assets/model_v2/build/reel.py -- <reel.json> <absolute out dir>`

1. **Check the edit list first.** Unknown clip, face or framing, a missing field, or a value out of
   range stops the run before any frame renders, with a message naming the shot.
2. **Pose.** Shot frame `i` is clip frame `start + i`. A loop wraps inside the action's baked
   `first`..`last` (the second cycle, swing settled); a one-shot holds `last`. `sprites.pose` sets the
   rig (reset, action, seated shapes for `sit_edge`).
3. **Face.** `sprites.set_face`, with her sideways glance sent to the side the camera sees: azimuth
   above 0 is "left", otherwise "right".
4. **Camera.** `sprites.setup`'s orthographic camera and sun. `azimuth` and `elevation` orbit the
   camera round an aim point; the framing sets the view height and the aim point; `x` moves her
   across through the camera's `shift_x`. Starting values, corrected by Ethan from renders:

   | Framing | View height | Aim point |
   | --- | --- | --- |
   | `full` | about 2.0 m | mid-body, her soles near the bottom of the frame |
   | `waist` | about 1.0 m | her chest |
   | `face` | about 0.45 m | her head bone, each frame, so the shot follows her head |

5. **Render** each frame through `brow_over.render`, at native size with EEVEE's anti-aliasing (the
   stills' 3x supersample would cost 9x per frame). If edges look rough, samples go up before
   supersampling does.

It imports `sprites`' functions rather than copying them, and never saves the `.blend`.

**Render time (measured Nov 12):** 4.4 to 5 s per frame at 1080×1920 with the GPU to itself, inside one Blender session, once
warm (a 4-frame call measured 6.6 s with its warm-up), so a 10-second reel (240 frames) is about 20 minutes. Every frame is two renders (`brow_over`), and the cost barely falls with
size (5.5 s at 270×480), so overhead dominates. With a second render sharing the GPU it rose to 7 to 9.3 s per frame;
`main`'s per-call figure, Blender's startup included, was about 10.7 s per frame for a 6-frame call. `main`'s full run of `reel_poc.json` (one call, 240 frames, GPU shared)
averaged 7.47 s per frame, and its own compositing and encoding took 97 s. Composing the MP4
takes about 20 seconds. Plan the render worker as a slow background job.

## The review reel

`assets/model_v2/build/reel_review.py`:
`blender -b --factory-startup -P assets/model_v2/build/reel_review.py -- <reel.json> <frames dir> <out.mp4>`

Blender's Video Sequencer, in an empty session:

- Each shot's background goes on channel 1 and her `shot-NN/` sequence on channel 2 with Alpha Over;
  shots end to end, so every boundary is a hard cut.
- The background is scaled to fill the frame; `pan` keys the strip's offset along the overflowing
  axis; a video starts at `offset`.
- Output: H.264 MP4 at 24 fps, silent, through the FFmpeg bundled with Blender (none is installed).

A plain overlay on purpose: tint, rim light and grain are `main`'s editing.

**The proof-of-concept reel**, `assets/model_v2/build/reel_poc.json`, about 10 seconds:

| # | Clip | Face | Camera | Frames | Background |
| --- | --- | --- | --- | --- | --- |
| 1 | `walk` | `soft_smile` | full, -32, `x` 0.35 | 72 | the video, panning sideways |
| 2 | `idle` | `observing` | waist, -10, elevation 10 | 48 | the video, later `offset` |
| 3 | `look_up` | `wonder` | face, 0 | 48 | the tall image, panning down |
| 4 | `sit_edge` | `fond` | full, +32, `x` 0.6 | 72 | the tall image, panning |

Placeholders: one free-licence video (Pexels) and one tall CC0 image (Wikimedia Commons), in
`assets/model_v2/reel_samples/` (git-ignored), with a `SOURCES.txt` saying where each came from. The
edit list reaches them by a path relative to the repo, resolved by the scripts.

## Checks

`assets/model_v2/build/checks/check_reel.py`, measured rather than eyeballed:

- **Edit list:** a bad list (unknown clip, unknown face, `x` out of range) fails before rendering,
  and the message names the shot.
- **Frames:** each `shot-NN/` holds exactly `frames` PNGs at 1080×1920 RGBA, corners transparent,
  her pixels present. Her alpha's horizontal centre lands within tolerance of `x` × 1080. `face`
  framing puts her head bone's projection in the top half of the frame; `full` keeps her soles above
  the bottom edge.
- **Loop and hold:** a shot longer than its clip wraps for a loop (frame `L` + 1 matches frame 1
  within a pixel tolerance) and holds for `look_up`.
- **MP4:** Blender loads it back as a movie clip: length is the sum of the shots' frames, size
  1080×1920.
- **Nothing else moved:** `run_rig_check.sh` and `check_clips.py` still pass; the `.blend` files are
  only read.

Ethan reviews the MP4 and a sheet of one frame per shot (`sheet.py`), and corrects the framing
presets and angles by eye.

## Out of scope (this stage)

- Everything in Later.
- Tint, rim light, grain, text: `main`'s editing.
- New clips, props, anything new in her design. Clips added to the manifest as they come.
- Publishing, and re-exporting the VRoid sample with modification and commercial use allowed (before
  she is public).

## Later: the end product, what ships

Ethan's bar for shipping reels on Instagram. Each extends the edit list; the seam keeps its shape.

- **Blended moves between clips** (walk easing into idle in one take) and **faces that change
  mid-shot**: rig work, render side.
- **Camera moves within a shot** (pans, push-ins, orbits): start and end values per camera field.
  On a flat backdrop an orbit round her reads as a turntable in front of a poster; push-ins and pans
  read fine. The fix is a 3D backdrop (content as screens in her scene), which is approach 2 above.
- **Her travelling across the frame** as well as staying put, toggled within a reel: a travel speed
  per clip in the manifest, matched to her stride so her feet do not slide.
- **Music, with cuts on the beat**: an `audio` field and beat marks; choosing the song and finding
  the beat is the engine's job.
- **A much larger clip library**, including `turn`.

## Notes for `main`'s session

- **The seam above is settled.** `clips.json` arrives by hand from `orbit`; never merge `orbit`
  into `main`.
- **Backgrounds are her finds:** `post_tick` already picks a find and reads its `media_path`; for a
  reel it writes that path into each shot's `background`.
- **Render worker:** rendering is on demand, so production runs Blender (headless, EEVEE) with
  `orbit`'s `reel.py` and `spica-v2-clips.blend`. Budget from the measured seconds per frame.
- **Compositing in Node:** `reel_review.py` is the recipe to copy: fill the frame, pan along the
  overflowing axis, video `offset`, hard cuts, her frames over the top. sharp handles stills only;
  the MP4 needs ffmpeg (for example `ffmpeg-static`). Tint, rim light and grain port from the still
  engine (`post-render.ts`).
- **Cost against freedom:** today a still post costs two LLM calls (caption, check); format and pose
  are seeded random. An edit list can be filled from format templates by seeded rules (no tokens),
  written by one LLM call per reel (cost grows with the catalogue in the prompt, not the reel's
  length), or a mix (templates fix the structure, the model picks clips and faces for the mood). The
  cost that grows with a reel's complexity is render time, not tokens.
- **Shipping waits for Later.**
