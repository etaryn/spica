# Renders her as transparent sprites for the post engine, or as frames for reviewing a clip.
# Args after --: sprites <absolute out dir> <clip:frame:face,...> | review <absolute out dir> <clip> <face>
# The clip "stance" is her arms-down pose with no animation. Every sprite is made facing both ways, because mirroring would swap her ponytail, star and socks.
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import brow_over
import face_expr2
import rig_poses as rp

GROUND = -0.0316  # her soles
SCALE = 1.85  # metres of her world from the top of a sprite to the bottom; the same for all, so she is always the same size
W, H, MASTER = 400, 1000, 3
ANCHOR = [200, 980]  # the ground under her lands on this pixel
AZIMUTH = {"left": 32, "right": -32}  # the review views q and qr
TAGS = {"stance": "standing", "idle": "standing", "walk": "walking", "look_up": "looking_up", "sit_edge": "sitting_edge"}
LOOK_UP_GAZE = 0.45  # 100% is 20 degrees


def setup(scene, transparent):
    """The lighting of render.py's toon views, and a fixed orthographic camera."""
    for name in ("cam", "sun"):
        if name in bpy.data.objects:
            bpy.data.objects.remove(bpy.data.objects[name])
    scene.render.engine = "BLENDER_EEVEE"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    world = bpy.data.worlds.new("sprite")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.84, 0.84, 0.89, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    scene.collection.objects.link(sun)
    sun.data.energy = 3.0
    sun.data.angle = 0.03
    sun.rotation_euler = (math.radians(33), 0, math.radians(-22))
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = SCALE
    cam.data.clip_end = 40
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def aim(cam, facing):
    a = math.radians(AZIMUTH[facing])
    d = Vector((math.sin(a), -math.cos(a), 0))
    centre = Vector((0, 0, GROUND + (ANCHOR[1] - H / 2) * SCALE / H))
    cam.location = centre + d * 6
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()


def set_sit(on):
    key = bpy.data.objects["hoodie"].data.shape_keys.key_blocks.get("sit_seat")
    if key:
        key.value = float(on)


def pose(arm, scene, clip, frame):
    if arm.animation_data:
        arm.animation_data.action = None
    set_sit(clip == "sit_edge")
    if clip == "stance":
        rp.apply(arm, "arms_down")
    else:
        action = bpy.data.actions["clip_" + clip]
        arm.animation_data_create()
        arm.animation_data.action = action
        arm.animation_data.action_slot = action.slots[0]
        rp.set_down_shapes(1.0)
    scene.frame_set(frame)
    bpy.context.view_layer.update()


def image_right_gaze(keys):
    """Which of Gaze_L and Gaze_R moves her eyes toward +x, the right of the picture."""

    def shift(name):
        moved, basis = np.empty(len(keys[name].data) * 3), np.empty(len(keys[name].data) * 3)
        keys[name].data.foreach_get("co", moved)
        keys["Basis"].data.foreach_get("co", basis)
        return float((moved - basis)[0::3].sum())

    return "Gaze_L" if shift("Gaze_L") > 0 else "Gaze_R"


def set_face(name, facing, clip):
    """Her expression, with any sideways glance sent the way she faces."""
    face_expr2.use(name)
    keys = bpy.data.objects["Face"].data.shape_keys.key_blocks
    right = image_right_gaze(keys)
    left = "Gaze_L" if right == "Gaze_R" else "Gaze_R"
    amount = max(keys["Gaze_L"].value, keys["Gaze_R"].value)
    toward, away = (right, left) if facing == "right" else (left, right)
    keys[toward].value, keys[away].value = amount, 0.0
    if clip == "look_up":
        keys["Gaze_Up"].value = max(keys["Gaze_Up"].value, LOOK_UP_GAZE)
        keys["Gaze_Down"].value = 0.0


def shrink(master, path):
    """Master to sprite: an exact 3x box filter in premultiplied alpha, so edges pick up no dark fringe."""
    image = bpy.data.images.load(str(master))
    image.colorspace_settings.name = "Non-Color"
    w, h = image.size
    a = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(a)
    bpy.data.images.remove(image)
    a = a.reshape(h, w, 4)
    alpha = a[:, :, 3:]
    small = np.concatenate([a[:, :, :3] * alpha, alpha], axis=2).reshape(H, MASTER, W, MASTER, 4).mean(axis=(1, 3))
    small[:, :, :3] = np.clip(small[:, :, :3] / np.maximum(small[:, :, 3:], 1e-6), 0, 1)
    out = bpy.data.images.new(path.stem, W, H, alpha=True)
    out.colorspace_settings.name = "Non-Color"
    out.pixels.foreach_set(small.astype(np.float32).ravel())
    out.filepath_raw = str(path)
    out.file_format = "PNG"
    path.unlink(missing_ok=True)
    out.save()
    bpy.data.images.remove(out)


def sprite(arm, scene, cam, out, clip, frame, face):
    name = ("%s-%s" % (clip, face)).replace("_", "-")
    for facing in ("left", "right"):
        pose(arm, scene, clip, frame)
        set_face(face, facing, clip)
        aim(cam, facing)
        stem = "%s-%s" % (name, facing)
        master = out / "master" / (stem + ".png")
        master.parent.mkdir(parents=True, exist_ok=True)
        master.unlink(missing_ok=True)
        scene.render.resolution_x, scene.render.resolution_y = W * MASTER, H * MASTER
        scene.render.filepath = str(master)
        brow_over.render(scene)
        shrink(master, out / (stem + ".png"))
    return {"name": name, "files": {s: "%s-%s.png" % (name, s) for s in ("left", "right")}, "tags": [TAGS[clip]], "anchor": ANCHOR}


def review(arm, scene, cam, out, clip, face):
    """Every second frame of a clip at sprite size on a plain background, facing right."""
    action = bpy.data.actions["clip_" + clip]
    out.mkdir(parents=True, exist_ok=True)
    aim(cam, "right")
    scene.render.resolution_x, scene.render.resolution_y = W, H
    for f in range(action["first"], action["last"] + 1, 2):
        pose(arm, scene, clip, f)
        set_face(face, "right", clip)
        path = out / ("f%04d.png" % f)
        path.unlink(missing_ok=True)
        scene.render.filepath = str(path)
        brow_over.render(scene)


def main():
    mode, out, *rest = sys.argv[sys.argv.index("--") + 1:]
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    arm = bpy.data.objects["Armature"]
    cam = setup(scene, transparent=mode == "sprites")
    if mode == "review":
        review(arm, scene, cam, out, rest[0], rest[1])
        return
    entries = {}
    for item in rest[0].split(","):
        clip, frame, face = item.split(":")
        entry = sprite(arm, scene, cam, out, clip, int(frame), face)
        entries[entry["name"]] = entry
    (out / "poses.json").write_text(json.dumps(list(entries.values()), indent=2) + "\n", newline="\n")


if __name__ == "__main__":
    main()
