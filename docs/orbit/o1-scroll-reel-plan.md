# O1 Scroll Reel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One 15-second test reel: she stands in front of a full-frame feed of reels, watches over her shoulder, reacts to the camera and swipes twice to the next video, with the feed's sound, as a half-size preview for Ethan and then a full render.

**Architecture:** A scroll reel is a folder `assets/model_v2/reels/<name>/` with `reel.json` (length, faces, feed, swipes) and `motion.py` (her motion as a clip function, timed by `reel.json`). `reel_edit.py` (plain Python) checks the edit list and turns it into one shot of the old format, so `reel.py` renders it unchanged apart from a face per frame. `clips.py -- reel:<name>` bakes the motion into `spica-v2-clips.blend` as a one-shot clip marked `reel` (kept out of `clips.json`). `reel_review.py` gains the feed: retimed videos that slide up at each swipe, their sound, and an AAC track. `checks/check_reel.py` gains `feed`, `scroll` and `scroll_review` modes. `run_scroll.sh` runs it all.

**Tech Stack:** Blender 5.2 (EEVEE, Video Sequencer with retiming keys and sound strips, bundled FFmpeg), Python 3 (`python` from miniconda for the plain tests), numpy.

**Spec:** `docs/orbit/o1-scroll-reel-spec.md`. Read it first. Its parent is `docs/orbit/o1-reels-spec.md` (the old edit list, unchanged).

## Global Constraints

- Branch `orbit`. Never merge `orbit` into `main`. Commit after each task; do not push (Ethan says when).
- Blender: `/c/Program Files/Blender Foundation/Blender 5.2/blender.exe`, always with `--python-exit-code 1`; paths given to Blender are absolute (`pwd -W`).
- Every file starts with a short plain-English header comment. Write text files with `newline="\n"`.
- Ask Ethan before adding anything to her design (no props, no phone).
- 24 fps. Swipe scroll `SWIPE_FRAMES = 8`; swipes at least `SWIPE_GAP = 48` frames apart and from either end.
- Full reel 1080×1920; preview half size, 540×960. Static front camera: azimuth 0, elevation 0, framing `full`, x 0.5.
- Feet planted within 3 mm all reel; head top, hands and feet inside the picture every frame.
- No ffmpeg on the machine; only Blender's.
- Renders, feed videos and `.blend` files are git-ignored (`assets/model_v2/renders/`, `assets/model_v2/reel_samples/`). `reels/<name>/reel.json` and `motion.py` are committed.
- `clips.json` stays the library's manifest for `main`: reel motions never appear in it.
- Never kill Blender by image name; Ethan may have it open. A PNG just viewed can be locked: delete before writing.
- Don't `grep -r` from the repo root (`assets/` takes minutes).
- The old proof of concept (`run_reel.sh`, `reel_poc.json`) must keep working.

## Probes already run (Nov 12, Blender 5.2, scratch only)

- A movie strip plays frame for frame. `strip.retiming_keys.add(timeline_frame=1)` makes two keys `[1, 1 + length]`; setting `retiming_keys[-1].timeline_frame = 1 + round(length * 24 / fps)` plays a 30 fps video at real speed. Moving `frame_start` afterwards moves the keys with it, and trimming with `frame_final_start/end` from an offset lines up: a red ramp read 0.341, 0.510, 0.663 against 0.337, 0.506, 0.660 expected.
- `strips.new_sound(name, video_path, channel, frame)` loads a video's sound at real time (2 s = 48 frames at 24 fps).
- `bpy.data.sounds.load(path).samplerate` is 48000 for a video with sound and 0 for one without (no exception).
- Rendering an MP4 with `ffmpeg.audio_codec = "AAC"` and a sound strip gives a file whose sound loads.

## Review Focus

1. **A feed video too short for its time on screen** from its offset. Expected: fails before any rendering, naming the video (`feed video N:`), not black frames or silence. Test: Task 2, Step 1.
2. **A feed video with no sound track** (most stock footage). Expected: fails naming the video. Test: Task 2, Step 1.
3. **A feed video not at 24 fps** (stock is often 25, 30, 60). Expected: plays at real speed so its picture keeps pace with its sound. Test: Task 2, Step 1 (a 30 fps ramp read by pixel).
4. **Moving a swipe in `reel.json`.** Expected: her arm and the feed move together, because the motion reads the same swipes. Test: Task 3 (the swipe check measures her hand against the scroll window).
5. **A reel motion leaking into `clips.json`** after `clips.py -- reel:<name>`. Expected: `clips.json` unchanged and the old manifest check passes. Test: Task 3, Step 8.

---

### Task 1: The scroll edit list in plain Python

**Files:**
- Modify: `assets/model_v2/build/reel_edit.py`
- Test: `assets/model_v2/build/checks/test_reel_edit.py`

**Interfaces:**
- Produces: `SWIPE_FRAMES = 8`; `SWIPE_GAP = 48`; `check_size(edit) -> None`; `validate_scroll(edit: dict, faces: list[str], root: Path = ROOT) -> None` (raises `ValueError`; feed errors start `feed video N:`); `face_at(faces: list, frame: int) -> str`; `feed_spans(edit) -> list[tuple[int, int]]` (first frame, end frame exclusive, per video); `sound_spans(edit) -> list[tuple[int, int]]`; `scroll_shot(edit: dict, clip: str) -> dict` (an old-format edit list with one shot that also carries `faces`); `preview(edit: dict) -> dict` (half size, even).

- [ ] **Step 1: Write the failing test**

Add to `assets/model_v2/build/checks/test_reel_edit.py`, above `if __name__ == "__main__":`:

```python
FACES = ["observing", "soft_smile", "laugh"]
SCROLL = {
    "width": 1080,
    "height": 1920,
    "frames": 360,
    "faces": [[1, "observing"], [96, "laugh"]],
    "feed": [{"file": "a.mp4", "offset": 0}, {"file": "b.mp4"}, {"file": "a.mp4", "offset": 2.5}],
    "swipes": [130, 250],
}


def scroll_rejects(root, change, words):
    edit = copy.deepcopy(SCROLL)
    change(edit)
    try:
        re_.validate_scroll(edit, FACES, root)
    except ValueError as e:
        assert words in str(e), "expected %r in %r" % (words, str(e))
        return
    raise AssertionError("accepted a bad scroll reel: expected " + words)


def test_scroll():
    with tempfile.TemporaryDirectory() as root:
        root = Path(root)
        for name in ("a.mp4", "b.mp4"):
            (root / name).write_bytes(b"x")
        re_.validate_scroll(SCROLL, FACES, root)
        scroll_rejects(root, lambda e: e["faces"].append([200, "grin"]), "unknown face")
        scroll_rejects(root, lambda e: e["faces"][0].__setitem__(0, 2), "start at 1")
        scroll_rejects(root, lambda e: e["faces"].append([50, "laugh"]), "rise")
        scroll_rejects(root, lambda e: e["faces"].append([361, "laugh"]), "inside")
        scroll_rejects(root, lambda e: e["faces"].append(["x", "laugh"]), "[frame, name]")
        scroll_rejects(root, lambda e: e.update(faces=[]), "no faces")
        scroll_rejects(root, lambda e: e.update(swipes=[130, 160]), "apart")
        scroll_rejects(root, lambda e: e.update(swipes=[250, 130]), "rise")
        scroll_rejects(root, lambda e: e.update(swipes=[30, 250]), "either end")
        scroll_rejects(root, lambda e: e.update(swipes=[130, 330]), "either end")
        scroll_rejects(root, lambda e: e.update(swipes=[130.5, 250]), "list of frames")
        scroll_rejects(root, lambda e: e["feed"].pop(), "one more than the swipes")
        scroll_rejects(root, lambda e: e["feed"][1].update(file="c.mp4"), "feed video 2: ")
        scroll_rejects(root, lambda e: e["feed"][2].update(offset=-1), "feed video 3: offset")
        scroll_rejects(root, lambda e: e["feed"][0].pop("file"), "feed video 1: no file")
        scroll_rejects(root, lambda e: e.update(frames=0), "frames")
        scroll_rejects(root, lambda e: e.update(width=1081), "width")
    assert [re_.face_at(SCROLL["faces"], f) for f in (1, 95, 96, 360)] == ["observing", "observing", "laugh", "laugh"]
    assert re_.feed_spans(SCROLL) == [(1, 138), (130, 258), (250, 361)]
    assert re_.sound_spans(SCROLL) == [(1, 130), (130, 250), (250, 361)]
    edit = re_.scroll_shot(SCROLL, "scroll_test")
    re_.validate(edit, {"clips": [{"name": "scroll_test", "frames": 360, "loops": False}], "faces": FACES, "framings": ["full"]})
    shot = edit["shots"][0]
    assert (shot["face"], shot["faces"], shot["azimuth"], shot["elevation"], shot["framing"], shot["x"]) == ("observing", SCROLL["faces"], 0, 0, "full", 0.5)
    small = re_.preview(SCROLL)
    assert (small["width"], small["height"], SCROLL["width"]) == (540, 960, 1080)
```

and in the `__main__` block add `test_scroll()` before the print.

- [ ] **Step 2: Run it to verify it fails**

Run: `python assets/model_v2/build/checks/test_reel_edit.py`
Expected: `AttributeError: module 'reel_edit' has no attribute 'validate_scroll'`

- [ ] **Step 3: Implement**

In `assets/model_v2/build/reel_edit.py`: change the header's second line to

```python
# The format is the seam with main's reel engine (docs/orbit/o1-reels-spec.md): change a field there first. Scroll reels: docs/orbit/o1-scroll-reel-spec.md.
```

add after `RANGES = ...`:

```python
SWIPE_FRAMES = 8  # a swipe's scroll, a third of a second
SWIPE_GAP = 48  # frames between swipes and from either end of the reel: one gesture, wind-up to arm down, is about 36
```

replace the size loop at the top of `validate` with a call `check_size(edit)`, and add above `validate`:

```python
def check_size(edit):
    for k in ("width", "height"):
        if not is_int(edit.get(k)) or edit[k] <= 0 or edit[k] % 2:
            raise ValueError("%s must be a positive even number of pixels (H.264 needs even sizes), not %r" % (k, edit.get(k)))
```

and at the end of the file:

```python
def validate_scroll(edit, faces, root=ROOT):
    """A scroll reel's edit list; raises on the first bad field. Video lengths and sound need Blender (reel_review.check_feed)."""
    check_size(edit)
    n = edit.get("frames")
    if not is_int(n) or n < 1:
        raise ValueError("frames must be a whole number from 1, not %r" % n)
    pairs = edit.get("faces")
    if not isinstance(pairs, list) or not pairs:
        raise ValueError("no faces")
    for p in pairs:
        if not (isinstance(p, list) and len(p) == 2 and is_int(p[0])):
            raise ValueError("a face must be [frame, name], not %r" % (p,))
        if p[1] not in faces:
            raise ValueError("unknown face %r" % p[1])
    at = [p[0] for p in pairs]
    if at[0] != 1 or any(b <= a for a, b in zip(at, at[1:])) or at[-1] > n:
        raise ValueError("face frames %s must start at 1, rise, and stay inside the reel's %d frames" % (at, n))
    swipes = edit.get("swipes")
    if not isinstance(swipes, list) or not all(is_int(s) for s in swipes):
        raise ValueError("swipes must be a list of frames, not %r" % (swipes,))
    marks = [1] + swipes + [n]
    if swipes and any(b - a < SWIPE_GAP for a, b in zip(marks, marks[1:])):
        raise ValueError("swipes %s must rise, at least %d frames apart and from either end of the reel's %d" % (swipes, SWIPE_GAP, n))
    feed = edit.get("feed")
    if not isinstance(feed, list) or len(feed) != len(swipes) + 1:
        raise ValueError("the feed needs %d videos, one more than the swipes" % (len(swipes) + 1))
    for k, video in enumerate(feed, 1):
        if not isinstance(video, dict) or "file" not in video:
            raise ValueError("feed video %d: no file" % k)
        if not resolve(video["file"], root).is_file():
            raise ValueError("feed video %d: %s not found" % (k, resolve(video["file"], root)))
        offset = video.get("offset", 0)
        if not is_number(offset) or offset < 0:
            raise ValueError("feed video %d: offset %r must be 0 or more seconds" % (k, offset))


def face_at(faces, frame):
    """Her expression at a frame: the last [frame, name] pair at or before it."""
    return [name for f, name in faces if f <= frame][-1]


def feed_spans(edit):
    """Each feed video's (first frame, end frame) on screen, end exclusive: it comes in with the swipe before it and leaves when the swipe after it ends."""
    swipes = edit["swipes"]
    return list(zip([1] + swipes, [s + SWIPE_FRAMES for s in swipes] + [edit["frames"] + 1]))


def sound_spans(edit):
    """Each feed video's sound, the same way: it switches as a swipe starts."""
    swipes = edit["swipes"]
    return list(zip([1] + swipes, swipes + [edit["frames"] + 1]))


def scroll_shot(edit, clip):
    """A scroll reel as one shot of the old edit list, so reel.py renders it as any shot: her full body, front on, her face per frame."""
    shot = {"clip": clip, "start": 0, "frames": edit["frames"], "face": edit["faces"][0][1], "faces": edit["faces"], "azimuth": 0, "elevation": 0, "framing": "full", "x": 0.5}
    return {"width": edit["width"], "height": edit["height"], "shots": [shot]}


def preview(edit):
    """Half size for checking her motion, kept even for H.264."""
    return dict(edit, width=edit["width"] // 4 * 2, height=edit["height"] // 4 * 2)
```

- [ ] **Step 4: Run it to verify it passes**

Run: `python assets/model_v2/build/checks/test_reel_edit.py`
Expected: `REEL_EDIT ok`

- [ ] **Step 5: Commit**

```bash
git add assets/model_v2/build/reel_edit.py assets/model_v2/build/checks/test_reel_edit.py
git commit -m "feat(orbit): O1 scroll reel: the edit list read and checked in plain Python"
```

---

### Task 2: The feed in the review

**Files:**
- Modify: `assets/model_v2/build/reel_review.py`
- Modify: `assets/model_v2/build/checks/check_reel.py`

**Interfaces:**
- Consumes: Task 1's `validate_scroll`, `feed_spans`, `sound_spans`, `preview`, `SWIPE_FRAMES`, `resolve`, `ROOT`.
- Produces (in `reel_review.py`): `has_sound(path) -> bool`; `check_feed(edit, root=ROOT) -> None` (raises `ValueError("feed video N: ...")`); `build_scroll(scene, edit, frames_dir, root=ROOT) -> None`; `write_video(scene, out, audio: bool) -> None`; CLI `-- scroll <abs reel dir> <abs frames dir> <abs out.mp4> [preview]`. In `check_reel.py`: modes `feed <abs scratch dir>` and `scroll_review <mp4> <abs reel dir> [preview]` (both `--factory-startup`), and `check_scroll_review(mp4, edit)`.

- [ ] **Step 1: Write the failing check**

In `assets/model_v2/build/checks/check_reel.py`: change the header's second and third lines to

```python
# Args after --: manifest | camera | wrap <abs scratch dir> | frames <abs frames dir> <reel.json> | scroll <abs reel dir> run on spica-v2-clips.blend;
# pan <abs scratch dir> | review <mp4> <reel.json> | feed <abs scratch dir> | scroll_review <mp4> <abs reel dir> [preview] run in an empty session (--factory-startup).
```

add `import math`, `import struct` and `import wave` to the imports, and add above `def main():`:

```python
def test_video(path, fps, frames, first, last, sound):
    """A test video, one colour fading linearly to another, with a tone if sound is on. Blender makes it: there is no ffmpeg here."""
    import reel_review as rr

    scene = bpy.data.scenes.new(path.stem)
    r = scene.render
    r.resolution_x, r.resolution_y, r.resolution_percentage, r.fps = 270, 480, 100, fps
    scene.view_settings.view_transform = "Standard"
    strips = scene.sequence_editor_create().strips
    colour = strips.new_effect("colour", "COLOR", 1, 1, length=frames)
    for f, c in ((1, first), (frames, last)):
        colour.color = c
        colour.keyframe_insert("color", frame=f)
    for fc in scene.animation_data.action.layers[0].strips[0].channelbags[0].fcurves:
        for k in fc.keyframe_points:
            k.interpolation = "LINEAR"
    if sound:
        tone = path.with_suffix(".wav")
        with wave.open(str(tone), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(48000)
            w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(math.tau * 440 * i / 48000))) for i in range(48000 * (frames // fps + 1))))
        strips.new_sound("tone", str(tone), 2, 1)
    scene.frame_start, scene.frame_end = 1, frames
    rr.write_video(scene, path, audio=sound)
    return path


def check_feed(scratch):
    """The feed by pixel: a 30 fps video plays at real speed from its offset, a swipe slides the old video up as the next comes in, and bad videos fail first."""
    import reel_review as rr

    red, blue, green = (1, 0, 0), (0, 0, 1), (0, 1, 0)
    v1 = test_video(scratch / "ramp30.mp4", 30, 150, (0, 0, 0), red, True)  # 5 s, red rising frame by frame
    v2 = test_video(scratch / "blue24.mp4", 24, 120, blue, blue, True)
    v3 = test_video(scratch / "green25.mp4", 25, 125, green, green, True)
    silent = test_video(scratch / "silent24.mp4", 24, 120, blue, blue, False)
    (scratch / "shot-01").mkdir(exist_ok=True)
    for k in range(1, 151):  # her frames: empty, so only the feed shows
        image = bpy.data.images.new("empty", 270, 480, alpha=True)
        image.pixels.foreach_set(np.zeros(270 * 480 * 4, np.float32))
        image.filepath_raw, image.file_format = str(scratch / "shot-01" / ("%04d.png" % k)), "PNG"
        image.save()
        bpy.data.images.remove(image)
    edit = {"width": 270, "height": 480, "frames": 150, "faces": [[1, "observing"]], "swipes": [50, 100], "feed": [{"file": str(v1), "offset": 1.0}, {"file": str(v2)}, {"file": str(v3)}]}
    for change, words in ((lambda e: e["feed"][1].update(file=str(silent)), "feed video 2: silent24.mp4 has no sound"), (lambda e: e["feed"][0].update(offset=3.0), "feed video 1: ramp30.mp4 is too short")):
        broken = json.loads(json.dumps(edit))
        change(broken)
        try:
            rr.build_scroll(bpy.data.scenes.new("broken"), broken, scratch, scratch)
            bad("a bad feed was accepted: expected " + words)
        except ValueError as e:
            if not str(e).startswith(words):
                bad("bad feed: unclear error %r, expected %r" % (str(e), words))
    scene = bpy.context.scene
    rr.build_scroll(scene, edit, scratch, scratch)
    mean = lambda f, rows=slice(None): read_still(scene, scratch, f)[rows, :, :3].reshape(-1, 3).mean(axis=0)
    want = 2.0 * 30 / 149  # frame 25 is 1 s into the shot, from 1 s into the video: its 60th frame of 150
    if abs(mean(25)[0] - want) > 0.04:
        bad("feed: a 30 fps video does not play at real speed from its offset (red %.3f, expected %.3f)" % (mean(25)[0], want))
    if mean(49)[2] > 0.05:
        bad("feed: the next video shows before its swipe")
    top, bottom = mean(54, slice(0, 120)), mean(54, slice(360, 480))
    if not (top[0] > 0.3 and top[2] < 0.1 and bottom[2] > 0.8):
        bad("feed: halfway through a swipe the old video should be leaving the top and the next coming in below (top %s, bottom %s)" % (np.round(top, 2), np.round(bottom, 2)))
    if mean(58)[2] < 0.9 or mean(125)[1] < 0.9:
        bad("feed: after a swipe the next video should fill the frame")
    mp4 = scratch / "feed.mp4"
    rr.write_video(scene, mp4, audio=True)
    check_scroll_review(mp4, edit)
    print("FEED checked")


def read_still(scene, scratch, frame):
    import reel_review as rr

    path = scratch / ("feed-%d.png" % frame)
    rr.still(scene, frame, path)
    return read_png(path)


def check_scroll_review(mp4, edit):
    clip = bpy.data.movieclips.load(str(mp4))
    if clip.frame_duration != edit["frames"]:
        bad("the reel is %d frames, the edit list says %d" % (clip.frame_duration, edit["frames"]))
    if tuple(clip.size) != (edit["width"], edit["height"]):
        bad("the reel is %s, the edit list says %dx%d" % (tuple(clip.size), edit["width"], edit["height"]))
    if abs(clip.fps - 24) > 0.01:
        bad("the reel is %.2f fps" % clip.fps)
    if bpy.data.sounds.load(str(mp4)).samplerate == 0:
        bad("the reel has no sound")
    print("REVIEW checked", edit["frames"], "frames with sound")
```

and in `main()` add, before `else:`:

```python
    elif mode == "feed":
        scratch = Path(rest[0])
        scratch.mkdir(parents=True, exist_ok=True)
        check_feed(scratch)
    elif mode == "scroll_review":
        edit = re_.load(Path(rest[1]) / "reel.json")
        check_scroll_review(Path(rest[0]), re_.preview(edit) if rest[2:] == ["preview"] else edit)
```

- [ ] **Step 2: Run it to verify it fails**

Run (from the repo root, Git Bash):

```bash
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
"$B" -b --factory-startup --python-exit-code 1 -P "$(pwd -W)/assets/model_v2/build/checks/check_reel.py" -- feed "$(pwd -W)/assets/model_v2/renders/reel/feedcheck" 2>&1 | grep -E "Error|PROBLEM|checked"
```

Expected: `AttributeError: module 'reel_review' has no attribute 'write_video'`

- [ ] **Step 3: Implement**

In `assets/model_v2/build/reel_review.py`: change the header to

```python
# Lays her rendered shots over their backgrounds and writes an MP4 for Ethan to watch: silent for an edit list, with the feed's sound for a scroll reel.
# A plain overlay on purpose: tint, rim light, grain and music are main's editing. Its recipe (fill, pan, offset, cuts, swipes) is what main copies.
# Args after --: <reel.json> <abs frames dir> <abs out.mp4> | scroll <abs reel dir> <abs frames dir> <abs out.mp4> [preview]. Run in an empty session: blender -b --factory-startup.
```

add `import json` to the imports and, after `VIDEO = ...`:

```python
MANIFEST = Path(__file__).resolve().parent.parent / "clips.json"
```

Replace the body of `build` from `W, H = ...` to the end of its loop with calls to two new helpers, so it reads:

```python
def build(scene, edit, frames, root=re_.ROOT):
    """The whole reel in the Sequencer: background on channel 1, her on channel 2, shots end to end. Returns its length."""
    re_.validate_backgrounds(edit, root)
    W, H = edit["width"], edit["height"]
    strips = setup(scene, W, H)
    t0 = 1
    for n, shot in enumerate(edit["shots"], 1):
        background(strips, n, shot, t0, W, H, root)
        her_strip(strips, "her-%02d" % n, Path(frames) / ("shot-%02d" % n), 2, t0, shot["frames"])
        t0 += shot["frames"]
    scene.frame_start, scene.frame_end = 1, t0 - 1
    return t0 - 1


def setup(scene, W, H):
    r = scene.render
    r.resolution_x, r.resolution_y, r.resolution_percentage, r.fps = W, H, 100, FPS
    scene.view_settings.view_transform = "Standard"  # the empty scene's default (AgX) would shift her colours
    return scene.sequence_editor_create().strips


def her_strip(strips, name, folder, channel, t0, frames):
    her = strips.new_image(name, str(folder / "0001.png"), channel, t0, fit_method="ORIGINAL")
    for k in range(2, frames + 1):
        her.elements.append("%04d.png" % k)
    her.blend_type = "ALPHA_OVER"


def has_sound(path):
    return bpy.data.sounds.load(str(path), check_existing=True).samplerate > 0  # a video with no sound track loads at rate 0


def check_feed(edit, root=re_.ROOT):
    """What only Blender can tell about the feed: each file is a video with sound that lasts its time on screen from its offset."""
    for k, (video, (t0, end)) in enumerate(zip(edit["feed"], re_.feed_spans(edit)), 1):
        path = re_.resolve(video["file"], root)
        w, h, fps, length = source_size(path)
        if fps is None:
            raise ValueError("feed video %d: %s is not a video" % (k, path.name))
        if not has_sound(path):
            raise ValueError("feed video %d: %s has no sound track" % (k, path.name))
        offset = video.get("offset", 0)
        need = offset + (end - t0) / FPS
        if need > length / fps + 1e-6:
            raise ValueError("feed video %d: %s is too short: it lasts %.2f s and the feed needs it to %.2f s" % (k, path.name, length / fps, need))


def feed_video(strips, name, path, channel, t0, end, offset, W, H):
    """A feed video on screen from t0 to end (exclusive), from offset seconds in, at its own speed, filling the frame."""
    w, h, fps, length = source_size(path)
    strip = strips.new_movie(name, str(path), channel, 1, fit_method="ORIGINAL")
    strip.retiming_keys.add(timeline_frame=1)
    strip.retiming_keys[-1].timeline_frame = 1 + round(length * FPS / fps)  # the Sequencer plays a video frame for frame; this stretches it to real time
    strip.frame_start = t0 - round(offset * FPS)
    strip.frame_final_start, strip.frame_final_end = t0, end
    strip.transform.scale_x = strip.transform.scale_y = max(W / w, H / h)
    strip.blend_type = "ALPHA_OVER"
    return strip


def feed_sound(strips, name, path, channel, t0, end, offset):
    sound = strips.new_sound(name, str(path), channel, 1)
    sound.frame_start = t0 - round(offset * FPS)
    sound.frame_final_start, sound.frame_final_end = t0, end


def slide(strip, at, H, leaving):
    """Over a swipe's scroll the feed moves up one screen, easing in and out: the old video from 0 to H, the next from -H to 0."""
    for f, y in zip((at, at + re_.SWIPE_FRAMES), (0, H) if leaving else (-H, 0)):
        strip.transform.offset_y = y
        strip.transform.keyframe_insert("offset_y", frame=f)


def build_scroll(scene, edit, frames, root=re_.ROOT):
    """A scroll reel in the Sequencer: the feed on channels 1 and 2 by turns (the next video comes in under a swipe), her on 3, the sound on 4 and 5."""
    re_.validate_scroll(edit, json.loads(MANIFEST.read_text())["faces"], root)
    check_feed(edit, root)
    W, H = edit["width"], edit["height"]
    strips = setup(scene, W, H)
    swipes = edit["swipes"]
    for k, (video, (t0, end), (_, heard)) in enumerate(zip(edit["feed"], re_.feed_spans(edit), re_.sound_spans(edit))):
        path, offset = re_.resolve(video["file"], root), video.get("offset", 0)
        strip = feed_video(strips, "feed-%d" % (k + 1), path, 1 + k % 2, t0, end, offset, W, H)
        if k > 0:
            slide(strip, swipes[k - 1], H, leaving=False)
        if k < len(swipes):
            slide(strip, swipes[k], H, leaving=True)
        feed_sound(strips, "sound-%d" % (k + 1), path, 4 + k % 2, t0, heard, offset)
    her_strip(strips, "her", Path(frames) / "shot-01", 3, 1, edit["frames"])
    scene.frame_start, scene.frame_end = 1, edit["frames"]
```

Replace `write` with:

```python
def write(scene, edit, out):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    for old in out.parent.glob(out.stem + "-shot-*.png"):
        old.unlink()  # a longer earlier reel's stills would land on the sheet
    t0 = 1
    for n, shot in enumerate(edit["shots"], 1):
        still(scene, t0 + shot["frames"] // 2, out.parent / ("%s-shot-%02d.png" % (out.stem, n)))
        t0 += shot["frames"]
    write_video(scene, out, audio=False)


def write_video(scene, out, audio):
    """The scene's Sequencer as H.264, with its sound strips as AAC when audio is on."""
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    r = scene.render
    if hasattr(r.image_settings, "media_type"):
        r.image_settings.media_type = "VIDEO"
    r.image_settings.file_format = "FFMPEG"
    r.ffmpeg.format, r.ffmpeg.codec = "MPEG4", "H264"
    r.ffmpeg.constant_rate_factor = "HIGH"
    r.ffmpeg.audio_codec = "AAC" if audio else "NONE"
    if audio:
        r.ffmpeg.audio_channels, r.ffmpeg.audio_mixrate, r.ffmpeg.audio_bitrate = "STEREO", 48000, 192
    for old in out.parent.glob(out.stem + "_*.mp4"):
        old.unlink()
    r.filepath = str(out.parent / (out.stem + "_"))
    with bpy.context.temp_override(scene=scene):
        bpy.ops.render.render(animation=True, scene=scene.name)
    made = sorted(out.parent.glob(out.stem + "_*.mp4"))
    assert len(made) == 1, "expected one video, found %s" % made
    out.unlink(missing_ok=True)
    made[0].rename(out)  # Blender adds the frame range to a video's name
```

Replace `main` with:

```python
def main():
    args = sys.argv[sys.argv.index("--") + 1:]
    scene = bpy.context.scene
    if args[0] == "scroll":
        folder, frames, out = (Path(a) for a in args[1:4])
        edit = re_.load(folder / "reel.json")
        build_scroll(scene, re_.preview(edit) if args[4:] == ["preview"] else edit, frames)
        write_video(scene, out, audio=True)
    else:
        reel_json, frames, out = args
        build(scene, re_.load(reel_json), Path(frames))
        write(scene, re_.load(reel_json), Path(out))
    print("REEL", out)
```

- [ ] **Step 4: Run it to verify it passes**

Run the Step 2 command.
Expected: `REVIEW checked 150 frames with sound` then `FEED checked`, and no `PROBLEM`.

If the slide reads the wrong way round (the old video leaving the bottom), the sign of `offset_y` is opposite to the old pan's comment: swap `(0, H)` and `(-H, 0)` for `(0, -H)` and `(H, 0)`, ledger a ruling, and re-run.

- [ ] **Step 5: The old proof of concept still composites**

Run:

```bash
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
"$B" -b --factory-startup --python-exit-code 1 -P "$(pwd -W)/assets/model_v2/build/checks/check_reel.py" -- pan "$(pwd -W)/assets/model_v2/renders/reel/pan" 2>&1 | grep -E "Error|PROBLEM|checked"
```

Expected: `PAN checked`, no `PROBLEM`.

- [ ] **Step 6: Commit**

```bash
git add assets/model_v2/build/reel_review.py assets/model_v2/build/checks/check_reel.py
git commit -m "feat(orbit): O1 scroll reel: the feed in the review, retimed, sliding at each swipe, with its sound"
```

---

### Task 3: Her motion for the first reel, and the renderer

**Files:**
- Modify: `assets/model_v2/build/clips.py`
- Modify: `assets/model_v2/build/reel.py`
- Modify: `assets/model_v2/build/checks/check_reel.py`
- Create: `assets/model_v2/reels/scroll_test/reel.json`
- Create: `assets/model_v2/reels/scroll_test/motion.py`

**Interfaces:**
- Consumes: Task 1's `scroll_shot`, `face_at`, `validate_scroll`, `preview`, `SWIPE_FRAMES`; `clips.py`'s `idle`, `leg`, `head_of`, `turn`, `B`, `HIPS`, `SPINE`, `CHEST`, `UPPER_CHEST`, `NECK`, `HEAD`.
- Produces: `clips.py -- reel:<name>` (builds `clip_<name>`, one-shot, custom prop `reel = True`, prints `BUILT`); `reel.manifest(reels=False)`; `reel.render` honouring a shot's optional `faces`; `reel.py -- scroll <abs reel dir> <abs out dir> [preview]` (writes `<out>/edit.json`, the shot edit list it rendered); `check_reel.py -- scroll <abs reel dir>`; `motion(arm, frame, edit) -> (dict[str, Quaternion], Vector)`.

- [ ] **Step 1: Write the first reel's edit list**

`assets/model_v2/reels/scroll_test/reel.json`:

```json
{
  "width": 1080,
  "height": 1920,
  "frames": 360,
  "faces": [[1, "observing"], [90, "laugh"], [152, "curious"], [210, "startled"], [262, "curious"], [332, "soft_smile"]],
  "feed": [
    { "file": "assets/model_v2/reel_samples/feed-1.mp4", "offset": 0 },
    { "file": "assets/model_v2/reel_samples/feed-2.mp4", "offset": 0 },
    { "file": "assets/model_v2/reel_samples/feed-3.mp4", "offset": 0 }
  ],
  "swipes": [130, 250]
}
```

(The feed files arrive in Task 4; nothing in this task opens them.)

- [ ] **Step 2: Write the failing check**

In `assets/model_v2/build/checks/check_reel.py` add after `SAME = ...`:

```python
FOOT_DRIFT = 0.003  # metres a planted foot may move through a scroll reel
EDGE = 0.01  # share of the picture kept clear at each edge
SWIPE_RISE = 0.15  # metres her swiping hand must rise during the scroll
```

and above `def main():`:

```python
def check_scroll(folder):
    """A scroll reel's motion, measured on her pose every frame: feet planted, all of her in the picture, each swipe's hand rising with the feed."""
    import reel
    import sprites as sp
    from bpy_extras.object_utils import world_to_camera_view

    edit, name = re_.load(folder / "reel.json"), folder.name
    shot = re_.scroll_shot(edit, name)["shots"][0]
    arm, scene = bpy.data.objects["Armature"], bpy.context.scene
    action = bpy.data.actions.get("clip_" + name)
    assert action and action.get("reel"), "clip_%s is missing or not marked as a reel motion; run clips.py -- reel:%s" % (name, name)
    if (action["first"], action["last"]) != (1, edit["frames"]):
        bad("clip_%s runs %d to %d, the reel is %d frames" % (name, action["first"], action["last"], edit["frames"]))
    cam = sp.setup(scene, transparent=True)
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = edit["width"], edit["height"], 100
    at = lambda bone, end="head": arm.matrix_world @ getattr(arm.pose.bones[bone], end)
    feet = ("J_Bip_L_Foot", "J_Bip_R_Foot", "J_Bip_L_ToeBase", "J_Bip_R_ToeBase")
    start, worst, outside, hands = None, (0.0, 1), {}, []
    for f in range(1, edit["frames"] + 1):
        sp.pose(arm, scene, name, f)
        reel.place_camera(cam, arm, scene, shot)
        now = [at(b) for b in feet]
        start = start or now
        worst = max(worst, (max((a - b).length for a, b in zip(now, start)), f))
        parts = {"head top": at("J_Bip_C_Head", "tail"), "left hand": at("J_Bip_L_Middle3", "tail"), "right hand": at("J_Bip_R_Middle3", "tail"), "left foot": now[2], "right foot": now[3]}
        for part, p in parts.items():
            v = world_to_camera_view(scene, cam, p)
            if not (EDGE < v.x < 1 - EDGE and EDGE < v.y < 1 - EDGE):
                outside.setdefault(part, f)
        hands.append(max(parts["left hand"].z, parts["right hand"].z))
    if worst[0] > FOOT_DRIFT:
        bad("a planted foot moves %.1f mm (worst at frame %d)" % (worst[0] * 1000, worst[1]))
    for part, f in outside.items():
        bad("her %s leaves the picture (first at frame %d)" % (part, f))
    height = lambda f: hands[f - 1]
    for s in edit["swipes"]:
        end = s + re_.SWIPE_FRAMES
        if height(end) < height(s) + SWIPE_RISE:
            bad("swipe at %d: her hand rises only %.2f m during the scroll" % (s, height(end) - height(s)))
        top = max(range(max(1, s - 12), min(edit["frames"], s + 30) + 1), key=height)
        if abs(top - end) > 3:
            bad("swipe at %d: her hand is highest at frame %d, not within 3 frames of the scroll's end (%d)" % (s, top, end))
    print("SCROLL checked", name, edit["frames"], "frames; feet within %.1f mm" % (worst[0] * 1000))
```

and in `main()`, before `else:`:

```python
    elif mode == "scroll":
        check_scroll(Path(rest[0]))
```

- [ ] **Step 3: Run it to verify it fails**

Run (repo root, Git Bash):

```bash
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"; M="$(pwd -W)/assets/model_v2"
"$B" -b "$M/spica-v2-clips.blend" --python-exit-code 1 -P "$M/build/checks/check_reel.py" -- scroll "$M/reels/scroll_test" 2>&1 | grep -E "Error|PROBLEM|checked"
```

Expected: `AssertionError: clip_scroll_test is missing or not marked as a reel motion; run clips.py -- reel:scroll_test`

- [ ] **Step 4: Teach clips.py to build a reel's motion**

In `assets/model_v2/build/clips.py`: change the header's first line to

```python
# Keys her clips on the finished model and saves spica-v2-clips.blend, leaving spica-v2.blend alone. Args after --: <name,...>; only those are replaced.
# reel:<name> builds a scroll reel's motion (assets/model_v2/reels/<name>/motion.py) as a one-shot clip marked "reel"; run it on spica-v2-clips.blend, as a library rebuild from spica-v2.blend drops it.
```

(keep the existing second header line after it), add `import importlib.util` to the imports, add after `OUT = ...`:

```python
REELS = OUT.parent / "reels"
```

add above `def main():`:

```python
def add_reel(name):
    """A reel's motion as a clip: reels/<name>/motion.py, timed by the reel.json beside it."""
    if name in CLIPS:
        raise SystemExit("reel %r has a library clip's name" % name)
    folder = REELS / name
    spec = importlib.util.spec_from_file_location("motion_" + name, folder / "motion.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    edit = json.loads((folder / "reel.json").read_text(encoding="utf-8"))
    CLIPS[name] = (lambda arm, frame: module.motion(arm, frame, edit), edit["frames"], False)
```

and replace `main`'s loop with:

```python
    names = sys.argv[sys.argv.index("--") + 1].split(",")
    for item in names:
        name = item[len("reel:"):] if item.startswith("reel:") else item
        if name != item:
            add_reel(name)
        build(arm, name)
        if name != item:
            bpy.data.actions["clip_" + name]["reel"] = True
```

and end `main` (after `reel.write_manifest(...)`) with `print("BUILT", names)`.

- [ ] **Step 5: Keep reel motions out of the manifest, and give the renderer faces per frame**

In `assets/model_v2/build/reel.py`: add the line `# Scroll reels: -- scroll <abs reel dir> <abs out dir> [preview] (docs/orbit/o1-scroll-reel-spec.md).` after the header's third line. Replace `manifest` with:

```python
def manifest(reels=False):
    """The clips in this file, her faces and the framings: what main's engine writes edit lists from. Reel motions are one-offs, listed only when asked."""
    clips = []
    for a in sorted((a for a in bpy.data.actions if a.name.startswith("clip_")), key=lambda a: a.name):
        if a.get("reel") and not reels:
            continue
        name = a.name[5:]
        tags = ["reel"] if a.get("reel") else [sp.TAGS[name]]
        clips.append({"name": name, "frames": a["last"] - a["first"] + 1, "loops": a["first"] > 1, "tags": tags})  # clips.py starts a loop at its second cycle
    return {"fps": FPS, "clips": clips, "faces": list(face_expr2.NAMES), "framings": list(FRAMING)}
```

In `render`: change `re_.validate(edit, manifest())` to `re_.validate(edit, manifest(reels=True))`, and replace the line `sp.set_face(shot["face"], facing, shot["clip"])` with:

```python
            face = re_.face_at(shot["faces"], i + 1) if "faces" in shot else shot["face"]
            sp.set_face(face, facing, shot["clip"])
```

Add above `def main():`:

```python
def render_scroll(folder, out, preview):
    """A scroll reel as one front-on shot; the shot's edit list goes beside the frames for the frames check."""
    edit = re_.load(folder / "reel.json")
    re_.validate_scroll(edit, manifest()["faces"])
    shot = re_.scroll_shot(re_.preview(edit) if preview else edit, folder.name)
    out.mkdir(parents=True, exist_ok=True)
    (out / "edit.json").write_text(json.dumps(shot, indent=2) + "\n", newline="\n")
    render(shot, out)
```

and in `main`, after the `manifest` branch:

```python
    if rest[0] == "scroll":
        render_scroll(Path(rest[1]), Path(rest[2]), rest[3:] == ["preview"])
        return
```

- [ ] **Step 6: Write her motion**

`assets/model_v2/reels/scroll_test/motion.py`:

```python
# Her motion for the first scroll reel: she watches the feed over her shoulder, turns back to react to the camera, and swipes to the next video.
# motion(arm, frame, edit) gives bone turns in her own axes and a hips offset, the form of the clips in build/clips.py; the reel.json beside it times everything.
# First version: angles and timings are starting values Ethan corrects from the preview.
import math

from mathutils import Quaternion

import clips as c
import reel_edit as re_

LOOK = {c.HIPS: 8, c.SPINE: 12, c.CHEST: 12, c.UPPER_CHEST: 14, c.NECK: 22, c.HEAD: 32}  # degrees each turns toward her left to look back at the feed: 100 in all, an over-the-shoulder glance
LOOK_UP = -6  # her head tips up a little to the screen behind her (negative X tips it back, as in look_up)
LEAD, RECOVER = 12, 16  # frames of wind-up before a swipe's scroll, and of the arm coming down after it
# Her right arm through a swipe, in frames from the scroll's start: upper arm forward (X; negative raises it, as her seated arms), out to her side (Y), forearm bend (X)
SWIPE = ((-LEAD, 0, 0, 0), (0, -70, 10, -50), (re_.SWIPE_FRAMES, -160, 28, -12), (re_.SWIPE_FRAMES + 3, -160, 28, -12), (re_.SWIPE_FRAMES + RECOVER, 0, 0, 0))
FADE = 6  # frames a reaction takes to come and go


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def window(frame, a, b, c_, d):
    """0 before a, up to 1 by b, held, back to 0 from c_ to d."""
    return smooth((frame - a) / (b - a)) * (1 - smooth((frame - c_) / (d - c_)))


def keyed(t, keys):
    """Values between keys, eased in and out; zeros outside them."""
    for (t0, *a), (t1, *b) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            k = smooth((t - t0) / (t1 - t0))
            return [x + (y - x) * k for x, y in zip(a, b)]
    return [0.0] * (len(keys[0]) - 1)


def looks(edit):
    """When she looks back at the feed: in each stretch between swipes, from soon after the last swipe until 24 frames before the next wind-up, so she has turned back to react first."""
    swipes, n = edit["swipes"], edit["frames"]
    starts = [1] + [s + re_.SWIPE_FRAMES + RECOVER for s in swipes]
    ends = [s - LEAD for s in swipes] + [n]
    return [(a + 8, a + 24, b - 40, b - 24) for a, b in zip(starts, ends) if b - a >= 72]


def react(name, frame):
    """Her body's part of an expression, at full strength, by bone."""
    if name == "laugh":
        return {c.UPPER_CHEST: c.turn("X", 2.5 * math.sin(math.tau * frame / 7)), c.HEAD: c.turn("X", -5)}  # shoulders shake, head tips back
    if name == "curious":
        return {c.UPPER_CHEST: c.turn("X", 4), c.HEAD: c.turn("Y", 8)}  # leans in, head tilted
    if name == "startled":
        return {c.UPPER_CHEST: c.turn("X", -5), c.HEAD: c.turn("X", -4)}  # pulls back
    if name == "soft_smile":
        return {c.HEAD: c.turn("Y", -6)}
    return {}


def motion(arm, frame, edit):
    turns, at = c.idle(arm, frame)
    look = max([window(frame, *w) for w in looks(edit)], default=0.0)
    extra = {bone: c.turn("Z", degrees * look) for bone, degrees in LOOK.items()}
    extra[c.HEAD] = c.turn("X", LOOK_UP * look) @ extra[c.HEAD]
    faces = edit["faces"]
    for (start, name), end in zip(faces, [f for f, _ in faces[1:]] + [edit["frames"] + 1]):
        weight = window(frame, start, start + FADE, end - FADE, end) * (1 - look)
        for bone, q in react(name, frame).items():
            extra[bone] = Quaternion().slerp(q, weight) @ extra.get(bone, Quaternion())
    for s in edit["swipes"]:
        forward, out, bend = keyed(frame - s, SWIPE)
        if forward or out or bend:
            extra[c.B("R", "UpperArm")] = c.turn("Y", out) @ c.turn("X", forward)
            extra[c.B("R", "LowerArm")] = c.turn("X", bend)
    for bone, q in extra.items():
        turns[bone] = q @ turns.get(bone, Quaternion())
    for side in "LR":  # her hips turn with the look; the legs follow so her feet stay where they stand
        turns.update(c.leg(arm, side, c.head_of(arm, c.B(side, "Foot")), 0, turns[c.HIPS], at))
    return turns, at
```

- [ ] **Step 7: Build it and run the check**

Run:

```bash
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"; M="$(pwd -W)/assets/model_v2"
"$B" -b "$M/spica-v2-clips.blend" --python-exit-code 1 -P "$M/build/clips.py" -- reel:scroll_test 2>&1 | grep -E "Error|Traceback|BUILT"
"$B" -b "$M/spica-v2-clips.blend" --python-exit-code 1 -P "$M/build/checks/check_reel.py" -- scroll "$M/reels/scroll_test" 2>&1 | grep -E "Error|PROBLEM|checked"
```

Expected: `BUILT ['reel:scroll_test']`, then `SCROLL checked scroll_test 360 frames; feet within N mm` with N at most 3, and no `PROBLEM`.

Where the check fails, change the motion, not the check:
- **The right hand leaves the picture at a swipe's top:** lower the sweep's peak (`-160` toward `-140`), then if needed reduce `out`. If even `-130` leaves the frame, ledger a ruling and add room above her for this reel instead (a ruling for Ethan: full framing's height in `reel.py` is his value).
- **A foot moves:** the hips' look turn is too big for `leg` to keep it planted; lower `LOOK[c.HIPS]`.
- **The hand peaks early or late:** move the `SWIPE` hold keys.

Then render one still of each swipe's top to check the arm goes up and out to her right, not across her face (her right is the picture's left from the front):

```bash
"$B" -b "$M/spica-v2-clips.blend" --python-exit-code 1 -P "$M/build/sprites.py" -- review "$M/renders/reels/scroll_test/poses" scroll_test observing 2>&1 | grep -E "Error|Traceback"
```

(`review` faces her 32 degrees round, every second frame.) Look at `f0137.png` and `f0257.png`. If the arm sweeps across her body, flip the sign of `out` in `SWIPE`, ledger it, and rebuild. Look at `f0049.png`: she should be turned to look back over a shoulder.

- [ ] **Step 8: The library manifest and the old checks are unchanged**

Run:

```bash
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"; M="$(pwd -W)/assets/model_v2"
git diff --exit-code assets/model_v2/clips.json && echo "CLIPS.JSON unchanged"
python "$M/build/checks/test_reel_edit.py"
"$B" -b "$M/spica-v2-clips.blend" --python-exit-code 1 -P "$M/build/checks/check_reel.py" -- manifest 2>&1 | grep -E "Error|PROBLEM|checked"
"$B" -b "$M/spica-v2-clips.blend" --python-exit-code 1 -P "$M/build/checks/check_clips.py" -- clip scroll_test 2>&1 | grep -E "Error|PROBLEM|CLIP |passed"
```

Expected: `CLIPS.JSON unchanged`, `REEL_EDIT ok`, `MANIFEST checked ['idle', 'look_up', 'sit_edge', 'walk']`, `CLIP scroll_test frames 1 360 ...` and `CLIPS check passed`, no `PROBLEM`.

- [ ] **Step 9: Commit**

```bash
git add assets/model_v2/build/clips.py assets/model_v2/build/reel.py assets/model_v2/build/checks/check_reel.py assets/model_v2/reels/scroll_test
git commit -m "feat(orbit): O1 scroll reel: her motion written for the first reel, built as a reel clip and measured"
```

---

### Task 4: Placeholder feed, the run script, the preview, docs

**Files:**
- Create: `assets/model_v2/build/run_scroll.sh`
- Create (git-ignored): `assets/model_v2/reel_samples/feed-1.mp4`, `feed-2.mp4`, `feed-3.mp4`; append to `assets/model_v2/reel_samples/SOURCES.txt`
- Modify: `CLAUDE.md`, `docs/orbit/o1-scroll-reel-spec.md`, `docs/orbit/o1-reels-spec.md`, `DECISIONS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `sh assets/model_v2/build/run_scroll.sh reels/<name> [preview]` writing `assets/model_v2/renders/reels/<name>/preview.mp4` or `reel.mp4`.

- [ ] **Step 1: Find three placeholder feed videos**

Find three free-licence videos **with a sound track**, ideally vertical (9:16; others are cropped to fill), each at least 7 seconds long. Licences that allow use and modification: CC0, CC-BY (credit in `SOURCES.txt`), the Pexels or Pixabay licence. Wikimedia Commons (search "vertical video" with a sound filter) and Pixabay are the likeliest; much stock footage is silent. Something a person would watch on a feed: an animal, cooking, a street scene. Not real Instagram reels (rights).

Download each into `assets/model_v2/reel_samples/` (a new file only, nothing run from that folder), named `feed-1.<ext>`, `feed-2.<ext>`, `feed-3.<ext>`. If an extension is not `.mp4`, change it in `reels/scroll_test/reel.json`. Append each one's title, author, licence and URL to `SOURCES.txt`.

If fewer than three with sound can be found, ledger a ruling: use a silent video for the picture and a CC0 sound from the same sources, joined in Blender by a one-off script in the scratchpad (a scene with the video as a movie strip and the sound as a sound strip, written with `reel_review.write_video(scene, out, audio=True)`), and say so in `SOURCES.txt`.

- [ ] **Step 2: Check the edit list against them**

Run:

```bash
python -c "import json, sys; sys.path.insert(0, 'assets/model_v2/build'); import reel_edit as r; r.validate_scroll(r.load('assets/model_v2/reels/scroll_test/reel.json'), json.load(open('assets/model_v2/clips.json'))['faces']); print('EDIT LIST ok')"
```

Expected: `EDIT LIST ok`. (Length and sound are checked by the run script in Blender.)

- [ ] **Step 3: Write the run script**

`assets/model_v2/build/run_scroll.sh`:

```sh
#!/bin/sh
# Builds a scroll reel's motion, checks it, renders her, lays her over the feed with its sound, and checks the result.
# Usage: sh assets/model_v2/build/run_scroll.sh reels/<name> [preview]. Output: renders/reels/<name>/ (git-ignored): frames/, preview.mp4 or reel.mp4.
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
M="$(cd "$(dirname "$0")/.." && pwd -W)"  # assets/model_v2
DIR="$M/${1%/}"
NAME="$(basename "$DIR")"
MODE="${2:-}"
F="$M/spica-v2-clips.blend"
OUT="$M/renders/reels/$NAME"
MP4="$OUT/$([ "$MODE" = preview ] && echo preview || echo reel).mp4"
CHECK="$M/build/checks/check_reel.py"
SHOW="Error|Traceback|PROBLEM|checked|passed|SHOT|REEL|BUILT|CLIP |ok$"
set -e -o pipefail  # a failing Blender run stops the script even through grep
python "$M/build/checks/test_reel_edit.py"
python -c "import json, sys; sys.path.insert(0, sys.argv[1]); import reel_edit as r; r.validate_scroll(r.load(sys.argv[2]), json.load(open(sys.argv[3]))['faces']); print('EDIT LIST ok')" "$M/build" "$DIR/reel.json" "$M/clips.json"
"$B" -b "$F" --python-exit-code 1 -P "$M/build/clips.py" -- "reel:$NAME" 2>&1 | grep -E "$SHOW"
"$B" -b "$F" --python-exit-code 1 -P "$M/build/checks/check_clips.py" -- clip "$NAME" 2>&1 | grep -E "$SHOW"
"$B" -b "$F" --python-exit-code 1 -P "$CHECK" -- scroll "$DIR" 2>&1 | grep -E "$SHOW"
"$B" -b --factory-startup --python-exit-code 1 -P "$CHECK" -- feed "$OUT/feedcheck" 2>&1 | grep -E "$SHOW"
"$B" -b "$F" --python-exit-code 1 -P "$M/build/reel.py" -- scroll "$DIR" "$OUT/frames" $MODE 2>&1 | grep -E "$SHOW"
"$B" -b "$F" --python-exit-code 1 -P "$CHECK" -- frames "$OUT/frames" "$OUT/frames/edit.json" 2>&1 | grep -E "$SHOW"
"$B" -b --factory-startup --python-exit-code 1 -P "$M/build/reel_review.py" -- scroll "$DIR" "$OUT/frames" "$MP4" $MODE 2>&1 | grep -E "$SHOW"
"$B" -b --factory-startup --python-exit-code 1 -P "$CHECK" -- scroll_review "$MP4" "$DIR" $MODE 2>&1 | grep -E "$SHOW"
echo "REEL done: $MP4"
```

- [ ] **Step 4: Run the preview end to end**

Run: `sh assets/model_v2/build/run_scroll.sh reels/scroll_test preview > .superpowers/sdd/o1-scroll-reel-plan/preview.log 2>&1; echo "exit $?"; tail -20 .superpowers/sdd/o1-scroll-reel-plan/preview.log`
Expected: `exit 0`; the tail shows `EDIT LIST ok`, `BUILT`, `CLIPS check passed`, `SCROLL checked`, `FEED checked`, `SHOT 1 scroll_test 360 frames, X s per frame`, `FRAMES checked 1 shots`, `REEL ...preview.mp4`, `REVIEW checked 360 frames with sound`, `REEL done`. Note the seconds per frame for the docs.

A failure stops the script at its step; fix the cause under systematic debugging and re-run.

- [ ] **Step 5: Docs**

- `CLAUDE.md`: after the Reels bullet add
  `- Scroll reels: \`sh assets/model_v2/build/run_scroll.sh reels/<name> [preview]\` builds a reel's own motion (\`reels/<name>/motion.py\`, timed by its \`reel.json\`), renders her front on and lays her over the feed with its sound, to \`renders/reels/<name>/\`; spec \`docs/orbit/o1-scroll-reel-spec.md\`. A library rebuild of clips drops reel motions; rerun the reel.`
  and in the design-docs line change `Reels: \`docs/orbit/o1-reels-spec.md\`` to `Reels: \`docs/orbit/o1-reels-spec.md\`, scroll reels \`docs/orbit/o1-scroll-reel-spec.md\``.
- `docs/orbit/o1-scroll-reel-spec.md`: status line to `Status: built Nov 12 to the preview, waiting for Ethan's review of renders/reels/scroll_test/preview.mp4.`; add a `## What changed while building it` section after the status listing every ruling from the ledger and the measured preview seconds per frame; in Rendering, replace "writing `renders/reels/<name>/preview.mp4` or `reel.mp4`" with the same plus "(the shot's edit list is written beside the frames as `frames/edit.json` for the frames check)".
- `docs/orbit/o1-reels-spec.md`: under the status line add `Next: scroll reels (\`o1-scroll-reel-spec.md\`), Ethan's direction after this proof of concept.`
- `DECISIONS.md`: one row per ruling from the ledger, dated 2026-11-12, in the table's format.

- [ ] **Step 6: Commit**

```bash
git add assets/model_v2/build/run_scroll.sh CLAUDE.md docs/orbit/o1-scroll-reel-spec.md docs/orbit/o1-reels-spec.md DECISIONS.md assets/model_v2/reels/scroll_test/reel.json
git commit -m "feat(orbit): O1 scroll reel: run script, placeholder feed, preview rendered"
```

- [ ] **Step 7: Stop for Ethan**

The preview is the review point. Report `assets/model_v2/renders/reels/scroll_test/preview.mp4` to Ethan with the rulings and what to look for (the swipe in step with the feed, the look back, the reactions, any arm through her body or hair). His corrections go into `motion.py` and `reel.json`, then `run_scroll.sh reels/scroll_test preview` again. Only once he approves the motion: `sh assets/model_v2/build/run_scroll.sh reels/scroll_test` for the full 1080×1920 `reel.mp4` (about 30 minutes).
