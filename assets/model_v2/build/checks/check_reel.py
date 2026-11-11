# Tests her reels by measurement, and raises on any failure.
# Args after --: manifest | camera | wrap <abs scratch dir> | frames <abs frames dir> <reel.json> run on spica-v2-clips.blend;
# pan <abs scratch dir> | review <mp4> <reel.json> run in an empty session (--factory-startup).
import json
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
