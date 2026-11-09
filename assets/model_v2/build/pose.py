# Review only: lifts her arms and the hoodie's sleeves into an A-pose so the clothes can be seen clearly.
# There is no rig yet, so this bends the meshes directly. Args after --: <output .blend>
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import body as bd

LIFT = 34.0  # degrees the arms are raised
SHOULDER = np.array([0.125, 0.016, 1.235])
ARM_DIRECTION = np.array([0.26, -0.03, -0.965])  # how the arm hangs before lifting


def along_arm(points, side):
    pivot = SHOULDER * np.array([side, 1, 1])
    return pivot, (points - pivot) @ (ARM_DIRECTION * np.array([side, 1, 1]))


def lift(points, weight, side):
    """Rotates points outward about the shoulder, each by its own share of the lift."""
    pivot, _ = along_arm(points, side)
    angle = math.radians(LIFT) * -side * weight
    r = points - pivot
    c, s = np.cos(angle), np.sin(angle)
    out = points.copy()
    out[:, 0] = pivot[0] + r[:, 0] * c + r[:, 2] * s
    out[:, 2] = pivot[2] - r[:, 0] * s + r[:, 2] * c
    return out


def body_arm_weight(p, side):
    """Her arm, told apart from her torso by how far out it is at each height."""
    table = np.array(bd.TORSO)
    limit = np.where(p[:, 2] < 0.85, 0.165, np.interp(p[:, 2], table[:, 0], table[:, 1]) + 0.012)
    arm = (p[:, 0] * side > limit) & (p[:, 2] < 1.29)
    _, t = along_arm(p, side)
    return arm * bd.smoothstep(-0.01, 0.07, t)


def hide_under_sleeves(body, before):
    """Removes the skin the bend would push through the cloth at the armpits. This file is only for pictures."""
    b = bmesh.new()
    try:
        b.from_mesh(body.data)
        b.verts.ensure_lookup_table()
        covered = (np.abs(before[:, 0]) > 0.09) & (before[:, 2] > 0.93) & (before[:, 2] < 1.29)
        doomed = [f for f in b.faces if all(covered[v.index] for v in f.verts)]
        bmesh.ops.delete(b, geom=doomed, context="FACES")
        b.to_mesh(body.data)
    finally:
        b.free()
    body.data.update()


def main():
    body = bpy.data.objects["Body"]
    edges = bm.edges_of(body)
    p = bm.get_co(body)
    before = p.copy()
    for side in (1, -1):
        w = body_arm_weight(p, side)
        w = bm.smooth_field(w, edges, p[:, 0] * side > 0.08, 6)
        here = p[:, 0] * side > 0
        q = p.copy()
        q[here] = lift(p[here], w[here], side)
        p = q
    bm.set_co(body, p)
    hide_under_sleeves(body, before)

    hoodie = bpy.data.objects["hoodie"]
    me = hoodie.data
    c = bm.get_co(hoodie)
    flag = np.empty(len(c), np.float32)
    me.attributes["arm"].data.foreach_get("value", flag)
    edges = bm.edges_of(hoodie)
    for side in (1, -1):
        _, t = along_arm(c, side)
        w = flag * bd.smoothstep(-0.01, 0.07, t) * (c[:, 0] * side > 0)
        w = bm.smooth_field(w.astype(float), edges, c[:, 0] * side > 0.05, 10)
        here = c[:, 0] * side > 0
        q = c.copy()
        q[here] = lift(c[here], w[here], side)
        c = q
    bm.set_co(hoodie, c)
    bpy.ops.wm.save_as_mainfile(filepath=sys.argv[sys.argv.index("--") + 1])


if __name__ == "__main__":
    main()
