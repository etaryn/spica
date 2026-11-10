# Checkpoint 4: dresses her. The hoodie comes from "hoodie and skirt" by Takeru (CC-BY-4.0), fitted to her body.
# Runs on spica-v2-head.blend and saves spica-v2-clothes.blend, which the hair step then builds on.
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import body as bd
import hair as hr
import materials as mt
import palette as pal
import zipper
from palette import linear

SOURCE = bm.ROOT / "base" / "hoodie_a" / "scene.gltf"
SNEAKER = bm.ROOT / "base" / "sneaker_a" / "scene.gltf"
SCALE = 0.88  # one even scale: the reference was draped on a taller figure
SHOULDER_TOP = 1.335  # where the top of the reference's body panels lands on her
CHEST_CENTRE_Y = -0.0375  # the middle of her chest, front to back
SLEEVE_ROOM = 1.22  # how much wider the sleeves are made, for the oversized look
PAST_WRIST = 0.095  # how far the cuff ends past the wrist
SHOULDER_EASE = 0.020  # how far the cloth stands out past her shoulder
SHOULDER_REST = 0.012  # the hoodie rests this far above the top of her shoulder
SHOULDER_POINT = 0.155  # past this she is arm, not shoulder: the drop stays what it is here
SHOULDER_DROP_FADE = (1.07, 1.26)  # no drop below the first height, all of it above the second
SLEEVE_LINE = (1.245, 1.075)  # the heights between which the upper sleeve's width runs straight
SLEEVE_ROWS, SLEEVE_TURNS, SLEEVE_CARRY = 9, 12, 0.03  # how finely it is measured along and round the arm, and how far sewn cloth follows
CHEST_REST = 0.013  # the cloth over her collarbones rests this far off her
CHEST_FADE = (1.20, 1.27)  # nothing moves below the first height, all of it above the second
CHEST_WIDTH, CHEST_BLUR, CHEST_CARRY = 0.17, 0.018, 0.04  # how far out from her middle, how widely the move is blurred, how far sewn cloth follows
FIT_PASSES = 5  # how many rounds of settling the sleeves and collarbones get
CHEST_KEEP = 0.25  # the share of the extra gap that stays
EVEN_Z, EVEN_X = (0.99, 1.05, 1.20, 1.25), (0.14, 0.18)  # where the chest is evened: heights it fades in and out over, and how far out it fades
EVEN_BACK, EVEN_REACH, EVEN_BLUR, EVEN_CARRY = 0.02, 0.05, 0.012, 0.03  # front only; how far to look for the mirror image; how widely the move is blurred; how far sewn cloth follows
EVEN_PASSES, EVEN_RELAX = 4, 4  # rounds of meeting halfway, then of relaxing the surface
LAYERS_TOGETHER = 0.015  # layers of the hood this close move as one when pushed off her skin
FLAP_BACK = (0.01, 0.06)  # from the first depth to the second the hood stops moving
SEAM_SLIT = 0.008  # the hem seam's edges that stretching pulled this far apart are sewn back together
BODY_GAP = 0.010  # the cloth stays at least this far off her skin
OUTLINE_WIDTH = 0.0016
STRETCH_FROM = 1.12  # the cloth is untouched above this height, which is below her armholes
HEM_BOTTOM = 0.81  # where the hem ends: below the widest part of her hips, for the oversized look
CROTCH = 0.787  # height of her crotch
SHORTS_TOP = 0.985  # the waistband, hidden under the hoodie
SHORTS_HEM = 0.765  # where the legs end: just below her crotch (Ethan)
SHORTS_EASE = 0.004  # how far the shorts stand off her hips
LEG_EASE = 0.008  # and off her thighs at the top of the leg
HEM_OPEN = 0.006  # extra room at the leg opening in the denim cut
CUFF_HEIGHT = 0.022  # the rolled hem
CUFF_WIDTH = 0.0045  # how far it stands out from the leg
CUFF_SQUARE = 0.45  # below 1 the band's section is a flat strip with soft edges rather than a round tube
# Each leg's hem sits unevenly: slow rises and falls (count round the leg, phase, depth) and creases pressed in (where, width, depth).
HEM_UNEVEN = {
    1: (((2, 0.7, 0.0052), (3, 2.1, 0.0028)), ((0.5, 0.16, 0.0020), (2.2, 0.12, 0.0016), (-1.9, 0.2, 0.0018))),
    -1: (((2, 3.4, 0.0044), (5, 1.0, 0.0018)), ((-0.9, 0.14, 0.0021), (1.4, 0.18, 0.0017))),
}
STOCKING_TOP = SHORTS_HEM - 0.06  # the thigh-high on her left leg ends this far below the shorts
ANKLE_SOCK_TOP = 0.13  # the ankle sock on her right leg, just above where a low sneaker ends
FADE_BOTTOM = 0.06  # the socks' colour fade runs from the stocking's top down to this height
ANKLE_BAND = 0.024  # the ribbed band at its top
SOCK_EASE = 0.0018  # socks are tight: this far off her skin
BAND_PROUD = 0.0016  # how far the band stands out from the sock
BAND_RIBS, BAND_RIB_DEPTH = 30, 0.0005
SOLE_LINE = 0.03  # in the reference's own size: everything this close to the ground is sole
HEEL_INSIDE = 0.003  # how far inside the shoe her heel is kept
SOLE_DEPTH = 0.030  # the sole goes under her foot, below the height her body stands at
FOOT_FREE = 0.085  # her leg is untouched above this: only the foot inside the shoe is slimmed
FOOT_WIDTH, FOOT_HEIGHT, FOOT_LENGTH = 0.60, 0.50, 0.84  # how much of its width, height and length the foot keeps in there
COLLAR_GAP = 0.0025  # how far the collar sits off her ankle
COLLAR_REACH = 0.075  # the collar's inner wall is found within this of her ankle
HEEL_ROOM, TOE_ROOM = 0.006, 0.010  # how much longer the sneaker is than her foot, behind and in front
TRIM_CLEAR, TRIM_FADE = 0.018, 0.02  # the hood's lining stops about this far short of its trim
SEAM_QUIET = 2  # how many steps either side of a seam have no outline
FOLD_ROUNDS, FOLD_DEEP = 8, 0.005  # how wide a fold is read, and how deep counts as fully in shadow
ZIP_TEETH_BAND, ZIP_TEETH_STEP = 0.15, 0.0042  # share of the strip that is teeth (each way from its centre), and their spacing
CLOTH_SOFT = 0.14  # how gradually knit cloth goes from light to shadow
STRAND_CUT = 1.283  # the hood trim ends at the neck; below this it was only the drawstrings
HEM_CURL = (0.010, 0.022)  # how far the hem curls in, over what height
CUFF_FROM, CUFF_FLARE = 0.55, 0.14  # from this far down the sleeve it widens, by this much at the cuff
WAISTBAND = 0.953  # where the shorts' waistband starts
HIP_HEIGHT = 0.85  # the widest part of her hips
COLUMN_EASE = 0.026  # how far the sides stand clear of her hips where the hem starts to gather
COLUMN_FRONT = -0.138  # where the front of the straight part hangs, just inside her bust
HEM_EASE = 0.020  # how close the elastic hem sits to her hips
GATHER_HEIGHT = 0.095  # how far above the hem the cloth starts curving in
HEM_BAND = 0.03  # the band itself, which stays snug
WAIST_HEIGHT = 1.03  # the narrowest part of her waist
WAIST_EASE = 0.020  # how far the cloth sits off her waist at the sides
WAIST_DEPTH_EASE = 0.018  # and at her front and back
WELD = 0.0012  # pattern pieces share their seams to within this distance


def her_arm(body):
    """Her left arm as a straight line: a point on it, its direction, and how far along it the wrist is."""
    p = bm.get_co(body)
    arm = p[(p[:, 0] > 0.13) & (p[:, 2] > 0.8) & (p[:, 2] < 1.22)]
    heights = np.linspace(1.16, 0.95, 22)
    centres = np.array([arm[np.abs(arm[:, 2] - z) < 0.012].mean(0) for z in heights])
    origin = centres.mean(0)
    direction = np.linalg.svd(centres - origin)[2][0]
    if direction[2] > 0:
        direction = -direction

    # The wrist is the narrowest part of the arm near its end.
    along = (p - origin) @ direction
    radial = np.linalg.norm(p - origin - along[:, None] * direction, axis=1)
    near = radial < 0.06
    steps = np.arange(0.12, 0.34, 0.01)
    slices = [radial[near & (np.abs(along - t) < 0.008)] for t in steps]
    widths = [np.percentile(s, 90) if len(s) else np.inf for s in slices]  # the last slices can run past her fingertips
    wrist = float(steps[int(np.argmin(widths))])
    print("her wrist height", round(float((origin + direction * wrist)[2]), 3))
    return origin, direction, wrist


def curl_ends(verts, arm):
    """The hem curves in at its very end, as a thick rolled edge does."""
    out = verts.copy()
    amount, height = HEM_CURL
    near_hem = (arm < 0.5) & (verts[:, 2] < HEM_BOTTOM + height)
    centre = verts[(arm < 0.5) & (verts[:, 2] < HEM_BOTTOM + 0.04), :2].mean(0)
    s = np.clip((HEM_BOTTOM + height - verts[near_hem, 2]) / height, 0, 1)
    d = verts[near_hem, :2] - centre
    r = np.linalg.norm(d, axis=1)
    pull = amount * (1 - np.sqrt(np.maximum(1 - s * s, 0)))
    out[near_hem, :2] = centre + d * ((r - pull) / np.maximum(r, 1e-6))[:, None]

    return out


def load_reference():
    """The reference hoodie's points in metres, its faces, and which pattern piece each point is on."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    new = [o for o in bpy.data.objects if o not in before]
    bpy.context.view_layer.update()
    source = next(o for o in new if o.type == "MESH" and "parker" in o.name)
    p = bm.get_co(source)
    m = np.array(source.matrix_world)
    p = (p @ m[:3, :3].T + m[:3, 3]) * 0.01
    faces = [list(f.vertices) for f in source.data.polygons]
    pieces = hr.islands_of(len(p), bm.edges_of(source))
    for o in new:
        bpy.data.objects.remove(o)
    return p, faces, pieces


def square_up(p):
    """Turns the reference to face her way: its two cuffs give the shoulder line, its hood marks the back."""
    low = p[p[:, 2] < p[:, 2].min() + 0.12]
    middle = low[:, :2].mean(0)
    axis = np.linalg.svd(low[:, :2] - middle)[2][0]
    angle = -math.atan2(axis[1], axis[0])
    c, s = math.cos(angle), math.sin(angle)
    p = p.copy()
    p[:, :2] = (p[:, :2] - middle) @ np.array([[c, -s], [s, c]]).T
    top = p[p[:, 2] > p[:, 2].max() - 0.08]
    chest = p[(np.abs(p[:, 2] - (p[:, 2].max() - 0.28)) < 0.04) & (np.abs(p[:, 0]) < 0.14)]
    if top[:, 1].mean() < chest[:, 1].mean():
        p[:, 0] *= -1
        p[:, 1] *= -1
    return p


def name_pieces(p, pieces):
    """Sorts the pattern pieces by where they sit: sleeve, cuff, hem, hood, body or cord end."""
    names = {}
    for k in range(pieces.max() + 1):
        q = p[pieces == k]
        m = q.mean(0)
        if len(q) < 60:
            names[k] = "cord"
        elif m[2] < 1.06:
            names[k] = "cuff"
        elif len(q) > 1000 and abs(m[0]) > 0.15 and m[2] < 1.3:
            names[k] = "sleeve"
        elif m[2] < 1.23:
            names[k] = "hem"
        elif m[2] > 1.45:
            names[k] = "trim" if len(q) < 400 else "hood"
        else:
            names[k] = "body"
    return names


def smooth_steps(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def carried_frame(tangents, start):
    """A direction across a tube, carried smoothly along it so it never twists."""
    frame = np.zeros_like(tangents)
    frame[0] = hr.unit(start - np.dot(start, tangents[0]) * tangents[0])
    for i in range(1, len(tangents)):
        frame[i] = hr.unit(frame[i - 1] - np.dot(frame[i - 1], tangents[i]) * tangents[i])
    return frame


def cuff_flare(u, radius, room):
    """How much to widen each ring so the sleeve opens out towards the cuff instead of gathering in."""
    bins = np.clip((u * 24).astype(int), 0, 23)
    rings = np.array([radius[bins == b].mean() if (bins == b).any() else np.nan for b in range(24)])
    centres = (np.arange(24) + 0.5) / 24
    known = ~np.isnan(rings)
    ring_now = np.interp(u, centres[known], rings[known])
    settled = float(np.interp(CUFF_FROM, centres[known], rings[known]))
    wanted = settled * (1 + CUFF_FLARE * smooth_steps(u, CUFF_FROM, 1.0))
    return 1 + (wanted / np.maximum(ring_now, 1e-4) - 1) * smooth_steps(u, CUFF_FROM - 0.1, CUFF_FROM)


def fit_sleeves(p, labels, arm):
    """Rebuilds each sleeve along her arm: its folds are kept, its bends and offsets are straightened out."""
    origin, direction, wrist = arm
    out = p.copy()
    for side in (1, -1):
        mirror = np.array([side, 1, 1])
        arm_origin, arm_direction = origin * mirror, direction * mirror
        here = np.isin(labels, ["sleeve", "cuff"]) & (np.sign(p[:, 0]) == side)
        q = p[here]
        sleeve_top = p[here & (labels == "sleeve")]
        pivot = sleeve_top[sleeve_top[:, 2] > sleeve_top[:, 2].max() - 0.03].mean(0)
        tip = p[here & (labels == "cuff")].mean(0)
        axis = hr.unit(tip - pivot)
        along = (q - pivot) @ axis
        length = along.max()
        bins = 30
        grid = np.linspace(0, length, bins)
        centres = []
        for t in grid:
            ring = q[np.abs(along - t) < length / bins * 1.2]
            centres.append(ring.mean(0) if len(ring) else np.full(3, np.nan))
        centres = np.array(centres)
        for c in range(3):
            good = ~np.isnan(centres[:, c])
            centres[:, c] = np.interp(grid, grid[good], centres[good, c])
        for _ in range(4):
            centres[1:-1] = (centres[:-2] + 2 * centres[1:-1] + centres[2:]) / 4
        tangents = np.gradient(centres, axis=0)
        tangents /= np.linalg.norm(tangents, axis=1)[:, None]
        old_e1 = carried_frame(tangents, np.array([0.0, 1.0, 0.0]))
        old_e2 = np.cross(tangents, old_e1)

        position = np.clip(along / length, 0, 1) * (bins - 1)
        low = np.clip(position.astype(int), 0, bins - 2)
        f = (position - low)[:, None]
        centre = centres[low] * (1 - f) + centres[low + 1] * f
        e1 = old_e1[low] * (1 - f) + old_e1[low + 1] * f
        e2 = old_e2[low] * (1 - f) + old_e2[low + 1] * f
        tan = tangents[low] * (1 - f) + tangents[low + 1] * f
        rel = q - centre
        a1, a2, a3 = (rel * e1).sum(1), (rel * e2).sum(1), (rel * tan).sum(1)

        # Her arm, from level with the top of the sleeve down to just past the wrist.
        start = float(np.dot(centres[0] - arm_origin, arm_direction))
        target_length = wrist + PAST_WRIST - start
        new_e1 = hr.unit(old_e1[0] - np.dot(old_e1[0], arm_direction) * arm_direction)
        new_e2 = np.cross(arm_direction, new_e1)
        u = np.clip(along / length, 0, 1)
        room = 1 + (SLEEVE_ROOM - 1) * smooth_steps(u, 0.0, 0.25)
        room *= cuff_flare(u, np.hypot(a1, a2), room)
        mapped = arm_origin + arm_direction * (start + u * target_length + a3)[:, None]
        mapped += new_e1 * (a1 * room)[:, None] + new_e2 * (a2 * room)[:, None]

        weight = smooth_steps(u, 0.02, 0.24)[:, None]
        moved = q * (1 - weight) + mapped * weight
        print("sleeve", "L" if side > 0 else "R", "was off her arm at the wrist by", round(float(np.linalg.norm(tip - (arm_origin + arm_direction * wrist))), 3))
        out[here] = moved

        # Body cloth sewn to the sleeve follows it, fading with distance, so no seam opens.
        tree = KDTree(int(here.sum()))
        for i, co in enumerate(q):
            tree.insert(co, i)
        tree.balance()
        change = moved - q
        near_armhole = 1 - smooth_steps(u, 0.15, 0.35)  # lower down, the sleeve only passes close to her side
        for i in np.where((labels == "body") & (np.sign(p[:, 0]) == side))[0]:
            _, j, d = tree.find(p[i])
            out[i] = p[i] + change[j] * math.exp(-((d / 0.035) ** 2)) * near_armhole[j]
    return out


def rest_on_shoulders(p, labels, body):
    """Lowers each shoulder of the hoodie onto hers: nothing at her neck, the most at the point of her shoulder, and easing out down her chest and arm."""
    skin = bm.get_co(body)
    skin = skin[(skin[:, 2] > 1.0) & (skin[:, 2] < 1.34)]
    cloth = p[np.isin(labels, ["sleeve", "body"]) & (p[:, 2] > 1.0)]
    across = np.arange(0.04, SHOULDER_POINT + 0.001, 0.01)
    out = p.copy()
    for side in (1, -1):
        top = lambda q, x: q[np.abs(q[:, 0] * side - x) < 0.005, 2].max()
        drop = bd.smoothed(np.array([max(top(cloth, x) - top(skin, x) - SHOULDER_REST, 0.0) for x in across]), 1.0)
        here = p[:, 0] * side > 0
        amount = np.interp(p[here, 0] * side, np.r_[0.02, across], np.r_[0.0, drop])
        out[here, 2] -= amount * smooth_steps(p[here, 2], *SHOULDER_DROP_FADE)
        print("shoulder", "L" if side > 0 else "R", "lowered by up to", round(float(drop.max()), 3))
    return out


def fit_shoulders(p, labels, body):
    """Moves each side's shoulder so it sits just outside hers."""
    skin = bm.get_co(body)
    band = (1.2, 1.27)
    out = p.copy()
    cloth = np.isin(labels, ["sleeve", "body"])
    for side in (1, -1):
        s_band = skin[(skin[:, 2] > band[0]) & (skin[:, 2] < band[1]) & (skin[:, 0] * side > 0)]
        c_mask = cloth & (p[:, 2] > band[0]) & (p[:, 2] < band[1]) & (p[:, 0] * side > 0)
        target = np.abs(s_band[:, 0]).max() + SHOULDER_EASE
        now = np.abs(p[c_mask, 0]).max()
        peak = p[c_mask][np.argmax(np.abs(p[c_mask, 0]))]
        shift = target - now
        here = cloth & (p[:, 0] * side > 0)
        d2 = ((p[here, 0] - peak[0]) / 0.13) ** 2 + ((p[here, 2] - peak[2]) / 0.11) ** 2
        out[here, 0] += side * shift * np.exp(-d2)
        print("shoulder", "L" if side > 0 else "R", "moved by", round(float(shift), 3))
    return out


def lengthen(p, labels):
    """Draws the body and hem down to HEM_BOTTOM. Below the chest the cloth falls loose: it never narrows in again."""
    lower = np.isin(labels, ["body", "hem"]) & (p[:, 2] < STRETCH_FROM)
    hem = labels == "hem"
    drop = p[hem, 2].min() - HEM_BOTTOM
    band_top = p[hem, 2].max()
    stretch = (STRETCH_FROM - (band_top - drop)) / (STRETCH_FROM - band_top)
    q = p[lower]
    z = q[:, 2]
    new_z = np.where(z > band_top, STRETCH_FROM - (STRETCH_FROM - z) * stretch, z - drop)

    # The cloth's own extents at each old height.
    grid = np.arange(z.min(), STRETCH_FROM + 0.001, 0.012)
    rows = []
    for h in grid:
        ring = q[np.abs(z - h) < 0.012]
        rows.append([ring[:, 0].min(), ring[:, 0].max(), ring[:, 1].min(), ring[:, 1].max()] if len(ring) > 4 else [np.nan] * 4)
    old = np.array(rows, float)
    # The reference's hem is slanted, so a slice through it only catches part of the ring: use the whole band's size.
    ring = q[z <= band_top]
    old[grid <= band_top] = [ring[:, 0].min(), ring[:, 0].max(), ring[:, 1].min(), ring[:, 1].max()]
    for c in range(4):
        good = ~np.isnan(old[:, c])
        old[:, c] = bd.smoothed(np.interp(grid, grid[good], old[good, c]), 2.0)
    x0, x1, y0, y1 = (np.interp(z, grid, old[:, c]) for c in range(4))

    # The outline: in to her waist, out clear of her hips, then gathered in at the hem.
    table = np.array(bd.TORSO)
    hip = float(np.interp(HIP_HEIGHT, table[:, 0], table[:, 1]))
    hip_front = float(np.interp(HIP_HEIGHT, table[:, 0], table[:, 2]))
    hip_back = float(np.interp(HIP_HEIGHT, table[:, 0], table[:, 3]))
    fall = np.arange(STRETCH_FROM, HEM_BOTTOM - 0.05, -0.005)
    gather = smooth_steps(HEM_BOTTOM + GATHER_HEIGHT - fall, 0.0, GATHER_HEIGHT - HEM_BAND)

    def outline(start, straight, hem_value, waist):
        stops = [HEM_BOTTOM + GATHER_HEIGHT, WAIST_HEIGHT, STRETCH_FROM]
        column = bd.smoothed(np.interp(fall, stops, [straight, waist, start]), 8.0)
        return column + (hem_value - column) * gather

    at_waist = [float(np.interp(WAIST_HEIGHT, table[:, 0], table[:, c])) for c in (1, 2, 3)]
    half = outline((old[-1, 1] - old[-1, 0]) / 2, hip + COLUMN_EASE, hip + HEM_EASE, at_waist[0] + WAIST_EASE)
    front = outline(old[-1, 2], COLUMN_FRONT, hip_front - HEM_EASE, at_waist[1] - WAIST_DEPTH_EASE)
    back = outline(old[-1, 3], hip_back + COLUMN_EASE, hip_back + HEM_EASE, at_waist[2] + WAIST_DEPTH_EASE)
    want_half = np.interp(new_z, fall[::-1], half[::-1])
    want_front = np.interp(new_z, fall[::-1], front[::-1])
    want_back = np.interp(new_z, fall[::-1], back[::-1])

    x = (q[:, 0] - (x0 + x1) / 2) / np.maximum((x1 - x0) / 2, 1e-4) * want_half
    y = (want_front + want_back) / 2 + (q[:, 1] - (y0 + y1) / 2) / np.maximum((y1 - y0) / 2, 1e-4) * (want_back - want_front) / 2
    blend = smooth_steps(STRETCH_FROM - z, 0.0, 0.03)
    out = p.copy()
    out[lower, 0] = q[:, 0] + (x - q[:, 0]) * blend
    out[lower, 1] = q[:, 1] + (y - q[:, 1]) * blend
    out[lower, 2] = new_z
    print("hem lowered by", round(float(drop), 3), "cloth above it stretched", round(float(stretch), 2), "times")
    return level_hem(out, labels)


def level_hem(p, labels):
    """The reference's hem is cut on a slant. Each direction round her is brought to one level, fading out above."""
    hem = labels == "hem"
    q = p[hem]
    centre = q[:, :2].mean(0)
    bins = np.linspace(-np.pi, np.pi, 37)
    middles = (bins[:-1] + bins[1:]) / 2
    angle = np.arctan2(q[:, 1] - centre[1], q[:, 0] - centre[0])
    lowest = np.array([q[(angle >= a) & (angle < b), 2].min() if ((angle >= a) & (angle < b)).any() else np.nan for a, b in zip(bins[:-1], bins[1:])])
    good = ~np.isnan(lowest)
    lowest = np.interp(middles, middles[good], lowest[good], period=2 * np.pi)
    lowest = np.convolve(np.r_[lowest[-2:], lowest, lowest[:2]], np.array([1, 2, 3, 2, 1]) / 9, mode="valid")
    around = np.isin(labels, ["hem", "body"])
    every = np.arctan2(p[around, 1] - centre[1], p[around, 0] - centre[0])
    lift = np.interp(every, middles, lowest, period=2 * np.pi) - HEM_BOTTOM
    fade = 1 - smooth_steps(p[around, 2], HEM_BOTTOM + GATHER_HEIGHT, HEM_BOTTOM + GATHER_HEIGHT + 0.12)
    out = p.copy()
    out[around, 2] -= lift * fade
    print("hem levelled, it was slanted by", round(float(np.ptp(lowest)), 3))
    return out


def sewn(p, faces, solid, arm, hem_slit=SEAM_SLIT):
    """Closes the seams between pattern pieces and rebuilds quads. Keeps each point's solid flag."""
    b = bmesh.new()
    try:
        layer = b.verts.layers.float.new("solid")
        arm_layer = b.verts.layers.float.new("arm")
        added = [b.verts.new(tuple(co)) for co in p.tolist()]
        for v, value, on_arm in zip(added, solid.tolist(), arm.tolist()):
            v[layer] = value
            v[arm_layer] = on_arm
        for f in faces:
            try:
                b.faces.new([added[i] for i in f])
            except ValueError:
                pass  # a repeated face in the source
        bmesh.ops.remove_doubles(b, verts=b.verts[:], dist=WELD)
        if hem_slit:
            slit = [v for v in b.verts if v.co.z < HEM_BOTTOM + 0.15 and any(e.is_boundary for e in v.link_edges)]
            others = [v for v in b.verts if v.co.z < HEM_BOTTOM + 0.15 and v not in set(slit)]
            tree = KDTree(len(others))
            for k, v in enumerate(others):
                tree.insert(v.co, k)
            tree.balance()
            ties = {}
            for v in slit:
                _, k, dist = tree.find(v.co)
                if dist < hem_slit:
                    ties[v] = others[k]
            bmesh.ops.weld_verts(b, targetmap=ties)
        bmesh.ops.join_triangles(b, faces=b.faces[:], angle_face_threshold=math.radians(40), angle_shape_threshold=math.radians(40))
        b.verts.index_update()
        verts = np.array([v.co[:] for v in b.verts])
        polys = [[v.index for v in f.verts] for f in b.faces]
        flags = np.array([v[layer] for v in b.verts])
        arms = np.array([v[arm_layer] for v in b.verts])
    finally:
        b.free()
    return verts, polys, flags, arms


def edge_pairs(faces):
    return np.array(sorted({tuple(sorted(e)) for f in faces for e in zip(f, f[1:] + f[:1])}))


def carry_along(change, moved, points, edges, reach):
    """Cloth sewn to what moved goes with it, fading with distance, so no seam pulls open."""
    tree = KDTree(int(moved.sum()))
    for k, co in enumerate(points[moved]):
        tree.insert(co, k)
    tree.balance()
    source = change[moved]
    out = change.copy()
    for i in np.where(~moved)[0]:
        _, k, d = tree.find(points[i])
        out[i] = source[k] * math.exp(-((d / reach) ** 2))
    return bm.smooth_field(out, edges, ~moved, 8)


def straighten_sleeves(verts, on_arm, arm, edges):
    """Takes the pinch out of each upper sleeve: round the arm, its width runs straight from the shoulder to below the deltoid. Folds are kept."""
    origin, direction, _ = arm
    change = np.zeros_like(verts)
    moved = np.zeros(len(verts), bool)
    for side in (1, -1):
        mirror = np.array([side, 1, 1])
        o, d = origin * mirror, direction * mirror
        here = (on_arm > 0.5) & (verts[:, 0] * side > 0)
        q = verts[here]
        along = (q - o) @ d
        radial = q - o - along[:, None] * d
        r = np.linalg.norm(radial, axis=1)
        across = hr.unit(np.cross(d, (0.0, 1.0, 0.0)))
        turn = (np.arctan2(radial @ np.cross(d, across), radial @ across) + math.pi) / (2 * math.pi) * SLEEVE_TURNS
        first, last = ((np.array(SLEEVE_LINE) - o[2]) / d[2]).tolist()
        rows = np.linspace(first, last, SLEEVE_ROWS)
        step = rows[1] - rows[0]
        size = np.full((SLEEVE_ROWS, SLEEVE_TURNS), np.nan)
        for i, t in enumerate(rows):
            for k in range(SLEEVE_TURNS):
                ring = r[(np.abs(along - t) < step) & (turn.astype(int) % SLEEVE_TURNS == k)]
                if len(ring) >= 3:
                    size[i, k] = np.percentile(ring, 92)  # its outer edge, which is what makes the outline
        ratio = np.ones_like(size)
        for k in range(SLEEVE_TURNS):
            if not np.isnan(size[[0, -1], k]).any():
                good = ~np.isnan(size[:, k])
                ratio[good, k] = np.linspace(size[0, k], size[-1, k], SLEEVE_ROWS)[good] / size[good, k]
        ratio = (np.roll(ratio, 1, 1) + 2 * ratio + np.roll(ratio, -1, 1)) / 4
        row = np.clip((along - first) / (last - first), 0, 1) * (SLEEVE_ROWS - 1)
        i0 = np.clip(row.astype(int), 0, SLEEVE_ROWS - 2)
        k0 = turn.astype(int) % SLEEVE_TURNS
        k1 = (k0 + 1) % SLEEVE_TURNS
        fr, ft = row - i0, turn - np.floor(turn)
        scale = ratio[i0, k0] * (1 - fr) * (1 - ft) + ratio[i0 + 1, k0] * fr * (1 - ft) + ratio[i0, k1] * (1 - fr) * ft + ratio[i0 + 1, k1] * fr * ft
        change[here] = radial * (scale - 1)[:, None]
        moved |= here
    print("sleeve outline moved by up to", round(float(np.linalg.norm(change, axis=1).max()), 4))
    return verts + carry_along(change, moved, verts, edges, SLEEVE_CARRY)


def settle_on_chest(verts, labels, edges, body):
    """Brings the cloth over her collarbones and the slope of her shoulders down onto her: the panels and the hood's front flap, whose layers keep their order."""
    tree = BVHTree.FromPolygons(bm.get_co(body).tolist(), [list(f.vertices) for f in body.data.polygons], all_triangles=False)
    panel = np.isin(labels, ["body", "sleeve"])
    flap = np.isin(labels, ["hood", "trim"])
    zone = (panel | flap) & (verts[:, 2] > CHEST_FADE[0]) & (np.abs(verts[:, 0]) < CHEST_WIDTH)
    pull = np.zeros_like(verts)
    for i in np.where(zone)[0]:
        hit, _, _, dist = tree.find_nearest(tuple(verts[i]))
        if dist > CHEST_REST:
            wanted = CHEST_REST + (dist - CHEST_REST) * CHEST_KEEP  # a share of the gap stays, so cloth lying on cloth does not cross it
            pull[i] = (np.array(hit) - verts[i]) * (1 - wanted / dist)
    fade = smooth_steps(verts[:, 2], *CHEST_FADE) * np.where(flap, 1 - smooth_steps(verts[:, 1], *FLAP_BACK), 1.0)  # the hood's back keeps its volume
    pull = bm.spread(verts, pull * fade[:, None], zone, CHEST_BLUR)  # by distance, so the hood's layers move as one and folds stay
    print("collarbone cloth lowered by up to", round(float(np.linalg.norm(pull, axis=1).max()), 4))
    return verts + carry_along(pull, zone, verts, edges, CHEST_CARRY)


def even_out_chest(verts, faces, labels, edges):
    """Her body is the same on both sides and the source garment is not: each side of the chest meets its mirror image halfway, then the surface is relaxed a little."""
    panel = labels == "body"
    sheet = [f for f in faces if panel[f].all()]
    side, height = np.abs(verts[:, 0]), verts[:, 2]
    zone = panel & (verts[:, 1] < EVEN_BACK) & (height > EVEN_Z[0]) & (height < EVEN_Z[3]) & (side < EVEN_X[1])
    fade = (smooth_steps(height, EVEN_Z[0], EVEN_Z[1]) * (1 - smooth_steps(height, EVEN_Z[2], EVEN_Z[3])) * (1 - smooth_steps(side, *EVEN_X)))[:, None]
    for _ in range(EVEN_PASSES):
        mirrored = verts * np.array([-1.0, 1.0, 1.0])
        tree = BVHTree.FromPolygons(mirrored.tolist(), sheet, all_triangles=False)
        change = np.zeros_like(verts)
        for i in np.where(zone)[0]:
            hit, _, _, dist = tree.find_nearest(tuple(verts[i]))
            if hit is not None and dist < EVEN_REACH:
                change[i] = (np.array(hit) - verts[i]) / 2
        change = bm.spread(verts, change * fade, zone, EVEN_BLUR)
        verts = verts + carry_along(change, zone, verts, edges, EVEN_CARRY)
    relaxed = bm.smooth_field(verts, edges, zone, EVEN_RELAX)
    print("chest evened: last move", round(float(np.linalg.norm(change, axis=1).max()), 4))
    return verts + (relaxed - verts) * fade


def keep_off_body(verts, faces, body, under=None, together=None):
    """Cloth inside or too close to the garment under it, or to her skin, moves out; its neighbours ease along. Layers in `together` take the push as one."""
    layers = [(bm.get_co(body).tolist(), [list(f.vertices) for f in body.data.polygons])]
    if under is not None:  # nearest-surface tests against skin alone would miss cloth that is inside the shorts
        layers.insert(0, (under[0].tolist(), under[1]))
    moved = verts.copy()
    touched = np.zeros(len(verts), bool)
    for points, polys in layers:
        tree = BVHTree.FromPolygons(points, polys, all_triangles=False)
        for i, co in enumerate(moved):
            hit, normal, _, dist = tree.find_nearest(tuple(co))
            if hit is None or dist > 0.06:
                continue
            hit, normal = np.array(hit), np.array(normal)
            if float(np.dot(co - hit, normal)) < BODY_GAP:
                moved[i] = hit + normal * BODY_GAP
                touched[i] = True
    pairs = edge_pairs(faces)
    print("cloth points moved off her skin:", int(touched.sum()), "of", len(verts))
    change = bm.smooth_field(moved - verts, pairs, bm.grow(touched, pairs, 4) & ~touched, 12)
    if together is not None:
        change = bm.spread(verts, change, together, LAYERS_TOGETHER)
    return verts + change


def cloth_material(name, base, shade, lining, lining_shade, cut=1.10, soft=0.03, crease=None, metal=None, ends=None):
    """Flat cloth: lit and shadow tones outside, the lining colour inside."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    t.nodes.clear()
    new = t.nodes.new
    out = new("ShaderNodeOutputMaterial")
    emit = new("ShaderNodeEmission")
    diffuse = new("ShaderNodeBsdfDiffuse")
    to_rgb = new("ShaderNodeShaderToRGB")
    grey = new("ShaderNodeRGBToBW")
    step = new("ShaderNodeMapRange")
    step.inputs["From Min"].default_value = cut - soft
    step.inputs["From Max"].default_value = cut + soft
    step.inputs["To Min"].default_value = 0.0
    step.inputs["To Max"].default_value = 1.0
    step.clamp = True
    geometry = new("ShaderNodeNewGeometry")
    t.links.new(diffuse.outputs[0], to_rgb.inputs[0])
    t.links.new(to_rgb.outputs[0], grey.inputs[0])
    t.links.new(grey.outputs[0], step.inputs["Value"])

    def two_tone(light, dark, far=None):
        """Lit and shadow colours; with far, each fades by the fade_t attribute to its far colour."""
        n = new("ShaderNodeMix")
        n.data_type = "RGBA"
        n.inputs["A"].default_value = linear(dark)
        n.inputs["B"].default_value = linear(light)
        if far:
            height = new("ShaderNodeAttribute")
            height.attribute_name = "fade_t"
            for socket, near_colour, far_colour, tag in ((n.inputs["A"], dark, far[1], "fade_shade"), (n.inputs["B"], light, far[0], "fade_lit")):
                g = new("ShaderNodeMix")
                g.data_type = "RGBA"
                g.name = tag
                g.inputs["A"].default_value = linear(near_colour)
                g.inputs["B"].default_value = linear(far_colour)
                t.links.new(height.outputs["Fac"], g.inputs["Factor"])
                t.links.new(g.outputs["Result"], socket)
        t.links.new(step.outputs[0], n.inputs["Factor"])
        return n.outputs["Result"]

    solid = new("ShaderNodeAttribute")
    solid.attribute_name = "solid"
    inside = new("ShaderNodeMath")
    inside.operation = "SUBTRACT"
    t.links.new(geometry.outputs["Backfacing"], inside.inputs[0])
    solid_edge = new("ShaderNodeMath")
    solid_edge.operation = "GREATER_THAN"
    solid_edge.inputs[1].default_value = 0.5
    t.links.new(solid.outputs["Fac"], solid_edge.inputs[0])
    t.links.new(solid_edge.outputs[0], inside.inputs[1])
    inside.use_clamp = True
    pick = new("ShaderNodeMix")
    pick.data_type = "RGBA"
    t.links.new(inside.outputs[0], pick.inputs["Factor"])
    outside = two_tone(base, shade, ends)
    if metal:  # the zip: a band of teeth along the middle of the strip, lit exactly as the cloth is
        across = new("ShaderNodeAttribute")
        across.attribute_name = "zip_across"
        along = new("ShaderNodeAttribute")
        along.attribute_name = "zip_along"
        centred = new("ShaderNodeMath")
        centred.operation = "SUBTRACT"
        centred.inputs[1].default_value = 0.5
        t.links.new(across.outputs["Fac"], centred.inputs[0])
        size = new("ShaderNodeMath")
        size.operation = "ABSOLUTE"
        t.links.new(centred.outputs[0], size.inputs[0])
        band = new("ShaderNodeMath")
        band.operation = "LESS_THAN"
        band.inputs[1].default_value = ZIP_TEETH_BAND
        t.links.new(size.outputs[0], band.inputs[0])
        scaled = new("ShaderNodeMath")
        scaled.operation = "MULTIPLY"
        scaled.inputs[1].default_value = 2 * math.pi / ZIP_TEETH_STEP
        t.links.new(along.outputs["Fac"], scaled.inputs[0])
        wave = new("ShaderNodeMath")
        wave.operation = "SINE"
        t.links.new(scaled.outputs[0], wave.inputs[0])
        tooth = new("ShaderNodeMath")
        tooth.operation = "GREATER_THAN"
        tooth.inputs[1].default_value = -0.35
        t.links.new(wave.outputs[0], tooth.inputs[0])
        teeth = new("ShaderNodeMath")
        teeth.operation = "MULTIPLY"
        t.links.new(band.outputs[0], teeth.inputs[0])
        t.links.new(tooth.outputs[0], teeth.inputs[1])
        on_strip = new("ShaderNodeMix")
        on_strip.data_type = "RGBA"
        t.links.new(teeth.outputs[0], on_strip.inputs["Factor"])
        t.links.new(outside, on_strip.inputs["A"])
        t.links.new(two_tone(*metal), on_strip.inputs["B"])
        outside = on_strip.outputs["Result"]
    if crease:  # valleys of the folds darken, read from the fold attribute
        fold = new("ShaderNodeAttribute")
        fold.attribute_name = "fold"
        shadow = new("ShaderNodeMix")
        shadow.data_type = "RGBA"
        t.links.new(fold.outputs["Fac"], shadow.inputs["Factor"])
        t.links.new(outside, shadow.inputs["A"])
        shadow.inputs["B"].default_value = linear(crease)
        outside = shadow.outputs["Result"]
    t.links.new(outside, pick.inputs["A"])
    inner = two_tone(lining, lining_shade)
    inner.node.name = "lining_tone"  # render.py finds it here to try colours
    t.links.new(inner, pick.inputs["B"])
    t.links.new(pick.outputs["Result"], emit.inputs[0])
    t.links.new(emit.outputs[0], out.inputs[0])
    return m


def subdivided(verts, faces):
    """The cloth as it is drawn, after smoothing: its points and faces."""
    me = bpy.data.meshes.new("smooth_temp")
    me.from_pydata(verts.tolist(), [], faces)
    ob = bpy.data.objects.new("smooth_temp", me)
    bpy.context.scene.collection.objects.link(ob)
    ob.modifiers.new("subsurf", "SUBSURF").levels = 1
    bpy.context.view_layer.update()
    done = ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
    out = np.array([v.co[:] for v in done.vertices])
    out_faces = [list(p.vertices) for p in done.polygons]
    ob.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    return out, out_faces


def fold_depth(verts, faces, body):
    """How far down in a fold each point lies, 0 to 1: its distance below a smoothed copy of the cloth."""
    me = bpy.data.meshes.new("fold_temp")
    me.from_pydata(verts.tolist(), [], faces)
    me.update()
    n = np.empty(len(verts) * 3, np.float32)
    me.vertex_normals.foreach_get("vector", n)
    n = n.reshape(-1, 3).astype(float)
    edges = np.array([list(e.vertices) for e in me.edges])
    bpy.data.meshes.remove(me)
    tree = BVHTree.FromPolygons(bm.get_co(body).tolist(), [list(p.vertices) for p in body.data.polygons], all_triangles=False)
    away = np.array([np.array(v) - np.array(tree.find_nearest(tuple(v))[0]) for v in verts])
    n *= np.where((n * away).sum(1) < 0, -1.0, 1.0)[:, None]  # the reference's own normals are mixed
    smoothed = verts.copy()
    for _ in range(FOLD_ROUNDS):
        total, count = np.zeros_like(smoothed), np.zeros(len(verts))
        np.add.at(total, edges[:, 0], smoothed[edges[:, 1]])
        np.add.at(total, edges[:, 1], smoothed[edges[:, 0]])
        np.add.at(count, edges.ravel(), 1)
        smoothed = smoothed * 0.4 + total / np.maximum(count, 1)[:, None] * 0.6
    return np.clip(((smoothed - verts) * n).sum(1) / FOLD_DEEP, 0, 1)


def quiet_seams(ob, verts, faces):
    """The hull is switched off at seams, where cloth layers meet and it would show as dark cracks."""
    count = {}
    for f in faces:
        for e in zip(f, f[1:] + f[:1]):
            key = tuple(sorted(e))
            count[key] = count.get(key, 0) + 1
    pairs = np.array(sorted(count))
    seam = np.zeros(len(verts), bool)
    seam[[v for e, n in count.items() if n != 2 for v in e]] = True
    seam = bm.grow(seam, pairs, SEAM_QUIET)
    group = ob.vertex_groups.new(name="outline_w")
    group.add(np.flatnonzero(~seam).tolist(), 1.0, "REPLACE")
    ob.modifiers["outline"].vertex_group = "outline_w"
    ob.modifiers["outline"].thickness_vertex_group = 0.0


def garment(name, verts, faces, solid, arm, material, line, levels=1, second=None, slots=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.materials.append(material)
    if second is not None:
        me.materials.append(second)
        me.polygons.foreach_set("material_index", slots)
    attribute = me.attributes.new("solid", "FLOAT", "POINT")
    attribute.data.foreach_set("value", solid.astype(np.float32))
    me.attributes.new("arm", "FLOAT", "POINT").data.foreach_set("value", arm.astype(np.float32))
    if levels:
        sub = ob.modifiers.new("subsurf", "SUBSURF")
        sub.levels = sub.render_levels = levels
    mt.add_outline(ob, line, OUTLINE_WIDTH)
    return ob


def skin_piece(body, keep, cuts):
    """A clean sheet of her skin: the faces of the kept points, cut level at each height, biggest piece only."""
    b = bmesh.new()
    try:
        b.from_mesh(body.data)
        b.verts.ensure_lookup_table()
        bmesh.ops.delete(b, geom=[f for f in b.faces if not all(keep[v.index] for v in f.verts)], context="FACES")
        bmesh.ops.delete(b, geom=[v for v in b.verts if not v.link_faces], context="VERTS")
        for height, keep_above in cuts:
            bmesh.ops.bisect_plane(
                b, geom=b.verts[:] + b.edges[:] + b.faces[:], plane_co=(0, 0, height), plane_no=(0, 0, 1),
                clear_inner=keep_above, clear_outer=not keep_above,
            )
            edge = [v for v in b.verts if abs(v.co.z - height) < 1e-4 and any(e.is_boundary for e in v.link_edges)]
            bmesh.ops.remove_doubles(b, verts=edge, dist=0.002)
        b.verts.index_update()
        points = np.array([v.co[:] for v in b.verts])
        faces = [[v.index for v in f.verts] for f in b.faces]
        edges = np.array([[e.verts[0].index, e.verts[1].index] for e in b.edges])
    finally:
        b.free()
    pieces = hr.islands_of(len(points), edges)
    main_piece = np.argmax(np.bincount(pieces))
    faces = [f for f in faces if pieces[f[0]] == main_piece]  # her forearms pass through the same box
    used = sorted({v for f in faces for v in f})
    remap = {v: i for i, v in enumerate(used)}
    return points[used], [[remap[v] for v in f] for f in faces]


def shorts_shell(body):
    """The part of her skin the shorts cover: waist to hem, cut level at both ends."""
    co = bm.get_co(body)
    keep = (co[:, 2] > SHORTS_HEM - 0.09) & (co[:, 2] < SHORTS_TOP + 0.03) & (np.abs(co[:, 0]) < 0.175)
    return skin_piece(body, keep, ((SHORTS_TOP, False), (SHORTS_HEM, True)))


def refined(points, faces, cuts):
    """The sheet subdivided, smoothly, with each point's normal: its points, normals and faces."""
    b = bmesh.new()
    try:
        added = [b.verts.new(tuple(co)) for co in points.tolist()]
        for f in faces:
            b.faces.new([added[i] for i in f])
        b.edges.ensure_lookup_table()
        bmesh.ops.subdivide_edges(b, edges=b.edges[:], cuts=cuts, use_grid_fill=True, smooth=0.6)
        b.verts.index_update()
        b.normal_update()
        return np.array([v.co[:] for v in b.verts]), np.array([v.normal[:] for v in b.verts]), [[v.index for v in f.verts] for f in b.faces]
    finally:
        b.free()


def sock(body, side, top, band):
    """One sock as a tight shell of her own leg and foot, with a ribbed band at the top if it has one."""
    co = bm.get_co(body)
    p, n, faces = refined(*skin_piece(body, (co[:, 2] < top + 0.03) & (co[:, 0] * side > 0), ((top, False),)), 3 if band else 1)
    p[:, 2] = np.minimum(p[:, 2], top)  # subdividing with smoothing bulges the open edge
    h = np.full(len(p), SOCK_EASE)
    if band:
        z = p[:, 2]
        d = p[:, :2] - p[z > top - band, :2].mean(0)
        h += smooth_steps(z, top - band - 0.0015, top - band) * (BAND_PROUD + BAND_RIB_DEPTH * np.cos(BAND_RIBS * np.arctan2(d[:, 1], d[:, 0])))
        h += trench(np.abs(z - (top - band)), 0.0012, 0.0012)
    return p + n * h[:, None], faces


def offset_shell(points, faces):
    """Moves the sheet off her skin: snug at the hips, roomier down the leg, and only just clear between her thighs."""
    me = bpy.data.meshes.new("shell_temp")
    me.from_pydata(points.tolist(), [], faces)
    me.update()
    n = np.empty(len(points) * 3, np.float32)
    me.vertex_normals.foreach_get("vector", n)
    n = n.reshape(-1, 3).astype(float)
    edges = np.array([list(e.vertices) for e in me.edges])
    bpy.data.meshes.remove(me)
    z = points[:, 2]
    down = np.clip((CROTCH - z) / (CROTCH - SHORTS_HEM), 0, 1)
    gap = np.where(z > CROTCH, SHORTS_EASE, LEG_EASE + HEM_OPEN * down)
    gap = np.where((np.abs(points[:, 0]) < 0.035) & (z < CROTCH + 0.02), 0.0025, gap)
    gap = bm.smooth_field(gap, edges, np.ones(len(points), bool), 6)
    out = points + n * gap[:, None]

    # Stiff cloth does not follow her into the crease at the front: it bridges across from one thigh to the other.
    centre_y = out[:, 1].mean()
    front = out[:, 1] < centre_y
    heights = np.arange(max(CROTCH - 0.03, SHORTS_HEM + 0.002), CROTCH + 0.12, 0.006)
    plane = [out[front & (np.abs(z - h) < 0.008) & (np.abs(out[:, 0]) < 0.09), 1].min() for h in heights]
    plane = bd.smoothed(np.array(plane), 3.0)
    across = 1 - smooth_steps(np.abs(out[:, 0]), 0.025, 0.09)
    along = smooth_steps(z, CROTCH - 0.02, CROTCH + 0.012) * (1 - smooth_steps(z, CROTCH + 0.09, CROTCH + 0.12))
    weight = across * along * front
    out[:, 1] += (np.interp(z, heights, plane) - out[:, 1]) * weight
    return out


def to_segments(points2d, line):
    """Distance from each 2D point to a polyline."""
    best = np.full(len(points2d), 1e9)
    for a, b in zip(line[:-1], line[1:]):
        a, b = np.array(a, float), np.array(b, float)
        ab = b - a
        t = np.clip(((points2d - a) @ ab) / max(float(ab @ ab), 1e-9), 0, 1)
        best = np.minimum(best, np.linalg.norm(points2d - (a + t[:, None] * ab), axis=1))
    return best


def inside(points2d, polygon):
    """True for points inside a closed polygon."""
    x, y = points2d[:, 0], points2d[:, 1]
    result = np.zeros(len(points2d), bool)
    for (x0, y0), (x1, y1) in zip(polygon, polygon[1:] + polygon[:1]):
        crosses = (y0 > y) != (y1 > y)
        result ^= crosses & (x < (x1 - x0) * (y - y0) / (y1 - y0 + 1e-12) + x0)
    return result


def trench(distance, width, depth):
    """A soft groove along a line."""
    return -depth * np.exp(-((distance / width) ** 2))


def denim_detail(points, faces):
    """Models the details of H and C into the shorts: waistband, loops, fly, pockets, seams and soft folds."""
    p, n, out_faces = refined(points, faces, 2)
    p[:, 2] = np.maximum(p[:, 2], SHORTS_HEM)  # subdividing with smoothing sags the open hem
    x, z = p[:, 0], p[:, 2]
    flat = np.column_stack([x, z])
    mirror = np.column_stack([np.abs(x), z])
    front = smooth_steps(-n[:, 1], -0.15, 0.15)
    back = 1 - front
    h = np.zeros(len(p))

    # Waistband and belt loops, as on both references.
    h += 0.0022 * smooth_steps(z, WAISTBAND, WAISTBAND + 0.002)
    h += trench(np.abs(z - WAISTBAND), 0.0013, 0.0015)
    loops = [(0.060, front), (0.132, front), (0.055, back), (0.0, back)]
    for at, facing in loops:
        h += 0.0034 * facing * smooth_steps(0.0065 - np.abs(np.abs(x) - at), 0.0, 0.0015) * smooth_steps(z, WAISTBAND - 0.006, WAISTBAND - 0.004)

    # The fly: a raised flap down the front with a curved row of stitching, and the centre seam.
    flap = inside(flat, [(-0.004, WAISTBAND), (0.025, WAISTBAND), (0.025, 0.848), (0.018, 0.826), (-0.004, 0.810)])
    h += 0.0017 * flap * front
    h += trench(to_segments(flat, [(0.0, 0.985), (0.0, CROTCH + 0.004)]), 0.0013, 0.0024) * front
    h += trench(to_segments(flat, [(0.0255, WAISTBAND), (0.0255, 0.848), (0.018, 0.826), (0.003, 0.812)]), 0.0009, 0.0012) * front

    # Angled front pockets, with a row of stitching beside the opening.
    opening = [(0.052, WAISTBAND), (0.082, 0.928), (0.120, 0.908), (0.158, 0.900)]
    h += trench(to_segments(mirror, opening), 0.0014, 0.0030) * front
    h += trench(to_segments(mirror, [(a, c - 0.0045) for a, c in opening]), 0.0008, 0.0010) * front

    # Yoke, centre back seam and patch pockets.
    yoke = [(0.0, 0.925), (0.16, 0.957)]
    h += trench(to_segments(mirror, yoke), 0.0014, 0.0024) * back
    h += trench(to_segments(flat, [(0.0, 0.985), (0.0, CROTCH)]), 0.0013, 0.0024) * back
    pocket = [(0.034, 0.918), (0.124, 0.918), (0.127, 0.860), (0.082, 0.832), (0.037, 0.860)]
    edge = to_segments(mirror, pocket + pocket[:1])
    is_in = inside(mirror, pocket)
    h += 0.0027 * smooth_steps(edge, 0.0, 0.0022) * is_in * back
    h += trench(np.abs(edge - 0.0042), 0.0008, 0.0011) * is_in * back

    # Side seam: found by which way the surface faces.
    across = np.abs(n[:, 1]) * 0.06
    outer = (n[:, 0] * np.sign(x)) > 0.3
    h += (trench(across, 0.0016, 0.0024) + trench(np.abs(across - 0.0042), 0.0008, 0.0010)) * outer

    # A few light creases rising from the crotch, deliberately unlike from one leg to the other.
    folds = [
        ([(0.030, 0.787), (0.078, 0.797), (0.128, 0.815)], 0.0045, 0.0016),
        ([(0.060, 0.774), (0.105, 0.780)], 0.0035, 0.0009),
        ([(-0.040, 0.794), (-0.100, 0.804)], 0.0050, 0.0013),
    ]
    for line, width, depth in folds:
        h += trench(to_segments(flat, line), width, depth) * front
    smiles = [
        ([(0.040, 0.780), (0.100, 0.774), (0.140, 0.783)], 0.0045, 0.0014),
        ([(-0.055, 0.789), (-0.115, 0.784)], 0.0040, 0.0010),
    ]
    for line, width, depth in smiles:
        h += trench(to_segments(flat, line), width, depth) * back

    print("shorts detail verts", len(p))
    return p + n * h[:, None], out_faces


def rolled_cuff(points, side):
    """A soft rolled band following the exact outline of one leg opening."""
    ring = points[(np.sign(points[:, 0]) == side) & (points[:, 2] < SHORTS_HEM + 0.002)]
    centre = (ring[:, :2].min(0) + ring[:, :2].max(0)) / 2
    d = ring[:, :2] - centre
    angle, radius = np.arctan2(d[:, 1], d[:, 0]), np.linalg.norm(d, axis=1)
    order = np.argsort(angle)
    around, tube = 160, 24
    verts, faces = [], []
    smooth_radius = np.interp(np.linspace(-np.pi, np.pi, around, endpoint=False), angle[order], radius[order], period=2 * np.pi)
    smooth_radius = np.convolve(np.r_[smooth_radius[-3:], smooth_radius, smooth_radius[:3]], np.ones(7) / 7, mode="valid")
    drop, dents = HEM_UNEVEN[side]
    for i, r in enumerate(smooth_radius):
        a = -np.pi + 2 * np.pi * i / around
        sag = -sum(depth * (0.5 + 0.5 * math.sin(count * a + phase)) for count, phase, depth in drop)
        pinch = sum(depth * math.exp(-(((math.atan2(math.sin(a - at), math.cos(a - at))) / width) ** 2)) for at, width, depth in dents)
        for j in range(tube):
            b = 2 * math.pi * j / tube
            flat_out = math.copysign(abs(math.cos(b)) ** CUFF_SQUARE, math.cos(b))
            flat_up = math.copysign(abs(math.sin(b)) ** CUFF_SQUARE, math.sin(b))
            out = r - 0.001 + CUFF_WIDTH * (flat_out * 0.5 + 0.5) - pinch * max(flat_out, 0.0)
            height = SHORTS_HEM + CUFF_HEIGHT * 0.5 * (1 + flat_up) - 0.002 + sag
            verts.append((centre[0] + out * math.cos(a), centre[1] + out * math.sin(a), height))
    for i in range(around):
        for j in range(tube):
            n, m = (i + 1) % around, (j + 1) % tube
            faces.append([i * tube + j, n * tube + j, n * tube + m, i * tube + m])
    return np.array(verts), faces


def load_sneaker(side):
    """The reference sneaker for one foot: the file holds a pair, one on each side of x = 0."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SNEAKER))
    new = [o for o in bpy.data.objects if o not in before]
    bpy.context.view_layer.update()
    source = next(o for o in new if o.type == "MESH")
    p = bm.get_co(source)
    m = np.array(source.matrix_world)
    p = p @ m[:3, :3].T + m[:3, 3]
    polys = [f for f in source.data.polygons if all(p[v, 0] * side > 0 for v in f.vertices)]
    faces = [list(f.vertices) for f in polys]
    is_sole = sole_faces(source, polys, p, p[:, 2].min())
    for o in new:
        bpy.data.objects.remove(o)
    used = sorted({v for f in faces for v in f})
    remap = {v: i for i, v in enumerate(used)}
    return p[used], [[remap[v] for v in f] for f in faces], is_sole


def sole_faces(source, polys, points, bottom):
    """Which faces are the sole: pale grey in the reference's own painted texture, or right at the bottom."""
    image = bpy.data.images.load(str(SNEAKER.parent / "textures" / "Shoes_baseColor.png"))
    w, h = image.size
    pixels = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(h, w, 4)
    bpy.data.images.remove(image)
    uv = source.data.uv_layers.active.data
    result = []
    for f in polys:
        at = np.mean([uv[i].uv[:] for i in f.loop_indices], axis=0) % 1.0
        r, g, b = pixels[int(at[1] * (h - 1)), int(at[0] * (w - 1)), :3]
        grey = max(r, g, b) > 0.5 and max(r, g, b) - min(r, g, b) < 0.12 * max(r, g, b)
        result.append(grey or points[list(f.vertices), 2].mean() < bottom + SOLE_LINE)
    return np.array(result)


def plan_axis(points):
    """Which way a sole points in plan: its long axis, turned towards her front."""
    flat = points[:, :2] - points[:, :2].mean(0)
    axis = np.linalg.svd(flat, full_matrices=False)[2][0]
    return axis if axis[1] < 0 else -axis


def fit_sneaker(p, foot):
    """Sizes the sneaker evenly to her foot and turns it the way her foot points; its sole goes under her foot."""
    aim = plan_axis(foot[foot[:, 2] < 0.02])
    side = np.array([-aim[1], aim[0]])
    own = plan_axis(p[p[:, 2] < p[:, 2].min() + 0.012])
    turn = math.atan2(aim[1], aim[0]) - math.atan2(own[1], own[0])
    c, s = math.cos(turn), math.sin(turn)
    flat = p[:, :2] @ np.array([[c, s], [-s, c]])
    size = (np.ptp(foot[:, :2] @ aim) + HEEL_ROOM + TOE_ROOM) / np.ptp(flat @ aim)
    flat *= size
    z = p[:, 2] * size
    along = (foot[:, :2] @ aim).min() - HEEL_ROOM - (flat @ aim).min()
    across = (foot[:, :2] @ side).min() + np.ptp(foot[:, :2] @ side) / 2 - (flat @ side).min() - np.ptp(flat @ side) / 2
    fitted = np.column_stack([flat + aim * along + side * across, z])
    fitted[:, 2] += -SOLE_DEPTH - fitted[:, 2].min()
    print("sneaker size", round(size, 3), "turned", round(math.degrees(turn), 1), "sole below her foot", round(-float(fitted[:, 2].min()), 4), "top", round(float(fitted[:, 2].max()), 4))
    return fitted


def slim_foot(ob, skin):
    """Her foot is wider and higher than the sneaker's solid shell, so inside the shoe it is slimmed, smoothly."""
    co = bm.get_co(ob)
    out = co.copy()
    for side in (1, -1):
        foot = skin[(skin[:, 2] < 0.02) & (skin[:, 0] * side > 0)]
        aim = plan_axis(foot)
        across = np.array([-aim[1], aim[0]])
        middle = (foot[:, :2] @ across).min() + np.ptp(foot[:, :2] @ across) / 2
        here = (co[:, 2] < FOOT_FREE) & (co[:, 0] * side > 0)
        z, y = co[here, 2], co[here, 1]
        offset = co[here, :2] @ across - middle
        narrow = FOOT_WIDTH + (1 - FOOT_WIDTH) * smooth_steps(z, 0.03, 0.075)
        out[here, :2] += across * (offset * (narrow - 1))[:, None]
        forward = co[here, :2] @ aim
        centre = (foot[:, :2] @ aim).min() + np.ptp(foot[:, :2] @ aim) / 2
        shorter = FOOT_LENGTH + (1 - FOOT_LENGTH) * smooth_steps(z, 0.045, 0.08)
        out[here, :2] += aim * ((forward - centre) * (shorter - 1))[:, None]
        lower = smooth_steps(-y, 0.01, 0.03) * (1 - smooth_steps(z, 0.07, FOOT_FREE))
        out[here, 2] = z * (1 - (1 - FOOT_HEIGHT) * lower)
    bm.set_co(ob, out)


def around(angles, values, bins=36):
    """A smooth closed profile: for each angle bin the given values' minimum, gaps filled from their neighbours."""
    index = ((angles + np.pi) / (2 * np.pi) * bins).astype(int) % bins
    found = np.array([values[index == b].min() if (index == b).any() else np.nan for b in range(bins)])
    centres = (np.arange(bins) + 0.5) / bins * 2 * np.pi - np.pi
    known = ~np.isnan(found)
    filled = np.interp(centres, centres[known], found[known], period=2 * np.pi)
    smooth = np.convolve(np.r_[filled[-2:], filled, filled[:2]], np.ones(5) / 5, mode="valid")
    return lambda a: np.interp(a, centres, smooth, period=2 * np.pi)


def snug_collar(points, faces, leg):
    """Draws the sneaker's collar in until it sits just off her ankle all the way round."""
    near_ankle = leg[(leg[:, 2] > 0.05) & (leg[:, 2] < 0.09)]
    centre = (near_ankle[:, :2].min(0) + near_ankle[:, :2].max(0)) / 2
    tree = BVHTree.FromPolygons(points.tolist(), faces, all_triangles=False)
    floor = tree.ray_cast((centre[0], centre[1], 0.3), (0, 0, -1))[0][2]
    d = near_ankle[:, :2] - centre
    ankle = around(np.arctan2(d[:, 1], d[:, 0]), -np.linalg.norm(d, axis=1))  # the widest of her ankle at each angle
    rel = points[:, :2] - centre
    r = np.linalg.norm(rel, axis=1)
    a = np.arctan2(rel[:, 1], rel[:, 0])
    wall = (points[:, 2] > floor + 0.004) & (r < COLLAR_REACH)
    inner = around(a[wall], r[wall])(a)
    target = -ankle(a) + COLLAR_GAP
    pull = np.maximum(inner - target, 0.0)
    height = smooth_steps(points[:, 2], floor - 0.03, floor + 0.002)
    fade = 1 - smooth_steps(r, inner + 0.015, inner + 0.06)
    new_r = np.where(r < inner, r * target / np.maximum(inner, 1e-6), r - pull) * height * fade + r * (1 - height * fade)
    print("sneaker collar floor", round(floor, 4), "pulled in by up to", round(float(pull.max()), 4), "mean", round(float(pull[wall].mean()), 4))
    out = points.copy()
    out[:, :2] = centre + rel * (new_r / np.maximum(r, 1e-6))[:, None]
    return out


def tuck_heel(ob, foot_side, shoe, centre, top):
    """The drawn-in collar pulls the back of the shoe in over her heel: the heel follows, just inside it."""
    co = bm.get_co(ob)
    out = co.copy()
    for i in np.flatnonzero((co[:, 0] * foot_side > 0) & (co[:, 2] < top) & (co[:, 1] > centre[1] - 0.01)):
        rel = co[i, :2] - centre
        r = np.linalg.norm(rel)
        if r < 1e-6:
            continue
        way = rel / r
        start = (*(centre + way * 0.3), co[i, 2])
        hit = shoe.ray_cast(start, (-way[0], -way[1], 0.0))[0]
        if hit is not None:
            wall = np.linalg.norm(np.array(hit[:2]) - centre)
            if r > wall - HEEL_INSIDE:
                out[i, :2] = centre + way * (wall - HEEL_INSIDE)
    bm.set_co(ob, out)


def without_strands(p, faces, labels):
    """The upper drawstrings are part of the hood trim: anything of it hanging below the neck goes."""
    drop = (labels == "trim") & (p[:, 2] < STRAND_CUT) & (p[:, 1] < -0.02)
    keep = ~drop
    index = np.cumsum(keep) - 1
    return p[keep], [[int(index[v]) for v in f] for f in faces if keep[f].all()], labels[keep]


def without_cords(p, faces, labels):
    """Drops the drawstrings from the reference: its points, faces and their labels."""
    keep = labels != "cord"
    index = np.cumsum(keep) - 1
    return p[keep], [[int(index[v]) for v in f] for f in faces if keep[f].all()], labels[keep]


def main():
    body = bpy.data.objects["Body"]
    p, faces, pieces = load_reference()
    p = square_up(p)
    names = name_pieces(p, pieces)
    for k in names:
        q = p[pieces == k]
        print("piece", k, names[k], len(q), "size", np.ptp(q, axis=0).round(3), "mean", q.mean(0).round(3))

    labels = np.array([names[k] for k in pieces])
    p, faces, labels = without_cords(p, faces, labels)
    panels = np.isin(labels, ["body"])
    top = p[panels, 2].max()
    chest = p[panels & (np.abs(p[:, 2] - (top - 0.17)) < 0.03)]
    centre_x = (chest[:, 0].min() + chest[:, 0].max()) / 2
    centre_y = (chest[:, 1].min() + chest[:, 1].max()) / 2
    p = (p - np.array([centre_x, centre_y, top])) * SCALE + np.array([0.0, CHEST_CENTRE_Y, SHOULDER_TOP])

    p = fit_sleeves(p, labels, her_arm(body))
    p = rest_on_shoulders(p, labels, body)
    p = fit_shoulders(p, labels, body)
    p = lengthen(p, labels)
    p, faces, labels = without_strands(p, faces, labels)
    # Only the inside of the hood is lined: everywhere else both layers of cloth count as outside.
    trim = KDTree(int((labels == "trim").sum()))
    for k, co in enumerate(p[labels == "trim"]):
        trim.insert(co, k)
    trim.balance()
    near_trim = 1 - np.clip((np.array([trim.find(co)[2] for co in p]) - TRIM_CLEAR) / TRIM_FADE, 0, 1)
    verts, polys, solid, arm = sewn(p, faces, np.maximum((labels != "hood").astype(float), near_trim), np.isin(labels, ["sleeve", "cuff"]).astype(float))
    pattern = KDTree(len(p))
    for k, co in enumerate(p):
        pattern.insert(co, k)
    pattern.balance()
    welded = np.array([labels[pattern.find(co)[1]] for co in verts])
    seams = edge_pairs(polys)
    line = her_arm(body)
    for _ in range(FIT_PASSES):  # each pass measures the cloth as the last one left it
        verts = straighten_sleeves(verts, arm, line, seams)
        verts = settle_on_chest(verts, welded, seams, body)
    verts = even_out_chest(verts, polys, welded, seams)
    sheet, sheet_faces = shorts_shell(body)
    fitted = offset_shell(sheet, sheet_faces)
    verts = keep_off_body(verts, polys, body, (fitted, sheet_faces), together=np.isin(welded, ["hood", "trim"]))
    verts = curl_ends(verts, arm)
    verts, polys, solid, arm, zip_top = zipper.open_front(verts, polys, solid, arm)
    print("hoodie verts", len(verts), "hem z", round(float(verts[:, 2].min()), 3))

    line = mt.outline_material("outline_cloth", pal.OUTLINE)
    hoodie = garment("hoodie", verts, polys, solid, arm, cloth_material("hoodie", pal.HOODIE, pal.HOODIE_SHADE, pal.LINING, pal.LINING_SHADE, soft=CLOTH_SOFT, crease=pal.HOODIE_CREASE), line)

    quiet_seams(hoodie, verts, polys)
    fold = fold_depth(verts, polys, body)
    hoodie.data.attributes.new("fold", "FLOAT", "POINT").data.foreach_set("value", fold.astype(np.float32))
    strip = cloth_material("zip_strip", pal.HOODIE_SHADE, pal.HOODIE_CREASE, pal.LINING, pal.LINING_SHADE, soft=CLOTH_SOFT, crease=pal.HOODIE_CREASE, metal=(pal.ZIP, pal.ZIP_DARK))
    slider = cloth_material("zip_slider", pal.ZIP, pal.ZIP_DARK, pal.ZIP, pal.ZIP_DARK, cut=0.9, soft=CLOTH_SOFT)
    zipper.build(*subdivided(verts, polys), verts, fold, zip_top, HEM_BOTTOM, strip, slider)
    cloth = cloth_material("shorts", pal.SHORTS, pal.SHORTS_SHADE, pal.SHORTS_SHADE, pal.SHORTS_SHADE, soft=CLOTH_SOFT)
    detailed, detailed_faces = denim_detail(fitted, sheet_faces)
    blank = np.zeros(len(detailed))
    garment("shorts", detailed, detailed_faces, blank, blank, cloth, line, levels=0)
    for side, tag in ((1, "L"), (-1, "R")):
        cv, cf = rolled_cuff(fitted, side)
        garment(f"shorts_cuff_{tag}", cv, cf, np.zeros(len(cv)), np.zeros(len(cv)), cloth, line)
    sock_cloth = cloth_material("sock", pal.SOCK, pal.SOCK_SHADE, pal.SOCK_SHADE, pal.SOCK_SHADE, ends=(pal.SOCK_END, pal.SOCK_END_SHADE))
    for name, side, top, band in (("stocking", 1, STOCKING_TOP, 0.0), ("ankle_sock", -1, ANKLE_SOCK_TOP, ANKLE_BAND)):
        sv, sf = sock(body, side, top, band)
        worn = garment(name, sv, sf, np.zeros(len(sv)), np.zeros(len(sv)), sock_cloth, line, levels=0)
        fade = np.clip((STOCKING_TOP - sv[:, 2]) / (STOCKING_TOP - FADE_BOTTOM), 0, 1)
        worn.data.attributes.new("fade_t", "FLOAT", "POINT").data.foreach_set("value", fade.astype(np.float32))
    shoe = cloth_material("sneaker", pal.SHOE, pal.SHOE_SHADE, pal.SHOE_SHADE, pal.SHOE_SHADE, soft=0.08)
    sole = cloth_material("sneaker_sole", pal.SOLE, pal.SOLE_SHADE, pal.SOLE_SHADE, pal.SOLE_SHADE, soft=0.08)
    skin = bm.get_co(body)
    legs = {"L": bpy.data.objects["stocking"], "R": bpy.data.objects["ankle_sock"]}
    for ob in (*legs.values(), body):
        slim_foot(ob, skin)
    for tag, foot_side in (("L", 1), ("R", -1)):
        points, shoe_faces, is_sole = load_sneaker(foot_side)
        points = fit_sneaker(points, skin[(skin[:, 2] < 0.13) & (skin[:, 0] * foot_side > 0)])
        blank = np.zeros(len(points))
        sv, sf, _, _ = sewn(points, shoe_faces, blank, blank, hem_slit=0)
        centres = KDTree(len(shoe_faces))
        for k, f in enumerate(shoe_faces):
            centres.insert(points[f].mean(0), k)
        centres.balance()
        slots = [int(is_sole[centres.find(sv[f].mean(0))[1]]) for f in sf]
        sv = snug_collar(sv, sf, bm.get_co(legs[tag]))
        garment(f"sneaker_{tag}", sv, sf, np.zeros(len(sv)), np.zeros(len(sv)), shoe, line, second=sole, slots=slots)
        ankle = bm.get_co(legs[tag])
        ankle = ankle[(ankle[:, 2] > 0.05) & (ankle[:, 2] < 0.09), :2]
        middle = (ankle.min(0) + ankle.max(0)) / 2
        tree = BVHTree.FromPolygons(sv.tolist(), sf, all_triangles=False)
        for ob in (legs[tag], body):
            tuck_heel(ob, foot_side, tree, middle, float(sv[:, 2].max()))
    bpy.ops.wm.save_as_mainfile(filepath=str(bm.ROOT / "spica-v2-clothes.blend"))


if __name__ == "__main__":
    main()
