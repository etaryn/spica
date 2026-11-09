# Loads Blender Studio's CC0 stylized female body into the scene, centred, with her parts labelled.
# Shared mesh helpers for the v2 build: bulk read and write, edges, smoothing a displacement field.
import os
from pathlib import Path

import bpy
import numpy as np

BUILD = Path(__file__).resolve().parent
ROOT = BUILD.parent
HEAD_SCALE = float(os.environ.get("SPICA_HEAD_SCALE", 0.93))  # halfway between her first head and v1's proportion (0.863)
HEAD_PIVOT = (0.0, -0.012, 1.34)  # the head shrinks towards this point at the top of her neck
BUNDLE = ROOT / "base" / "human_base_meshes_bundle.blend"
SOURCE_NAME = "GEO-body_female_stylized"

# Sculpt face sets in the bundle, read off by their bounding boxes.
PARTS = {
    "neck": {6},
    "head": {27, 28, 29, 37, 44, 45, 46, 47, 48, 49},
    "torso": {258, 259},
    "shoulder": {260},
    "arm": {262, 263},
    "hand": {272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 359},
    "leg": {256, 257},
    "foot": {288, 316, 317, 318, 319, 320, 321, 322},
}

FINGERS = {
    "index": {278, 283, 282},
    "middle": {277, 279, 272},
    "ring": {280, 274, 275},
    "pinky": {281, 286, 276},
    "thumb": {284, 285, 359},
}


def load_body(name="Body"):
    """Append the base mesh, bake its offset, put her centre on x = 0. Returns the object."""
    with bpy.data.libraries.load(str(BUNDLE), link=False) as (src, dst):
        dst.objects = [SOURCE_NAME]
    ob = dst.objects[0]
    bpy.context.scene.collection.objects.link(ob)
    ob.name = name
    ob.data.name = name
    ob.modifiers.clear()
    if ob.animation_data:
        ob.animation_data_clear()
    ob.parent = None
    p = get_co(ob)
    p[:, 0] += ob.location.x
    p[:, 0] -= (p[:, 0].min() + p[:, 0].max()) / 2
    ob.location = (0, 0, 0)
    set_co(ob, p)
    return ob


def get_co(ob):
    me = ob.data
    c = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", c)
    return c.reshape(-1, 3).astype(np.float64)


def set_co(ob, p):
    me = ob.data
    me.vertices.foreach_set("co", p.astype(np.float32).ravel())
    me.update()


def edges_of(ob):
    me = ob.data
    e = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get("vertices", e)
    return e.reshape(-1, 2)


def labels(ob):
    """One part name per vertex, from the face sets (a seam vertex takes one of its faces' parts)."""
    me = ob.data
    n = len(me.polygons)
    fs, start, total = np.empty(n, np.int32), np.empty(n, np.int32), np.empty(n, np.int32)
    me.attributes[".sculpt_face_set"].data.foreach_get("value", fs)
    me.polygons.foreach_get("loop_start", start)
    me.polygons.foreach_get("loop_total", total)
    corner = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", corner)
    part_of = {s: part for part, sets in PARTS.items() for s in sets}
    out = np.empty(len(me.vertices), dtype=object)
    for i in range(n):
        part = part_of[int(fs[i])]
        out[corner[start[i] : start[i] + total[i]]] = part
    return out


def vertices_in_sets(ob, sets):
    """Boolean per-vertex mask of the vertices on faces in these face sets."""
    me = ob.data
    n = len(me.polygons)
    fs, start, total = np.empty(n, np.int32), np.empty(n, np.int32), np.empty(n, np.int32)
    me.attributes[".sculpt_face_set"].data.foreach_get("value", fs)
    me.polygons.foreach_get("loop_start", start)
    me.polygons.foreach_get("loop_total", total)
    corner = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", corner)
    out = np.zeros(len(me.vertices), bool)
    for i in np.where(np.isin(fs, list(sets)))[0]:
        out[corner[start[i] : start[i] + total[i]]] = True
    return out


def smooth_field(d, edges, mask, rounds, rate=0.6):
    """Averages per-vertex values with their neighbours, only where mask is true."""
    d = d.copy()
    count = np.zeros(len(d))
    np.add.at(count, edges[:, 0], 1)
    np.add.at(count, edges[:, 1], 1)
    count[count == 0] = 1
    wide = d.ndim == 2
    for _ in range(rounds):
        s = np.zeros_like(d)
        np.add.at(s, edges[:, 0], d[edges[:, 1]])
        np.add.at(s, edges[:, 1], d[edges[:, 0]])
        mean = s / (count[:, None] if wide else count)
        d[mask] += rate * (mean[mask] - d[mask])
    return d


def grow(mask, edges, rounds):
    """Expands a boolean vertex mask along the mesh by this many edge rings."""
    m = mask.copy()
    for _ in range(rounds):
        a, b = edges[:, 0], edges[:, 1]
        hit = m[a] | m[b]
        m[a] |= hit
        m[b] |= hit
    return m
