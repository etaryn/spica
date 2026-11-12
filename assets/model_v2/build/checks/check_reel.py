# Tests her reels by measurement, and raises on any failure.
# Args after --: manifest | camera | wrap <abs scratch dir> | frames <abs frames dir> <reel.json> | scroll <abs reel dir> run on spica-v2-clips.blend;
# pan <abs scratch dir> | review <mp4> <reel.json> | feed <abs scratch dir> | scroll_review <mp4> <abs reel dir> [preview] run in an empty session (--factory-startup).
import json
import math
import struct
import sys
import wave
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
            corners = [alpha[0, 0], alpha[0, -1]] + ([alpha[-1, 0], alpha[-1, -1]] if shot["framing"] == "full" else [])  # closer in, her body fills the bottom
            if max(corners) > 0.01:
                bad("shot %d %s: the corners are not transparent" % (n, path.name))
            solid = alpha > 0.5
            if solid.mean() < 0.02:
                bad("shot %d %s: she is nearly missing" % (n, path.name))
                continue
            centre = float(np.where(solid)[1].mean()) / W
            if abs(centre - shot["x"]) > X_TOLERANCE:
                bad("shot %d %s: her centre is at x %.2f, the edit list says %.2f" % (n, path.name, centre, shot["x"]))
        print("FRAMES shot", n, len(pngs))
    print("FRAMES checked", len(edit["shots"]), "shots")


def same(p, q):
    return float(np.abs(read_png(p) - read_png(q)).mean()) < SAME


def check_wrap(scratch):
    """A loop running past its clip comes back to the clip's first frame; a one-shot holds its last. Small renders, so it is quick."""
    import reel

    shot = lambda clip, start, frames: {"clip": clip, "start": start, "frames": frames, "face": "observing", "azimuth": -32, "elevation": 0, "framing": "full", "x": 0.5}
    edit = {"width": 270, "height": 480, "shots": [shot("walk", 94, 4), shot("walk", 1, 1), shot("look_up", 46, 3), shot("look_up", 47, 1)]}  # walk: idle moves too little to tell its frames apart
    reel.render(edit, scratch)
    d = lambda n, f: scratch / ("shot-%02d" % n) / ("%04d.png" % f)
    if not same(d(1, 4), d(2, 1)):
        bad("walk: two frames after the clip's last is not its second")
    if same(d(1, 1), d(2, 1)):
        bad("walk: frames 94 and 1 render the same, so the wrap test proves nothing")
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


def picture(path, size, first, second):
    """A plain test picture, one colour in the first half and another in the second, split across its longer side."""
    w, h = size
    a = np.zeros((h, w, 4), np.float32)
    a[:, :, 3] = 1
    if w > h:
        a[:, : w // 2, :3], a[:, w // 2 :, :3] = first, second
    else:
        a[: h // 2, :, :3], a[h // 2 :, :, :3] = first, second
    image = bpy.data.images.new(path.stem, w, h, alpha=True)
    image.pixels.foreach_set(a[::-1].ravel())  # Blender's rows run bottom up
    image.filepath_raw, image.file_format = str(path), "PNG"
    path.unlink(missing_ok=True)
    image.save()


def check_pan(scratch):
    """Pan 0 shows the left or top of the content, pan 1 the right or bottom; a video too short for its shot fails before rendering."""
    import reel_review as rr

    red, blue = (1, 0, 0), (0, 0, 1)
    picture(scratch / "wide.png", (1920, 480), red, blue)
    picture(scratch / "tall.png", (270, 1920), red, blue)
    for n in (1, 2):  # her frames: empty, so only the background shows
        (scratch / ("shot-%02d" % n)).mkdir(exist_ok=True)
        for k in (1, 2):
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
    video = re_.ROOT / "assets/model_v2/reel_samples/video.webm"
    try:
        rr.build(bpy.data.scenes.new("short"), {"width": 270, "height": 480, "shots": [{"frames": 2, "background": {"file": str(video), "offset": 3600, "pan": [0, 1]}}]}, scratch, scratch)
        bad("a background video shorter than its shot was accepted")
    except ValueError as e:
        if "frames" not in str(e) or not str(e).startswith("shot 1:"):
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
    elif mode == "pan":
        scratch = Path(rest[0])
        scratch.mkdir(parents=True, exist_ok=True)
        check_pan(scratch)
    elif mode == "review":
        check_review(Path(rest[0]), re_.load(rest[1]))
    elif mode == "feed":
        scratch = Path(rest[0])
        scratch.mkdir(parents=True, exist_ok=True)
        check_feed(scratch)
    elif mode == "scroll_review":
        edit = re_.load(Path(rest[1]) / "reel.json")
        check_scroll_review(Path(rest[0]), re_.preview(edit) if rest[2:] == ["preview"] else edit)
    else:
        raise SystemExit("unknown mode " + mode)
    if problems:
        raise SystemExit("%d problems" % len(problems))


main()
