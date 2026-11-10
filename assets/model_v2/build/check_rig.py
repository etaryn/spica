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
NECKLINE_X, NECKLINE_Z = 0.07, 1.16  # the open V at the front of her hoodie
SKIN_SHOWING_MOST = 70  # rays on a 5 mm grid from four sides: under this is the forearm down the cuff and the open V when she leans
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
hoodie = bpy.data.objects["hoodie"]
skin_at, cloth_at = bm.get_co(body), bm.get_co(hoodie)
tree = BVHTree.FromPolygons(
    np.vstack([skin_at, cloth_at]).tolist(),
    [list(p.vertices) for p in body.data.polygons] + [[len(skin_at) + v for v in p.vertices] for p in hoodie.data.polygons],
    all_triangles=False,
)  # with the hidden skin gone, a joint is inside her if it is inside her skin or her hoodie
for b in arm.data.bones:
    if b.name.startswith("J_Bip"):
        head = b.head_local
        if not all(tree.ray_cast(head, w * Vector((0, 1, 0) if "Arm" in b.name else (1, 0, 0)))[0] for w in (1, -1)):  # her arms lie along x, so across them is y
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


COVERED_SETS = {s for part in ("torso", "shoulder", "arm") for s in bm.PARTS[part]}


def skin_showing():
    """Looks at her from all four sides on a 5 mm grid and counts the rays whose first hit is skin the hoodie should cover."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    points, tris = [], []
    body_tris, sets = 0, []
    for o in (body, hoodie):
        ev = o.evaluated_get(depsgraph)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        base = len(points)
        points += [v.co.copy() for v in me.vertices]
        tris += [tuple(base + k for k in t.vertices) for t in me.loop_triangles]
        if o is body:
            body_tris = len(me.loop_triangles)
            fs = np.empty(len(me.polygons), np.int32)
            me.attributes[".sculpt_face_set"].data.foreach_get("value", fs)
            sets = [int(fs[t.polygon_index]) for t in me.loop_triangles]
        ev.to_mesh_clear()
    scene = BVHTree.FromPolygons(points, tris)
    count = 0
    for z in np.arange(0.99, 1.33, 0.005):
        for across in np.arange(-0.40, 0.4001, 0.005):
            for origin, way in (((across, -1.0, z), (0, 1, 0)), ((across, 1.0, z), (0, -1, 0)), ((-1.0, across, z), (1, 0, 0)), ((1.0, across, z), (-1, 0, 0))):
                hit, _, index, _ = scene.ray_cast(origin, way)
                if hit is None or index >= body_tris or sets[index] not in COVERED_SETS:
                    continue
                was = skin_at[tris[index][0]]  # where this skin is in her rest pose, because the V moves with her when she leans
                if was[1] < -0.03 and abs(was[0]) < NECKLINE_X and was[2] > NECKLINE_Z:
                    continue  # the open V of her hoodie shows skin on purpose
                count += 1
    return count


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
        if (pct > 10 and name != "hoodie") or stretch > {"arms_up": 8, "arms_overhead": 9, "arms_down": 9, "a_pose": 9}.get(pose, 6):  # the hoodie's skin is partly gone, so skin_showing measures it instead  # arms straight up is the hardest bend from arms hanging: the spec's named risk
            bad("%s: %s is %.1f%% inside skin, stretched x%.1f" % (pose, name, pct, stretch))
    showing = skin_showing()
    if showing > SKIN_SHOWING_MOST:
        bad("%s: %d rays see skin the hoodie should cover" % (pose, showing))
    print("POSE", pose, "skin seen %d" % showing, "neck %.2fmm" % (np.abs(gap).max() * 1000), " ".join(row))
rp.reset(arm)
if problems:
    raise RuntimeError("%d problems" % len(problems))
print("CHECK passed")
