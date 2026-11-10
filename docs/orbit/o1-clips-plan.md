# O1 clips and sprites: implementation plan

The step-by-step build of `docs/orbit/o1-clips-spec.md`: her four clips, the sprites rendered from
them, and the small change on `main` that stops her being mirrored.
Nov 11, 2026. Status: written, not started.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render her real body as transparent sprites, facing both ways, and have the post engine
use them without mirroring her.

**Architecture:** `clips.py` keys each clip from plain functions of the frame and saves
`spica-v2-clips.blend`. `sprites.py` opens that file and renders any clip, frame and face.
`check_clips.py` measures both and raises on failure; Ethan judges the look. On `main`, the pose
manifest names one picture per facing and the mirroring code is deleted.

**Tech Stack:** Blender 5.2 LTS headless Python, numpy, mathutils. Pillow outside Blender for sheets
and GIFs. On `main`: TypeScript, sharp, zod, vitest.

**Spec:** `docs/orbit/o1-clips-spec.md`

## Global Constraints

- `B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"`; every run uses
  `--python-exit-code 1`. Output folders passed to Blender are absolute: `W=$(pwd -W)` in Git Bash.
- Every new file starts with a short plain-English header.
- `.blend` files and renders stay git-ignored. `spica-v2.blend` is never saved over.
- Commit only on Ethan's word. Never merge `orbit` into `main`. On `main`, `git add` by path only:
  the model files show as untracked there.
- Nothing new on her design without asking Ethan.
- Stop after each checkpoint and show Ethan the renders. The next starts after his word.
- A render PNG just viewed can be locked: `sprites.py` deletes before rendering.
- Don't kill Blender by image name; he may have it open.

Measured from the finished model (Nov 11): her soles are at z -0.0316 and the top of her binary star
at 1.6805. Hips head z 0.9. Thigh and shin are each about 0.387 long. In her own axes she faces -y
and +x is her left, the right of the picture from the front. A turn of +X leans forward and swings
a hanging limb back, -Y lowers her right side, +Z turns her to her left.

## Review Focus

1. **Her eyes against the way she faces.** `observing` and `curious` have a fixed sideways glance. A
   sprite must look the way she faces, not back over her shoulder (Task 1, `state` check).
2. **Rebuilding one clip** in a file that already has the others must replace that clip and leave
   the rest alone (Task 2, one action per clip).
3. **Seated swing.** `spring.py` keeps the ponytail out of her by a table of heights measured
   standing, which is 33.5 cm wrong when she sits (Task 4, seated torso check).
4. **State left over between sprites** in one Blender session: the seat cloth shape after
   `sit_edge`, or one face's water on the next (Task 4, `check_seat`).
5. **A fresh clone of `main` with no sprites:** tests still pass (Task 7), and an old-format
   manifest fails loudly (Task 6).

---

## Checkpoint 1: one sprite, three faces

### Task 1: Transparent sprite with the right size, anchor and gaze

**Files:**

- Create: `assets/model_v2/build/sprites.py`, `assets/model_v2/build/checks/check_clips.py`

**Interfaces:**

- Produces: `sprites.pose(arm, scene, clip, frame)`, `sprites.set_face(name, facing, clip)`,
  `sprites.set_sit(on)`, `sprites.GROUND`. `check_clips.py` takes `sprites <dir>`, `state`, or
  `clip <name,...>`.

- [ ] **Step 1: Write the sprite check, failing first**

`assets/model_v2/build/checks/check_clips.py`:

```python
# Tests her clips and sprites by measurement, and raises on any failure.
# Args after --: sprites <absolute dir> | state | clip <name,...>. Sprites and state run on any file; clip needs spica-v2-clips.blend.
import json
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sprites as sp

args = sys.argv[sys.argv.index("--") + 1:]
problems = []


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


def check_sprite(path, standing):
    a = read_png(path)
    if a.shape[:2] != (sp.H, sp.W):
        return bad("%s: size %s" % (path.name, a.shape))
    alpha = a[:, :, 3]
    if (alpha > 0.5).mean() < 0.03:
        bad(path.name + ": nearly empty")
    edge = np.concatenate([alpha[:2].ravel(), alpha[-2:].ravel(), alpha[:, :2].ravel(), alpha[:, -2:].ravel()])
    if edge.max() > 0.02:
        bad(path.name + ": touches the edge of the canvas")
    lowest = int(np.where((alpha > 0.5).any(axis=1))[0].max())
    if standing and abs(lowest - sp.ANCHOR[1]) > 8:
        bad("%s: lowest solid row %d, anchor row %d" % (path.name, lowest, sp.ANCHOR[1]))
    glow = a[:125][(a[:125, :, 3] > 0.05) & (a[:125, :, 3] < 0.6)]  # the binary star's halo is the only soft thing up there
    if len(glow) and np.median(glow[:, :3].mean(axis=1)) < 0.4:
        bad(path.name + ": the star's glow has a dark edge")


def check_sprites(folder):
    entries = json.loads((folder / "poses.json").read_text())
    assert entries, "the manifest is empty"
    for e in entries:
        assert sorted(e) == ["anchor", "files", "name", "tags"], e["name"] + ": wrong fields"
        for side in ("left", "right"):
            check_sprite(folder / e["files"][side], not e["name"].startswith("sit-"))
    print("SPRITES checked", len(entries))


def check_state():
    keys = bpy.data.objects["Face"].data.shape_keys.key_blocks
    right = sp.image_right_gaze(keys)
    left = "Gaze_L" if right == "Gaze_R" else "Gaze_R"
    for facing, toward, away in (("right", right, left), ("left", left, right)):
        sp.set_face("observing", facing, "stance")
        assert keys[toward].value > 0.5 and keys[away].value == 0, "she looks away from where she faces, " + facing


if args[0] == "sprites":
    check_sprites(Path(args[1]))
elif args[0] == "state":
    check_state()
if problems:
    raise RuntimeError("%d problems" % len(problems))
print("CLIPS check passed")
```

- [ ] **Step 2: Run it to see it fail**

```bash
cd /c/Users/ethan/projects/spica
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
"$B" -b assets/model_v2/spica-v2.blend --python-exit-code 1 -P assets/model_v2/build/checks/check_clips.py -- state 2>&1 | tail -3
```

Expected: `ModuleNotFoundError: No module named 'sprites'`.

- [ ] **Step 3: Write `sprites.py`**

`assets/model_v2/build/sprites.py`:

```python
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
```

- [ ] **Step 4: Run the state check and render the test sprites**

```bash
W=$(pwd -W)
OUT="$W/assets/model_v2/renders/sprites/test"
"$B" -b assets/model_v2/spica-v2.blend --python-exit-code 1 -P assets/model_v2/build/checks/check_clips.py -- state 2>&1 | tail -2
"$B" -b assets/model_v2/spica-v2.blend --python-exit-code 1 -P assets/model_v2/build/sprites.py -- sprites "$OUT" stance:1:observing,stance:1:curious,stance:1:soft_smile 2>&1 | grep -E "^Error|Traceback"
"$B" -b assets/model_v2/spica-v2.blend --python-exit-code 1 -P assets/model_v2/build/checks/check_clips.py -- sprites "$OUT" 2>&1 | grep -E "PROBLEM|SPRITES|CLIPS|Error"
```

Expected: `CLIPS check passed` twice and `SPRITES checked 3`. If it reports a dark edge on the star
or the brows are wrong on a transparent background, fix that in `brow_over.py` or the star's halo
material before going on, and rerun.

- [ ] **Step 5: Make the close-up review sheet and show Ethan**

```bash
cd assets/model_v2/renders/sprites/test
python -I - <<'PY'
from pathlib import Path
from PIL import Image
files = sorted(Path("master").glob("*.png"))
sheet = Image.new("RGB", (900 * 3, 900 * 2), (120, 150, 190))
for k, f in enumerate(files):
    head = Image.open(f).crop((150, 60, 1050, 960))
    sheet.paste(head, ((k // 2) * 900, (k % 2) * 900), head)
sheet.save("faces.png")
PY
cd -
```

Expected: `faces.png`, on a blue background so the transparency shows. Top row faces left, bottom
row faces right. Check at 3x zoom yourself first. Ask Ethan: is the transparency clean, and do
these three faces hold up at this angle, including her eyes following the way she faces? Fix what he
marks, then stop until his word.

- [ ] **Step 6: Commit on Ethan's word**

```bash
git add assets/model_v2/build/sprites.py assets/model_v2/build/checks/check_clips.py
git commit -m "feat(orbit): O1 sprites: transparent, fixed size, anchored, both facings"
```

---

## Checkpoint 2: the clips

### Task 2: `idle` and `walk`

**Files:**

- Create: `assets/model_v2/build/clips.py`, `assets/model_v2/build/gif.py`
- Modify: `assets/model_v2/build/checks/check_clips.py`

**Interfaces:**

- Consumes: `spring.bake(arm, f0, f1)`, `rig_poses.apply`, `sprites.GROUND`.
- Produces: actions `clip_<name>` with custom properties `first` and `last` (the usable frames) and
  every arms-down bone keyed. `clips.py -- <name,...>` replaces only the clips named.

- [ ] **Step 1: Add the clip checks, failing first**

In `check_clips.py`, replace `if args[0] == "sprites":` and the `elif` under it with:

```python
WATCH = ("J_Bip_C_Head", "J_Bip_L_Hand", "J_Bip_R_Hand", "J_Bip_L_Foot", "J_Bip_R_Foot", "J_Sec_Pony8")
LOOPS = ("idle", "walk", "sit_edge")
GARMENTS = ("shorts", "shorts_cuff_L", "shorts_cuff_R", "stocking", "ankle_sock", "sneaker_L", "sneaker_R")
GARMENT_MOST = 10  # percent of a garment's points inside her skin, the limit her rig check uses


def evaluated(ob):
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    ev.to_mesh_clear()
    return a.reshape(-1, 3)


def sole(name):
    """The lowest point of a shoe, with its drawn outline on, because GROUND was measured with it."""
    ob = bpy.data.objects[name]
    outline = [m for m in ob.modifiers if m.type == "SOLIDIFY"]
    for m in outline:
        m.show_viewport = True
    bpy.context.view_layer.update()
    low = float(evaluated(ob)[:, 2].min())
    for m in outline:
        m.show_viewport = False
    return low


def percent_inside(name, tree):
    from mathutils import Vector

    points = evaluated(bpy.data.objects[name])[::3]
    inside = 0
    for c in points:
        loc, nrm, _, _ = tree.find_nearest(Vector(c))
        inside += (Vector(c) - loc).dot(nrm) < -0.0005
    return 100.0 * inside / len(points)


def check_clip(name):
    import spring

    arm, scene = bpy.data.objects["Armature"], bpy.context.scene
    found = [a.name for a in bpy.data.actions if a.name.startswith("clip_" + name)]
    assert found == ["clip_" + name], "%s: expected one action, found %s" % (name, found)
    action = bpy.data.actions[found[0]]
    first, last = action["first"], action["last"]
    track, soles, inside = [], [], {g: 0.0 for g in GARMENTS}
    for f in range(first, last + 1):
        sp.pose(arm, scene, name, f)
        track.append([np.array(arm.matrix_world @ arm.pose.bones[b].head) for b in WATCH])
        if (f - first) % 4 == 0:
            soles.append((sole("sneaker_L"), sole("sneaker_R")))
        if (f - first) % 24 == 0:
            tree = spring.solid_tree(("Body",))
            for g in GARMENTS:
                inside[g] = max(inside[g], percent_inside(g, tree))
    track = np.array(track)
    step = np.linalg.norm(track[1:] - track[:-1], axis=2).max(axis=0)
    seam = np.linalg.norm(track[0] - track[-1], axis=1)
    if name in LOOPS and (seam > 1.6 * step + 0.001).any():
        bad("%s: the loop jumps at %s" % (name, [b for b, s, t in zip(WATCH, seam, step) if s > 1.6 * t + 0.001]))
    soles = np.array(soles)
    if soles.min() < sp.GROUND - 0.006:
        bad("%s: a foot sinks %.1f mm below the ground" % (name, (sp.GROUND - soles.min()) * 1000))
    if name == "walk" and soles.min(axis=1).max() > sp.GROUND + 0.012:
        bad("walk: both feet leave the ground")
    if name in ("idle", "look_up"):
        drift = np.linalg.norm(track[:, 3:5] - track[0, 3:5], axis=2).max()
        if drift > 0.002:
            bad("%s: a planted foot slides %.1f mm" % (name, drift * 1000))
    for g, pct in inside.items():
        if pct > GARMENT_MOST:
            bad("%s: %s is %.1f%% inside her" % (name, g, pct))
    print("CLIP", name, "frames", first, last, "worst inside", {g: round(p, 1) for g, p in inside.items() if p > 1})


for g in [o for o in bpy.data.objects if o.type == "MESH"]:
    for m in g.modifiers:
        if m.type == "SOLIDIFY":
            m.show_viewport = args[0] != "clip"  # the check measures cloth without its drawn outline
if args[0] == "sprites":
    check_sprites(Path(args[1]))
elif args[0] == "state":
    check_state()
elif args[0] == "clip":
    for clip_name in args[1].split(","):
        check_clip(clip_name)
```

Run it on `spica-v2.blend`:

```bash
"$B" -b assets/model_v2/spica-v2.blend --python-exit-code 1 -P assets/model_v2/build/checks/check_clips.py -- clip idle 2>&1 | tail -2
```

Expected: `AssertionError: idle: expected one action, found []`.

- [ ] **Step 2: Write `clips.py` with `idle` and `walk`**

`assets/model_v2/build/clips.py`:

```python
# Keys her clips on the finished model and saves spica-v2-clips.blend, leaving spica-v2.blend alone. Args after --: <name,...>; only those are replaced.
# A clip is a function from a frame to bone turns in her own axes, each relative to the bone's parent and laid over her arms-down pose. Loops are keyed for two cycles and bake swing over both; the second is the clip.
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rig_poses as rp
import spring

OUT = Path(__file__).resolve().parent.parent / "spica-v2-clips.blend"
TAU = 2 * math.pi
AXES = {"X": Vector((1, 0, 0)), "Y": Vector((0, 1, 0)), "Z": Vector((0, 0, 1))}
SPINE, CHEST, UPPER_CHEST, NECK, HEAD, HIPS = (("J_Bip_C_%s" % n) for n in ("Spine", "Chest", "UpperChest", "Neck", "Head", "Hips"))
STRIDE = 0.20  # half a step, front foot to under her hips
STEP_LIFT = 0.07
TOE_AHEAD, ANKLE_HIGH = 0.17, 0.127  # the tip of her shoe from her ankle, along the ground and down to it


def B(side, name):
    return "J_Bip_%s_%s" % (side, name)


def turn(axis, degrees):
    return Quaternion(AXES[axis], math.radians(degrees))


def head_of(arm, name):
    return arm.data.bones[name].head_local.copy()


def leg(arm, side, ankle, pitch, hips_turn, hips_at):
    """Turns that put her ankle at a point, knee forward, foot pitched: positive lifts her heel."""
    hip0, knee0, ankle0 = (head_of(arm, B(side, n)) for n in ("UpperLeg", "LowerLeg", "Foot"))
    centre = head_of(arm, HIPS)
    hip = centre + hips_at + hips_turn @ (hip0 - centre)
    upper, lower = (knee0 - hip0).length, (ankle0 - knee0).length
    to_ankle = ankle - hip
    reach = min(to_ankle.length, (upper + lower) * 0.998)
    axis = to_ankle.normalized()
    along = (upper * upper - lower * lower + reach * reach) / (2 * reach)
    forward = Vector((0, -1, 0))
    bend = (forward - axis * forward.dot(axis)).normalized()
    knee = hip + axis * along + bend * math.sqrt(max(upper * upper - along * along, 0.0))
    world_upper = (knee0 - hip0).rotation_difference(knee - hip)
    world_lower = (ankle0 - knee0).rotation_difference(hip + axis * reach - knee)
    return {
        B(side, "UpperLeg"): hips_turn.inverted() @ world_upper,
        B(side, "LowerLeg"): world_upper.inverted() @ world_lower,
        B(side, "Foot"): world_lower.inverted() @ turn("X", pitch),
    }


def idle(arm, frame):
    s = (frame - 1) / 96
    sway, breath = math.sin(TAU * s), math.sin(TAU * 2 * s)
    at = Vector((0.012 * sway, 0, -0.006))
    hips = turn("Y", -1.2 * sway)
    turns = {
        HIPS: hips,
        SPINE: turn("Y", 0.6 * sway),
        CHEST: turn("X", -0.5 * breath),
        UPPER_CHEST: turn("X", -0.6 * breath) @ turn("Y", 0.6 * sway),
        HEAD: turn("Z", 2 * math.sin(TAU * s + 0.8)) @ turn("X", math.sin(TAU * 2 * s)),
        B("L", "UpperArm"): turn("X", math.sin(TAU * s + 1)),
        B("R", "UpperArm"): turn("X", math.sin(TAU * s + 2)),
    }
    for side in "LR":
        turns.update(leg(arm, side, head_of(arm, B(side, "Foot")), 0, hips, at))
    return turns, at


def heel_rise(pitch):
    """How far her ankle must rise for a heel lifted this much, so the rigid shoe pivots on its tip and stays out of the ground."""
    a = math.radians(max(pitch, 0))
    return TOE_AHEAD * math.sin(a) - ANKLE_HIGH * (1 - math.cos(a))


def foot_path(p):
    """Along the ground (+ is behind her), height, and pitch, through one step: 0 heel down in front, 0.6 toes leave behind her."""
    if p < 0.6:
        u = p / 0.6
        pitch = -12 * (1 - u / 0.1) if u < 0.1 else (24 * ((u - 0.7) / 0.3) ** 1.5 if u > 0.7 else 0.0)
        return -STRIDE + 2 * STRIDE * u, heel_rise(pitch), pitch
    u = (p - 0.6) / 0.4
    eased = u * u * (3 - 2 * u)
    pitch = 24 * (1 - u) - 12 * u
    return STRIDE - 2 * STRIDE * eased, heel_rise(pitch) + STEP_LIFT * math.sin(math.pi * u), pitch


def walk(arm, frame):
    p = ((frame - 1) / 32) % 1
    c, s = math.cos(TAU * p), math.sin(TAU * p)
    at = Vector((0.015 * s, 0, -(0.0265 + 0.0085 * math.cos(2 * TAU * p))))
    hips = turn("Z", -6 * c) @ turn("Y", -2.5 * s)
    turns = {
        HIPS: hips,
        SPINE: turn("X", 3) @ turn("Z", 3 * c),
        CHEST: turn("Z", 3 * c) @ turn("Y", 1.5 * s),
        UPPER_CHEST: turn("Z", 2 * c),
        NECK: turn("X", -2),
        HEAD: turn("Z", -2 * c),
        B("L", "UpperArm"): turn("X", 18 * c),
        B("R", "UpperArm"): turn("X", -18 * c),
        B("L", "LowerArm"): turn("X", -10 + 8 * c),
        B("R", "LowerArm"): turn("X", -10 - 8 * c),
    }
    for side, phase in (("L", p), ("R", (p + 0.5) % 1)):
        along, lift, pitch = foot_path(phase)
        turns.update(leg(arm, side, head_of(arm, B(side, "Foot")) + Vector((0, along, lift)), pitch, hips, at))
    return turns, at


CLIPS = {"idle": (idle, 96, True), "walk": (walk, 96, True)}


def build(arm, name):
    function, length, loops = CLIPS[name]
    old = bpy.data.actions.get("clip_" + name)
    if old:
        bpy.data.actions.remove(old)
    arm.animation_data_create()
    arm.animation_data.action = None
    rp.apply(arm, "arms_down")
    bpy.context.view_layer.update()
    action = bpy.data.actions.new("clip_" + name)
    action.use_fake_user = True
    arm.animation_data.action = action
    down = {pb.name: pb.rotation_quaternion.copy() for pb in arm.pose.bones}
    for bone in json.loads(arm["arms_down"]):
        pb = arm.pose.bones[bone]
        pb.keyframe_insert("rotation_quaternion", frame=1)
        pb.keyframe_insert("location", frame=1)
    hips = arm.pose.bones[HIPS]
    to_bone = hips.bone.matrix_local.to_quaternion().inverted()
    last = 2 * length if loops else length
    for f in range(1, last + 1):
        turns, at = function(arm, f)
        for bone, q in turns.items():
            pb = arm.pose.bones[bone]
            rest = pb.bone.matrix_local.to_quaternion()
            pb.rotation_quaternion = rest.inverted() @ q @ rest @ down[bone]
            pb.keyframe_insert("rotation_quaternion", frame=f)
        hips.location = to_bone @ at
        hips.keyframe_insert("location", frame=f)
    spring.bake(arm, 1, last)
    action["first"], action["last"] = (length + 1 if loops else 1), last
    arm.animation_data.action = None


def main():
    arm = bpy.data.objects["Armature"]
    for name in sys.argv[sys.argv.index("--") + 1].split(","):
        build(arm, name)
    rp.apply(arm, "arms_down")
    bpy.context.scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT))


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Build, check and test rebuilding**

```bash
C=assets/model_v2/spica-v2-clips.blend
CHECK=assets/model_v2/build/checks/check_clips.py
"$B" -b assets/model_v2/spica-v2.blend --python-exit-code 1 -P assets/model_v2/build/clips.py -- idle,walk 2>&1 | grep -E "^Error|Traceback|File .*clips"
"$B" -b "$C" --python-exit-code 1 -P "$CHECK" -- clip idle,walk 2>&1 | grep -E "PROBLEM|CLIP|Error"
"$B" -b "$C" --python-exit-code 1 -P assets/model_v2/build/clips.py -- idle 2>&1 | grep -E "^Error|Traceback"
"$B" -b "$C" --python-exit-code 1 -P "$CHECK" -- clip idle,walk 2>&1 | grep -E "PROBLEM|CLIP|Error"
git status --short assets/model_v2/spica-v2.blend
```

Expected: `CLIPS check passed` both times, no `.001` actions (the check asserts one action per
clip), and no change to `spica-v2.blend`. Tune the constants in `clips.py` if a check fails.

- [ ] **Step 4: Write the GIF tool**

`assets/model_v2/build/gif.py`:

```python
# Joins a folder's frames into a looping GIF for judging motion. Args: <folder> <output.gif> <ms per frame>.
import sys
from pathlib import Path

from PIL import Image

folder, out, ms = sys.argv[1:]
frames = [Image.open(p).convert("RGB") for p in sorted(Path(folder).glob("f*.png"))]
frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(ms), loop=0)
```

There is no ffmpeg on this machine, and a GIF is enough to judge motion.

- [ ] **Step 5: Render the review and show Ethan**

```bash
W=$(pwd -W)
for clip in idle walk; do
  R="$W/assets/model_v2/renders/clips/$clip"
  "$B" -b "$C" --python-exit-code 1 -P assets/model_v2/build/sprites.py -- review "$R" "$clip" observing 2>&1 | grep -E "^Error|Traceback"
  python -I assets/model_v2/build/gif.py "$R" "$R/motion.gif" 83
  python -I assets/model_v2/build/sheet.py "$R/sheet.png" 3200 8 $(ls "$R"/f*.png | awk 'NR%6==1')
done
```

Expected: `sheet.png` and `motion.gif` for each. Ask Ethan to correct the motion and pick a frame
number for each clip (file names `f0097.png` and so on). Tune `PONY` and `BUST` in `spring.py` here
if the swing looks wrong. If they change, rerun `check_spring.py` as `run_rig_check.sh` does.

- [ ] **Step 6: Commit on Ethan's word**

```bash
git add assets/model_v2/build/clips.py assets/model_v2/build/gif.py assets/model_v2/build/checks/check_clips.py assets/model_v2/build/spring.py
git commit -m "feat(orbit): O1 clips: idle and walk"
```

### Task 3: `look_up`

**Files:**

- Modify: `assets/model_v2/build/clips.py`

**Interfaces:**

- Consumes: `clips.turn`, `clips.leg`, `CLIPS`. `sprites.set_face` already adds the upward glance
  for `look_up`.

- [ ] **Step 1: See the check fail**

```bash
"$B" -b "$C" --python-exit-code 1 -P "$CHECK" -- clip look_up 2>&1 | tail -1
```

Expected: `AssertionError: look_up: expected one action, found []`.

- [ ] **Step 2: Add the clip**

Before `CLIPS` in `clips.py`:

```python
def look_up(arm, frame):
    rise = min(max((frame - 8) / 20, 0.0), 1.0)
    rise = rise * rise * (3 - 2 * rise)
    at = Vector((0, 0, -0.004))
    hips = Quaternion()
    turns = {
        HIPS: hips,
        CHEST: turn("X", -2 * rise),
        UPPER_CHEST: turn("X", -4 * rise),
        NECK: turn("X", -8 * rise),
        HEAD: turn("X", -17 * rise),
    }
    for side in "LR":
        turns.update(leg(arm, side, head_of(arm, B(side, "Foot")), 0, hips, at))
    return turns, at
```

Change `CLIPS` to:

```python
CLIPS = {"idle": (idle, 96, True), "walk": (walk, 96, True), "look_up": (look_up, 48, False)}
```

- [ ] **Step 3: Build, check, render the review**

```bash
"$B" -b "$C" --python-exit-code 1 -P assets/model_v2/build/clips.py -- look_up 2>&1 | grep -E "^Error|Traceback"
"$B" -b "$C" --python-exit-code 1 -P "$CHECK" -- clip look_up 2>&1 | grep -E "PROBLEM|CLIP|Error"
R="$(pwd -W)/assets/model_v2/renders/clips/look_up"
"$B" -b "$C" --python-exit-code 1 -P assets/model_v2/build/sprites.py -- review "$R" look_up curious 2>&1 | grep -E "^Error|Traceback"
python -I assets/model_v2/build/gif.py "$R" "$R/motion.gif" 83
python -I assets/model_v2/build/sheet.py "$R/sheet.png" 3200 8 $(ls "$R"/f*.png | awk 'NR%3==1')
```

Expected: `CLIPS check passed`. Look at the head and neck at 3x for hair in her shoulder and her
mouth and water at the new angle. Ask Ethan to correct it and pick a frame.

- [ ] **Step 4: Commit on Ethan's word**

```bash
git add assets/model_v2/build/clips.py
git commit -m "feat(orbit): O1 clips: look_up"
```

### Task 4: `sit_edge`

**Files:**

- Modify: `assets/model_v2/build/clips.py`, `assets/model_v2/build/spring.py:67,87,114`,
  `assets/model_v2/build/checks/check_clips.py`

**Interfaces:**

- Consumes: `drape.blended_bones(hoodie, deform)`, `drape.rest_change(blend, points, posed)`,
  `base_mesh.get_co(ob)`, `base_mesh.spread(points, change, mask, radius)`,
  `spring.solid_tree(names)`, `sprites.set_sit`.
- Produces: hoodie shape key `sit_seat` (value 0 except in `sit_edge`), and
  `spring.bake(arm, f0, f1, torso_drop=0.0)`.

- [ ] **Step 1: Add the seat and leftover-state checks, failing first**

In `check_clips.py`, add before `for g in [o for o in bpy.data.objects`:

```python
SEAT_GAP = 0.002  # hoodie points closer than this to her shorts, or under them, show the shorts through


def check_seat():
    from mathutils import Vector
    import spring

    arm, scene = bpy.data.objects["Armature"], bpy.context.scene
    sp.pose(arm, scene, "sit_edge", bpy.data.actions["clip_sit_edge"]["first"])
    tree = spring.solid_tree(("shorts", "shorts_cuff_L", "shorts_cuff_R"))
    points = evaluated(bpy.data.objects["hoodie"])
    low = points[points[:, 2] < points[:, 2].min() + 0.25]
    under = 0
    for c in low:
        loc, nrm, _, _ = tree.find_nearest(Vector(c))
        under += (Vector(c) - loc).dot(nrm) < SEAT_GAP and (Vector(c) - loc).length < 0.03
    if under > 0.01 * len(low):
        bad("sit_edge: %d of %d hoodie points are at or under her shorts" % (under, len(low)))
    import body as shape

    torso = np.array(shape.TORSO)  # measured standing, so a seated height is compared 0.335 higher
    for chain, kind in spring.chains(arm):
        if kind is spring.PONY:
            for b in chain:
                p = arm.matrix_world @ arm.pose.bones[b.name].tail
                z = p.z + 0.335
                if torso[0, 0] <= z <= torso[-1, 0]:
                    half, front, back = (np.interp(z, torso[:, 0], torso[:, c]) for c in (1, 2, 3))
                    if abs(p.x) < half and front < p.y < back:
                        bad("sit_edge: %s is inside her" % b.name)
    sp.pose(arm, scene, "walk", bpy.data.actions["clip_walk"]["first"])
    key = bpy.data.objects["hoodie"].data.shape_keys.key_blocks["sit_seat"]
    assert key.value == 0, "the seat shape stayed on after sit_edge"
    sp.set_face("teary", "right", "walk")
    sp.set_face("observing", "right", "walk")
    assert bpy.data.objects["accent_water"].hide_render, "one face's water stayed on the next"
    assert bpy.data.objects["accent_water_back"].hide_render, "one face's water stayed on the next"
```

In the argument handling, after `check_clip(clip_name)` in the `clip` branch add:

```python
        if clip_name == "sit_edge":
            check_seat()
```

Run: `"$B" -b "$C" --python-exit-code 1 -P "$CHECK" -- clip sit_edge 2>&1 | tail -1`.
Expected: `AssertionError: sit_edge: expected one action, found []`.

- [ ] **Step 2: Let the swing know how far she has sat down**

In `spring.py`, change `out_of_torso` to:

```python
def out_of_torso(p, margin, drop=0.0):
    """If p is inside her outline, the nearest place just outside it. By measurement, because the skin under the hoodie has been removed. Drop is how far her body has come down from standing."""
    z = p.z + drop
    if not TORSO[0, 0] <= z <= TORSO[-1, 0]:
        return p
    half, front, back = (float(np.interp(z, TORSO[:, 0], TORSO[:, c])) for c in (1, 2, 3))
```

Change `def bake(arm, f0, f1):` to `def bake(arm, f0, f1, torso_drop=0.0):`, and the call inside it
to `outside = out_of_torso(nxt, k["margin"], torso_drop)`.

- [ ] **Step 3: Add the clip and the seat cloth shape**

In `clips.py`, add to the imports:

```python
import numpy as np

import base_mesh as bm
import drape
```

Add before `CLIPS`:

```python
SIT_DROP = 0.335  # how far her hips come down: her hanging toes clear the ground by about a centimetre
SEAT_ABOVE = 1.0  # hoodie points below this height, in her rest pose, may move for the seat shape
SEAT_MARGIN = 0.006  # the gap the hoodie keeps outside her shorts
SEAT_BLUR = 0.02


def sit_edge(arm, frame):
    s = (frame - 1) / 96
    breath = math.sin(TAU * 2 * s)
    turns = {
        HIPS: Quaternion(),
        SPINE: turn("X", 4),
        CHEST: turn("X", -0.5 * breath),
        UPPER_CHEST: turn("X", 3 - 0.6 * breath),
        NECK: turn("X", -3),
        HEAD: turn("X", -3) @ turn("Z", 2 * math.sin(TAU * s + 0.8)),
        B("L", "UpperLeg"): turn("Z", 4) @ turn("X", -88),
        B("R", "UpperLeg"): turn("Z", -4) @ turn("X", -88),
        B("L", "LowerLeg"): turn("X", 88 + 9 * math.sin(TAU * s)),
        B("R", "LowerLeg"): turn("X", 86 + 2 * math.sin(TAU * s + 1)),
        B("L", "Foot"): turn("X", 15),
        B("R", "Foot"): turn("X", 15),
        B("L", "UpperArm"): turn("X", -8),
        B("R", "UpperArm"): turn("X", -8),
    }
    return turns, Vector((0, 0, -SIT_DROP))


def add_seat_shape(arm):
    """Lifts the hoodie clear of her shorts in the seated pose, as a shape before the armature."""
    hoodie = bpy.data.objects["hoodie"]
    keys = hoodie.data.shape_keys.key_blocks
    if "sit_seat" in keys:
        hoodie.shape_key_remove(keys["sit_seat"])
    outlines = [m for o in bpy.data.objects if o.type == "MESH" for m in o.modifiers if m.type == "SOLIDIFY"]
    for m in outlines:
        m.show_viewport = False
    bpy.context.view_layer.update()
    tree = spring.solid_tree(("shorts", "shorts_cuff_L", "shorts_cuff_R"))
    ev = hoodie.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    posed = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", posed)
    ev.to_mesh_clear()
    posed = posed.reshape(-1, 3)
    basis = bm.get_co(hoodie)
    down = np.empty(len(basis) * 3)
    keys["arms_down"].data.foreach_get("co", down)
    before = down.reshape(-1, 3)  # what the armature receives, with her arms-down shape on
    zone = before[:, 2] < SEAT_ABOVE
    target = posed.copy()
    for i in np.where(zone)[0]:
        p = Vector(posed[i])
        loc, nrm, _, _ = tree.find_nearest(p)
        gap = (p - loc).dot(nrm)
        if gap < SEAT_MARGIN and (p - loc).length < 0.03:
            target[i] = posed[i] + np.array(nrm) * (SEAT_MARGIN - gap)
    deform = {b.name: np.array(b.matrix @ b.bone.matrix_local.inverted()) for b in arm.pose.bones}
    change = bm.spread(basis, drape.rest_change(drape.blended_bones(hoodie, deform), before, target), zone, SEAT_BLUR)
    key = hoodie.shape_key_add(name="sit_seat", from_mix=False)
    key.value = 1.0
    key.data.foreach_set("co", (basis + change).astype(np.float32).ravel())
    for m in outlines:
        m.show_viewport = True
    print("CLIP seat shape moved up to", round(float(np.linalg.norm(change, axis=1).max()), 3))
```

Change `CLIPS` to:

```python
CLIPS = {"idle": (idle, 96, True), "walk": (walk, 96, True), "look_up": (look_up, 48, False), "sit_edge": (sit_edge, 96, True)}
```

In `build`, replace `spring.bake(arm, 1, last)` with:

```python
    if name == "sit_edge":
        bpy.context.scene.frame_set(1)
        bpy.context.view_layer.update()
        add_seat_shape(arm)
    spring.bake(arm, 1, last, SIT_DROP if name == "sit_edge" else 0.0)
    if name == "sit_edge":
        bpy.data.objects["hoodie"].data.shape_keys.key_blocks["sit_seat"].value = 0.0
```

- [ ] **Step 4: Build, check, render the review and the anchor options**

```bash
"$B" -b "$C" --python-exit-code 1 -P assets/model_v2/build/clips.py -- sit_edge 2>&1 | grep -E "^Error|Traceback|CLIP"
"$B" -b "$C" --python-exit-code 1 -P "$CHECK" -- clip sit_edge 2>&1 | grep -E "PROBLEM|CLIP|Error"
"$B" -b "$C" --python-exit-code 1 -P "$CHECK" -- clip idle 2>&1 | grep -E "PROBLEM|CLIP|Error"
R="$(pwd -W)/assets/model_v2/renders/clips/sit_edge"
"$B" -b "$C" --python-exit-code 1 -P assets/model_v2/build/sprites.py -- review "$R" sit_edge observing 2>&1 | grep -E "^Error|Traceback"
python -I assets/model_v2/build/gif.py "$R" "$R/motion.gif" 83
python -I assets/model_v2/build/sheet.py "$R/sheet.png" 3200 8 $(ls "$R"/f*.png | awk 'NR%6==1')
```

Expected: `CLIPS check passed`. If the seat check still fails, raise `SEAT_MARGIN` to 0.010.

Then make a side-by-side of the two anchor options on a mock post (a plain 1080x1350 background
with a floor line at 80% height): feet on the line, and seat on the line. Use a frame from the
review, placed with Pillow. Show Ethan with the sheet and GIF, and ask him to correct the pose, pick
a frame and pick the anchor. Her seat row is `980 - (0.8677 - 0.335 - 0.09 - GROUND) * 1000 / SCALE`,
which is 724 at `SCALE` 1.85. A seat anchor is `[200, 724]`.

- [ ] **Step 5: Record the anchor**

In `sprites.py`, replace `"anchor": ANCHOR` in the `sprite` return with
`"anchor": SEAT_ANCHOR if clip == "sit_edge" else ANCHOR`, and add under `ANCHOR`:

```python
SEAT_ANCHOR = [200, 724]  # Ethan's pick at review; set to ANCHOR if he chose her feet
```

- [ ] **Step 6: Commit on Ethan's word**

```bash
git add assets/model_v2/build/clips.py assets/model_v2/build/spring.py assets/model_v2/build/sprites.py assets/model_v2/build/checks/check_clips.py
git commit -m "feat(orbit): O1 clips: sit_edge and its seat cloth shape"
```

---

## Checkpoint 3: the sprites

### Task 5: The 24 sprites

**Files:**

- Create: `assets/model_v2/build/run_sprites.sh`

**Interfaces:**

- Consumes: `sprites.py -- sprites`, `check_clips.py -- sprites`, Ethan's four frame numbers.

- [ ] **Step 1: Write the batch, with Ethan's frames**

`assets/model_v2/build/run_sprites.sh`, setting the four `F_` values to the frames he picked:

```sh
#!/bin/sh
# Renders the sprites that ship, with the frames Ethan picked, and checks them. Output: renders/sprites/final.
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd -W)"
F="$ROOT/spica-v2-clips.blend"
OUT="$ROOT/renders/sprites/final"
F_IDLE=97
F_WALK=97
F_LOOK=48
F_SIT=97
LIST=""
for face in observing curious soft_smile; do
  LIST="$LIST,idle:$F_IDLE:$face,walk:$F_WALK:$face,look_up:$F_LOOK:$face,sit_edge:$F_SIT:$face"
done
"$B" -b "$F" --python-exit-code 1 -P "$ROOT/build/sprites.py" -- sprites "$OUT" "${LIST#,}" 2>&1 | grep -E "^Error|Traceback"
"$B" -b "$F" --python-exit-code 1 -P "$ROOT/build/checks/check_clips.py" -- sprites "$OUT" 2>&1 | grep -E "PROBLEM|SPRITES|CLIPS|Error"
```

- [ ] **Step 2: Run it**

Run: `sh assets/model_v2/build/run_sprites.sh`
Expected: `SPRITES checked 12` and `CLIPS check passed`. If a sprite touches the canvas edge, raise
`SCALE` in `sprites.py` a little and rerun: every sprite must share one scale.

- [ ] **Step 3: Sheet for Ethan**

```bash
cd assets/model_v2/renders/sprites/final
python -I - <<'PY'
from pathlib import Path
from PIL import Image
files = sorted(Path(".").glob("*-*.png"))
sheet = Image.new("RGB", (400 * 8, 1000 * 3), (120, 150, 190))
for k, f in enumerate(files):
    s = Image.open(f)
    sheet.paste(s, ((k % 8) * 400, (k // 8) * 1000), s)
sheet.thumbnail((3200, 2400))
sheet.save("sheet.png")
PY
cd -
```

Expected: 24 sprites on a blue background. Check at full size yourself first, then ask Ethan to
review it. Stop until his word.

- [ ] **Step 4: Commit on Ethan's word**

```bash
git add assets/model_v2/build/run_sprites.sh
git commit -m "feat(orbit): O1 sprites: the first batch of 24, with Ethan's frames"
```

---

## Checkpoint 4: into the post engine

These tasks run on `main`: `git switch main`, and back with `git switch orbit`. Its tests need the
test database up, as they always do. Tasks 6 and 7 land as one commit, so the placeholders leave in
the same change as the real sprites.

### Task 6: `main`: one picture per facing, no mirroring

**Files:**

- Modify: `src/mind/process/core/post-library.ts:40-46`, `src/mind/process/core/post-render.ts:13,144-158`,
  `src/mind/process/core/post.ts:81-85,110-115`, `evals/scripts/posts-review.ts:62-67`,
  `tests/mind/process/core/post-render.test.ts:18-22`,
  `tests/mind/process/core/post-library.test.ts:52,85`, `tests/exit/phase-14.test.ts:38`,
  `tests/mind/process/core/post-tick.test.ts`
- Move: `assets/poses/{walk-01,stand-01,look-up-01,sit-edge-01}.png` to `tests/fixtures/poses/`
- Create: `tests/fixtures/poses/poses.json`

**Interfaces:**

- Produces: `Pose = {name, files: {left, right}, tags, anchor}` and
  `PoseSprite = {left: Buffer, right: Buffer, anchor: [number, number]}`.

- [ ] **Step 1: Move the placeholders to a fixture folder**

```bash
git switch main
mkdir -p tests/fixtures/poses
git mv assets/poses/walk-01.png assets/poses/stand-01.png assets/poses/look-up-01.png assets/poses/sit-edge-01.png tests/fixtures/poses/
```

`tests/fixtures/poses/poses.json`:

```json
[
  {
    "name": "walk-01",
    "files": { "left": "walk-01.png", "right": "walk-01.png" },
    "tags": ["walking"],
    "anchor": [200, 980]
  },
  {
    "name": "stand-01",
    "files": { "left": "stand-01.png", "right": "stand-01.png" },
    "tags": ["standing"],
    "anchor": [200, 980]
  },
  {
    "name": "look-up-01",
    "files": { "left": "look-up-01.png", "right": "look-up-01.png" },
    "tags": ["looking_up"],
    "anchor": [200, 980]
  },
  {
    "name": "sit-edge-01",
    "files": { "left": "sit-edge-01.png", "right": "sit-edge-01.png" },
    "tags": ["sitting_edge"],
    "anchor": [200, 980]
  }
]
```

- [ ] **Step 2: Write the failing tests**

In `tests/mind/process/core/post-render.test.ts`, replace the `pose` constant with:

```ts
const walk = readFileSync("tests/fixtures/poses/walk-01.png");
const pose = { left: walk, right: walk, anchor: [200, 980] as [number, number] };
```

Add at the end of the file:

```ts
test("she is drawn from the picture for the way she faces, never mirrored", async () => {
  const solid = (background: string) =>
    sharp({ create: { width: 400, height: 1000, channels: 4, background } })
      .png()
      .toBuffer();
  const [red, blue] = await Promise.all([solid("#ff0000"), solid("#0000ff")]);
  const content = await fixturePng({ busy: "left" }); // she stands on the right, facing left
  const redIn = async (left: Buffer, right: Buffer) => {
    const out = await renderStill(
      await input({ content, pose: { left, right, anchor: [200, 980] } }),
    );
    return (await sharp(out).stats()).channels[0]!.mean;
  };
  expect(await redIn(red, blue)).toBeGreaterThan(await redIn(blue, red));
});
```

In `tests/mind/process/core/post-library.test.ts`, change both `loadPoses("assets/poses")` calls to
`loadPoses("tests/fixtures/poses")`, and add at the end:

```ts
test("a pose manifest in the old one-file format fails loudly", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "poses-"));
  writeFileSync(
    path.join(dir, "poses.json"),
    JSON.stringify([
      { name: "a", file: "a.png", tags: ["walking"], facing: "right", anchor: [200, 980] },
    ]),
  );
  expect(() => loadPoses(dir)).toThrow();
});
```

In `tests/exit/phase-14.test.ts:38`, and in the `posts` config override of
`tests/mind/process/core/post-tick.test.ts` (beside its `media_dir`), add
`poses_dir: "tests/fixtures/poses",`.

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run tests/mind/process/core/post-render.test.ts tests/mind/process/core/post-library.test.ts`
Expected: FAIL. The fixture manifest does not match the old `PoseSchema`, and `input.pose.png` is
undefined.

- [ ] **Step 4: Change the schema**

In `post-library.ts`, replace `PoseSchema` with:

```ts
const PoseFile = z.string().regex(/^[\w-]+\.png$/);
const PoseSchema = z.object({
  name: z.string().min(1),
  files: z.object({ left: PoseFile, right: PoseFile }),
  tags: z.array(z.string().min(1)).min(1),
  anchor: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
});
```

- [ ] **Step 5: Choose the picture and delete the mirroring**

In `post-render.ts`, line 13 becomes:

```ts
export type PoseSprite = { left: Buffer; right: Buffer; anchor: [number, number] };
```

Replace lines 143-158 (from `const [lo, hi] = format.placement.scale;` through
`const ay = input.pose.anchor[1] * k;`) with:

```ts
  const [lo, hi] = format.placement.scale;
  const facing = side === "right" ? "left" : "right";
  const picture = input.pose[facing];
  const original = await sharp(picture).metadata();
  // A sprite wider than the canvas is scaled down to fit, so placement offsets can't go negative.
  const height = Math.min(
    Math.round(H * (lo + (hi - lo) * u("scale"))),
    Math.floor((W * original.height!) / original.width!),
  );
  const k = height / original.height!;
  const her = await sharp(picture).resize({ height }).png().toBuffer();
  const herMeta = await sharp(her).metadata();
  const w = herMeta.width!;
  const ax = input.pose.anchor[0] * k;
  const ay = input.pose.anchor[1] * k;
```

- [ ] **Step 6: Read both files in the callers**

In `post.ts`, replace `let posePng: Buffer;` with
`let posePictures: { left: Buffer; right: Buffer };`, and the `posePng = ...` line with:

```ts
    posePictures = {
      left: await readMedia(path.join(cfg.poses_dir, pose.files.left)),
      right: await readMedia(path.join(cfg.poses_dir, pose.files.right)),
    };
```

and the `pose:` argument of `renderStill` with `pose: { ...posePictures, anchor: pose.anchor },`.

In `evals/scripts/posts-review.ts`, replace the `pose:` argument with:

```ts
        pose: {
          left: readFileSync(path.join(cfg.poses_dir, pose.files.left)),
          right: readFileSync(path.join(cfg.poses_dir, pose.files.right)),
          anchor: pose.anchor,
        },
```

- [ ] **Step 7: Run the tests**

Run: `pnpm typecheck && pnpm vitest run tests/mind/process/core tests/exit/phase-14.test.ts`
Expected: PASS.

### Task 7: `main`: the real sprites, and one post per facing

**Files:**

- Modify: `assets/poses/poses.json`, `.gitignore`
- Copy, git-ignored: `assets/poses/*.png`

**Interfaces:**

- Consumes: `assets/model_v2/renders/sprites/final/` from Task 5, which stays on disk across the
  branch switch.

- [ ] **Step 1: Bring the sprites across and ignore the PNGs**

```bash
F=assets/model_v2/renders/sprites/final
cp "$F"/*-left.png "$F"/*-right.png "$F"/poses.json assets/poses/
printf '\n# her real sprites stay out of git until the VRoid sample is re-exported (docs/orbit, orbit branch)\nassets/poses/*.png\n' >> .gitignore
git status --short assets/poses .gitignore tests/fixtures
pnpm prettier --write assets/poses/poses.json
```

Expected: `poses.json` and `.gitignore` modified, the four placeholders shown as renamed, and no
real PNG listed.

- [ ] **Step 2: Run the whole suite, with and without sprites**

```bash
pnpm typecheck && pnpm lint && pnpm test
mkdir -p "$TMP/poses-held" && mv assets/poses/*.png "$TMP/poses-held/"
pnpm test
mv "$TMP/poses-held/"*.png assets/poses/
```

Expected: PASS both times. The second run is what a fresh clone has.

- [ ] **Step 3: One post per facing**

`pnpm eval --llm=fake` replays chat scripts and makes no posts, so use a temporary test that calls
`renderStill` directly, with no LLM or database. `tests/tmp-sprite-preview.test.ts` (never committed):

```ts
/** Temporary: one post per facing from the real sprites, for Ethan to look at. Delete after. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { loadPoses, type StillFormat } from "@/mind/process/core/post-library";
import { renderStill } from "@/mind/process/core/post-render";
import { fixturePng } from "./helpers/web";

const format: StillFormat = {
  name: "t",
  medium: "still",
  min_skill: 0,
  aspect: "4:5",
  frame: "none",
  placement: { side: "auto", scale: [0.6, 0.7] },
  poses: ["walking"],
  overlay: { kind: "none", position: "bottom", style: "plain" },
  grain: 0.2,
  caption_pattern: "short",
  reviewed: true,
};

test("preview", async () => {
  mkdirSync(".data/review/sprites", { recursive: true });
  for (const pose of loadPoses("assets/poses")) {
    for (const busy of ["left", "right"] as const) {
      const image = await renderStill({
        content: await fixturePng({ busy }),
        format,
        pose: {
          left: readFileSync(path.join("assets/poses", pose.files.left)),
          right: readFileSync(path.join("assets/poses", pose.files.right)),
          anchor: pose.anchor,
        },
        overlayText: null,
        skill: 0.2,
        seed: pose.name,
        posts: loadConfig().posts,
      });
      writeFileSync(`.data/review/sprites/${pose.name}-${busy}.png`, image);
    }
  }
  expect(true).toBe(true);
});
```

Run: `pnpm vitest run tests/tmp-sprite-preview.test.ts && rm tests/tmp-sprite-preview.test.ts`
Expected: 24 pictures in `.data/review/sprites/`. Show Ethan a few of each clip: her star and
ponytail on the right sides, feet on the floor line, seated anchor as he picked it.

- [ ] **Step 4: Commit on `main` on Ethan's word, by path**

```bash
git add .gitignore assets/poses/poses.json tests/fixtures/poses src/mind/process/core/post-library.ts src/mind/process/core/post-render.ts src/mind/process/core/post.ts evals/scripts/posts-review.ts tests/mind/process/core/post-render.test.ts tests/mind/process/core/post-library.test.ts tests/mind/process/core/post-tick.test.ts tests/exit/phase-14.test.ts
git add -u assets/poses
git commit -m "feat(posts): one picture per facing, no mirroring; her real sprites replace the placeholders"
git switch orbit
```

### Task 8: Record it

**Files:**

- Modify: `DECISIONS.md`, `docs/orbit/o1-model.md:245-247`, `docs/orbit/o1-clips-spec.md`, `CLAUDE.md`

- [ ] **Step 1: Add the decisions**

Add one row each to `DECISIONS.md`, dated the day they are built: sprites are never mirrored, each
facing is its own render; a sprite's sideways glance follows the way she faces; the seated anchor
Ethan picked; real sprites stay out of git on `main` until the VRoid re-export; any motion or swing
values Ethan set by review.

- [ ] **Step 2: Update the docs**

Mark stages 5 and 6 done in `docs/orbit/o1-model.md`, pointing to `o1-clips-spec.md`. Set the spec's
status line to built and add a "What changed while building it" list like `o1-v2-rig-spec.md` has.
In `CLAUDE.md`, change "Next: clips and sprites; doodles only when Ethan asks." to name the new
build commands (`clips.py`, `run_sprites.sh`) and what is next.

- [ ] **Step 3: Commit on Ethan's word**

```bash
git add DECISIONS.md docs/orbit/o1-model.md docs/orbit/o1-clips-spec.md CLAUDE.md
git commit -m "docs(orbit): O1 clips and sprites built"
```
