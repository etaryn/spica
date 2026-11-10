# Tests her cloth shapes: they exist, are silent at rest, switch on in the key poses, and ease the bend at her armpit.
# Run: blender -b assets/model_v2/spica-v2-drape.blend --python-exit-code 1 -P assets/model_v2/build/check_drape.py
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import drape
import rig_poses as rp

KEYS = ("arms_forward", "arms_up", "arms_overhead")
LIMITS = {"arms_forward": 6.0, "arms_up": 8.0, "arms_overhead": 9.0}  # the most any single cloth edge of 4 mm or more may stretch: a guard against tearing, not a measure of how good it looks
MOST_MOVE = 0.20  # no shape moves cloth further than this
ARMPIT_X, ARMPIT_Z = (0.07, 0.20), (1.04, 1.34)  # round her armpit, in her rest pose
LINE_MOST = 0.25  # how much of the drawn outline may remain where her armpit creases
HARD_EXTRA = 10  # how many more hard edges than at rest a raised arm may have

arm = bpy.data.objects["Armature"]
hoodie = bpy.data.objects["hoodie"]
assert hoodie.data.shape_keys, "the hoodie has no cloth shapes"
blocks = hoodie.data.shape_keys.key_blocks
names = ["cloth_%s_%s" % (side, pose) for side in "LR" for pose in KEYS]
for n in names:
    assert n in blocks, "missing shape " + n
for m in hoodie.modifiers:
    if m.type in ("SOLIDIFY", "SUBSURF"):
        m.show_viewport = False
base = bm.get_co(hoodie)
for n in names:
    co = np.empty(len(base) * 3)
    blocks[n].data.foreach_get("co", co)
    move = float(np.linalg.norm(co.reshape(-1, 3) - base, axis=1).max())
    assert np.isfinite(move) and 0.002 < move < MOST_MOVE, "%s moves cloth by %.4f" % (n, move)


HARD_ANGLE = np.radians(55)  # two neighbouring faces meeting more sharply than this read as a hard edge
x_, z_ = np.abs(base[:, 0]), base[:, 2]
in_zone = (x_ > ARMPIT_X[0]) & (x_ < ARMPIT_X[1]) & (z_ > ARMPIT_Z[0]) & (z_ < ARMPIT_Z[1])
faces_of = {}
for f in hoodie.data.polygons:
    for key in f.edge_keys:
        faces_of.setdefault(key, []).append(f.index)
shared = [(key, fs) for key, fs in faces_of.items() if len(fs) == 2 and in_zone[key[0]] and in_zone[key[1]]]
neighbours = np.array([fs for _, fs in shared])
shared_edges = np.array([key for key, _ in shared])
creased = np.zeros(len(base), bool)


def hard_edges(record=False):
    """How many edges round her armpit are sharp creases, with the arm where it is now."""
    ev = hoodie.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    n = np.empty(len(me.polygons) * 3)
    me.polygon_normals.foreach_get("vector", n)
    ev.to_mesh_clear()
    n = n.reshape(-1, 3)
    sharp = np.arccos(np.clip((n[neighbours[:, 0]] * n[neighbours[:, 1]]).sum(1), -1, 1)) > HARD_ANGLE
    if record:
        creased[shared_edges[sharp].ravel()] = True
    return int(sharp.sum())


def stretch_now(rest):
    ev = hoodie.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    ev.to_mesh_clear()
    a = a.reshape(-1, 3)
    edges = bm.edges_of(hoodie)
    lengths = np.linalg.norm(a[edges[:, 0]] - a[edges[:, 1]], axis=1)
    ok = rest > 0.004
    return float((lengths[ok] / rest[ok]).max())


edges = bm.edges_of(hoodie)
rest_len = np.linalg.norm(base[edges[:, 0]] - base[edges[:, 1]], axis=1)
rp.reset(arm)
bpy.context.view_layer.update()
for n in names:
    assert blocks[n].value < 1e-4, "%s is on at rest (%.3f)" % (n, blocks[n].value)
hard_at_rest = hard_edges()
problems = []
for pose in KEYS:
    rp.apply(arm, pose)
    bpy.context.view_layer.update()
    bpy.context.view_layer.update()
    for side in "LR":
        value = blocks["cloth_%s_%s" % (side, pose)].value
        if value < 0.9:
            problems.append("%s: shape %s is only at %.2f" % (pose, side, value))
    stretch = stretch_now(rest_len)
    hard = hard_edges(record=True)
    print("DRAPE", pose, "stretch x%.1f" % stretch, "limit x%.1f" % LIMITS[pose], "hard edges at the armpit %d (at rest %d)" % (hard, hard_at_rest))
    if hard > hard_at_rest + HARD_EXTRA:
        problems.append("%s has %d hard edges at the armpit, %d at rest" % (pose, hard, hard_at_rest))
    if stretch > LIMITS[pose]:
        problems.append("%s stretches x%.1f" % (pose, stretch))
free = drape.pin_weights(hoodie, base, edges)[0] < 0.5
group = hoodie.vertex_groups["outline_w"]
line = []
for i in np.where(creased & free)[0]:
    for g in hoodie.data.vertices[int(i)].groups:
        if g.group == group.index:
            line.append(g.weight)
line_there = float(np.mean(line)) if line else 0.0
print("DRAPE outline at the armpit creases %.2f of full" % line_there)
if line_there > LINE_MOST:
    problems.append("the outline at her armpit creases is at %.2f" % line_there)
rp.reset(arm)
if problems:
    raise RuntimeError("; ".join(problems))
print("DRAPE passed")
