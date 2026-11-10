# Checkpoint 2: replaces the placeholder head with the bald VRoid head, copied and scaled evenly.
# Her Face keeps its shape keys; the skull and neck come with it and tuck into the body's neck.
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import materials as mt
import palette as pal
import v1_face
from palette import linear

SOURCE = bm.ROOT / "base" / "vroid_head.glb"
SCALE = 1.07  # one number for all three axes: the head's own shape is never altered
SOURCE_NECK_Z = 1.340  # the copied neck stops here, where it is still a plain column
HEAD_LIFT = -0.10224  # height offset that puts her chin where it was approved
BODY_CUT_Z = 1.288  # the body stops here, on the slope into her shoulders
NECK_MEASURE_Z = 1.316  # the head is centred on the body's neck at this height
NECK_RINGS = 12  # rings in the new stretch of neck
NECK_END_GAP = 0.0012  # between the sweep's top ring and the copied neck
SKIN_SLOT = "Face_00_SKIN"
BODY_SKIN_SLOT = "Body_00_SKIN"


def import_head():
    """Imports the head, detaches it from its armature and returns (face, vroid body)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    new = [o for o in bpy.data.objects if o not in before]
    face = next(o for o in new if o.type == "MESH" and o.name.startswith("Face"))
    source_body = next(o for o in new if o.type == "MESH" and o.name.startswith("Body"))
    bpy.context.view_layer.update()
    for o in (face, source_body):
        assert np.allclose(np.array(o.matrix_world), np.eye(4), atol=1e-5), "head is not at the origin"
        o.parent = None
        o.modifiers.clear()
    for o in new:
        if o not in (face, source_body):
            bpy.data.objects.remove(o)
    return face, source_body


def transform_all(ob, offset):
    """Scales evenly and moves a mesh, including every shape key."""
    me = ob.data
    n = len(me.vertices)

    def moved(c):
        return (c.reshape(-1, 3) * SCALE + offset).astype(np.float32).ravel()

    c = np.empty(n * 3, np.float32)
    if me.shape_keys:
        for key in me.shape_keys.key_blocks:
            key.data.foreach_get("co", c)
            key.data.foreach_set("co", moved(c.copy()))
    me.vertices.foreach_get("co", c)
    me.vertices.foreach_set("co", moved(c.copy()))
    me.update()


def tidy_cut_edge(b, on_cut):
    """Merges the slivers a plane cut leaves, so the edge is an even ring of vertices."""
    ring = [v for v in b.verts if on_cut(v) and any(e.is_boundary for e in v.link_edges)]
    bmesh.ops.remove_doubles(b, verts=ring, dist=0.002)


def extract_skull(source_body):
    """Keeps only the skin of the head and neck from the VRoid body, as its own object."""
    me = source_body.data
    slot = next(i for i, m in enumerate(me.materials) if BODY_SKIN_SLOT in m.name)
    b = bmesh.new()
    try:
        b.from_mesh(me)
        doomed = [f for f in b.faces if f.material_index != slot]
        bmesh.ops.delete(b, geom=doomed, context="FACES")
        bmesh.ops.remove_doubles(b, verts=b.verts, dist=1e-5)
        bmesh.ops.bisect_plane(
            b,
            geom=b.verts[:] + b.edges[:] + b.faces[:],
            plane_co=(0, 0, SOURCE_NECK_Z),
            plane_no=(0, 0, 1),
            clear_inner=True,
        )
        tidy_cut_edge(b, lambda v: abs(v.co.z - SOURCE_NECK_Z) < 1e-4)
        for f in b.faces:
            f.material_index = 0
        b.to_mesh(me)
    finally:
        b.free()
    source_body.name = "Head"
    me.name = "Head"
    me.materials.clear()
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()
    return source_body


def neck_extents(p, z, reach=0.006, x_limit=0.09):
    q = p[(np.abs(p[:, 2] - z) < reach) & (np.abs(p[:, 0]) < x_limit)]
    assert len(q) >= 8, f"no neck at height {z}"
    return np.abs(q[:, 0]).max(), q[:, 1].min(), q[:, 1].max()


def fit_body_neck(ob, skull_points):
    """Finds where the head sits on the body, then cuts the body low on the neck."""
    p = bm.get_co(ob)
    L = bm.labels(ob)
    _, y0, y1 = neck_extents(p[L == "neck"], NECK_MEASURE_Z)
    _, v0, v1 = neck_extents(skull_points, SOURCE_NECK_Z + 0.008, x_limit=0.05)
    bake_subdivision(ob)

    b = bmesh.new()
    try:
        b.from_mesh(ob.data)
        bmesh.ops.bisect_plane(
            b,
            geom=b.verts[:] + b.edges[:] + b.faces[:],
            plane_co=(0, 0, BODY_CUT_Z),
            plane_no=(0, 0, 1),
            clear_outer=True,
        )
        tidy_cut_edge(b, lambda v: abs(v.co.z - BODY_CUT_Z) < 1e-4)
        b.to_mesh(ob.data)
    finally:
        b.free()
    ob.data.update()
    return np.array([0.0, (y0 + y1) / 2 - (v0 + v1) / 2 * SCALE, HEAD_LIFT])


def bake_subdivision(ob):
    """Makes one level of smoothing real, so the unsmoothed copied head can share the body's mesh."""
    sub = ob.modifiers.new("subsurf", "SUBSURF")
    sub.levels = 1
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(ob.evaluated_get(depsgraph))
    old = ob.data
    ob.modifiers.clear()
    ob.data = baked
    name = old.name
    bpy.data.meshes.remove(old)
    baked.name = name


def polar_table(points, centre):
    """Radius of a closed ring by angle about its centre, as an ascending table."""
    d = points[:, :2] - centre
    angle = np.arctan2(d[:, 1], d[:, 0])
    order = np.argsort(angle)
    return angle[order], np.linalg.norm(d, axis=1)[order]


def body_slope(body_points, centre, ring_radius):
    """How fast the body widens as it goes down from the cut, in 32 directions around the neck."""
    near = body_points[(body_points[:, 2] < BODY_CUT_Z) & (body_points[:, 2] > BODY_CUT_Z - 0.022)]
    d = near[:, :2] - centre
    angle, radius = np.arctan2(d[:, 1], d[:, 0]), np.linalg.norm(d, axis=1)
    bins = np.linspace(-np.pi, np.pi, 33)
    middles = (bins[:-1] + bins[1:]) / 2
    slopes = []
    for lo, hi, mid in zip(bins[:-1], bins[1:], middles):
        keep = (angle >= lo) & (angle < hi) & (radius < ring_radius(mid) * 1.5)
        slopes.append(np.polyfit(near[keep, 2], radius[keep], 1)[0] if keep.sum() >= 6 else np.nan)
    slopes = np.array(slopes)
    good = ~np.isnan(slopes)
    slopes = np.interp(middles, middles[good], slopes[good], period=2 * np.pi)
    kernel = np.array([1, 2, 3, 2, 1]) / 9
    slopes = np.convolve(np.r_[slopes[-2:], slopes, slopes[:2]], kernel, mode="valid")
    return middles, np.clip(slopes, -3.0, 0.0)


def join_neck(ob, skull):
    """Sweeps new neck up from the body's own edge to the copied neck, as one mesh and one outline."""
    head_points = bm.get_co(skull)
    body_points = bm.get_co(ob)
    limit = (SOURCE_NECK_Z + 0.012) * SCALE + HEAD_LIFT
    b = bmesh.new()
    try:
        b.from_mesh(ob.data)
        first = len(b.verts)
        added = [b.verts.new(tuple(co)) for co in head_points.tolist()]
        for poly in skull.data.polygons:
            b.faces.new([added[i] for i in poly.vertices])
        b.verts.index_update()
        b.edges.ensure_lookup_table()
        ring_a = [e for e in b.edges if e.is_boundary and all(v.index >= first and v.co.z < limit for v in e.verts)]
        ring_b = [e for e in b.edges if e.is_boundary and all(v.index < first for v in e.verts)]
        bottom = sorted({v for e in ring_b for v in e.verts}, key=lambda v: v.index)
        top_co = np.array([v.co[:] for e in ring_a for v in e.verts])
        bottom_co = np.array([v.co[:] for v in bottom])

        centre_a = top_co[:, :2].mean(0)
        centre_b = bottom_co[:, :2].mean(0)
        angle_b, radius_b = polar_table(bottom_co, centre_b)
        angle_a, radius_a = polar_table(top_co, centre_a)
        d = top_co[:, :2] - centre_a
        order = np.argsort(np.arctan2(d[:, 1], d[:, 0]))
        heights_a = top_co[order, 2]

        def ring_radius(a):
            return np.interp(a, angle_b, radius_b, period=2 * np.pi)

        slope_angle, slope = body_slope(body_points, centre_b, ring_radius)
        offset = bottom_co[:, :2] - centre_b
        theta = np.arctan2(offset[:, 1], offset[:, 0])
        end = np.linalg.norm(offset, axis=1)
        end_z = bottom_co[:, 2]
        start = np.interp(theta, angle_a, radius_a, period=2 * np.pi)
        top_z = np.interp(theta, angle_a, heights_a, period=2 * np.pi) - NECK_END_GAP
        span = end_z - top_z
        tangent = np.interp(theta, slope_angle, slope, period=2 * np.pi) * span

        previous, edges = bottom, ring_b
        for k in range(1, NECK_RINGS + 1):
            t = 1 - k / NECK_RINGS  # 0 at the copied neck, 1 at the body
            h01 = -2 * t**3 + 3 * t**2
            h11 = t**3 - t**2
            radius = (1 - h01) * start + h01 * end + h11 * tangent
            centre = centre_a * (1 - h01) + centre_b * h01
            xy = centre + radius[:, None] * np.column_stack([np.cos(theta), np.sin(theta)])
            z = top_z + span * t
            ring = [b.verts.new((float(c[0]), float(c[1]), float(h))) for c, h in zip(xy, z)]
            lookup = dict(zip(previous, ring))
            for e in edges:
                u, v = e.verts
                b.faces.new((u, v, lookup[v], lookup[u]))
            b.edges.ensure_lookup_table()
            edges = [b.edges.get((lookup[e.verts[0]], lookup[e.verts[1]])) for e in edges]
            previous = ring

        made = bmesh.ops.bridge_loops(b, edges=edges + ring_a)
        assert made["faces"], "the neck did not join the copied head"
        bmesh.ops.recalc_face_normals(b, faces=b.faces[:])
        for f in b.faces:
            f.smooth = True
            f.material_index = 0
        b.to_mesh(ob.data)
    finally:
        b.free()
    ob.data.update()
    bpy.data.objects.remove(skull)


def skin_with_texture(image, ratio):
    """Her toon skin multiplied by the head's own painted detail, normalised to her skin colour."""
    m = mt.toon("face_skin", pal.SKIN, pal.SKIN_SHADE, cut=0.38, soft=0.02)
    t = m.node_tree
    ramp = next(n for n in t.nodes if n.type == "VALTORGB")
    emit = next(n for n in t.nodes if n.type == "EMISSION")
    tex = t.nodes.new("ShaderNodeTexImage")
    tex.image = image
    norm = t.nodes.new("ShaderNodeVectorMath")
    norm.operation = "MULTIPLY"
    norm.inputs[1].default_value = tuple(1 / max(c, 1e-3) for c in ratio)
    mix = t.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    t.links.new(tex.outputs[0], norm.inputs[0])
    t.links.new(ramp.outputs[0], mix.inputs["A"])
    t.links.new(norm.outputs[0], mix.inputs["B"])
    t.links.new(mix.outputs["Result"], emit.inputs[0])
    return m


def median_skin(me, slot, image):
    """The typical colour of the painted skin, in linear light."""
    w, h = image.size
    pixels = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(h, w, 4)
    n = len(me.polygons)
    mats, start = np.empty(n, np.int32), np.empty(n, np.int32)
    me.polygons.foreach_get("material_index", mats)
    me.polygons.foreach_get("loop_start", start)
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)[start[mats == slot]]
    x = np.clip((uv[:, 0] * w).astype(int), 0, w - 1)
    y = np.clip((uv[:, 1] * h).astype(int), 0, h - 1)
    s = np.median(pixels[y, x, :3], axis=0)
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4).tolist()


def layer_colour(material):
    """A face layer's picture and its alpha, from whatever the importer built."""
    tex = next(n for n in material.node_tree.nodes if n.type == "TEX_IMAGE")
    return tex, tex.outputs[0], tex.outputs[1]


def flat_layer(material, colour_of):
    """Rewires a face layer to flat colour: no lighting, the picture's alpha kept."""
    t = material.node_tree
    tex, _, _ = layer_colour(material)
    for n in [n for n in t.nodes if n != tex]:
        t.nodes.remove(n)
    colour, alpha = tex.outputs[0], tex.outputs[1]
    out = t.nodes.new("ShaderNodeOutputMaterial")
    emit = t.nodes.new("ShaderNodeEmission")
    clear = t.nodes.new("ShaderNodeBsdfTransparent")
    mix = t.nodes.new("ShaderNodeMixShader")
    t.links.new(colour_of(t, colour), emit.inputs[0])
    t.links.new(alpha, mix.inputs[0])
    t.links.new(clear.outputs[0], mix.inputs[1])
    t.links.new(emit.outputs[0], mix.inputs[2])
    t.links.new(mix.outputs[0], out.inputs[0])


def ramp_on(t, colour, stops):
    """Maps a picture's brightness through colour stops, given as (position, hex)."""
    grey = t.nodes.new("ShaderNodeRGBToBW")
    ramp = t.nodes.new("ShaderNodeValToRGB")
    elements = ramp.color_ramp.elements
    while len(elements) < len(stops):
        elements.new(0.5)
    for element, (position, hex_colour) in zip(elements, stops):
        element.position = position
        element.color = linear(hex_colour)
    t.links.new(colour, grey.inputs[0])
    t.links.new(grey.outputs[0], ramp.inputs[0])
    return ramp.outputs[0]


def brightness_range(image):
    """5th and 95th percentile of the opaque pixels' brightness, in linear light."""
    w, h = image.size
    p = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(p)
    p = p.reshape(-1, 4)
    p = p[p[:, 3] > 0.5][:, :3]
    p = np.where(p <= 0.04045, p / 12.92, ((p + 0.055) / 1.055) ** 2.4)
    grey = p @ np.array([0.2126, 0.7152, 0.0722])
    return np.percentile(grey, 5), np.percentile(grey, 95)


def finish_face(face):
    """Her colours on the copied face layers, all flat, in the palette's blues."""
    z = bm.get_co(face)[:, 2]
    z_lo, z_hi = z.min(), z.max()
    materials = {m.name: m for m in face.data.materials}

    def find(key):
        return next(m for name, m in materials.items() if key in name)

    iris = find("EyeIris")
    tex, _, _ = layer_colour(iris)
    lo, hi = brightness_range(tex.image)
    n = len(face.data.polygons)
    index = np.empty(n, np.int32)
    face.data.polygons.foreach_get("material_index", index)
    slot = list(face.data.materials).index(iris)
    used = sorted({v for p in face.data.polygons if p.material_index == slot for v in p.vertices})
    iris_z = bm.get_co(face)[used, 2]
    low, top = (iris_z.min() - z_lo) / (z_hi - z_lo), (iris_z.max() - z_lo) / (z_hi - z_lo)

    def iris_colour(t, colour):
        base = ramp_on(t, colour, [(lo, pal.IRIS_RIM), ((lo + hi) / 2, pal.IRIS_MID), (hi, "3CA0F4")])
        coords = t.nodes.new("ShaderNodeTexCoord")
        split = t.nodes.new("ShaderNodeSeparateXYZ")
        fall = t.nodes.new("ShaderNodeMapRange")
        fall.interpolation_type = "SMOOTHSTEP"
        fall.inputs["From Min"].default_value = low + (top - low) * 0.12
        fall.inputs["From Max"].default_value = low + (top - low) * 0.5
        fall.inputs["To Min"].default_value = 0.9
        fall.inputs["To Max"].default_value = 0.0
        mix = t.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs["B"].default_value = linear(pal.IRIS_GLOW)
        t.links.new(coords.outputs["Generated"], split.inputs[0])
        t.links.new(split.outputs[2], fall.inputs["Value"])
        t.links.new(fall.outputs[0], mix.inputs["Factor"])
        t.links.new(base, mix.inputs["A"])
        return mix.outputs["Result"]

    def solid(hex_colour):
        def make(t, colour):
            node = t.nodes.new("ShaderNodeRGB")
            node.outputs[0].default_value = linear(hex_colour)
            return node.outputs[0]

        return make

    flat_layer(iris, iris_colour)
    flat_layer(find("EyeHighlight"), solid(pal.IRIS_HIGHLIGHT))
    flat_layer(find("EyeWhite"), lambda t, c: c)
    flat_layer(find("FaceMouth"), lambda t, c: c)
    flat_layer(find("FaceBrow"), solid(pal.BROW))
    flat_layer(find("FaceEyelash"), solid(pal.OUTLINE))
    flat_layer(find("FaceEyeline"), solid(pal.OUTLINE))


def face_outline(face, line):
    """A twin of the face's skin only, carrying the inverted hull; the Face itself has many thin layers."""
    twin = face.copy()
    twin.data = face.data.copy()
    twin.name = twin.data.name = "face_outline"
    bpy.context.scene.collection.objects.link(twin)
    slot = next(i for i, m in enumerate(face.data.materials) if m.name == "face_skin")
    all_points = bm.get_co(face)
    lips = all_points[sorted({v for p in face.data.polygons if p.material_index == 0 for v in p.vertices})]
    b = bmesh.new()
    try:
        b.from_mesh(twin.data)
        bmesh.ops.delete(b, geom=[f for f in b.faces if f.material_index != slot], context="FACES")
        for f in b.faces:
            f.material_index = 0
        b.verts.index_update()
        rim = {v.index for e in b.edges if e.is_boundary for v in e.verts}
        rim |= {v.index for v in b.verts if np.linalg.norm(lips - np.array(v.co), axis=1).min() < 0.006}  # the mouth is a picture
        b.to_mesh(twin.data)
    finally:
        b.free()
    hide = bpy.data.materials.new("hidden")
    hide.use_nodes = True
    t = hide.node_tree
    t.nodes.clear()
    o = t.nodes.new("ShaderNodeOutputMaterial")
    transparent = t.nodes.new("ShaderNodeBsdfTransparent")
    t.links.new(transparent.outputs[0], o.inputs[0])
    twin.data.materials.clear()
    twin.data.materials.append(hide)
    mod = mt.add_outline(twin, line, 0.0016)
    group = twin.vertex_groups.new(name="outline_w")
    for i in range(len(twin.data.vertices)):
        group.add([i], 0.0 if i in rim else 1.0, "REPLACE")
    mod.vertex_group = "outline_w"
    mod.thickness_vertex_group = 0.0
    return twin


def main():
    ob = bpy.data.objects["Body"]
    ob.modifiers.clear()
    face, source_body = import_head()
    skull = extract_skull(source_body)
    offset = fit_body_neck(ob, bm.get_co(skull))
    transform_all(face, offset)
    transform_all(skull, offset)

    skin = mt.toon("skin", pal.SKIN, pal.SKIN_SHADE, cut=0.38, soft=0.02)
    line = mt.outline_material("outline_skin", pal.OUTLINE_SKIN)
    ob.data.materials.clear()
    ob.data.materials.append(skin)
    join_neck(ob, skull)
    mt.add_outline(ob, line, 0.0018)

    slot = next(i for i, m in enumerate(face.data.materials) if SKIN_SLOT in m.name)
    source = face.data.materials[slot]
    tex = next(n for n in source.node_tree.nodes if n.type == "TEX_IMAGE")
    median = median_skin(face.data, slot, tex.image)
    face.data.materials[slot] = skin_with_texture(tex.image, median)
    finish_face(face)
    v1_face.adopt(face)
    face_outline(face, line)

    print("HEAD top", bm.get_co(ob)[:, 2].max(), "chin", bm.get_co(face)[:, 2].min(), "verts", len(ob.data.vertices))
    bpy.ops.wm.save_as_mainfile(filepath=str(bm.ROOT / ("spica-v2-head%s.blend" % bm.STAGE)))


if __name__ == "__main__":
    main()
