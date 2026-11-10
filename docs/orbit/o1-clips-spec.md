# Orbit O1 v2: clips and sprites

What O1 stages 5 and 6 build for her v2 model: four animation clips, the sprites rendered from
them, and how those sprites reach the post engine on `main`.
Nov 11, 2026. Status: design agreed with Ethan, not built.

## Goal

Her real body replaces the four placeholder silhouettes in her posts. Any frame of a clip can be
rendered as a still with any of her 32 faces, so nothing is hand-posed. Done means one test post
per facing shows her, correctly lit and placed, and Ethan has approved the clips and the sprites
from renders.

## Out of scope

- Video output and voice. The clips are real animation, so video can use them later.
- More clips. Smirk and flustered are faces for now, with no body movement of their own.
- The engine choosing a face to match a post. Until it can, only faces that suit any post ship.
- Props or anything else new in her design.
- Publishing, and re-exporting the VRoid sample (see Licence).

## The clips

One new script, `assets/model_v2/build/clips.py`, opens the finished `spica-v2.blend`, keys the
clips and saves `assets/model_v2/spica-v2-clips.blend`. The approved `spica-v2.blend` is not
changed, so every existing check still holds. Each clip is one stored action, named `clip_<name>`.

All four start from her arms-down stance (`rig_poses.apply(arm, "arms_down")`, its pose and its
`arms_down` shape) and run at 24 fps.

| Clip | Length | Motion |
| --- | --- | --- |
| `idle` | 96 frames, loops | Chest breathing, a small weight shift between her feet, slight head drift. |
| `walk` | Three 32-frame cycles, loops | About 1.3 seconds per pair of steps. In place: the sprite does not travel. Hips bob and turn, arms swing 15 to 20 degrees. |
| `look_up` | 48 frames, then holds | Head and neck tilt back about 25 degrees, eyes rise, chest lifts slightly. |
| `sit_edge` | 96 frames, loops | Thighs level, shins hanging, one foot swinging slowly, hands on the edge beside her hips. |

- Angles and timings are starting values, corrected by Ethan from the review sheets.
- 96 frames is one orbit of her binary star (`rig.py`), so the star loops with the clips.
- Her arms stay near her sides because her cloth shapes are only tuned for arms down, forward, up
  and overhead.
- **Swing:** `spring.bake` runs after the body is keyed. Loops bake over one extra cycle first, so
  they do not start from a dead stop, and only the settled cycle is kept. `PONY` and `BUST` in
  `spring.py` were a first guess and are tuned on these clips.
- **Faces are not part of a clip.** `face_expr2.use(name)` is applied at render time. `look_up`
  adds its upward glance on top of whichever face is set.
- **Sit fix:** in the current seated test pose, her shorts poke through the hoodie at the seat. A
  cloth shape used only by `sit_edge` fixes it, and it stays off for the standing clips.

**Review:** for each clip, a sheet of evenly spaced frames from the sprite angle and a short video.
Ethan picks the frame each sprite uses.

## The sprites

One new script, `assets/model_v2/build/sprites.py`, takes a clip, frame, face and facing, renders
through `brow_over.render` so her brows stay over her fringe, and writes the PNG and its manifest
entry.

- **Format:** RGBA PNG, 400x1000, transparent background, plus a 3x master (1200x3000). The sprite
  is scaled down from the master with premultiplied alpha, so there is one render per sprite.
- **Angle:** three-quarter, orthographic, like every render so far. Facing left is the camera at
  +32 degrees (`q`), facing right at -32 degrees (`qr`). Every sprite is rendered both ways, because
  mirroring would swap her ponytail, cheek star and socks.
- **Size:** one fixed camera scale for all sprites, set so the tallest and widest frame of
  all four clips fits the canvas, binary star included.
- **Anchor:** the ground point under her (`Root` at x and y 0, her soles at z -0.03) lands at pixel
  `[200, 980]` in every standing sprite. `sit_edge` is decided at its review from rendered options:
  the anchor at her feet (she appears to sit on nothing, feet on the floor line) or at her seat
  (the floor line acts as the edge she sits on, her legs hanging below it).
- **Output:** `assets/model_v2/renders/sprites/` (git-ignored), masters in `master/`, and a
  `poses.json` to copy to `main`.

**First batch:** `observing`, `curious` and `soft_smile`, on all four clips, in both facings: 12
manifest entries, 24 PNGs. The engine picks a sprite by pose tag alone, so only faces that suit any
post ship.

| Clip       | Engine tag     |
| ---------- | -------------- |
| `idle`     | `standing`     |
| `walk`     | `walking`      |
| `look_up`  | `looking_up`   |
| `sit_edge` | `sitting_edge` |

Names are `<clip>-<face>` with every `_` written as `-` (for example `look-up-soft-smile`), and
files are `<name>-left.png` and `<name>-right.png`.

## Change on `main`

Its own small commit on `main`. `orbit` is never merged. The sprites and `poses.json` cross by hand.

- **Manifest:** each entry in `assets/poses/poses.json` becomes
  `{name, files: {left, right}, tags, anchor}`. `facing` and `file` go.
- **`post-library.ts`:** `PoseSchema` matches the new entry.
- **`post-render.ts`:** `PoseSprite` carries both pictures. `renderStill` uses the one for the side
  it needs. The `flop()` and the mirrored anchor are deleted, so she cannot be flipped by accident.
- **`post.ts` and `evals/scripts/posts-review.ts`:** read both files.
- **Tests:** `post-library.test.ts` and `post-render.test.ts` read the placeholders from
  `assets/poses/` today, and `post-tick.test.ts` and the Phase 14 exit test make posts from that
  folder. All four move to a fixture folder, `tests/fixtures/poses/`, holding the placeholders and
  a manifest in the new format, so they pass on a fresh clone with no sprites.
- **Replace rule:** the four placeholders leave `assets/poses/` in the same commit.

## Licence

The sprites show face features from the VRoid sample that must be re-exported with modification and
commercial use allowed before she ships. Until Ethan has done that, the real PNGs stay out of git
on `main`: `assets/poses/*.png` is git-ignored there, and `poses.json` and the code are committed.
A fresh clone has no sprites until they are copied in, and its posts end in `render_failed`.

## Checks

A new `assets/model_v2/build/checks/check_clips.py`:

- Each loop's last frame leads smoothly into its first, swing included.
- A foot that is meant to be planted does not slide or sink below the ground.
- Garment vertices inside her body stay within the rig check's counts.
- Each sprite has a transparent background, nothing touching its canvas edges, and its anchor in
  the agreed place.

Ethan judges the look from renders. On `main`, the post tests pass, and a temporary test calls
`renderStill` directly to make one test post per facing, with no LLM or database. (`pnpm eval
--llm=fake` replays chat scripts and makes no posts.)

## Known risks

- Transparency has never run with `brow_over` or with her binary star's glow. The glow is the
  likeliest to show dark edges, and any fix is part of this work.
- Her faces have only been reviewed head-on, so the three faces may need fixes at 32 degrees.
- `observing` and `curious` have a fixed sideways glance. Sprites send it the way she faces, so she
  does not look back over her shoulder.
- `look_up` is the first real head tilt on these faces and her ponytail. The known hair clip is a
  40-degree tilt toward the ponytail, which this clip does not do.

## Build order

Each step stops for Ethan's review.

1. One test sprite, proving transparency, then `observing`, `curious` and `soft_smile` close up at
   32 degrees.
2. `idle` and `walk`, then `look_up`, then `sit_edge` with its anchor options. Ethan reviews each
   sheet and video and picks its frame.
3. The 24 sprites, reviewed as one sheet.
4. The change on `main`, then the test posts, one per facing.
