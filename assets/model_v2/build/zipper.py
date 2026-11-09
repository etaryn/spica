# Her hoodie's zip: slits the front from the neck to the slider, lets the two sides fall open in a curve, and lays the zip on the cloth.
# The zip is one strip on the cloth's own surface, shaded by the hoodie's shader; the closed part runs along the real folds of the mesh.
import math

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

POINT = 1.175  # the slider's height: level with her bust
TOP_LIMIT = 1.33  # the slit stops at the neck
NECK_END = 1.306  # the zip carries on up the edge of the neckline to here
OPEN = {1: 0.034, -1: 0.032}  # how far each side has fallen open at the top of the slit
FAN = 1.7  # above 1 the opening stays narrow low down and sweeps outwards towards the neck
# Unevenness of each edge: (waves over the slit's height, phase, size in metres).
UNEVEN = {1: ((2.3, 0.4, 0.0034), (5.1, 1.9, 0.0013)), -1: ((1.7, 2.6, 0.0040), (4.3, 0.2, 0.0015))}
SPREAD_REACH = 0.10  # cloth this far from the centre eases along with it
TAPE_WIDTH = 0.0075
LIFT = 0.0012  # how far the strip sits off the cloth
STEP = 0.003  # the strip's rows
SLIDER = (0.0065, 0.0095, 0.0028)
PULL = (0.0032, 0.0135, 0.0009)
TRACK_REACH, TRACK_STEP = 0.008, 0.001  # the closed zip looks for the fold line within this far of the centre
TRACK_STIFF = 0.00015  # what a sideways step costs against how deep the fold is, in metres
TRACK_CENTRE = 6.0  # how strongly it is held towards the centre line, so it ends at the middle of the hem
FOLD_ON_STRIP = 0.35  # the zip takes this share of the cloth's crease shadow, or the teeth vanish in the deepest folds
LEAVE_SLIDER = 14  # rows below the slider over which it may start to move off centre
JUMP = 0.012  # a neck-edge row this far from the last has jumped to other cloth: the zip ends there


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def blur(a, size):
    half = size // 2
    return np.convolve(np.r_[[a[0]] * half, a, [a[-1]] * half], np.ones(size) / size, mode="valid")


def front_hit(tree, x, z):
    """The outermost cloth at this place, seen from the front: its point and outward normal, or None."""
    found = tree.ray_cast((float(x), -0.5, float(z)), (0, 1, 0))
    if found[0] is None:
        return None
    normal = Vector(found[1])
    return found[0], -normal if normal.y > 0 else normal


def fallen_open(z, top, side):
    """How far one edge has moved from the centre at this height: a curve, a little different on each side."""
    t = float(np.clip((z - POINT) / (top - POINT), 0, 1))
    waves = sum(size * math.sin(count * math.pi * t + phase) for count, phase, size in UNEVEN[side])
    return OPEN[side] * t**FAN + waves * math.sin(math.pi * t)


def open_front(verts, faces, solid, arm):
    """Slits the front at x = 0 from the slider's height to the neck and lets the two sides fall open."""
    b = bmesh.new()
    try:
        solid_layer = b.verts.layers.float.new("solid")
        arm_layer = b.verts.layers.float.new("arm")
        added = [b.verts.new(tuple(co)) for co in verts.tolist()]
        for v, s, a in zip(added, solid.tolist(), arm.tolist()):
            v[solid_layer], v[arm_layer] = s, a
        for f in faces:
            b.faces.new([added[i] for i in f])
        b.edges.ensure_lookup_table()
        region = [f for f in b.faces if all(v.co.y < -0.03 and abs(v.co.x) < 0.07 and POINT - 0.02 < v.co.z < TOP_LIMIT + 0.02 for v in f.verts)]
        geom = list({*region, *(e for f in region for e in f.edges), *(v for f in region for v in f.verts)})
        cut = bmesh.ops.bisect_plane(b, geom=geom, plane_co=(0, 0, 0), plane_no=(1, 0, 0), dist=1e-5)["geom_cut"]
        slit = [e for e in cut if isinstance(e, bmesh.types.BMEdge) and all(POINT - 1e-4 <= v.co.z <= TOP_LIMIT for v in e.verts) and e.link_faces]
        top = max(v.co.z for e in slit for v in e.verts)
        bmesh.ops.split_edges(b, edges=slit)
        b.verts.ensure_lookup_table()
        for v in b.verts:
            if not v.link_faces or v.co.z < POINT or abs(v.co.x) > SPREAD_REACH or v.co.y > -0.02:
                continue
            side = int(np.sign(np.mean([f.calc_center_median().x for f in v.link_faces])))
            amount = fallen_open(v.co.z, top, side) * (1 - float(smooth(abs(v.co.x), 0.0, SPREAD_REACH))) * (1 - float(smooth(v.co.z, top + 0.02, top + 0.09)))
            v.co.x += side * amount
        b.verts.index_update()
        new_verts = np.array([v.co[:] for v in b.verts])
        new_faces = [[v.index for v in f.verts] for f in b.faces]
        new_solid = np.array([v[solid_layer] for v in b.verts])
        new_arm = np.array([v[arm_layer] for v in b.verts])
    finally:
        b.free()
    print("zip open from", POINT, "to", round(top, 4))
    return new_verts, new_faces, new_solid, new_arm, top


def track_folds(tree, hem_bottom):
    """The line of the closed zip: from the slider down, the path that lies deepest in the cloth's real folds."""
    heights = np.arange(POINT, hem_bottom + 0.003, -0.004)
    columns = np.arange(-TRACK_REACH, TRACK_REACH + 1e-6, TRACK_STEP)
    depth = np.zeros((len(heights), len(columns)))
    for r, z in enumerate(heights):
        for c, x in enumerate(columns):
            hit = front_hit(tree, x, z)
            depth[r, c] = hit[0].y if hit else np.nan
        row = depth[r]
        row[np.isnan(row)] = np.nanmin(row)
        depth[r] = row - np.polyval(np.polyfit(columns, row, 1), columns) - TRACK_CENTRE * columns**2  # folds only, not the overall tilt
    middle = len(columns) // 2
    best = np.full(depth.shape, -1e9)
    came = np.zeros(depth.shape, int)
    best[0, middle] = 0.0  # it starts at the slider, at the centre
    for r in range(1, len(heights)):
        for c in range(len(columns)):
            options = [(best[r - 1, p] - TRACK_STIFF * (c - p) ** 2, p) for p in range(max(c - 1, 0), min(c + 2, len(columns))) ]
            score, p = max(options)
            best[r, c], came[r, c] = score + depth[r, c], p
    c = int(np.argmax(best[-1]))
    path = []
    for r in range(len(heights) - 1, -1, -1):
        path.append(columns[c])
        c = came[r, c]
    x = blur(np.array(path[::-1]), 7)
    x[:LEAVE_SLIDER] *= smooth(np.arange(LEAVE_SLIDER), 0, LEAVE_SLIDER - 1)  # it leaves the slider on the centre line
    return heights, x


def neck_edge(tree, side, heights):
    """Where the neckline's edge is on one side at each height: the first cloth met going out from the centre."""
    found = []
    for z in heights:
        for x in np.arange(0.004, 0.09, 0.001):
            hit = front_hit(tree, side * x, z)
            if hit and hit[0].y < -0.02:
                found.append(side * float(x))
                break
        else:
            found.append(found[-1] if found else side * 0.04)
    return blur(np.array(found), 5)


def open_edge(tree, side, top):
    """One open edge from the slider up: the fallen-open curve, running on into the neckline."""
    low = np.arange(POINT, top, STEP)
    x_low = np.array([side * fallen_open(z, top, side) for z in low])
    high = np.arange(top, NECK_END, STEP)
    x_high = neck_edge(tree, side, high)
    join = x_low[-1] - x_high[0]
    x_high = x_high + join * (1 - smooth(high, top, top + 0.02))
    return np.r_[low, high], np.r_[x_low, x_high]


def add_box(points, faces, centre, along, across, out, half):
    start = len(points)
    for i in (-1, 1):
        for j in (-1, 1):
            for k in (-1, 1):
                points.append(centre + along * (i * half[0]) + across * (j * half[1]) + out * (k * half[2]))
    faces.extend([[start + a for a in f] for f in ((0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3))])


class Strip:
    """The zip's surface: rows of points on the cloth, each carrying where it is across and along the zip."""

    def __init__(self):
        self.points, self.faces, self.across, self.along = [], [], [], []

    def add_run(self, rows, across_values):
        """rows: a list of rows of points, every row the same length across."""
        start = len(self.points)
        run = 0.0
        width = len(across_values)
        for r, row in enumerate(rows):
            if r:
                run += (row[width // 2] - rows[r - 1][width // 2]).length
            for point, a in zip(row, across_values):
                self.points.append(point)
                self.across.append(0.5 + 0.5 * a)
                self.along.append(run)
        for r in range(len(rows) - 1):
            for c in range(width - 1):
                n = start + r * width + c
                self.faces.append([n, n + width, n + width + 1, n + 1])


def cloth_point(tree, x, z, fallback=None):
    hit = front_hit(tree, x, z)
    if hit is None:
        return fallback
    return hit[0] + hit[1] * LIFT


def build(verts, faces, base_verts, fold, top, hem_bottom, strip_material, metal_material):
    """Lays the zip on the cloth as drawn: the closed run and the two open edges, with slider and pull at the point of the V."""
    tree = BVHTree.FromPolygons(verts.tolist(), faces, all_triangles=False)
    strip = Strip()

    heights, x = track_folds(tree, hem_bottom)
    across = (-1.0, -0.5, 0.0, 0.5, 1.0)
    rows = []
    for z, centre in zip(heights, x):
        row = [cloth_point(tree, centre + a * TAPE_WIDTH, z) for a in across]
        if all(p is not None for p in row):
            rows.append(row)
    strip.add_run(rows, across)

    across_open = (0.0, 0.5, 1.0)
    for side in (1, -1):
        z_line, x_line = open_edge(tree, side, top)
        rows = []
        last = None
        for z, edge in zip(z_line, x_line):
            row = [cloth_point(tree, edge + side * (0.0015 + a * TAPE_WIDTH), z) for a in across_open]
            if row[0] is None or row[2] is None:
                continue
            if row[1] is None:
                row[1] = (row[0] + row[2]) / 2
            row[0] = row[0] + Vector((-side * 0.0015, 0, 0))  # the teeth sit right on the cloth's edge
            if last is not None and (row[0] - last[0]).length > JUMP:
                break
            rows.append(row)
            last = row
        strip.add_run(rows, across_open)

    near = KDTree(len(base_verts))
    for i, co in enumerate(base_verts):
        near.insert(co, i)
    near.balance()
    strip_fold = [float(fold[near.find(p)[1]]) * FOLD_ON_STRIP for p in strip.points]

    me = bpy.data.meshes.new("zip_strip")
    me.from_pydata([tuple(p) for p in strip.points], [], strip.faces)
    me.update()
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.materials.append(strip_material)
    for name, values in (("zip_across", strip.across), ("zip_along", strip.along), ("fold", strip_fold), ("solid", [1.0] * len(strip.points))):
        me.attributes.new(name, "FLOAT", "POINT").data.foreach_set("value", np.array(values, np.float32))
    ob = bpy.data.objects.new("zip_strip", me)
    bpy.context.scene.collection.objects.link(ob)

    metal_p, metal_f = [], []
    hit = front_hit(tree, 0.0, POINT - 0.002)
    along, sideways, out = Vector((0, 0, 1)), Vector((1, 0, 0)), Vector((0, -1, 0))
    slider_at = hit[0] + out * (LIFT + SLIDER[2] + 0.001)
    add_box(metal_p, metal_f, slider_at, along, sideways, out, SLIDER)
    add_box(metal_p, metal_f, slider_at + out * SLIDER[2] - along * (SLIDER[0] + PULL[1] * 0.9), sideways, along, out, PULL)
    pull = bpy.data.meshes.new("zip_slider")
    pull.from_pydata([tuple(p) for p in metal_p], [], metal_f)
    pull.update()
    pull.materials.append(metal_material)
    slider = bpy.data.objects.new("zip_slider", pull)
    bpy.context.scene.collection.objects.link(slider)
    print("zip strip points", len(strip.points), "closed zip strays up to", round(float(np.abs(x).max()), 4))
