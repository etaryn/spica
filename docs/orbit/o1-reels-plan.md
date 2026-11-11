# O1 Reels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render her clips to order from an edit list as transparent frames, and lay them over a background as a silent review MP4, so `main`'s reel engine has a seam to build against.

**Architecture:** `reel_edit.py` is plain Python (no Blender): it reads and checks edit lists and maps shot frames onto clip frames. `reel.py` runs in `spica-v2-clips.blend`, poses her through `sprites.py`, places an orthographic camera per shot and renders PNGs through `brow_over.render`; it also writes the clip manifest. `reel_review.py` runs in an empty Blender session and builds the reel in the Video Sequencer, then writes an H.264 MP4 with Blender's bundled FFmpeg. `checks/check_reel.py` measures everything.

**Tech Stack:** Blender 5.2 (EEVEE, Video Sequencer, bundled FFmpeg), Python 3 (`python` from miniconda for the plain tests), numpy, Pillow (`sheet.py`).

**Spec:** `docs/orbit/o1-reels-spec.md`. Read it first: the seam (manifest, edit list, frames) is settled with Ethan and with `main`'s session; do not change a field.

## Global Constraints

- Branch `orbit`. Never merge `orbit` into `main`.
- Blender: `/c/Program Files/Blender Foundation/Blender 5.2/blender.exe`. Run with `--python-exit-code 1`. Output paths given to Blender are absolute.
- Every file starts with a short plain-English header comment (see any file in `assets/model_v2/build/`).
- Write text files with `newline="\n"` (`Path.write_text` on Windows turns LF into CRLF).
- Never save or change `spica-v2.blend` or `spica-v2-clips.blend` from these scripts.
- Edit list fields exactly as the spec: `width`, `height`, `shots[]` of `clip`, `start`, `frames`, `face`, `azimuth` (-180..180), `elevation` (-30..30), `framing` (`full`|`waist`|`face`), `x` (0..1), `background` {`file`, `offset`, `pan`}.
- Frames: `<out>/shot-NN/NNNN.png`, both from 01/0001, transparent RGBA at `width`×`height`.
- Output: 24 fps, silent, H.264 MP4. No ffmpeg on the machine; only Blender's.
- Renders, samples and `.blend` files are git-ignored (`assets/model_v2/renders/`, `assets/model_v2/reel_samples/`). `clips.json` and `reel_poc.json` are committed.
- Never kill Blender by image name; Ethan may have it open. A PNG just viewed can be locked: delete before writing.
- Don't `grep -r` from the repo root (`assets/` takes minutes).

## Review Focus

1. **Stale frames:** rendering an edit list into a folder that held a longer earlier render must not leave old PNGs that the review then picks up. Expected: `reel.py` clears `shot-*/*.png` in the output folder first. Test: Task 2, Step 6.
2. **A background video too short for its shot** (or `offset` past its end). Expected: the review fails before rendering, naming the shot, not black frames. Test: Task 3, Step 5.
3. **A background video not at 24 fps** plays at the wrong speed in the Sequencer. Expected: fail loudly naming the shot and the fps (retiming is `main`'s job with ffmpeg). Test: Task 3, Step 5.
4. **A loop shot running past its clip, or a one-shot past its end.** Expected: a loop wraps to the clip's first frame with no jump; a one-shot holds its last. Test: Task 1 (mapping) and Task 2, Step 6 (pixels).
5. **Relative background paths** run from another working directory. Expected: resolved against the repo root, wherever the command runs. Test: Task 1.

---

### Task 1: The edit list in plain Python

**Files:**
- Create: `assets/model_v2/build/reel_edit.py`
- Test: `assets/model_v2/build/checks/test_reel_edit.py`

**Interfaces:**
- Produces: `ROOT: Path` (the repo); `load(path) -> dict`; `resolve(file: str, root: Path = ROOT) -> Path`; `validate(edit: dict, manifest: dict) -> None` (raises `ValueError("shot N: ...")`); `validate_backgrounds(edit: dict, root: Path = ROOT) -> None` (raises the same way); `clip_frame(first: int, last: int, loops: bool, start: int, i: int) -> int`.

- [ ] **Step 1: Write the failing test**

`assets/model_v2/build/checks/test_reel_edit.py`:

```python
# Tests the edit-list reader without Blender: what it rejects, how shots map onto clip frames, and where relative paths point.
import copy
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import reel_edit as re_

MANIFEST = {
    "fps": 24,
    "clips": [{"name": "walk", "frames": 96, "loops": True, "tags": ["walking"]}, {"name": "look_up", "frames": 48, "loops": False, "tags": ["looking_up"]}],
    "faces": ["observing", "soft_smile"],
    "framings": ["full", "waist", "face"],
}
SHOT = {"clip": "walk", "start": 0, "frames": 72, "face": "soft_smile", "azimuth": -32, "elevation": 0, "framing": "full", "x": 0.35}
EDIT = {"width": 1080, "height": 1920, "shots": [SHOT]}


def rejects(change, words):
    edit = copy.deepcopy(EDIT)
    change(edit)
    try:
        re_.validate(edit, MANIFEST)
    except ValueError as e:
        assert words in str(e), "expected %r in %r" % (words, str(e))
        return
    raise AssertionError("accepted a bad edit list: expected " + words)


def test_validate():
    re_.validate(EDIT, MANIFEST)
    two = copy.deepcopy(EDIT)
    two["shots"].append(dict(SHOT, clip="wlak"))
    try:
        re_.validate(two, MANIFEST)
        raise AssertionError("accepted an unknown clip")
    except ValueError as e:
        assert str(e).startswith("shot 2:"), str(e)
    rejects(lambda e: e["shots"][0].update(clip="wlak"), "unknown clip")
    rejects(lambda e: e["shots"][0].update(face="grin"), "unknown face")
    rejects(lambda e: e["shots"][0].update(framing="wide"), "unknown framing")
    rejects(lambda e: e["shots"][0].update(x=1.2), "x")
    rejects(lambda e: e["shots"][0].update(elevation=45), "elevation")
    rejects(lambda e: e["shots"][0].update(azimuth=181), "azimuth")
    rejects(lambda e: e["shots"][0].update(frames=0), "frames")
    rejects(lambda e: e["shots"][0].update(start=96), "start")
    rejects(lambda e: e["shots"][0].update(x=True), "x")
    rejects(lambda e: e["shots"][0].pop("face"), "missing face")
    rejects(lambda e: e.update(width=1081), "width")
    rejects(lambda e: e.update(shots=[]), "no shots")


def test_clip_frame():
    assert [re_.clip_frame(97, 192, True, 0, i) for i in (0, 95, 96, 97)] == [97, 192, 97, 98]
    assert [re_.clip_frame(97, 192, True, 94, i) for i in (0, 1, 2)] == [191, 192, 97]
    assert [re_.clip_frame(97, 192, True, 0, i) for i in (191, 192)] == [192, 97]  # two whole cycles wrap again
    assert [re_.clip_frame(1, 48, False, 46, i) for i in (0, 1, 2, 30)] == [47, 48, 48, 48]


def test_backgrounds():
    with tempfile.TemporaryDirectory() as root:
        root = Path(root)
        (root / "bg.jpg").write_bytes(b"x")
        edit = copy.deepcopy(EDIT)
        edit["shots"][0]["background"] = {"file": "bg.jpg", "offset": 0, "pan": [0.2, 0.6]}
        here = os.getcwd()
        os.chdir(tempfile.gettempdir())  # relative paths follow the repo root, not the working directory
        try:
            re_.validate_backgrounds(edit, root)
        finally:
            os.chdir(here)
        assert re_.resolve("bg.jpg", root) == root / "bg.jpg"
        for bg, words in (({"file": "none.jpg", "pan": [0, 1]}, "not found"), ({"file": "bg.jpg", "pan": [0, 2]}, "pan"), ({"file": "bg.jpg", "pan": [0.5]}, "pan"), ({"file": "bg.jpg", "offset": -1, "pan": [0, 1]}, "offset")):
            edit["shots"][0]["background"] = bg
            try:
                re_.validate_backgrounds(edit, root)
                raise AssertionError("accepted " + str(bg))
            except ValueError as e:
                assert words in str(e) and str(e).startswith("shot 1:"), str(e)
        edit["shots"][0].pop("background")
        try:
            re_.validate_backgrounds(edit, root)
            raise AssertionError("accepted a shot with no background")
        except ValueError as e:
            assert "background" in str(e)
    assert re_.ROOT == Path(__file__).resolve().parents[4], re_.ROOT


if __name__ == "__main__":
    test_validate()
    test_clip_frame()
    test_backgrounds()
    print("REEL_EDIT ok")
```

- [ ] **Step 2: Run it to verify it fails**

Run: `python assets/model_v2/build/checks/test_reel_edit.py`
Expected: `ModuleNotFoundError: No module named 'reel_edit'`

- [ ] **Step 3: Write the implementation**

`assets/model_v2/build/reel_edit.py`:

```python
# Reads and checks a reel's edit list and maps each shot's frames onto her clips. Plain Python, no Blender, so it tests in a second.
# The format is the seam with main's reel engine (docs/orbit/o1-reels-spec.md): change a field there first.
import json
import numbers
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # the repo: build, model_v2, assets, repo
FIELDS = ("clip", "start", "frames", "face", "azimuth", "elevation", "framing", "x")
RANGES = {"azimuth": (-180, 180), "elevation": (-30, 30), "x": (0, 1)}


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def resolve(file, root=ROOT):
    p = Path(file)
    return p if p.is_absolute() else Path(root) / p


def fail(n, message):
    raise ValueError("shot %d: %s" % (n, message))


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def is_number(v):
    return isinstance(v, numbers.Real) and not isinstance(v, bool)


def validate(edit, manifest):
    """Everything the renderer reads; raises on the first bad field, naming its shot."""
    for k in ("width", "height"):
        if not is_int(edit.get(k)) or edit[k] <= 0 or edit[k] % 2:
            raise ValueError("%s must be a positive even number of pixels (H.264 needs even sizes), not %r" % (k, edit.get(k)))
    if not edit.get("shots"):
        raise ValueError("no shots")
    clips = {c["name"]: c for c in manifest["clips"]}
    for n, s in enumerate(edit["shots"], 1):
        missing = [k for k in FIELDS if k not in s]
        if missing:
            fail(n, "missing " + ", ".join(missing))
        if s["clip"] not in clips:
            fail(n, "unknown clip %r" % s["clip"])
        if s["face"] not in manifest["faces"]:
            fail(n, "unknown face %r" % s["face"])
        if s["framing"] not in manifest["framings"]:
            fail(n, "unknown framing %r" % s["framing"])
        if not is_int(s["frames"]) or s["frames"] < 1:
            fail(n, "frames must be a whole number from 1, not %r" % s["frames"])
        length = clips[s["clip"]]["frames"]
        if not is_int(s["start"]) or not 0 <= s["start"] < length:
            fail(n, "start %r is outside the clip's %d frames" % (s["start"], length))
        for k, (lo, hi) in RANGES.items():
            if not is_number(s[k]) or not lo <= s[k] <= hi:
                fail(n, "%s %r is outside %s to %s" % (k, s[k], lo, hi))


def validate_backgrounds(edit, root=ROOT):
    """The fields only the compositor reads (the review script here, main's engine there)."""
    for n, s in enumerate(edit["shots"], 1):
        bg = s.get("background")
        if not isinstance(bg, dict) or "file" not in bg:
            fail(n, "no background file")
        if not resolve(bg["file"], root).is_file():
            fail(n, "background %s not found" % resolve(bg["file"], root))
        offset = bg.get("offset", 0)
        if not is_number(offset) or offset < 0:
            fail(n, "background offset %r must be 0 or more seconds" % offset)
        pan = bg.get("pan")
        if not isinstance(pan, list) or len(pan) != 2 or not all(is_number(p) and 0 <= p <= 1 for p in pan):
            fail(n, "background pan %r must be two numbers from 0 to 1" % pan)


def clip_frame(first, last, loops, start, i):
    """The clip frame for shot frame i: a loop wraps within first..last, a one-shot holds last."""
    if loops:
        return first + (start + i) % (last - first + 1)
    return min(first + start + i, last)
```

- [ ] **Step 4: Run it to verify it passes**

Run: `python assets/model_v2/build/checks/test_reel_edit.py`
Expected: `REEL_EDIT ok`

- [ ] **Step 5: Commit**

```bash
git add assets/model_v2/build/reel_edit.py assets/model_v2/build/checks/test_reel_edit.py
git commit -m "feat(orbit): O1 reels: the edit list read and checked in plain Python"
```

---

### Task 2: The renderer and the clip manifest

**Files:**
- Create: `assets/model_v2/build/reel.py`
- Create: `assets/model_v2/build/checks/check_reel.py`
- Create: `assets/model_v2/clips.json` (generated, committed)
- Modify: `assets/model_v2/build/clips.py` (`main()`, end: write the manifest)

**Interfaces:**
- Consumes: `reel_edit.load/validate/clip_frame` (Task 1); `sprites.setup(scene, transparent) -> cam`, `sprites.pose(arm, scene, clip, frame)`, `sprites.set_face(name, facing, clip)`, `sprites.GROUND`, `sprites.TAGS`; `brow_over.render(scene)`; `face_expr2.NAMES`; actions `clip_<name>` with custom props `first`, `last`.
- Produces: `reel.FRAMING: dict[str, float]` (view height in metres); `reel.FPS = 24`; `reel.manifest() -> dict`; `reel.write_manifest(path)`; `reel.aim_point(arm, framing) -> Vector`; `reel.place_camera(cam, arm, scene, shot)`; `reel.render(edit, out: Path)`; CLI `reel.py -- <reel.json> <abs out dir>` and `reel.py -- manifest <abs out.json>`. `check_reel.py` modes: `manifest`, `camera`, `frames <abs frames dir> <reel.json>`, `wrap <abs scratch dir>` (Task 3 adds `pan`, `review`).

- [ ] **Step 1: Write the failing checks**

`assets/model_v2/build/checks/check_reel.py`:

```python
# Tests her reels by measurement, and raises on any failure.
# Args after --: manifest | camera | wrap <abs scratch dir> | frames <abs frames dir> <reel.json> run on spica-v2-clips.blend;
# pan <abs scratch dir> | review <mp4> <reel.json> run in an empty session (--factory-startup).
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import reel_edit as re_

args = sys.argv[sys.argv.index("--") + 1:]
problems = []
MANIFEST = Path(__file__).resolve().parents[2] / "clips.json"
X_TOLERANCE = 0.08  # share of the frame width her alpha's centre may sit from x: she is not symmetric, and a side view moves her centre
SAME = 0.004  # mean difference per channel under which two renders are the same picture


def bad(message):
    problems.append(message)
    print("PROBLEM", message)


def read_png(path):
    """RGBA as stored in the file, top row first."""
    image = bpy.data.images.load(str(path))
    image.colorspace_settings.name = "Non-Color"
    w, h = image.size
    a = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(a)
    bpy.data.images.remove(image)
    return a.reshape(h, w, 4)[::-1]


def check_manifest():
    import reel

    on_disk = json.loads(MANIFEST.read_text())
    live = reel.manifest()
    if on_disk != live:
        bad("clips.json differs from the clips in this file; run reel.py -- manifest")
    names = sorted(c["name"] for c in live["clips"])
    assert names == ["idle", "look_up", "sit_edge", "walk"], names
    assert {c["name"]: c["loops"] for c in live["clips"]} == {"idle": True, "look_up": False, "sit_edge": True, "walk": True}
    assert len(live["faces"]) == 32 and live["framings"] == ["full", "waist", "face"] and live["fps"] == 24
    print("MANIFEST checked", names)


def check_camera():
    """Where the camera puts her, measured by projection, for every clip, framing and a spread of angles."""
    import reel
    import sprites as sp
    from bpy_extras.object_utils import world_to_camera_view

    arm, scene = bpy.data.objects["Armature"], bpy.context.scene
    cam = sp.setup(scene, transparent=True)
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 1080, 1920, 100
    head = arm.pose.bones["J_Bip_C_Head"]
    count = 0
    for clip in [a.name[5:] for a in bpy.data.actions if a.name.startswith("clip_")]:
        sp.pose(arm, scene, clip, bpy.data.actions["clip_" + clip]["first"])
        for framing in reel.FRAMING:
            for azimuth in (-180, -90, -32, 0, 32, 90):
                for elevation in (-30, 0, 30):
                    for x in (0.3, 0.5, 0.7):
                        shot = {"clip": clip, "framing": framing, "azimuth": azimuth, "elevation": elevation, "x": x}
                        reel.place_camera(cam, arm, scene, shot)
                        at = lambda p: world_to_camera_view(scene, cam, arm.matrix_world @ p)
                        name = "%s %s az %d el %d x %.1f" % (clip, framing, azimuth, elevation, x)
                        aim = world_to_camera_view(scene, cam, reel.aim_point(arm, framing))
                        if abs(aim.x - x) > 0.005:
                            bad("%s: her aim point lands at x %.3f" % (name, aim.x))
                        top, base = at(head.tail), at(head.head)
                        if framing == "face" and not all(0 < v < 1 for p in (top, base) for v in (p.x, p.y)):
                            bad("%s: her head is not whole in the frame" % name)
                        if framing == "full":
                            low = min(at(arm.pose.bones["J_Bip_%s_Foot" % s].head).y for s in "LR")
                            if low <= 0 or top.y >= 1:
                                bad("%s: she runs off the frame (ankles at %.3f, head top at %.3f)" % (name, low, top.y))
                        count += 1
    print("CAMERA checked", count, "placements")


def check_frames(folder, edit):
    W, H = edit["width"], edit["height"]
    for n, shot in enumerate(edit["shots"], 1):
        pngs = sorted((folder / ("shot-%02d" % n)).glob("*.png"))
        if len(pngs) != shot["frames"]:
            bad("shot %d: %d frames, expected %d" % (n, len(pngs), shot["frames"]))
        for path in pngs[:: max(1, len(pngs) // 4)]:
            a = read_png(path)
            if a.shape != (H, W, 4):
                bad("shot %d %s: size %s" % (n, path.name, a.shape))
                continue
            alpha = a[:, :, 3]
            if max(alpha[0, 0], alpha[0, -1], alpha[-1, 0], alpha[-1, -1]) > 0.01:
                bad("shot %d %s: the corners are not transparent" % (n, path.name))
            solid = alpha > 0.5
            if solid.mean() < 0.02:
                bad("shot %d %s: she is nearly missing" % (n, path.name))
                continue
            centre = float(np.where(solid)[1].mean()) / W
            if abs(centre - shot["x"]) > X_TOLERANCE:
                bad("shot %d %s: her centre is at x %.2f, the edit list says %.2f" % (n, path.name, centre, shot["x"]))
        print("FRAMES shot", n, len(pngs))


def same(p, q):
    return float(np.abs(read_png(p) - read_png(q)).mean()) < SAME


def check_wrap(scratch):
    """A loop running past its clip comes back to the clip's first frame; a one-shot holds its last. Small renders, so it is quick."""
    import reel

    shot = lambda clip, start, frames: {"clip": clip, "start": start, "frames": frames, "face": "observing", "azimuth": -32, "elevation": 0, "framing": "full", "x": 0.5}
    edit = {"width": 270, "height": 480, "shots": [shot("idle", 95, 2), shot("idle", 0, 1), shot("look_up", 46, 3), shot("look_up", 47, 1)]}
    reel.render(edit, scratch)
    d = lambda n, f: scratch / ("shot-%02d" % n) / ("%04d.png" % f)
    if not same(d(1, 2), d(2, 1)):
        bad("idle: the frame after the clip's last is not its first")
    if same(d(1, 1), d(2, 1)):
        bad("idle: the clip's last and first frames are identical, so the wrap test proves nothing")
    if not (same(d(3, 2), d(4, 1)) and same(d(3, 3), d(4, 1))):
        bad("look_up: does not hold its last frame")
    stale = scratch / "shot-09" / "0001.png"
    stale.parent.mkdir(exist_ok=True)
    stale.write_bytes(b"old")
    (scratch / "shot-01" / "0007.png").write_bytes(b"old")
    reel.render({"width": 270, "height": 480, "shots": [shot("idle", 0, 1)]}, scratch)
    left = sorted(p.relative_to(scratch).as_posix() for p in scratch.glob("shot-*/*.png"))
    if left != ["shot-01/0001.png"]:
        bad("stale frames survive a new render: %s" % left)
    print("WRAP checked")


def main():
    mode, *rest = args
    if mode == "manifest":
        check_manifest()
    elif mode == "camera":
        check_camera()
    elif mode == "frames":
        check_frames(Path(rest[0]), re_.load(rest[1]))
    elif mode == "wrap":
        scratch = Path(rest[0])
        scratch.mkdir(parents=True, exist_ok=True)
        check_wrap(scratch)
    else:
        raise SystemExit("unknown mode " + mode)
    if problems:
        raise SystemExit("%d problems" % len(problems))


main()
```

- [ ] **Step 2: Run the checks to verify they fail**

Run (from the repo root, Git Bash):
```sh
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
F="$(pwd -W)/assets/model_v2/spica-v2-clips.blend"
"$B" -b "$F" --python-exit-code 1 -P assets/model_v2/build/checks/check_reel.py -- camera 2>&1 | grep -E "Error|CAMERA|PROBLEM"
```
Expected: `ModuleNotFoundError: No module named 'reel'`

- [ ] **Step 3: Write the renderer**

`assets/model_v2/build/reel.py`:

```python
# Renders her shots for a reel from an edit list, as transparent frames for the reel engine on main to lay over content.
# Args after --: <reel.json> <absolute out dir> | manifest <absolute out.json>. Runs on spica-v2-clips.blend and never saves it.
# Seam and fields: docs/orbit/o1-reels-spec.md.
import json
import math
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import brow_over
import face_expr2
import reel_edit as re_
import sprites as sp

FPS = 24
FRAMING = {"full": 2.0, "waist": 1.0, "face": 0.45}  # how many metres of her world the frame is tall; starting values, Ethan corrects from renders
FULL_FOOT_ROOM = 0.04  # share of a full-framed picture under her soles
FACE_UP = 0.07  # from the base of her skull to the middle of her face
DISTANCE = 6  # metres from the aim point; orthographic, so it only has to clear her


def manifest():
    """The clips in this file, her faces and the framings: what main's engine writes edit lists from."""
    clips = []
    for a in sorted((a for a in bpy.data.actions if a.name.startswith("clip_")), key=lambda a: a.name):
        name = a.name[5:]
        clips.append({"name": name, "frames": a["last"] - a["first"] + 1, "loops": a["first"] > 1, "tags": [sp.TAGS[name]]})  # clips.py starts a loop at its second cycle
    return {"fps": FPS, "clips": clips, "faces": list(face_expr2.NAMES), "framings": list(FRAMING)}


def write_manifest(path):
    Path(path).write_text(json.dumps(manifest(), indent=2) + "\n", newline="\n")


def aim_point(arm, framing):
    """What the camera centres on: a fixed height for full, her chest or face, followed frame by frame, otherwise."""
    if framing == "full":
        return Vector((0, 0, sp.GROUND + FRAMING["full"] * (0.5 - FULL_FOOT_ROOM)))
    bone = arm.pose.bones["J_Bip_C_UpperChest" if framing == "waist" else "J_Bip_C_Head"]
    p = arm.matrix_world @ bone.head
    return p + Vector((0, 0, FACE_UP)) if framing == "face" else p


def place_camera(cam, arm, scene, shot):
    a, e = math.radians(shot["azimuth"]), math.radians(shot["elevation"])
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))  # azimuth as sprites.aim; positive elevation looks down on her
    cam.location = aim_point(arm, shot["framing"]) + d * DISTANCE
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = FRAMING[shot["framing"]]  # the frame's longer side, its height
    r = scene.render
    cam.data.shift_x = -(shot["x"] - 0.5) * r.resolution_x / max(r.resolution_x, r.resolution_y)  # shift is in units of the longer side
    cam.data.shift_y = 0.0
    bpy.context.view_layer.update()


def render(edit, out):
    out = Path(out)
    re_.validate(edit, manifest())
    for old in out.glob("shot-*/*.png"):
        old.unlink()
    scene, arm = bpy.context.scene, bpy.data.objects["Armature"]
    cam = sp.setup(scene, transparent=True)
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = edit["width"], edit["height"], 100
    for n, shot in enumerate(edit["shots"], 1):
        action = bpy.data.actions["clip_" + shot["clip"]]
        folder = out / ("shot-%02d" % n)
        folder.mkdir(parents=True, exist_ok=True)
        facing = "left" if shot["azimuth"] > 0 else "right"  # the side the camera sees, as the stills
        began = time.time()
        for i in range(shot["frames"]):
            f = re_.clip_frame(action["first"], action["last"], action["first"] > 1, shot["start"], i)
            sp.pose(arm, scene, shot["clip"], f)
            sp.set_face(shot["face"], facing, shot["clip"])
            place_camera(cam, arm, scene, shot)
            scene.render.filepath = str(folder / ("%04d.png" % (i + 1)))
            brow_over.render(scene)
        print("SHOT %d %s %d frames, %.2f s per frame" % (n, shot["clip"], shot["frames"], (time.time() - began) / shot["frames"]))


def main():
    rest = sys.argv[sys.argv.index("--") + 1:]
    if rest[0] == "manifest":
        write_manifest(rest[1])
        return
    render(re_.load(rest[0]), Path(rest[1]))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Write the manifest and hook it into `clips.py`**

In `assets/model_v2/build/clips.py`, `main()`, after the `save_as_mainfile` line, add:

```python
    import reel  # here, not at the top: reel imports sprites, which clips.py does not otherwise need

    reel.write_manifest(OUT.parent / "clips.json")
```

Then write it from the current clips file without the 15-minute rebuild:
```sh
"$B" -b "$F" --python-exit-code 1 -P assets/model_v2/build/reel.py -- manifest "$(pwd -W)/assets/model_v2/clips.json" 2>&1 | grep -E "Error|Traceback"
head -20 assets/model_v2/clips.json
```
Expected: four clips (idle 96 loops, look_up 48 one-shot, sit_edge 96 loops, walk 96 loops), 32 faces, three framings.

- [ ] **Step 5: Run manifest and camera checks**

```sh
for m in manifest camera; do "$B" -b "$F" --python-exit-code 1 -P assets/model_v2/build/checks/check_reel.py -- $m 2>&1 | grep -E "Error|MANIFEST|CAMERA|PROBLEM"; done
```
Expected: `MANIFEST checked [...]`, `CAMERA checked 648 placements`, no `PROBLEM`. If `face` framing fails at elevation ±30 (the head bone's tail is long), lower `FACE_UP` or raise `FRAMING["face"]` to the smallest value that passes, and say so in the commit; these are starting values.

- [ ] **Step 6: Run the wrap and stale-frame check**

```sh
S="$(pwd -W)/assets/model_v2/renders/reel/wrap"
"$B" -b "$F" --python-exit-code 1 -P assets/model_v2/build/checks/check_reel.py -- wrap "$S" 2>&1 | grep -E "Error|WRAP|PROBLEM|SHOT"
```
Expected: four `SHOT` lines, then `WRAP checked`, no `PROBLEM`.

- [ ] **Step 7: Render one full-size shot and check its frames**

Write `$S/one.json` with one shot (`walk`, start 0, frames 4, `soft_smile`, azimuth -32, elevation 0, `full`, x 0.35) at 1080×1920, then:
```sh
"$B" -b "$F" --python-exit-code 1 -P assets/model_v2/build/reel.py -- "$S/one.json" "$S/one" 2>&1 | grep -E "Error|SHOT"
"$B" -b "$F" --python-exit-code 1 -P assets/model_v2/build/checks/check_reel.py -- frames "$S/one" "$S/one.json" 2>&1 | grep -E "Error|FRAMES|PROBLEM"
```
Expected: `SHOT 1 walk 4 frames, N s per frame` (note N), `FRAMES shot 1 4`, no `PROBLEM`. Open `$S/one/shot-01/0001.png` and look: her whole body, soles near the bottom, on the left third, edges clean. Zoom to 3x on her face, hair edge and star glow.

- [ ] **Step 8: Commit**

```bash
git add assets/model_v2/build/reel.py assets/model_v2/build/checks/check_reel.py assets/model_v2/build/clips.py assets/model_v2/clips.json
git commit -m "feat(orbit): O1 reels: her shots rendered from an edit list, and the clip manifest"
```

---

### Task 3: Placeholders, the proof-of-concept edit list and the review reel

**Files:**
- Create: `assets/model_v2/reel_samples/video.mp4`, `tall.jpg`, `SOURCES.txt` (git-ignored)
- Create: `assets/model_v2/build/reel_poc.json`
- Create: `assets/model_v2/build/reel_review.py`
- Modify: `assets/model_v2/build/checks/check_reel.py` (add `pan`, `review` modes)

**Interfaces:**
- Consumes: `reel_edit.load/resolve/validate_backgrounds/ROOT` (Task 1); frames from `reel.render` (Task 2).
- Produces: `reel_review.build(scene, edit, frames: Path, root: Path = re_.ROOT) -> int` (total frames; sets up the Sequencer, raises `ValueError("shot N: ...")` for a bad background); `reel_review.write(scene, edit, out_mp4: Path)` (MP4 plus `<stem>-shot-NN.png` mid-shot stills beside it); CLI `reel_review.py -- <reel.json> <abs frames dir> <abs out.mp4>`.

- [ ] **Step 1: Find and download the placeholders**

Use WebSearch and the web-fetch agent; download with `curl -L`. Put each in `assets/model_v2/reel_samples/`, a new folder, and write nothing executable there.
- `video.mp4`: landscape 16:9, **24 fps** (23.976 is fine), at least 8 seconds, licence free for any use (Pexels licence, CC0 or public domain). Something she might be looking at online (city, nature, a stream); no people's faces in close-up, no logos.
- `tall.jpg`: CC0 or public domain from Wikimedia Commons, at least three times as tall as it is wide (a long vertical image or scroll-like picture).
- `SOURCES.txt`: for each file, its page URL, author and licence, and the date downloaded.

Confirm the video's fps and length in Blender:
```sh
"$B" -b --factory-startup --python-expr "import bpy; c=bpy.data.movieclips.load(r'$(pwd -W)/assets/model_v2/reel_samples/video.mp4'); print('VIDEO', c.fps, c.frame_duration, tuple(c.size))" 2>&1 | grep VIDEO
```
Expected: fps 24 (or 23.98), at least 192 frames.

- [ ] **Step 2: Write the proof-of-concept edit list**

`assets/model_v2/build/reel_poc.json` (the spec's four shots; shot 2 starts the video 4 seconds in):

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
      "background": { "file": "assets/model_v2/reel_samples/video.mp4", "offset": 0, "pan": [0.2, 0.6] }
    },
    {
      "clip": "idle",
      "start": 0,
      "frames": 48,
      "face": "observing",
      "azimuth": -10,
      "elevation": 10,
      "framing": "waist",
      "x": 0.5,
      "background": { "file": "assets/model_v2/reel_samples/video.mp4", "offset": 4, "pan": [0.6, 0.7] }
    },
    {
      "clip": "look_up",
      "start": 0,
      "frames": 48,
      "face": "wonder",
      "azimuth": 0,
      "elevation": 0,
      "framing": "face",
      "x": 0.5,
      "background": { "file": "assets/model_v2/reel_samples/tall.jpg", "offset": 0, "pan": [0.0, 0.3] }
    },
    {
      "clip": "sit_edge",
      "start": 0,
      "frames": 72,
      "face": "fond",
      "azimuth": 32,
      "elevation": 0,
      "framing": "full",
      "x": 0.6,
      "background": { "file": "assets/model_v2/reel_samples/tall.jpg", "offset": 0, "pan": [0.4, 0.8] }
    }
  ]
}
```

Check it with `python -c "import sys; sys.path.insert(0,'assets/model_v2/build'); import reel_edit as r, json; e=r.load('assets/model_v2/build/reel_poc.json'); r.validate(e, json.load(open('assets/model_v2/clips.json'))); r.validate_backgrounds(e); print('POC ok')"`.
Expected: `POC ok`.

- [ ] **Step 3: Probe the Sequencer API in Blender 5.2**

Strip and output names moved in Blender 5.x; confirm them before writing the script:
```sh
"$B" -b --factory-startup --python-expr "
import bpy
s = bpy.context.scene; ed = s.sequence_editor_create()
print('PROBE strips', hasattr(ed, 'strips'), hasattr(ed, 'sequences'))
st = ed.strips.new_image('a', r'$(pwd -W)/assets/model_v2/reel_samples/tall.jpg', 1, 1, fit_method='ORIGINAL')
print('PROBE transform', st.transform.offset_x, st.transform.scale_x, st.blend_type)
print('PROBE media_type', hasattr(s.render.image_settings, 'media_type'))
" 2>&1 | grep -E "PROBE|Error"
```
Expected: `strips True`, a transform, and whether `media_type` exists. If any name differs, use the 5.2 name in Step 4 and note it in the commit.

- [ ] **Step 4: Write the review script**

`assets/model_v2/build/reel_review.py`:

```python
# Lays her rendered shots over their backgrounds and writes a silent MP4 for Ethan to watch, plus one still per shot for a sheet.
# A plain overlay on purpose: tint, rim light, grain and music are main's editing. Its recipe (fill, pan, offset, cuts) is what main copies.
# Args after --: <reel.json> <absolute frames dir> <absolute out.mp4>. Run in an empty session: blender -b --factory-startup.
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reel_edit as re_

FPS = 24
VIDEO = {".mp4", ".webm", ".mov", ".mkv", ".avi"}


def source_size(path):
    """Width, height and, for a video, fps and length in frames."""
    if path.suffix.lower() in VIDEO:
        clip = bpy.data.movieclips.load(str(path), check_existing=True)
        return clip.size[0], clip.size[1], clip.fps, clip.frame_duration
    image = bpy.data.images.load(str(path), check_existing=True)
    return image.size[0], image.size[1], None, None


def background(strips, n, shot, t0, W, H, root):
    bg = shot["background"]
    path = re_.resolve(bg["file"], root)
    w, h, fps, length = source_size(path)
    frames = shot["frames"]
    if fps is None:
        strip = strips.new_image("bg-%02d" % n, str(path), 1, t0, fit_method="ORIGINAL")
        strip.frame_final_duration = frames
    else:
        if abs(fps - FPS) > 0.5:
            re_.fail(n, "background video is %.2f fps; the review needs %d (retiming is main's job)" % (fps, FPS))
        skip = round(bg.get("offset", 0) * FPS)
        if skip + frames > length:
            re_.fail(n, "background video has %d frames; the shot needs %d from frame %d" % (length, frames, skip))
        strip = strips.new_movie("bg-%02d" % n, str(path), 1, t0 - skip, fit_method="ORIGINAL")
        strip.frame_final_start, strip.frame_final_end = t0, t0 + frames
    s = max(W / w, H / h)  # fill the frame; the overflow is what pan moves through
    strip.transform.scale_x = strip.transform.scale_y = s
    over_x, over_y = w * s - W, h * s - H
    # ponytail: Blender's default easing on the keys, so a pan eases in and out; linear keys if Ethan wants a steady scroll
    for f, c in ((t0, bg["pan"][0]), (t0 + frames - 1, bg["pan"][1])):
        if over_x > 1:
            strip.transform.offset_x = (0.5 - c) * over_x  # pan 0 shows the left edge
            strip.transform.keyframe_insert("offset_x", frame=f)
        elif over_y > 1:
            strip.transform.offset_y = (c - 0.5) * over_y  # pan 0 shows the top edge
            strip.transform.keyframe_insert("offset_y", frame=f)


def build(scene, edit, frames, root=re_.ROOT):
    """The whole reel in the Sequencer: background on channel 1, her on channel 2, shots end to end. Returns its length."""
    re_.validate_backgrounds(edit, root)
    W, H = edit["width"], edit["height"]
    r = scene.render
    r.resolution_x, r.resolution_y, r.resolution_percentage, r.fps = W, H, 100, FPS
    scene.view_settings.view_transform = "Standard"  # the empty scene's default (AgX) would shift her colours
    strips = scene.sequence_editor_create().strips
    t0 = 1
    for n, shot in enumerate(edit["shots"], 1):
        background(strips, n, shot, t0, W, H, root)
        folder = Path(frames) / ("shot-%02d" % n)
        her = strips.new_image("her-%02d" % n, str(folder / "0001.png"), 2, t0, fit_method="ORIGINAL")
        for k in range(2, shot["frames"] + 1):
            her.elements.append("%04d.png" % k)
        her.blend_type = "ALPHA_OVER"
        t0 += shot["frames"]
    scene.frame_start, scene.frame_end = 1, t0 - 1
    return t0 - 1


def still(scene, frame, path):
    scene.render.image_settings.file_format = "PNG"
    scene.frame_set(frame)
    scene.render.filepath = str(path)
    path.unlink(missing_ok=True)
    bpy.ops.render.render(write_still=True)


def write(scene, edit, out):
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    t0 = 1
    for n, shot in enumerate(edit["shots"], 1):
        still(scene, t0 + shot["frames"] // 2, out.parent / ("%s-shot-%02d.png" % (out.stem, n)))
        t0 += shot["frames"]
    r = scene.render
    if hasattr(r.image_settings, "media_type"):
        r.image_settings.media_type = "VIDEO"
    r.image_settings.file_format = "FFMPEG"
    r.ffmpeg.format, r.ffmpeg.codec = "MPEG4", "H264"
    r.ffmpeg.constant_rate_factor, r.ffmpeg.audio_codec = "HIGH", "NONE"
    for old in out.parent.glob(out.stem + "_*.mp4"):
        old.unlink()
    r.filepath = str(out.parent / (out.stem + "_"))
    bpy.ops.render.render(animation=True)
    made = sorted(out.parent.glob(out.stem + "_*.mp4"))
    assert len(made) == 1, "expected one video, found %s" % made
    out.unlink(missing_ok=True)
    made[0].rename(out)  # Blender adds the frame range to a video's name


def main():
    reel_json, frames, out = sys.argv[sys.argv.index("--") + 1:]
    scene = bpy.context.scene
    build(scene, re_.load(reel_json), Path(frames))
    write(scene, re_.load(reel_json), Path(out))
    print("REEL", out)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Add the `pan` and `review` checks**

In `check_reel.py`, add these functions above `main()`:

```python
def picture(path, size, top_left, bottom_right):
    """A plain test picture, one colour in the first half and another in the second, split across its longer side."""
    w, h = size
    a = np.zeros((h, w, 4), np.float32)
    a[:, :, 3] = 1
    if w > h:
        a[:, : w // 2, :3], a[:, w // 2 :, :3] = top_left, bottom_right
    else:
        a[: h // 2, :, :3], a[h // 2 :, :, :3] = top_left, bottom_right
    image = bpy.data.images.new(path.stem, w, h, alpha=True)
    image.pixels.foreach_set(a[::-1].ravel())  # Blender's rows run bottom up
    image.filepath_raw, image.file_format = str(path), "PNG"
    path.unlink(missing_ok=True)
    image.save()


def check_pan(scratch):
    """Pan 0 shows the left or top of the content, pan 1 the right or bottom; a short or wrong-rate video fails before rendering."""
    import reel_review as rr

    red, blue = (1, 0, 0), (0, 0, 1)
    picture(scratch / "wide.png", (1920, 480), red, blue)
    picture(scratch / "tall.png", (270, 1920), red, blue)
    for k in (1, 2):  # her frames: empty, so only the background shows
        for n in (1, 2):
            (scratch / ("shot-%02d" % n)).mkdir(exist_ok=True)
            image = bpy.data.images.new("empty", 270, 480, alpha=True)
            image.pixels.foreach_set(np.zeros(270 * 480 * 4, np.float32))
            image.filepath_raw, image.file_format = str(scratch / ("shot-%02d" % n) / ("%04d.png" % k)), "PNG"
            image.save()
    shot = lambda file: {"frames": 2, "background": {"file": str(scratch / file), "offset": 0, "pan": [0, 1]}}
    edit = {"width": 270, "height": 480, "shots": [shot("wide.png"), shot("tall.png")]}
    scene = bpy.context.scene
    rr.build(scene, edit, scratch, scratch)
    for frame, name, want in ((1, "wide first", red), (2, "wide last", blue), (3, "tall first", red), (4, "tall last", blue)):
        path = scratch / ("pan-%d.png" % frame)
        rr.still(scene, frame, path)
        mean = read_png(path)[:, :, :3].reshape(-1, 3).mean(axis=0)
        if mean[list(want).index(1)] < 0.8:
            bad("pan %s: expected mostly %s, got mean colour %s" % (name, "red" if want == red else "blue", np.round(mean, 2)))
    video = re_.ROOT / "assets/model_v2/reel_samples/video.mp4"
    for bg, words in (({"file": str(video), "offset": 3600, "pan": [0, 1]}, "frames"),):
        try:
            rr.build(bpy.data.scenes.new("short"), {"width": 270, "height": 480, "shots": [{"frames": 2, "background": bg}]}, scratch, scratch)
            bad("a background video shorter than its shot was accepted")
        except ValueError as e:
            if words not in str(e) or not str(e).startswith("shot 1:"):
                bad("short video: unclear error %r" % str(e))
    print("PAN checked")


def check_review(mp4, edit):
    clip = bpy.data.movieclips.load(str(mp4))
    total = sum(s["frames"] for s in edit["shots"])
    if clip.frame_duration != total:
        bad("the reel is %d frames, the edit list adds up to %d" % (clip.frame_duration, total))
    if tuple(clip.size) != (edit["width"], edit["height"]):
        bad("the reel is %s, the edit list says %dx%d" % (tuple(clip.size), edit["width"], edit["height"]))
    if abs(clip.fps - 24) > 0.01:
        bad("the reel is %.2f fps" % clip.fps)
    print("REVIEW checked", total, "frames")
```

and in `main()`, before `else:`:

```python
    elif mode == "pan":
        scratch = Path(rest[0])
        scratch.mkdir(parents=True, exist_ok=True)
        check_pan(scratch)
    elif mode == "review":
        check_review(Path(rest[0]), re_.load(rest[1]))
```

The wrong-fps case (Review Focus 3) has no sample to test with; it is the two-line guard in `background()` and is read in review, not tested.

- [ ] **Step 6: Run the pan check**

```sh
"$B" -b --factory-startup --python-exit-code 1 -P assets/model_v2/build/checks/check_reel.py -- pan "$(pwd -W)/assets/model_v2/renders/reel/pan" 2>&1 | grep -E "Error|PAN|PROBLEM"
```
Expected: `PAN checked`, no `PROBLEM`. If a direction is reversed, flip the sign in `background()` for that axis only, and re-run.

- [ ] **Step 7: Commit**

```bash
git add assets/model_v2/build/reel_review.py assets/model_v2/build/reel_poc.json assets/model_v2/build/checks/check_reel.py
git commit -m "feat(orbit): O1 reels: the review reel over image and video backgrounds, and the proof-of-concept edit list"
```

---

### Task 4: The run script, the proof-of-concept reel, and the docs

**Files:**
- Create: `assets/model_v2/build/run_reel.sh`
- Modify: `docs/orbit/o1-reels-spec.md` (status, seconds per frame, "What changed while building it")
- Modify: `docs/orbit/o1-model.md` (stage 6 entry)
- Modify: `CLAUDE.md` (the reel commands)
- Modify: `DECISIONS.md` (rows for choices the spec does not cover)

**Interfaces:**
- Consumes: every CLI above.
- Produces: `sh assets/model_v2/build/run_reel.sh [reel.json]` → `assets/model_v2/renders/reel/{frames/, reel.mp4, reel-shot-NN.png, sheet.png}`, all checks run.

- [ ] **Step 1: Write the run script**

`assets/model_v2/build/run_reel.sh`:

```sh
#!/bin/sh
# Checks the reel code, renders an edit list (default: the proof of concept), lays it over its backgrounds, and checks the result.
# Output: renders/reel (git-ignored): frames/, reel.mp4, one still per shot, sheet.png.
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd -W)"
F="$ROOT/spica-v2-clips.blend"
REEL="${1:-$ROOT/build/reel_poc.json}"
OUT="$ROOT/renders/reel"
CHECK="$ROOT/build/checks/check_reel.py"
SHOW="Error|Traceback|PROBLEM|checked|SHOT|REEL|ok$"
set -e
python "$ROOT/build/checks/test_reel_edit.py"
for m in manifest camera "wrap $OUT/wrap"; do "$B" -b "$F" --python-exit-code 1 -P "$CHECK" -- $m 2>&1 | grep -E "$SHOW"; done
"$B" -b --factory-startup --python-exit-code 1 -P "$CHECK" -- pan "$OUT/pan" 2>&1 | grep -E "$SHOW"
"$B" -b "$F" --python-exit-code 1 -P "$ROOT/build/reel.py" -- "$REEL" "$OUT/frames" 2>&1 | grep -E "$SHOW"
"$B" -b "$F" --python-exit-code 1 -P "$CHECK" -- frames "$OUT/frames" "$REEL" 2>&1 | grep -E "$SHOW"
"$B" -b --factory-startup --python-exit-code 1 -P "$ROOT/build/reel_review.py" -- "$REEL" "$OUT/frames" "$OUT/reel.mp4" 2>&1 | grep -E "$SHOW"
"$B" -b --factory-startup --python-exit-code 1 -P "$CHECK" -- review "$OUT/reel.mp4" "$REEL" 2>&1 | grep -E "$SHOW"
python "$ROOT/build/sheet.py" "$OUT/sheet.png" 1600 4 "$OUT"/reel-shot-*.png
echo "REEL done: $OUT/reel.mp4"
```

`grep` exits 1 when nothing matches; every step prints at least one line in `SHOW`, so `set -e` stops only on a real failure. If a step prints nothing it matches, remove `set -e` for that line rather than hiding errors.

- [ ] **Step 2: Run it**

Run: `sh assets/model_v2/build/run_reel.sh` (takes minutes; run it in the background and wait for it to finish).
Expected, in order: `REEL_EDIT ok`, `MANIFEST checked`, `CAMERA checked 648 placements`, `WRAP checked`, `PAN checked`, four `SHOT ... s per frame` lines, four `FRAMES shot` lines, `REEL ...`, `REVIEW checked 240 frames`, `REEL done`. No `PROBLEM`.

- [ ] **Step 3: Look before showing Ethan**

Open `renders/reel/sheet.png` and each `reel-shot-NN.png`, and zoom to 3x on her face, hair edge and star in each: edges clean against the background, no dark fringe, brows over the fringe, the face right for the shot, she is where the edit list says. Play `reel.mp4` start to end: four hard cuts, the pans move the right way, the video moves, the length is 10 seconds. Fix anything wrong at its cause and re-run before showing him.

- [ ] **Step 4: Run the existing checks**

```sh
sh assets/model_v2/build/run_rig_check.sh
"$B" -b "$F" --python-exit-code 1 -P assets/model_v2/build/checks/check_clips.py -- clip idle,walk,look_up,sit_edge 2>&1 | grep -E "PROBLEM|CLIP|Error"
```
Expected: both pass as before (nothing changed `.blend` files).

- [ ] **Step 5: Docs**

- `docs/orbit/o1-reels-spec.md`: status line to "built, waiting for Ethan's review"; replace "Seconds per frame are measured on the first build and written here" with the measured numbers per framing from the `SHOT` lines (seconds per frame and total minutes for the 10-second reel); add a "What changed while building it" list at the top (as `o1-clips-spec.md` has) with: the head-in-frame check measures the whole head bone in the frame for `face` framing; the review's pans ease in and out; the review fails on a background video not at 24 fps; the review writes one still per shot beside the MP4; any value changed in Task 2 Step 5 or any Sequencer name changed in Task 3 Step 3.
- `docs/orbit/o1-model.md`: stage 6 entry: built, commands, link to the spec.
- `CLAUDE.md`: one bullet after the clips bullet: `- Reels: sh assets/model_v2/build/run_reel.sh [reel.json] renders an edit list (default build/reel_poc.json) to renders/reel/reel.mp4 and checks it; renderer reel.py, review reel_review.py, manifest clips.json (docs/orbit/o1-reels-spec.md).`
- `DECISIONS.md`: a 2026-11-12 row for each choice made while building that the spec does not cover (the same list as "What changed", one row each, with why).

- [ ] **Step 6: Commit**

```bash
git add assets/model_v2/build/run_reel.sh docs/orbit/o1-reels-spec.md docs/orbit/o1-model.md CLAUDE.md DECISIONS.md
git commit -m "docs(orbit): O1 reels built: run script, measured render time, decisions"
```

- [ ] **Step 7: Show Ethan**

Send him the paths of `renders/reel/reel.mp4` and `renders/reel/sheet.png` with the measured render time, and ask for his corrections to framing heights, angles and placement. Corrections are edits to `FRAMING`, `FULL_FOOT_ROOM`, `FACE_UP` in `reel.py` or to `reel_poc.json`, then a re-run of `run_reel.sh`.
