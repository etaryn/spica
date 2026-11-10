# O1 v2 rig, swing and expressions: implementation plan

Status: built. This is the plan as written; the T-pose rest and later changes are listed at the top of `o1-v2-rig-spec.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make her v2 model movable and expressive without changing how she looks at rest.

**Architecture:** Two new build steps follow `accents`: `rig.py` (skeleton measured from the
finished mesh, weights) and `expressions.py` (v1's shape keys and materials carried over). Each step
reads the previous step's `.blend` and saves its own. `check_rig.py` and `check_expressions.py` are
the tests: they measure and raise on failure. Ethan judges the renders at each checkpoint.

**Tech Stack:** Blender 5.2 LTS headless Python, numpy, mathutils. Pillow outside Blender for sheets.

**Spec:** `docs/orbit/o1-v2-rig-spec.md`

## Global Constraints

- `B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"`; every run uses
  `--python-exit-code 1`.
- Every new file starts with a short plain-English header.
- `.blend`, renders and textures stay git-ignored.
- No commits or pushes unless Ethan asks. Never merge `orbit` into `main`.
- Do not change her look at rest. Nothing new on her design without asking Ethan.
- At most four weights a point, adding up to 1, none on bones she lacks.
- Stop after each checkpoint and show Ethan the renders. The next starts after his word.
- A render PNG that was just viewed can be locked: delete it before re-rendering.

## Review Focus

1. Re-running one step on its own: each step reads the previous step's file, so a rerun must give
   the same result (Task 3, second-run comparison).
2. Automatic weights failing quietly and leaving points unweighted: must raise, not save (Task 3).
3. A head turn while an expression is showing: tattoo and face must move together (Task 7).
4. `run_colour_options.sh` on the rigged file: it must still render (Task 4).
5. The binary star on frame 1 must sit where today's still has it (Task 6).

---

## Checkpoint 1: rig

### Task 1: The rule check, failing first

**Files:**

- Create: `assets/model_v2/build/rig_poses.py`, `assets/model_v2/build/check_rig.py`
- Modify: `assets/model_v2/build/render.py` (after line 24)

**Interfaces:**

- Produces: `rig_poses.POSES` (name to list of `(bone, axis, degrees)`), `rig_poses.apply(arm, name)`,
  `rig_poses.reset(arm)`. `render.py` honours env `SPICA_POSE` and `SPICA_FRAME`.

- [ ] **Step 1: Save today's look as the baseline**

```bash
cd /c/Users/ethan/projects/spica
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
R=assets/model_v2/renders/rig/before
"$B" -b assets/model_v2/spica-v2.blend --python-exit-code 1 -P assets/model_v2/build/render.py -- "$R" toon front,q,side,back,face
cp assets/model_v2/spica-v2.blend assets/model_v2/spica-v2-accents.blend
```

- [ ] **Step 2: Write `rig_poses.py`**

Her arms hang at rest, so raising the left arm outward is a negative turn about world Y.

```python
# The stress poses for checking her rig, as turns of bones about world axes from her rest pose.
import math

from mathutils import Matrix


def B(side, name):
    return "J_Bip_%s_%s" % (side, name)


def both(name, axis, left):
    """The same turn on both sides; a turn about Y or Z is mirrored, a turn about X is not."""
    return [(B("L", name), axis, left), (B("R", name), axis, left if axis == "X" else -left)]


POSES = {
    "rest": [],
    "a_pose": both("UpperArm", "Y", -34),
    "arms_up": both("UpperArm", "Y", -140) + both("LowerArm", "Y", -20),
    "arms_forward": both("UpperArm", "X", -80),
    "arms_crossed": both("UpperArm", "X", -70) + both("UpperArm", "Z", -30) + both("LowerArm", "Z", -70),
    "sit": both("UpperLeg", "X", -90) + both("LowerLeg", "X", 90),
    "lean": [("J_Bip_C_Spine", "X", 20), ("J_Bip_C_Chest", "X", 15), ("J_Bip_C_UpperChest", "X", 10), ("J_Bip_C_Neck", "X", 10)],
    "head_turn": [("J_Bip_C_Neck", "Z", 15), ("J_Bip_C_Head", "Z", 40), ("J_Bip_C_Head", "X", 20), ("J_Bip_C_Head", "Y", 15)],
    "stride": [(B("L", "UpperLeg"), "X", -35), (B("R", "UpperLeg"), "X", 25), (B("L", "LowerLeg"), "X", 20), (B("R", "LowerLeg"), "X", 40)],
    "twist": [("J_Bip_C_Spine", "Z", 25), ("J_Bip_C_Chest", "Z", 20), ("J_Bip_C_UpperChest", "Z", 15)],
}


def reset(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)


def turn(arm, context, bone, axis, degrees):
    pb = arm.pose.bones[bone]
    head = arm.matrix_world @ pb.head
    spin = Matrix.Translation(head) @ Matrix.Rotation(math.radians(degrees), 4, axis) @ Matrix.Translation(-head)
    pb.matrix = arm.matrix_world.inverted() @ spin @ arm.matrix_world @ pb.matrix
    context.view_layer.update()


def apply(arm, name):
    import bpy

    reset(arm)
    bpy.context.view_layer.update()
    for bone, axis, degrees in POSES[name]:
        turn(arm, bpy.context, bone, axis, degrees)
```

- [ ] **Step 3: Write `check_rig.py`**

```python
# Measures her rig and raises if any rule fails: bones, weights, nothing moved at rest, the neck join, cloth in stress poses.
# Run: blender -b assets/model_v2/spica-v2.blend --python-exit-code 1 -P assets/model_v2/build/check_rig.py
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import rig_poses as rp

GARMENTS = ("hoodie", "shorts", "shorts_cuff_L", "shorts_cuff_R", "stocking", "ankle_sock", "sneaker_L", "sneaker_R")
NEED = ["Root", "J_Bip_C_Hips", "J_Bip_C_Spine", "J_Bip_C_Chest", "J_Bip_C_UpperChest", "J_Bip_C_Neck", "J_Bip_C_Head", "J_Adj_L_FaceEye", "J_Adj_R_FaceEye", "J_Sec_L_Bust1", "J_Sec_R_Bust2"]
for side in "LR":
    NEED += ["J_Bip_%s_%s" % (side, n) for n in ("Shoulder", "UpperArm", "LowerArm", "Hand", "UpperLeg", "LowerLeg", "Foot", "ToeBase")]
    NEED += ["J_Bip_%s_%s%d" % (side, f, i) for f in ("Index", "Middle", "Ring", "Little", "Thumb") for i in (1, 2, 3)]
problems = []


def bad(message):
    problems.append(message)
    print("PROBLEM", message)


arm = bpy.data.objects.get("Armature")
if arm is None:
    raise RuntimeError("PROBLEM no armature")
names = {b.name for b in arm.data.bones}
for n in NEED:
    if n not in names:
        bad("missing bone " + n)
skinned = [o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)]
loose = [o.name for o in bpy.data.objects if o.type == "MESH" and o not in skinned and not (o.parent and o.parent.name.startswith("accent_"))]
if loose:
    bad("meshes with no armature: %s" % loose)
print("RIG bones", len(names), "skinned", len(skinned))


def evaluated_points(ob):
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    ev.to_mesh_clear()
    return a.reshape(-1, 3)


for o in skinned:
    if [m.type for m in o.modifiers][0] != "ARMATURE":
        bad(o.name + ": armature is not the first modifier")
    for m in o.modifiers:
        if m.type in ("SOLIDIFY", "SUBSURF"):
            m.show_viewport = False
    groups = {g.index: g.name for g in o.vertex_groups}
    none = many = off = 0
    for v in o.data.vertices:
        ws = [g.weight for g in v.groups if groups[g.group] in names and g.weight > 1e-4]
        none += not ws
        many += len(ws) > 4
        off += bool(ws) and abs(sum(ws) - 1) > 0.01
    if none or many or off:
        bad("%s: %d unweighted, %d over four bones, %d not adding to 1" % (o.name, none, many, off))

rp.reset(arm)
bpy.context.view_layer.update()
for o in skinned:
    if not o.data.shape_keys:
        moved = float(np.abs(evaluated_points(o) - bm.get_co(o)).max())
        if moved > 1e-5:
            bad("%s moved %.6f at rest" % (o.name, moved))

body = bpy.data.objects["Body"]
tree = BVHTree.FromPolygons(bm.get_co(body).tolist(), [list(p.vertices) for p in body.data.polygons], all_triangles=False)
for b in arm.data.bones:
    if b.name.startswith("J_Bip"):
        head = b.head_local
        if not (tree.ray_cast(head, Vector((1, 0, 0)))[0] and tree.ray_cast(head, Vector((-1, 0, 0)))[0]):
            bad(b.name + ": joint is outside her body")

face = bpy.data.objects["Face"]
face_rest, body_rest = evaluated_points(face), evaluated_points(body)
low = np.where(face_rest[:, 2] < face_rest[:, 2].min() + 0.012)[0]
kd = KDTree(len(body_rest))
for i, c in enumerate(body_rest.tolist()):
    kd.insert(c, i)
kd.balance()
pair = [(int(i), kd.find(face_rest[i].tolist())[1]) for i in low]


def skin_tree():
    points, faces = [], []
    for o in (body, face):
        ev = o.evaluated_get(bpy.context.evaluated_depsgraph_get())
        me = ev.to_mesh()
        me.calc_loop_triangles()
        base = len(points)
        points += [v.co.copy() for v in me.vertices]
        faces += [tuple(base + k for k in t.vertices) for t in me.loop_triangles]
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(points, faces)


def cloth_row(ob, skin):
    p = evaluated_points(ob)
    inside = 0
    for c in p[::3]:
        loc, nrm, _, _ = skin.find_nearest(Vector(c))
        inside += (Vector(c) - loc).dot(nrm) < -0.0005
    e = bm.edges_of(ob)
    return 300.0 * inside / len(p), np.linalg.norm(p[e[:, 0]] - p[e[:, 1]], axis=1)


rest_len = {}
for pose in rp.POSES:
    rp.apply(arm, pose)
    bpy.context.view_layer.update()
    f, b_ = evaluated_points(face), evaluated_points(body)
    gap = np.array([np.linalg.norm(f[i] - b_[j]) - np.linalg.norm(face_rest[i] - body_rest[j]) for i, j in pair])
    if np.abs(gap).max() > 0.001:
        bad("%s: neck join moved %.2f mm" % (pose, np.abs(gap).max() * 1000))
    skin = skin_tree()
    row = []
    for name in GARMENTS:
        pct, lengths = cloth_row(bpy.data.objects[name], skin)
        rest_len.setdefault(name, lengths)
        ok = rest_len[name] > 0.004
        stretch = float((lengths[ok] / rest_len[name][ok]).max())
        row.append("%s %.1f%%/x%.1f" % (name, pct, stretch))
        if pct > 10 or stretch > 6:
            bad("%s: %s is %.1f%% inside skin, stretched x%.1f" % (pose, name, pct, stretch))
    print("POSE", pose, "neck %.2fmm" % (np.abs(gap).max() * 1000), " ".join(row))
rp.reset(arm)
if problems:
    raise RuntimeError("%d problems" % len(problems))
print("CHECK passed")
```

- [ ] **Step 4: Run it and watch it fail**

Run: `"$B" -b assets/model_v2/spica-v2-accents.blend --python-exit-code 1 -P assets/model_v2/build/check_rig.py 2>&1 | grep -E "PROBLEM|CHECK"`
Expected: `RuntimeError: PROBLEM no armature`.

- [ ] **Step 5: Teach `render.py` poses and frames**

Insert after the line `bpy.data.objects.remove(o)` that ends the `cam`/`sun` loop (line 24):

```python
if os.environ.get("SPICA_FRAME"):
    scene.frame_set(int(os.environ["SPICA_FRAME"]))
if os.environ.get("SPICA_POSE"):
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import rig_poses

    rig_poses.apply(bpy.data.objects["Armature"], os.environ["SPICA_POSE"])
```

### Task 2: The skeleton

**Files:**

- Create: `assets/model_v2/build/rig.py`
- Modify: `assets/model_v2/build/accents.py:275`

**Interfaces:**

- Produces: `rig.measure(body) -> dict` of joint positions (left side), `rig.build_armature(joints, face) -> arm`.

- [ ] **Step 1: Make each step save its own file**

In `accents.py` change the save to `str(bm.ROOT / "spica-v2-accents.blend")`.

- [ ] **Step 2: Write the skeleton half of `rig.py`**

```python
# Gives her a skeleton and skin weights. Runs on spica-v2-accents.blend and saves spica-v2-rig.blend.
# Joints are measured from the finished mesh; bone names are v1's. Her rest pose is how she stands now.
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import body as bd

SPINE = (("J_Bip_C_Hips", 0.90), ("J_Bip_C_Spine", 0.97), ("J_Bip_C_Chest", 1.06), ("J_Bip_C_UpperChest", 1.16), ("J_Bip_C_Neck", 1.285), ("J_Bip_C_Head", 1.345))
HEAD_TOP = 1.58
HIP_ABOVE_CREASE = 0.02  # the hip joint sits this far above the top of the slanted crease at her thigh
TOE_AT = 0.72  # the ball of her foot, as a share of the way from heel to toe tip
FINGERS = {"Index": (278, 283, 282), "Middle": (277, 279, 272), "Ring": (280, 274, 275), "Little": (281, 286, 276), "Thumb": (359, 285, 284)}  # face sets, root to tip
PALM = {273}
MIRROR = np.array([-1.0, 1.0, 1.0])
HAND_SETS = bm.PARTS["hand"]


def slab_centre(points, mask, at, axis, half=0.006):
    """The middle of her mesh in a thin slice across a limb."""
    q = points[mask]
    near = q[np.abs((q - at) @ axis) < half]
    assert len(near) >= 8, "too few points in the slice at %s" % at
    return (near.min(0) + near.max(0)) / 2


def measure(body):
    p = bm.get_co(body)
    in_sets = lambda sets: bm.vertices_in_sets(body, sets)
    left = p[:, 0] > 0
    border = lambda a, b: p[in_sets(a) & in_sets(b) & left]
    j = {}

    torso_mask = (np.abs(p[:, 0]) < 0.16) & ~in_sets(bm.PARTS["arm"] | HAND_SETS)
    for name, z in SPINE:
        mid = slab_centre(p, torso_mask, np.array([0, 0, z]), np.array([0.0, 0, 1]))
        j[name] = np.array([0.0, mid[1], z])
    j["J_Bip_C_Head"][1] = bm.HEAD_PIVOT[1]

    j["Shoulder"] = border(bm.PARTS["torso"], bm.PARTS["shoulder"]).mean(0)
    ring = border(bm.PARTS["shoulder"], bm.PARTS["arm"]).mean(0)
    j["UpperArm"] = np.array([ring[0], ring[1], bd.SHOULDER_JOINT[2]])
    j["Hand"] = border(bm.PARTS["arm"], HAND_SETS).mean(0)
    axis = (j["Hand"] - j["UpperArm"]) / np.linalg.norm(j["Hand"] - j["UpperArm"])
    j["LowerArm"] = slab_centre(p, in_sets(bm.PARTS["arm"]) & left, (j["UpperArm"] + j["Hand"]) / 2, axis)

    crease = border(bm.PARTS["torso"], bm.PARTS["leg"])
    j["UpperLeg"] = np.array([crease[:, 0].mean(), crease[:, 1].mean(), crease[:, 2].max() + HIP_ABOVE_CREASE])
    j["Foot"] = border(bm.PARTS["leg"], bm.PARTS["foot"]).mean(0)
    leg = in_sets(bm.PARTS["leg"]) & left
    j["LowerLeg"] = slab_centre(p, leg, (j["UpperLeg"] + j["Foot"]) / 2, np.array([0.0, 0, 1]))

    foot = p[in_sets(bm.PARTS["foot"]) & left]
    heel, toe = foot[:, 1].max(), foot[:, 1].min()
    y = heel + TOE_AT * (toe - heel)
    j["ToeBase"] = np.array([foot[np.abs(foot[:, 1] - y) < 0.01, 0].mean(), y, 0.02])
    j["ToeTip"] = np.array([j["ToeBase"][0], toe, 0.015])

    for finger, (a, b, c) in FINGERS.items():
        first, second, third = in_sets({a}) & left, in_sets({b}) & left, in_sets({c}) & left
        one, two = p[first & second].mean(0), p[second & third].mean(0)
        palm = first & in_sets(PALM)
        root = p[palm].mean(0) if palm.any() else 2 * p[first].mean(0) - one
        tip = p[third][np.argmax(np.linalg.norm(p[third] - two, axis=1))]
        j[finger] = (root, one, two, tip)

    chest = in_sets(bm.PARTS["torso"]) & left & (p[:, 2] > 1.10) & (p[:, 2] < 1.25)
    j["Bust"] = p[chest][np.argmin(p[chest][:, 1])]
    return j


def bone_list(j, face):
    """(name, head, tail, parent) for every bone, left side measured and right side mirrored."""
    out = [("Root", np.zeros(3), np.array([0, 0, 0.1]), None)]
    spine = [n for n, _ in SPINE]
    for k, n in enumerate(spine):
        tail = j[spine[k + 1]] if k + 1 < len(spine) else np.array([0, j[n][1], HEAD_TOP])
        out.append((n, j[n], tail, spine[k - 1] if k else "Root"))
    for side, m in (("L", np.ones(3)), ("R", MIRROR)):
        b = lambda n: "J_Bip_%s_%s" % (side, n)
        hand_tip = j["Middle"][0]
        out += [
            (b("Shoulder"), j["Shoulder"] * m, j["UpperArm"] * m, "J_Bip_C_UpperChest"),
            (b("UpperArm"), j["UpperArm"] * m, j["LowerArm"] * m, b("Shoulder")),
            (b("LowerArm"), j["LowerArm"] * m, j["Hand"] * m, b("UpperArm")),
            (b("Hand"), j["Hand"] * m, hand_tip * m, b("LowerArm")),
            (b("UpperLeg"), j["UpperLeg"] * m, j["LowerLeg"] * m, "J_Bip_C_Hips"),
            (b("LowerLeg"), j["LowerLeg"] * m, j["Foot"] * m, b("UpperLeg")),
            (b("Foot"), j["Foot"] * m, j["ToeBase"] * m, b("LowerLeg")),
            (b("ToeBase"), j["ToeBase"] * m, j["ToeTip"] * m, b("Foot")),
        ]
        for finger in FINGERS:
            root, one, two, tip = j[finger]
            for k, (h, t) in enumerate(((root, one), (one, two), (two, tip))):
                out.append(("J_Bip_%s_%s%d" % (side, finger, k + 1), h * m, t * m, b("Hand") if k == 0 else "J_Bip_%s_%s%d" % (side, finger, k)))
        peak = j["Bust"] * m
        sec = lambda n: "J_Sec_%s_Bust%d" % (side, n)
        out += [
            (sec(1), peak + [0, 0.05, 0], peak + [0, 0.025, 0], "J_Bip_C_UpperChest"),
            (sec(2), peak + [0, 0.025, 0], peak, sec(1)),
        ]
        eye = "J_Adj_%s_FaceEye" % side
        g = face.vertex_groups[eye].index
        points = bm.get_co(face)[[v.index for v in face.data.vertices if any(x.group == g and x.weight > 0.5 for x in v.groups)]]
        out.append((eye, points.mean(0), points.mean(0) + [0, -0.02, 0], "J_Bip_C_Head"))
    return out


def build_armature(j, face):
    data = bpy.data.armatures.new("Armature")
    arm = bpy.data.objects.new("Armature", data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    made = {}
    for name, head, tail, parent in bone_list(j, face):
        e = data.edit_bones.new(name)
        e.head, e.tail = head.tolist(), tail.tolist()
        if parent:
            e.parent = made[parent]
        made[name] = e
    bpy.ops.object.mode_set(mode="OBJECT")
    data.bones["Root"].use_deform = False
    return arm
```

### Task 3: Weights

**Files:**

- Modify: `assets/model_v2/build/rig.py` (append)

**Interfaces:**

- Consumes: `measure`, `build_armature` from Task 2; `base_mesh.vertices_in_sets`, `smooth_field`, `edges_of`.
- Produces: `spica-v2-rig.blend`, with every mesh skinned. `rig.write_group`, `rig.attach`, `rig.rigid`.

- [ ] **Step 1: Append the weights half of `rig.py`**

```python
NOT_IN_HEAT = ("J_Adj_", "J_Sec_")  # eyes keep their own weights, bust is a falloff, ponytail goes by its own line
NECK_TO_HEAD = (1.30, 1.345)  # her body's skin goes fully to the head bone by the height the face begins
BUST_RADIUS, BUST_INNER, BUST_SHARE = 0.085, 0.03, 0.8


def heat_weights(arm, body):
    """Blender's automatic weights, on a closed copy so the opening for her face cannot upset them. Same points, same order."""
    temp = body.copy()
    temp.data = body.data.copy()
    temp.name = "rig_temp"
    temp.modifiers.clear()
    bpy.context.scene.collection.objects.link(temp)
    b = bmesh.new()
    try:
        b.from_mesh(temp.data)
        made = bmesh.ops.holes_fill(b, edges=[e for e in b.edges if e.is_boundary], sides=0)["faces"]
        bmesh.ops.triangulate(b, faces=made)
        b.to_mesh(temp.data)
    finally:
        b.free()
    assert len(temp.data.vertices) == len(body.data.vertices)
    skip = [b.name for b in arm.data.bones if b.name.startswith(NOT_IN_HEAT)]
    for n in skip:
        arm.data.bones[n].use_deform = False
    bpy.ops.object.select_all(action="DESELECT")
    temp.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    for n in skip:
        arm.data.bones[n].use_deform = True
    bones = [b.name for b in arm.data.bones]
    col = {n: i for i, n in enumerate(bones)}
    W = np.zeros((len(temp.data.vertices), len(bones)), np.float32)
    by_group = {g.index: col[g.name] for g in temp.vertex_groups if g.name in col}
    for v in temp.data.vertices:
        for g in v.groups:
            if g.group in by_group:
                W[v.index, by_group[g.group]] = g.weight
    mesh = temp.data
    bpy.data.objects.remove(temp)
    bpy.data.meshes.remove(mesh)
    assert W.sum(1).min() > 1e-4, "automatic weights left %d points unweighted: try option C from the spec" % int((W.sum(1) <= 1e-4).sum())
    return W, bones, col


def finish(W, limit=4):
    W = W.copy()
    np.put_along_axis(W, np.argsort(W, axis=1)[:, :-limit], 0, 1)
    total = W.sum(1, keepdims=True)
    assert total.min() > 1e-6, "a point has no weight left"
    return W / total


class Skin:
    """Her body's weights, and which of its points belong to which limb."""

    def __init__(self, body, W, bones, col, j):
        self.p = bm.get_co(body)
        self.W, self.bones, self.col = W, bones, col
        self.in_sets = lambda sets: bm.vertices_in_sets(body, sets)
        self.side = {"L": self.p[:, 0] > 0, "R": self.p[:, 0] < 0}
        self.peak = j["Bust"]

    def part(self, *names):
        out = np.zeros(len(self.p), bool)
        for n in names:
            out |= self.in_sets(bm.PARTS[n])
        return out

    def clean(self):
        """Removes weights that automatic weighting bled across limbs; each limb keeps its own bones."""
        W, col = self.W, self.col
        def wipe(mask, names):
            W[np.ix_(mask, [col[n] for n in names if n in col])] = 0
        spine = [n for n in self.bones if n.startswith("J_Bip_C_")]
        fingers = lambda s, f: ["J_Bip_%s_%s%d" % (s, f, i) for i in (1, 2, 3)]
        for s, other in (("L", "R"), ("R", "L")):
            b = lambda n: "J_Bip_%s_%s" % (s, n)
            arm_here = self.part("arm", "hand") & self.side[s]
            shoulder = self.part("shoulder") & self.side[s]
            leg_here = self.part("leg", "foot") & self.side[s]
            below_arm = [b("LowerArm"), b("Hand")] + [n for f in FINGERS for n in fingers(s, f)]
            wipe(~arm_here, below_arm)
            wipe(~(arm_here | shoulder), [b("UpperArm")])
            wipe(~leg_here, [b("LowerLeg"), b("Foot"), b("ToeBase")])
            wipe(arm_here, spine)
            wipe(self.part("leg", "foot"), [b("Shoulder")])
            wipe(self.side[other], [b("UpperLeg"), b("Shoulder")])
            for finger, sets in FINGERS.items():
                here = self.in_sets(set(sets)) & self.side[s]
                wipe(here, [n for f in FINGERS if f != finger for n in fingers(s, f)])

    def neck_and_bust(self):
        W, col, p = self.W, self.col, self.p
        share = bd.smoothstep(NECK_TO_HEAD[0], NECK_TO_HEAD[1], p[:, 2])[:, None]
        W *= (1 - share).astype(np.float32)
        W[:, col["J_Bip_C_Head"]] += share[:, 0]
        torso = self.part("torso")
        for s, m in (("L", np.ones(3)), ("R", MIRROR)):
            d = np.linalg.norm(p - self.peak * m, axis=1)
            w = ((1 - bd.smoothstep(BUST_INNER, BUST_RADIUS, d)) * BUST_SHARE * (torso & self.side[s])).astype(np.float32)
            W *= (1 - w)[:, None]
            W[:, col["J_Sec_%s_Bust1" % s]] += 0.4 * w
            W[:, col["J_Sec_%s_Bust2" % s]] += 0.6 * w


def transfer(points, source_points, source_W, k=4):
    """Each point takes the blended weights of the nearest source points."""
    kd = KDTree(len(source_points))
    for i, c in enumerate(source_points.tolist()):
        kd.insert(c, i)
    kd.balance()
    out = np.zeros((len(points), source_W.shape[1]), np.float32)
    for i, c in enumerate(points.tolist()):
        for _, index, distance in kd.find_n(c, k):
            out[i] += source_W[index] / (distance + 1e-4)
    return out / out.sum(1, keepdims=True)


def write_group(ob, W, bones):
    for j in np.where((W > 0).any(0))[0]:
        g = ob.vertex_groups.new(name=bones[j])
        for i in np.where(W[:, j] > 0)[0]:
            g.add([int(i)], float(W[i, j]), "REPLACE")


def attach(ob, arm):
    mod = ob.modifiers.new("rig", "ARMATURE")
    mod.object = arm
    ob.modifiers.move(len(ob.modifiers) - 1, 0)
    ob.parent = arm
    ob.matrix_parent_inverse.identity()


def rigid(ob, arm, bone):
    ob.vertex_groups.new(name=bone).add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    attach(ob, arm)


def skin_cloth(ob, arm, skin, W, smooth=0):
    if smooth:
        W = bm.smooth_field(W, bm.edges_of(ob), np.ones(len(W), bool), smooth)
    W = finish(W)
    write_group(ob, W, skin.bones)
    attach(ob, arm)
    return W


def clothes(arm, skin):
    core = skin.part("torso", "shoulder", "neck") | ~skin.part("torso", "shoulder", "neck", "arm", "hand", "leg", "foot", "head")
    legs = skin.part("leg", "foot")
    ob = bpy.data.objects["hoodie"]
    points = bm.get_co(ob)
    flag = np.empty(len(points), np.float32)
    ob.data.attributes["arm"].data.foreach_get("value", flag)
    sleeve = flag > 0.5
    W = np.zeros((len(points), len(skin.bones)), np.float32)
    for s, sign in (("L", 1), ("R", -1)):
        here = sleeve & (points[:, 0] * sign > 0)
        src = skin.part("arm", "hand", "shoulder") & skin.side[s]
        W[here] = transfer(points[here], skin.p[src], skin.W[src])
    src = core | legs
    W[~sleeve] = transfer(points[~sleeve], skin.p[src], skin.W[src])
    hoodie_W = skin_cloth(ob, arm, skin, W, smooth=6)

    ob = bpy.data.objects["shorts"]
    points = bm.get_co(ob)
    W = np.zeros((len(points), len(skin.bones)), np.float32)
    for s, sign in (("L", 1), ("R", -1)):
        here = points[:, 0] * sign >= 0
        src = (skin.part("torso") | legs) & (skin.side[s] | skin.part("torso"))
        W[here] = transfer(points[here], skin.p[src], skin.W[src])
    skin_cloth(ob, arm, skin, W, smooth=4)

    stocking_W = None
    for name, s, parts in (("shorts_cuff_L", "L", ("leg",)), ("shorts_cuff_R", "R", ("leg",)), ("stocking", "L", ("leg", "foot")), ("ankle_sock", "R", ("leg", "foot")), ("sneaker_L", "L", ("foot",)), ("sneaker_R", "R", ("foot",))):
        ob = bpy.data.objects[name]
        src = skin.part(*parts) & skin.side[s]
        done = skin_cloth(ob, arm, skin, transfer(bm.get_co(ob), skin.p[src], skin.W[src]))
        if name == "stocking":
            stocking_W = done

    for name, under, under_W in (("zip_strip", "hoodie", hoodie_W), ("zip_slider", "hoodie", hoodie_W), ("accent_stocking_stars", "stocking", stocking_W)):
        ob = bpy.data.objects[name]
        skin_cloth(ob, arm, skin, transfer(bm.get_co(ob), bm.get_co(bpy.data.objects[under]), under_W))


def parent_to_bone(ob, arm, bone):
    """Keeps the object where it is. A bone child hangs off the bone's tail, hence the length."""
    bpy.context.view_layer.update()
    pb = arm.pose.bones[bone]
    inverse = (arm.matrix_world @ pb.matrix @ Matrix.Translation((0, pb.bone.length, 0))).inverted()
    ob.parent, ob.parent_type, ob.parent_bone = arm, "BONE", bone
    ob.matrix_parent_inverse = inverse


def face_parts(arm):
    for name in ("Face", "face_outline"):
        ob = bpy.data.objects[name]
        keep = {"J_Bip_C_Head", "J_Adj_L_FaceEye", "J_Adj_R_FaceEye"}  # outline_w is not a bone and stays
        for g in [g for g in ob.vertex_groups if g.name.startswith(("J_", "Root")) and g.name not in keep]:
            ob.vertex_groups.remove(g)
        attach(ob, arm)


def main():
    body, face = bpy.data.objects["Body"], bpy.data.objects["Face"]
    joints = measure(body)
    arm = build_armature(joints, face)
    W, bones, col = heat_weights(arm, body)
    skin = Skin(body, W, bones, col, joints)
    skin.clean()
    skin.neck_and_bust()
    skin.W = finish(skin.W)
    write_group(body, skin.W, bones)
    attach(body, arm)
    clothes(arm, skin)
    face_parts(arm)
    for name in ("hair_bob", "hair_ponytail", "hair_tie", "hair_star", "accent_face_mouth", "accent_tattoo"):
        rigid(bpy.data.objects[name], arm, "J_Bip_C_Head")
    parent_to_bone(bpy.data.objects["accent_binary"], arm, "J_Bip_C_Head")
    joint_sum = sum(float(np.abs(np.array(v)).sum()) for v in joints.values())
    print("RIG bones", len(bones), "joint sum", round(joint_sum, 5), "weight sum", round(float(skin.W.sum()), 2))
    bpy.ops.wm.save_as_mainfile(filepath=str(bm.ROOT / "spica-v2-rig.blend"))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it, twice, and confirm the same result**

```bash
"$B" -b assets/model_v2/spica-v2-accents.blend --python-exit-code 1 -P assets/model_v2/build/rig.py 2>&1 | grep -E "RIG|Error|Traceback|  File"
"$B" -b assets/model_v2/spica-v2-accents.blend --python-exit-code 1 -P assets/model_v2/build/rig.py 2>&1 | grep -E "RIG|Error"
```

Expected: two identical `RIG bones ... joint sum ... weight sum ...` lines, no traceback. If
automatic weights fail, the assertion names option C from the spec: **stop and tell Ethan** before
building it.

- [ ] **Step 3: Run the check on the rigged file**

Run: `"$B" -b assets/model_v2/spica-v2-rig.blend --python-exit-code 1 -P assets/model_v2/build/check_rig.py 2>&1 | grep -E "RIG|POSE|PROBLEM|CHECK|Traceback"`
Expected: `POSE` lines for all ten poses and `CHECK passed`. A `PROBLEM` is fixed at its root in
`rig.py`, except skin through cloth in `arms_up`, which is in the spec's risks: render it and ask.

### Task 4: Build wiring and stress renders

**Files:**

- Create: `assets/model_v2/build/run_rig_check.sh`, `assets/model_v2/build/compare_rest.py`
- Modify: `assets/model_v2/build/run.sh:7-12`

- [ ] **Step 1: Add the step to `run.sh`**

Change `WANT` to include `RIG` and the step list to
`for step in "body head" "head clothes" "clothes hair" "hair accents" "accents rig"; do`, and after
the loop add `cp "$ROOT/spica-v2-rig.blend" "$ROOT/spica-v2.blend"`. Task 7 replaces that line.

- [ ] **Step 2: Write `compare_rest.py`**

```python
# Compares two folders of renders of the same views and fails if her look changed.
import sys
from pathlib import Path

import numpy as np
from PIL import Image

before, after = map(Path, sys.argv[1:3])
worst = 0.0
for f in sorted(before.glob("*.png")):
    a = np.asarray(Image.open(f).convert("RGB"), float)
    b = np.asarray(Image.open(after / f.name).convert("RGB"), float)
    share = float((np.abs(a - b).max(2) > 8).mean())
    worst = max(worst, share)
    print(f.name, "pixels changed %.4f%%" % (share * 100))
assert worst < 0.002, "her look changed"
print("SAME")
```

- [ ] **Step 3: Write `run_rig_check.sh`**

```sh
#!/bin/sh
# Measures her rig, renders every stress pose, and compares her rest pose with the look before the rig.
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="$ROOT/spica-v2.blend"
R="$ROOT/renders/rig"
"$B" -b "$F" --python-exit-code 1 -P "$ROOT/build/check_rig.py" 2>&1 | grep -E "RIG|POSE|PROBLEM|CHECK|Traceback"
rm -rf "$R/after" "$R/poses"
"$B" -b "$F" --python-exit-code 1 -P "$ROOT/build/render.py" -- "$R/after" toon front,q,side,back,face 2>&1 | grep -E "Error|Traceback"
python -I "$ROOT/build/compare_rest.py" "$R/before" "$R/after"
for pose in a_pose arms_up arms_forward arms_crossed sit lean head_turn stride twist; do
  SPICA_POSE=$pose "$B" -b "$F" --python-exit-code 1 -P "$ROOT/build/render.py" -- "$R/poses/$pose" toon front,q,side 2>&1 | grep -E "Error|Traceback"
done
python -I "$ROOT/build/sheet.py" "$R/poses_front.png" 2400 5 "$R"/poses/*/front.png
python -I "$ROOT/build/sheet.py" "$R/poses_q.png" 2400 5 "$R"/poses/*/q.png
python -I "$ROOT/build/sheet.py" "$R/poses_side.png" 2400 5 "$R"/poses/*/side.png
```

- [ ] **Step 4: Run them and confirm the colour script still works**

```bash
cp assets/model_v2/spica-v2-rig.blend assets/model_v2/spica-v2.blend
sh assets/model_v2/build/run_rig_check.sh
sh assets/model_v2/build/run_colour_options.sh SPICA_HOODIE rig_test "cream F7F1E5,E9DFC9"
```

Expected: `CHECK passed`, `SAME`, three pose sheets in `renders/rig/`, and a colour sheet without error.

- [ ] **Step 5: CHECKPOINT 1. Show Ethan the three pose sheets and stop until he replies.**

---

## Checkpoint 2: swing

### Task 5: Ponytail chain

**Files:**

- Modify: `assets/model_v2/build/hair.py:541,678-685`, `assets/model_v2/build/rig.py`

- [ ] **Step 1: Keep each point's place along the hanging line**

In `hair.py`, `place_ponytail` returns `placed, ring_centre, out, radius, bob_tree, u`. In `main`,
unpack `(tie_point, normal, radius, bob_tree, chain_t)` and, after `pony_fade` is written, add:

```python
    pony.data.attributes.new("chain_t", "FLOAT", "POINT").data.foreach_set("value", chain_t.astype(np.float32))
```

- [ ] **Step 2: Add the chain to `rig.py`**

```python
PONY_BONES = 8
PONY_RIGID = 0.04  # the part at the tie, as a share of its length, stays on the head


def pony_t(pony):
    t = np.empty(len(pony.data.vertices), np.float32)
    pony.data.attributes["chain_t"].data.foreach_get("value", t)
    return t


def pony_nodes(pony):
    """Points through the final mesh's middle at even places along the hanging line."""
    p, t = bm.get_co(pony), pony_t(pony)
    half = 0.5 / PONY_BONES
    return [p[np.abs(t - i / PONY_BONES) <= half].mean(0) for i in range(PONY_BONES + 1)]


def pony_weights(pony, bones, col):
    t = pony_t(pony)
    W = np.zeros((len(t), len(bones)), np.float32)
    s = np.clip(t * PONY_BONES - 0.5, 0, PONY_BONES - 1)
    low = np.clip(s.astype(int), 0, PONY_BONES - 2)
    f = s - low
    for k in range(PONY_BONES - 1):
        a, b = col["J_Sec_Pony%d" % (k + 1)], col["J_Sec_Pony%d" % (k + 2)]
        here = low == k
        W[here, a] += (1 - f[here])
        W[here, b] += f[here]
    head = (1 - bd.smoothstep(0.0, PONY_RIGID, t)).astype(np.float32)
    W *= (1 - head)[:, None]
    W[:, col["J_Bip_C_Head"]] += head
    return W
```

In `bone_list`, before `return out`, add:

```python
    nodes = pony_nodes(bpy.data.objects["hair_ponytail"])
    for k in range(PONY_BONES):
        out.append(("J_Sec_Pony%d" % (k + 1), nodes[k], nodes[k + 1], "J_Sec_Pony%d" % k if k else "J_Bip_C_Head"))
```

In `main`, remove `"hair_ponytail"` from the rigid list and add:

```python
    pony = bpy.data.objects["hair_ponytail"]
    write_group(pony, finish(pony_weights(pony, bones, col)), bones)
    attach(pony, arm)
```

- [ ] **Step 3: Rebuild from hair and re-run the rig check**

```bash
for step in "clothes hair" "hair accents" "accents rig"; do set -- $step
  "$B" -b "assets/model_v2/spica-v2-$1.blend" --python-exit-code 1 -P "assets/model_v2/build/$2.py" 2>&1 | grep -E "RIG|Error|Traceback"
done
cp assets/model_v2/spica-v2-rig.blend assets/model_v2/spica-v2.blend
sh assets/model_v2/build/run_rig_check.sh
```

Expected: `CHECK passed` and `SAME`.

### Task 6: Swing and the binary star

**Files:**

- Create: `assets/model_v2/build/spring.py`, `assets/model_v2/build/check_spring.py`
- Modify: `assets/model_v2/build/rig.py` (`main`)

**Interfaces:**

- Produces: `spring.bake(arm, f0, f1)`, `spring.chains(arm)`.

- [ ] **Step 1: Write the failing check**

```python
# Tests her swing and the binary star: lag, settling, the same result twice, the tail out of her body.
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spring

arm = bpy.data.objects["Armature"]
sc = bpy.context.scene
star = bpy.data.objects["accent_orb_heavy"]
sc.frame_set(1)
at_one = star.matrix_world.translation.copy()
sc.frame_set(25)
assert (star.matrix_world.translation - at_one).length > 0.005, "the binary star does not orbit"
sc.frame_set(97)
assert (star.matrix_world.translation - at_one).length < 1e-4, "one orbit should take 96 frames"

head = arm.pose.bones["J_Bip_C_Head"]
head.rotation_mode = "XYZ"
for f, deg in ((1, 0), (8, 40), (30, 40)):
    head.rotation_euler = (0, 0, math.radians(deg))
    head.keyframe_insert("rotation_euler", frame=f)
spring.bake(arm, 1, 60)


def tip(f):
    sc.frame_set(f)
    bpy.context.view_layer.update()
    return (arm.matrix_world @ arm.pose.bones["J_Sec_Pony8"].tail).copy()


assert (tip(8) - tip(60)).length > 0.01, "the ponytail does not lag"
assert (tip(58) - tip(60)).length < 0.002, "the ponytail has not settled"
first = [tip(f) for f in (8, 20, 40)]
spring.bake(arm, 1, 60)
second = [tip(f) for f in (8, 20, 40)]
assert max((a - b).length for a, b in zip(first, second)) < 1e-5, "two bakes differ"
sc.frame_set(20)
bpy.context.view_layer.update()
tree = spring.solid_tree()
for chain, kind in spring.chains(arm):
    for b in chain:
        if kind is spring.PONY:
            tail = arm.matrix_world @ arm.pose.bones[b.name].tail
            loc, nrm, _, _ = tree.find_nearest(tail)
            assert (tail - loc).dot(nrm) > -0.002, b.name + " is inside her"
print("SPRING passed")
```

Run on `spica-v2-rig.blend`. Expected: `ModuleNotFoundError: No module named 'spring'`.

- [ ] **Step 2: Write `spring.py`**

```python
# Swing for her ponytail and bust: a spring solver baked into pose keys, trimmed from v1's.
# Each chain tip is pulled back to rest, carried by its own inertia, held at bone length, and kept out of her. 24 fps.
import math

import bpy
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

# stiffness: share of the way back to rest per frame; drag: speed lost per frame; cone: most it may swing (degrees); margin: gap kept from her (m)
PONY = dict(stiffness=0.06, drag=0.30, cone=35, margin=0.010)
BUST = dict(stiffness=0.20, drag=0.45, cone=15, margin=0.0)
SOLID = ("Body", "Face", "hoodie", "hair_bob")
ROOTS = (("J_Sec_Pony1", PONY), ("J_Sec_L_Bust1", BUST), ("J_Sec_R_Bust1", BUST))


def chains(arm):
    out = []
    for name, kind in ROOTS:
        chain = [arm.data.bones[name]]
        while chain[-1].children:
            chain.append(chain[-1].children[0])
        out.append((chain, kind))
    return out


def clear(arm):
    """Removes earlier swing keys, so baking twice gives the same result."""
    act = arm.animation_data.action if arm.animation_data else None
    if act:
        for layer in act.layers:
            for strip in layer.strips:
                bag = strip.channelbag(arm.animation_data.action_slot)
                for fc in [f for f in bag.fcurves if f.data_path.startswith('pose.bones["J_Sec')]:
                    bag.fcurves.remove(fc)
    for pb in arm.pose.bones:
        if pb.name.startswith("J_Sec"):
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = (1, 0, 0, 0)


def solid_tree():
    depsgraph = bpy.context.evaluated_depsgraph_get()
    verts, tris = [], []
    for name in SOLID:
        o = bpy.data.objects[name]
        ev = o.evaluated_get(depsgraph)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        base = len(verts)
        verts += [o.matrix_world @ v.co for v in me.vertices]
        tris += [tuple(base + k for k in t.vertices) for t in me.loop_triangles]
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, tris)


def clearance(tree, p):
    loc, nrm, _, _ = tree.find_nearest(p)
    return nrm, (p - loc).dot(nrm)


def bake(arm, f0, f1):
    clear(arm)
    scene = bpy.context.scene
    cs = chains(arm)
    mw = arm.matrix_world
    state = {}
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        bpy.context.view_layer.update()
        tree = solid_tree()
        for chain, k in cs:
            parent_world = mw @ arm.pose.bones[chain[0].parent.name].matrix
            parent_rest = chain[0].parent.matrix_local
            for b in chain:
                rest = parent_world @ (parent_rest.inverted() @ b.matrix_local)
                head, length = rest.translation, b.length
                along = (rest.to_3x3() @ Vector((0, 1, 0))).normalized()
                target = head + along * length
                tail, prev = state.get(b.name, (target.copy(), target.copy()))
                if f == f0:
                    tail = prev = target.copy()
                nxt = tail + (tail - prev) * (1 - k["drag"]) + (target - tail) * k["stiffness"]
                q = along.rotation_difference((nxt - head).normalized())
                if q.angle > math.radians(k["cone"]):
                    q = Quaternion().slerp(q, math.radians(k["cone"]) / q.angle)
                nxt = head + (q @ along) * length
                state[b.name] = (nxt, tail)  # the free motion: collision only corrects what is keyed, so it can never stick
                if k["margin"]:
                    _, rigid_gap = clearance(tree, target)
                    nrm, gap = clearance(tree, nxt)
                    allowed = min(k["margin"], rigid_gap)
                    if gap < allowed:
                        q = along.rotation_difference((nxt + nrm * (allowed - gap) - head).normalized())
                basis = rest.to_3x3().normalized()
                local = (basis.inverted() @ q.to_matrix() @ basis).to_quaternion()
                pb = arm.pose.bones[b.name]
                pb.rotation_mode = "QUATERNION"
                pb.rotation_quaternion = local
                pb.keyframe_insert("rotation_quaternion", frame=f)
                parent_world, parent_rest = rest @ local.to_matrix().to_4x4(), b.matrix_local
```

- [ ] **Step 3: Make the binary star orbit**

Add to `rig.py`, and call `orbit()` in `main` before saving:

```python
def orbit():
    """One empty turning the pair about the line through them. Frame 1 is the pose of her still."""
    pivot = bpy.data.objects["accent_binary"]
    spin = bpy.data.objects.new("accent_spin", None)
    bpy.context.scene.collection.objects.link(spin)
    for child in list(pivot.children):
        child.parent = spin
    spin.parent = pivot
    fc = spin.driver_add("rotation_euler", 2)
    fc.driver.type = "SCRIPTED"
    fc.driver.expression = "(frame - 1) * 6.283185307 / 96"
```

- [ ] **Step 4: Run, then re-check the rest pose**

```bash
"$B" -b assets/model_v2/spica-v2-accents.blend --python-exit-code 1 -P assets/model_v2/build/rig.py 2>&1 | grep -E "RIG|Error|Traceback"
"$B" -b assets/model_v2/spica-v2-rig.blend --python-exit-code 1 -P assets/model_v2/build/check_spring.py 2>&1 | grep -E "SPRING|Assert|Error"
cp assets/model_v2/spica-v2-rig.blend assets/model_v2/spica-v2.blend
sh assets/model_v2/build/run_rig_check.sh
```

Expected: `SPRING passed`, `CHECK passed`, `SAME`.

- [ ] **Step 5: Render rigid beside sprung**

Create `assets/model_v2/build/spring_demo.py`:

```python
# Keys a head shake and a jump, bakes the swing, and saves a demo file to render at chosen frames. Args after --: <out .blend>
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import spring

arm = bpy.data.objects["Armature"]
head, root = arm.pose.bones["J_Bip_C_Head"], arm.pose.bones["Root"]
head.rotation_mode = "XYZ"
for f, deg in ((1, 0), (8, 40), (16, -40), (24, 0)):
    head.rotation_euler = (0, 0, math.radians(deg))
    head.keyframe_insert("rotation_euler", frame=f)
for f, z in ((24, 0), (32, 0.25), (40, 0)):
    root.location = (0, 0, z)
    root.keyframe_insert("location", frame=f)
if "sprung" in sys.argv:
    spring.bake(arm, 1, 56)
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[sys.argv.index("--") + 1])
```

Render frames 8, 16, 28, 34 and 44 at views `q,side` from both files with `SPICA_FRAME`, into
`renders/rig/swing/{rigid,sprung}/<frame>/`, and tile them with `sheet.py` into `renders/rig/swing.png`.

- [ ] **Step 6: CHECKPOINT 2. Show Ethan `swing.png` and stop until he replies.**

---

## Checkpoint 3: expressions

### Task 7: Expressions

**Files:**

- Create: `assets/model_v2/build/expressions.py`, `assets/model_v2/build/face_expr.py`,
  `assets/model_v2/build/check_expressions.py`, `assets/model_v2/build/expr_review.py`
- Modify: `assets/model_v2/build/run.sh`

**Interfaces:**

- Produces: `face_expr.use(name)`, `face_expr.NAMES`; final `spica-v2.blend`.

- [ ] **Step 1: Write the failing check**

```python
# Tests her expressions: every key exists on her face and its shells, the tattoo stays on her cheek in a head turn.
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import face_expr
import rig_poses as rp


def evaluated(ob):
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    ev.to_mesh_clear()
    return a.reshape(-1, 3)


face, tattoo = bpy.data.objects["Face"], bpy.data.objects["accent_tattoo"]
arm = bpy.data.objects["Armature"]
keys = {k.name for k in face.data.shape_keys.key_blocks}
assert len(keys) == 224, "Face has %d keys" % len(keys)
for name in ("face_outline", "mouth_outline", "accent_tattoo"):
    assert len(bpy.data.objects[name].data.shape_keys.key_blocks) == 224, name
assert len(face_expr.NAMES) == 25
for name, e in face_expr.expr_defs.EXPRESSIONS.items():
    missing = [k for k in e["keys"] if k not in keys]
    assert not missing, (name, missing)


def tattoo_gap():
    f, t = evaluated(face), evaluated(tattoo)
    kd = KDTree(len(f))
    for i, c in enumerate(f.tolist()):
        kd.insert(c, i)
    kd.balance()
    return max(kd.find(c)[2] for c in t.tolist())


face_expr.use("neutral")
bpy.context.view_layer.update()
rest = tattoo_gap()
for expression in ("pout", "happy"):
    face_expr.use(expression)
    rp.apply(arm, "head_turn")
    bpy.context.view_layer.update()
    assert tattoo_gap() < rest + 0.0015, "the tattoo left her cheek in " + expression
rp.reset(arm)
print("EXPRESSIONS passed")
```

Run on `spica-v2-rig.blend`. Expected: `ModuleNotFoundError: No module named 'face_expr'`.

- [ ] **Step 2: Write `face_expr.py`**

```python
# Switches her face to one of her 25 expressions in any session with the built model. The table is v1's expr_defs.py.
#     import face_expr; face_expr.use("smug")
import json
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
TEX = HERE.parent.parent / "model" / "tex" / "face"
sys.path.append(str(HERE.parent.parent / "model" / "build"))
import expr_defs  # noqa: E402

NAMES = list(expr_defs.EXPRESSIONS)
FOLLOWERS = ("face_outline", "mouth_outline", "accent_tattoo")
MOUTH = "N00_000_00_FaceMouth_00_FACE"
DRAWN = set(json.loads((TEX / "decal.json").read_text())["back"])


def set_overlay(items):
    nodes = bpy.data.materials["face_skin"].node_tree.nodes
    if items:
        name, strength = items[0]
        image = bpy.data.images.get(name) or bpy.data.images.load(str(TEX / name))
        image.alpha_mode = "STRAIGHT"
        nodes["overlay_tex"].image = image
        nodes["overlay_k"].inputs[1].default_value = strength
    else:
        nodes["overlay_k"].inputs[1].default_value = 0.0


def show_drawn(name):
    ob = bpy.data.objects["accent_face_mouth"]
    ob.hide_render = name not in DRAWN
    if name in DRAWN:
        image = bpy.data.images.load(str(TEX / (name + ".png")), check_existing=True)
        image.alpha_mode = "STRAIGHT"
        ob.data.materials[0].node_tree.nodes["Image Texture"].image = image


def use(name):
    e = expr_defs.EXPRESSIONS[name]
    face = bpy.data.objects["Face"]
    keys = face.data.shape_keys.key_blocks
    for k in keys:
        if k.name != "Basis":
            k.value = 0.0
    for key, percent in e["keys"].items():
        keys[key].value = percent / 100.0
    for follower in FOLLOWERS:
        for k in bpy.data.objects[follower].data.shape_keys.key_blocks:
            if k.name != "Basis":
                k.value = keys[k.name].value
    mouth = e.get("mesh_mouth", True)
    face.material_slots[0].material = bpy.data.materials[MOUTH if mouth else "face_hidden"]
    bpy.data.objects["mouth_outline"].hide_render = not mouth
    set_overlay(e.get("overlays", []))
    show_drawn(name)
```

- [ ] **Step 3: Write `expressions.py`**

```python
# Gives v2 v1's expressions: all its shape keys, its finished mouth and the outline that follows it. Runs on spica-v2-rig.blend, saves spica-v2.blend.
# The two faces match point for point, so each key is v1's offset, resized to her head.
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import face_expr
import v1_face as vf

MOUTH_LINE = 0.0013  # the thin line of a closed mouth, as v1


def nearest_map(points, source):
    kd = KDTree(len(source))
    for i, c in enumerate(source.tolist()):
        kd.insert(c, i)
    kd.balance()
    return np.array([kd.find(c)[1] for c in points.tolist()])


def set_key(ob, name, co, like):
    key = ob.data.shape_keys.key_blocks.get(name) or ob.shape_key_add(name=name, from_mix=False)
    key.value = 0.0
    key.slider_min, key.slider_max = like.slider_min, like.slider_max
    key.data.foreach_set("co", co.astype(np.float32).ravel())


def carry_keys(face, v1):
    """Takes the lid out of her base shape, then writes every v1 key on her face and on what follows it. Returns her open base."""
    base1 = vf.key_positions(v1.data, "Basis")
    close = vf.key_positions(v1.data, "Fcl_EYE_Close") - base1
    old = vf.key_positions(face.data, "Basis")
    features = vf.feature_points(face.data)
    source = (base1 + vf.LIDS * close)[features]
    scale, shift = vf.fitted_scale(source, old[features])
    misfit = float(np.abs(source * scale + shift - old[features]).max())
    assert misfit < 3e-4, "her features no longer match v1's (%.5f)" % misfit
    opened = old - vf.LIDS * close * scale

    outline, tattoo = bpy.data.objects["face_outline"], bpy.data.objects["accent_tattoo"]
    skin = np.array(sorted({v for p in face.data.polygons if p.material_index == vf.SKIN_SLOT for v in p.vertices}))
    outline_map = nearest_map(bm.get_co(outline), old)
    tattoo_map = skin[nearest_map(bm.get_co(tattoo), old[skin])]
    outline_base = bm.get_co(outline) - vf.LIDS * (close * scale)[outline_map]
    tattoo_base = bm.get_co(tattoo)
    if not tattoo.data.shape_keys:
        tattoo.shape_key_add(name="Basis", from_mix=False)

    for ob, base in ((face, opened), (outline, outline_base)):
        bm.set_co(ob, base)
        ob.data.shape_keys.key_blocks["Basis"].data.foreach_set("co", base.astype(np.float32).ravel())
    for key in v1.data.shape_keys.key_blocks:
        if key.name == "Basis":
            continue
        offset = (vf.key_positions(v1.data, key.name) - base1) * scale
        set_key(face, key.name, opened + offset, key)
        set_key(outline, key.name, outline_base + offset[outline_map], key)
        set_key(tattoo, key.name, tattoo_base + offset[tattoo_map], key)


def bring_materials():
    with bpy.data.libraries.load(str(vf.V1_FILE), link=False) as (_, wanted):
        wanted.materials = [face_expr.MOUTH, "mouth_outline", "clear"]
    for m in wanted.materials:
        m.use_fake_user = True
    bpy.data.materials["face_hidden"].use_fake_user = True
    return wanted.materials


def is_tooth(face, uv):
    """The teeth sample the white block of the mouth picture; they carry no outline."""
    u = sum(l[uv].uv.x for l in face.loops) / len(face.loops)
    v = sum(l[uv].uv.y for l in face.loops) / len(face.loops)
    return u < 0.22 and v > 0.5


def mouth_outline(face, line, clear):
    hull = face.copy()
    hull.data = face.data.copy()
    hull.name = hull.data.name = "mouth_outline"
    face.users_collection[0].objects.link(hull)
    b = bmesh.new()
    try:
        b.from_mesh(hull.data)
        uv = b.loops.layers.uv.active
        bmesh.ops.delete(b, geom=[f for f in b.faces if f.material_index != 0 or is_tooth(f, uv)], context="FACES")
        for v in [v for v in b.verts if not v.link_faces]:
            b.verts.remove(v)
        for f in b.faces:
            f.material_index = 0
        b.to_mesh(hull.data)
    finally:
        b.free()
    hull.data.materials.clear()
    hull.data.materials.append(clear)
    hull.data.materials.append(line)
    mod = hull.modifiers.new("outline", "SOLIDIFY")
    mod.thickness, mod.offset, mod.use_flip_normals, mod.material_offset = MOUTH_LINE, 1.0, True, 1


def add_overlay():
    """One picture laid over her skin by UV, for the tears, the shadow and the eyebags."""
    t = bpy.data.materials["face_skin"].node_tree
    emit = next(n for n in t.nodes if n.type == "EMISSION")
    link = next(l for l in t.links if l.to_node == emit and l.to_socket.name == "Color")
    before = link.from_socket
    t.links.remove(link)
    tex = t.nodes.new("ShaderNodeTexImage")
    tex.name, tex.extension = "overlay_tex", "CLIP"
    k = t.nodes.new("ShaderNodeMath")
    k.name, k.operation = "overlay_k", "MULTIPLY"
    k.inputs[1].default_value = 0.0
    mix = t.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    t.links.new(tex.outputs["Alpha"], k.inputs[0])
    t.links.new(k.outputs["Value"], mix.inputs["Factor"])
    t.links.new(before, mix.inputs["A"])
    t.links.new(tex.outputs["Color"], mix.inputs["B"])
    t.links.new(mix.outputs["Result"], emit.inputs["Color"])


def main():
    face = bpy.data.objects["Face"]
    with bpy.data.libraries.load(str(vf.V1_FILE), link=False) as (_, wanted):
        wanted.objects = ["Face"]
    v1 = wanted.objects[0]
    carry_keys(face, v1)
    armature = v1.parent
    bpy.data.objects.remove(v1)
    if armature is not None:
        bpy.data.objects.remove(armature)
    mouth, line, clear = bring_materials()
    assert mouth.name == face_expr.MOUTH, "a material of that name was already in the file: " + mouth.name
    mouth_outline(face, line, clear)
    add_overlay()
    face_expr.use("neutral")
    print("EXPR keys", len(face.data.shape_keys.key_blocks))
    bpy.ops.wm.save_as_mainfile(filepath=str(bm.ROOT / "spica-v2.blend"))


if __name__ == "__main__":
    main()
```

`wanted.materials` holds the order of the names asked for, so `mouth, line, clear` unpack correctly.

- [ ] **Step 4: Write `expr_review.py`**

```python
# Renders all her expressions, one picture each. Read-only on the .blend. Args after --: <output dir>
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import face_expr

out = Path(sys.argv[sys.argv.index("--") + 1])
out.mkdir(parents=True, exist_ok=True)
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.render.resolution_x = sc.render.resolution_y = 600
world = bpy.data.worlds.new("review")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.84, 0.84, 0.89, 1)
sc.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy, sun.data.angle = 3.0, 0.03
sun.rotation_euler = (math.radians(33), 0, math.radians(-22))
sc.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type, cam.data.ortho_scale = "ORTHO", 0.30
cam.location = Vector((0, -6.05, 1.445))
cam.rotation_euler = (math.radians(90), 0, 0)
sc.collection.objects.link(cam)
sc.camera = cam
for name in face_expr.NAMES:
    face_expr.use(name)
    sc.render.filepath = str(out / ("face-%s.png" % name))
    bpy.ops.render.render(write_still=True)
print("RENDERED", len(face_expr.NAMES))
```

- [ ] **Step 5: Wire, run and check**

In `run.sh`, add `EXPR` to `WANT`, extend the steps with `"rig expressions"`, and delete the
`cp ... spica-v2.blend` line from Task 4. Then:

```bash
"$B" -b assets/model_v2/spica-v2-rig.blend --python-exit-code 1 -P assets/model_v2/build/expressions.py 2>&1 | grep -E "EXPR|Error|Traceback|  File"
"$B" -b assets/model_v2/spica-v2.blend --python-exit-code 1 -P assets/model_v2/build/check_expressions.py 2>&1 | grep -E "EXPRESSIONS|Assert|Error"
sh assets/model_v2/build/run_rig_check.sh
"$B" -b assets/model_v2/spica-v2.blend --python-exit-code 1 -P assets/model_v2/build/expr_review.py -- assets/model_v2/renders/expr 2>&1 | grep -E "RENDERED|Error"
python -I assets/model/build/expr_sheet.py assets/model_v2/renders/expr face
```

Expected: `EXPR keys 224`, `EXPRESSIONS passed`, `CHECK passed`, `SAME` (this proves neutral matches
today's face), `RENDERED 25`, and the sheets. Render v1's beside them with
`blender -b assets/model/spica-v1.blend -P assets/model/build/expressions.py -- assets/model/renders/expr`.

- [ ] **Step 6: CHECKPOINT 3. Show Ethan both sets of sheets, noting blush and tears. Stop until he replies.**

### Task 8: From nothing, and paperwork

**Files:**

- Delete: `assets/model_v2/build/pose.py`, `assets/model_v2/build/run_pose.sh`
- Modify: `CLAUDE.md`, `README.md`, `DECISIONS.md`, `docs/orbit/o1-v2-rig-spec.md`

- [ ] **Step 1: Full rebuild**

Run: `sh assets/model_v2/build/run.sh && sh assets/model_v2/build/run_rig_check.sh`
Expected: `RIG`, `EXPR keys 224`, `CHECK passed`, `SAME`.

- [ ] **Step 2: Update the docs**

Delete `pose.py` and `run_pose.sh`. In `CLAUDE.md`, replace "No rig or expressions yet." with the
build, check and `face_expr.use` commands, and set the next stage to clips and sprites. Add rows to
`DECISIONS.md` for: rest pose stays arms-down; `Body` skin goes fully to the head bone at the face
join; one overlay slot; the bob stays stiff. Set the spec's status to built. Tell Ethan the work is
ready for him to decide about committing.
