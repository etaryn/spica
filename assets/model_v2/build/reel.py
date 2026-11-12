# Renders her shots for a reel from an edit list, as transparent frames for the reel engine on main to lay over content.
# Args after --: <reel.json> <absolute out dir> | manifest <absolute out.json>. Runs on spica-v2-clips.blend and never saves it.
# Seam and fields: docs/orbit/o1-reels-spec.md.
# Scroll reels: -- scroll <abs reel dir> <abs out dir> [preview] (docs/orbit/o1-scroll-reel-spec.md).
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
    re_.validate(edit, manifest(reels=True))
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
            face = re_.face_at(shot["faces"], i + 1) if "faces" in shot else shot["face"]
            sp.set_face(face, facing, shot["clip"])
            place_camera(cam, arm, scene, shot)
            scene.render.filepath = str(folder / ("%04d.png" % (i + 1)))
            brow_over.render(scene)
        print("SHOT %d %s %d frames, %.2f s per frame" % (n, shot["clip"], shot["frames"], (time.time() - began) / shot["frames"]))


def render_scroll(folder, out, preview):
    """A scroll reel as one front-on shot; the shot's edit list goes beside the frames for the frames check."""
    edit = re_.load(folder / "reel.json")
    re_.validate_scroll(edit, manifest()["faces"])
    shot = re_.scroll_shot(re_.preview(edit) if preview else edit, folder.name)
    out.mkdir(parents=True, exist_ok=True)
    (out / "edit.json").write_text(json.dumps(shot, indent=2) + "\n", newline="\n")
    render(shot, out)


def main():
    rest = sys.argv[sys.argv.index("--") + 1:]
    if rest[0] == "manifest":
        write_manifest(rest[1])
        return
    if rest[0] == "scroll":
        render_scroll(Path(rest[1]), Path(rest[2]), rest[3:] == ["preview"])
        return
    render(re_.load(rest[0]), Path(rest[1]))


if __name__ == "__main__":
    main()
