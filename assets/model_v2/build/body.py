# Checkpoint 1: reshapes the CC0 base body into Spica's proportions and saves spica-v2-body.blend.
# Each section table below is her target, measured in metres; run with Blender in background mode.
import math
import os
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import materials as mt
import palette as pal

# Torso, by height: half width, front (toward -y), back. Soft waist, moderate bust, rounded hips.
TORSO = [
    (0.79, 0.050, -0.067, 0.067),
    (0.85, 0.147, -0.098, 0.087),
    (0.91, 0.139, -0.102, 0.079),
    (0.97, 0.116, -0.098, 0.050),
    (1.03, 0.095, -0.093, 0.031),
    (1.09, 0.099, -0.099, 0.032),
    (1.15, 0.113, -0.131, 0.047),
    (1.18, 0.116, -0.136, 0.061),
    (1.21, 0.108, -0.118, 0.067),
    (1.24, 0.095, -0.090, 0.066),
    (1.27, 0.088, -0.067, 0.061),
    (1.30, 0.083, -0.008, 0.032),
]
# Her left leg (+x, mirrored for the right): height, inner x, outer x, front, back.
LEG = [
    (0.12, 0.047, 0.090, -0.021, 0.025),
    (0.20, 0.046, 0.101, -0.024, 0.037),
    (0.28, 0.040, 0.115, -0.031, 0.047),
    (0.36, 0.037, 0.119, -0.044, 0.047),
    (0.40, 0.037, 0.116, -0.053, 0.040),
    (0.48, 0.031, 0.111, -0.079, 0.014),
    (0.56, 0.021, 0.127, -0.087, 0.024),
    (0.64, 0.012, 0.141, -0.100, 0.037),
    (0.72, 0.005, 0.149, -0.106, 0.047),
    (0.80, 0.014, 0.149, -0.103, 0.074),
]
SHOULDER_IN = 0.016  # how much narrower her shoulders are, each side
ARM_TILT = float(os.environ.get("SPICA_ARM_TILT", 12.5))  # degrees closer to her body, so her arms hang as her hoodie's sleeves were draped; -62 builds the T-pose
ARM_SLIM = [(0.0, 0.88), (0.45, 0.80), (0.75, 0.78), (1.0, 0.80)]  # radial scale along the arm
HAND_SCALE = 0.87
DELTOID_SHRINK = 0.14  # takes the muscle off her shoulder cap
# How far each finger fans out from its knuckle, in degrees (the base mesh's fingers touch).
FINGER_SLIM = 0.82
FINGER_LONG = 1.06
FINGER_FAN = {"index": -7.0, "middle": -2.0, "ring": 3.0, "pinky": 9.0, "thumb": -10.0}
FOOT_SCALE = 0.93
HEAD_SCALE = (0.92, 0.84, 0.94)  # coarse only; checkpoint 2 models the head
NECK_SLIM = (0.86, 0.90)
SHOULDER_JOINT = np.array([0.135, 0.016, 1.235])
WRIST_HEIGHT = 0.895


def smoothed(values, width=2.0):
    k = np.exp(-0.5 * (np.arange(-6, 7) / width) ** 2)
    k /= k.sum()
    padded = np.pad(values, 6, mode="edge")
    return np.convolve(padded, k, mode="valid")


def profile(q, grid, x_side):
    """Per-height extents of a column of points, smoothed so a sparse ring does not jolt the mapping."""
    rows = []
    for z in grid:
        ring = q[np.abs(q[:, 2] - z) < 0.016]
        if len(ring) < 3:
            rows.append([np.nan] * 4)
        else:
            lo = ring[:, 0].min() if x_side else -ring[:, 0].max()
            rows.append([lo, ring[:, 0].max(), ring[:, 1].min(), ring[:, 1].max()])
    a = np.array(rows, float)
    for c in range(4):
        good = ~np.isnan(a[:, c])
        a[:, c] = smoothed(np.interp(grid, grid[good], a[good, c]))
    return a


def remap_column(P, mask, table, x_side):
    """Moves a column of points so each height's extents match the target table."""
    q = P[mask]
    grid = np.arange(q[:, 2].min(), q[:, 2].max() + 0.01, 0.01)
    src = profile(q, grid, x_side)
    t = np.array(table, float)
    if not x_side:  # torso rows are (z, hx, yf, yb): inner x is -hx
        t = np.column_stack([t[:, 0], -t[:, 1], t[:, 1], t[:, 2], t[:, 3]])
    dst = np.column_stack([smoothed(np.interp(grid, t[:, 0], t[:, c])) for c in range(1, 5)])

    # Scale only the part of the table the column actually has.
    z = q[:, 2]
    def at(rows, c):
        return np.interp(z, grid, rows[:, c])

    x0, x1, y0, y1 = (at(src, c) for c in range(4))
    u0, u1, v0, v1 = (at(dst, c) for c in range(4))
    out = q.copy()
    out[:, 0] = (u0 + u1) / 2 + (q[:, 0] - (x0 + x1) / 2) * (u1 - u0) / np.maximum(x1 - x0, 1e-4)
    out[:, 1] = (v0 + v1) / 2 + (q[:, 1] - (y0 + y1) / 2) * (v1 - v0) / np.maximum(y1 - y0, 1e-4)
    P = P.copy()
    P[mask] = out
    return P


def mirrored(P, mask, table):
    """Applies a +x column table to the +x side and to a mirrored copy of the -x side."""
    pos = mask & (P[:, 0] > 0)
    neg = mask & (P[:, 0] <= 0)
    out = remap_column(P, pos, table, True)
    flip = P * np.array([-1, 1, 1])
    flip = remap_column(flip, neg, table, True)
    out[neg] = flip[neg] * np.array([-1, 1, 1])
    return out


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def arm_axis(side):
    s = SHOULDER_JOINT * np.array([side, 1, 1])
    w = np.array([0.316 * side, -0.012, WRIST_HEIGHT])
    return s, w


def reshape(ob):
    P = bm.get_co(ob)
    L = bm.labels(ob)
    edges = bm.edges_of(ob)
    src = P.copy()
    seams = L.copy()

    for name, sets in bm.FINGERS.items():
        finger = bm.vertices_in_sets(ob, sets)
        seams[finger] = name
        for side in (1, -1):
            here = finger & (np.sign(P[:, 0]) == side)
            q = P[here]
            pivot = q[q[:, 2] > q[:, 2].max() - 0.006].mean(0)
            a = math.radians(FINGER_FAN[name])
            c, sn = math.cos(a), math.sin(a)
            rel = q - pivot
            y = rel[:, 1] * c - rel[:, 2] * sn
            z = rel[:, 1] * sn + rel[:, 2] * c
            P[here, 1], P[here, 2] = pivot[1] + y, pivot[2] + z

            # Slimmer, slightly longer fingers around each one's own centre line.
            q = P[here]
            tip = q[np.argmax(np.linalg.norm(q - pivot, axis=1))]
            axis = (tip - pivot) / np.linalg.norm(tip - pivot)
            t = (q - pivot) @ axis
            line = pivot + t[:, None] * axis
            P[here] = pivot + (line - pivot) * FINGER_LONG + (q - line) * FINGER_SLIM

    P = remap_column(P, L == "torso", TORSO, False)
    P = mirrored(P, L == "leg", LEG)

    for side in (1, -1):
        s, w = arm_axis(side)
        axis = (w - s) / np.linalg.norm(w - s)
        length = np.linalg.norm(w - s)
        here = (L == "arm") & (np.sign(P[:, 0]) == side)
        t = (P[here] - s) @ axis
        foot = s + t[:, None] * axis
        scale = np.interp(t / length, *zip(*ARM_SLIM))
        P[here] = foot + (P[here] - foot) * scale[:, None]

        cap = (L == "shoulder") & (np.sign(P[:, 0]) == side)
        ramp = smoothstep(0.07, 0.14, np.abs(P[cap, 0]))
        P[cap] = s + (P[cap] - s) * (1 - DELTOID_SHRINK * ramp)[:, None]

        # Smaller hands about the wrist.
        hand = (L == "hand") & (np.sign(P[:, 0]) == side)
        P[hand] = w + (P[hand] - w) * HAND_SCALE

    for side in (1, -1):
        foot_m = (L == "foot") & (np.sign(P[:, 0]) == side)
        pivot = np.array([0.07 * side, 0.0, 0.0])
        P[foot_m] = pivot + (P[foot_m] - pivot) * FOOT_SCALE

    # Blend every seam between parts, using the mesh's own neighbours so the legs do not affect each other.
    seam = np.zeros(len(P), bool)
    diff = seams[edges[:, 0]] != seams[edges[:, 1]]
    seam[edges[diff].ravel()] = True
    band = bm.grow(seam, edges, 4)
    d = bm.smooth_field(P - src, edges, band, 60)
    P = src + d

    # Whole-part moves: these ramp along the body, so nothing tears.
    outer = np.abs(P[:, 0])
    arm_like = np.isin(L, ["shoulder", "arm", "hand"])
    w = smoothstep(0.07, 0.16, outer) * arm_like
    P[:, 0] -= np.sign(P[:, 0]) * SHOULDER_IN * w

    for side in (1, -1):
        s, _ = arm_axis(side)
        s = s - np.array([SHOULDER_IN * side, 0, 0])
        here = arm_like & (np.sign(P[:, 0]) == side)
        along = (P[here, 0] - s[0]) * side + (s[2] - P[here, 2]) * 0.6
        ramp = smoothstep(-0.03, 0.06, along)
        a = math.radians(ARM_TILT) * side * ramp
        c, sn = np.cos(a), np.sin(a)
        rel = P[here] - s
        x = rel[:, 0] * c + rel[:, 2] * sn
        z = -rel[:, 0] * sn + rel[:, 2] * c
        P[here, 0], P[here, 2] = s[0] + x, s[2] + z

    neck_ramp = smoothstep(1.275, 1.31, P[:, 2]) * (1 - smoothstep(1.34, 1.38, P[:, 2]))
    neck_like = np.isin(L, ["neck", "head"])
    P[:, 0] *= 1 + (NECK_SLIM[0] - 1) * neck_ramp * neck_like
    mid_y = -0.02
    P[:, 1] = mid_y + (P[:, 1] - mid_y) * (1 + (NECK_SLIM[1] - 1) * neck_ramp * neck_like)

    pivot = np.array([0.0, -0.02, 1.335])
    head = smoothstep(1.31, 1.37, P[:, 2]) * neck_like
    scale = 1 + (np.array(HEAD_SCALE) - 1) * head[:, None]
    P = pivot + (P - pivot) * scale

    bm.set_co(ob, P)
    print("HEIGHT", P[:, 2].max() - P[:, 2].min())
    return L


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ob = bm.load_body()
    reshape(ob)
    ob.data.polygons.foreach_set("use_smooth", [True] * len(ob.data.polygons))
    ob.data.update()

    ob.data.materials.clear()
    ob.data.materials.append(mt.toon("skin", pal.SKIN, pal.SKIN_SHADE))
    sub = ob.modifiers.new("subsurf", "SUBSURF")
    sub.levels = 2
    sub.render_levels = 2
    mt.add_outline(ob, mt.outline_material("outline_skin", pal.OUTLINE_SKIN), 0.0018)

    bpy.ops.wm.save_as_mainfile(filepath=str(bm.ROOT / ("spica-v2-body%s.blend" % bm.STAGE)))


if __name__ == "__main__":
    main()
