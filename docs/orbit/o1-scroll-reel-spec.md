# Orbit O1 v2: the scroll reel

What comes after the reels proof of concept (`o1-reels-spec.md`): one test reel in which she stands in front of a
giant screen playing a feed of reels, watches them over her shoulder, reacts to the camera and swipes to the next
one. Her motion is written fresh for this reel, not taken from the clip library.
Nov 12, 2026. Status: spec, not built.

## Why it changed (Ethan, Nov 12, after watching the proof of concept)

- **Her full body most of the time, the camera static from the front.** The camera angles were for the future; the
  fields stay in the old edit list, unused here.
- **Backgrounds she ignores look random.** She watches reels on the screen behind her and scrolls them: a stand-in
  for watching dynamic content online.
- **Four clips with no transitions are too restricting.** Her motion is written for each reel instead.
- **Ethan reviews every reel** in the early stages (posts are not frequent), so the reel is made in a Claude Code
  session on `orbit`, not by `main`'s engine calling the API.

## Choices (Ethan, Nov 12)

- **The feed fills the whole frame**, as if she stands in front of a giant screen; a swipe scrolls the whole
  background.
- **No phone.** She swipes the screen with big gestures, like a gesture-controlled screen.
- **Motion: keyframes Claude writes for each reel**, after comparing live mocap, video to motion, text to motion,
  motion libraries, AI video and hand keys. Video to motion comes later, for copying other videos (trend dances).
- **She watches like a green-screen reaction video:** she glances back over her shoulder at the feed, turning
  from the waist up with her feet planted, then turns back to react to the camera.
- **The feed's sound plays.**
- **The first reel:** about 15 seconds, one continuous shot, three feed videos and two swipes. A test.

## A reel's files

Each reel is a folder `assets/model_v2/reels/<name>/` (committed; its renders and feed videos are not):

- **`reel.json`**, the edit list:

  ```json
  {
    "width": 1080,
    "height": 1920,
    "frames": 360,
    "faces": [[1, "observing"], [70, "laugh"], [150, "soft_smile"]],
    "feed": [
      { "file": "assets/model_v2/reel_samples/feed-1.mp4", "offset": 0 },
      { "file": "assets/model_v2/reel_samples/feed-2.mp4", "offset": 0 },
      { "file": "assets/model_v2/reel_samples/feed-3.mp4", "offset": 2.5 }
    ],
    "swipes": [130, 250]
  }
  ```

  | Field | Meaning |
  |---|---|
  | `frames` | the reel's length at 24 fps |
  | `faces` | `[frame, expression]` pairs, frames ascending, the first at frame 1; her face is the last pair at or before each frame. Names from her 32 (`face_expr2`). |
  | `feed` | the videos in the order she sees them; one more than `swipes`. `offset` is the second of the video the feed starts at, as in the old edit list. |
  | `swipes` | the frame each swipe's scroll starts on, ascending, inside the reel, at least `SWIPE_GAP` (24 frames, one gesture's length) apart and from either end |

- **`motion.py`**, her motion: a function `motion(arm, frame, edit)` returning bone turns and a hips offset, the same
  form as the clips in `clips.py` (`idle`, `walk`...), so it can use `clips.py`'s helpers and her `idle` as its
  base. It reads `edit["swipes"]` and `edit["faces"]` to time her gestures, so the edit list is the one source of
  timing: moving a swipe there moves her arm and the feed together.

`clips.py -- reel:<name>` builds the motion into `spica-v2-clips.blend` as a one-shot clip `clip_<name>`, through
the same `build` as the library clips (the bob's swing is baked over it). Reel motions are marked as such and left
out of `clips.json`, which stays the library's manifest for `main`.

## Her motion

- **Feet planted all reel.** Everything above her hips moves; her soles stay at `clips.py`'s standing height.
- **The swipe:** one arm comes up in front of her and sweeps up and out above her head over about half a second,
  then drops back. The feed slides during the upward sweep.
- **Watching:** she turns from the waist and head to look back at the feed over her shoulder, then turns back to
  the camera to react.
- **Reactions between swipes:** head tilts, leaning in, a laugh in her shoulders, a hand to her mouth; her face
  changes at the frames `faces` gives.

## Rendering

`reel.py` renders the reel as one shot of the existing format: clip `<name>`, start 0, `full` framing, azimuth 0,
elevation 0, x 0.5, with her face looked up per frame from `faces`. Output as now: transparent PNGs in
`shot-01/NNNN.png`.

**Two renders per version:** a preview at half size (540×960) for Ethan to check her motion, then the full
1080×1920 once he is happy. One command does each: `sh assets/model_v2/build/run_scroll.sh reels/<name> [preview]`,
writing `renders/reels/<name>/preview.mp4` or `reel.mp4`.

## The feed

The review script (`reel_review.py`, extended) lays her over the feed in the Sequencer:

- Each feed video **fills the frame** (scaled to cover, centred) and plays from its `offset`.
- At each swipe the **whole feed slides up** over `SWIPE_FRAMES` (8 frames, a third of a second), easing in and out:
  the old video leaves the top as the next comes in from the bottom and starts playing.
- **Sound:** each video's sound plays while it is on screen and switches at the swipe's start. The MP4 has AAC audio.
- **Frame rate:** a feed video not at 24 fps is retimed so its picture keeps pace with its sound. The build probes
  how the Sequencer does it; if it cannot, the placeholders are chosen at 24 or 25 fps and the old 5% slack applies.
- **Placeholders:** free-licence vertical stock videos with sound (Pexels or similar), in `reel_samples/` with their
  sources in `SOURCES.txt`. Real Instagram reels are a rights question settled before anything ships.

## Checks

Measured, not eyeballed; all but the last run on her pose alone, without a render.

- **Edit list:** the fields above; every face name is real; each feed video exists, has a sound track and is long
  enough for its time on screen from its offset.
- **Feet planted:** on every frame each sole is within 3 mm of where it started, in height and across the floor.
- **In frame:** on every frame her head top, both feet and both hands project inside the picture, the raised hand at
  the top of a swipe included. If the full framing is too tight for it, the reel gets more room above her (a value
  Ethan judges from the preview).
- **Swipe in step with the feed:** through each swipe's scroll window her higher hand rises, and it is at its highest
  within 3 frames of the window's end.
- **Output:** the MP4's length, size, frame rate and audio track match the edit list.
- **Left to Ethan's review:** an arm or hand passing through her body or hair, and whether a reaction reads well.

The old proof of concept (`run_reel.sh`, `reel_poc.json`) keeps working and its checks stay; it is no longer the
default.

## Out of scope (this stage)

Camera moves and angles, cuts, video to motion, rights for real Instagram content, music, other formats (room
commentary, dances, skits, vlogs, replying to comments), and `main`'s engine taking part.

## Notes for `main`'s session

Reels are made in Claude Code sessions on `orbit` for now, with Ethan reviewing each; `main`'s engine sits out reel
making. The old edit-list seam (`o1-reels-spec.md`, `clips.json`) is unchanged.
