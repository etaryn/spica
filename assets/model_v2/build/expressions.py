# Gives v2 v1's expressions: all its shape keys, its finished mouth and the outline that follows it. Runs on spica-v2-drape.blend, saves spica-v2.blend.
# The two faces match point for point, so each key is v1's offset, resized to her head.
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import face_expr
import rig
import v1_face as vf

MOUTH_LINE = 0.0013  # the thin line of a closed mouth, as v1
GAZE_DEGREES, HIGHLIGHT_GROWTH = 20, 0.5  # how far a gaze key at 100 turns her eyes; how much bigger the highlight is at 100
EYE_DEPTH = 0.025  # how far behind the iris her eye turns from: the sample's eye bones sit on the iris itself
SIDES = (1, -1)
IRIS_SLOT, HIGHLIGHT_SLOT, WHITE_SLOT = 1, 2, 4
WATER_WIDER, WATER_BELOW, WATER_ABOVE, WATER_NOSE = 0.032, 0.060, 0.026, 0.006  # how far the water patch reaches round her eyes, in metres
WATER_STEP, WATER_LIFT, WATER_SMOOTH = 0.0012, 0.0015, 3  # its grid; its gap in front of her; rounds of smoothing
WATER_LAYERS = (("accent_water", -0.05), ("accent_water_back", 0.05))  # a patch sorts by where its origin sits: forward it draws over her eye layers, back it stays under them while still covering her star


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


def add_eye_keys(face):
    """Her eyes really turn: the iris and its highlight swing about the eye's centre, which the sample's own keys never do. The eyelids are left alone."""
    base = vf.key_positions(face.data, "Basis")
    slots = np.zeros(len(base), int) - 1
    for p in face.data.polygons:
        slots[list(p.vertices)] = p.material_index
    moving = np.isin(slots, (IRIS_SLOT, HIGHLIGHT_SLOT))
    for name, axis, degrees in (("Gaze_L", "Z", GAZE_DEGREES), ("Gaze_R", "Z", -GAZE_DEGREES), ("Gaze_Up", "X", -GAZE_DEGREES), ("Gaze_Down", "X", GAZE_DEGREES)):
        turn = np.array(Matrix.Rotation(np.radians(degrees), 3, axis))
        co = base.copy()
        for side in SIDES:
            eye = moving & (np.sign(base[:, 0]) == side)
            pivot = base[eye].mean(0) + (0, EYE_DEPTH, 0)
            co[eye] = (base[eye] - pivot) @ turn.T + pivot
        key = face.shape_key_add(name=name, from_mix=False)
        key.value, key.slider_min, key.slider_max = 0.0, 0.0, 2.0
        key.data.foreach_set("co", co.astype(np.float32).ravel())
    co = base.copy()
    for side in SIDES:
        eye = (slots == HIGHLIGHT_SLOT) & (np.sign(base[:, 0]) == side)
        for spot in split_islands(face, eye):
            centre = base[spot].mean(0)
            co[spot] = centre + (base[spot] - centre) * (1 + HIGHLIGHT_GROWTH)
    key = face.shape_key_add(name="Highlight_Big", from_mix=False)
    key.value, key.slider_min, key.slider_max = 0.0, 0.0, 2.0
    key.data.foreach_set("co", co.astype(np.float32).ravel())


def split_islands(face, mask):
    """The separate pieces of mesh among the points in mask."""
    neighbours = {int(i): set() for i in np.where(mask)[0]}
    for a, b in bm.edges_of(face).tolist():
        if a in neighbours and b in neighbours:
            neighbours[a].add(b)
            neighbours[b].add(a)
    pieces, left = [], set(neighbours)
    while left:
        grow, piece = [left.pop()], []
        while grow:
            v = grow.pop()
            piece.append(v)
            found = neighbours[v] & left
            left -= found
            grow.extend(found)
        pieces.append(piece)
    return pieces


def add_iris_dim(face):
    """A colour her iris is multiplied by, so a face can make her eyes darker. White leaves them as they are."""
    t = face.data.materials[IRIS_SLOT].node_tree
    emit = next(n for n in t.nodes if n.type == "EMISSION")
    link = next(l for l in t.links if l.to_node == emit and l.to_socket.name == "Color")
    before = link.from_socket
    t.links.remove(link)
    mix = t.nodes.new("ShaderNodeMix")
    mix.name, mix.data_type, mix.blend_type = "iris_dim", "RGBA", "MULTIPLY"
    pick = lambda sockets, identifier: next(s for s in sockets if s.identifier == identifier)
    pick(mix.inputs, "Factor_Float").default_value = 1.0
    pick(mix.inputs, "B_Color").default_value = (1, 1, 1, 1)
    t.links.new(before, pick(mix.inputs, "A_Color"))
    t.links.new(pick(mix.outputs, "Result_Color"), emit.inputs["Color"])


def add_water(face, arm):
    """A thin patch over her eyes and the skin round them, for water drawn to fit her lids. It draws over her eye layers, so the water can climb over her iris."""
    base = vf.key_positions(face.data, "Basis")
    slots = np.zeros(len(base), int) - 1
    polys = [list(p.vertices) for p in face.data.polygons if p.material_index in (IRIS_SLOT, WHITE_SLOT, vf.SKIN_SLOT)]
    for p in face.data.polygons:
        slots[list(p.vertices)] = p.material_index
    iris = base[slots == IRIS_SLOT]
    half, middle = float(np.abs(iris[:, 0]).max()) + WATER_WIDER, float(iris[:, 2].mean())
    rect = (-half, half, middle - WATER_BELOW, middle + WATER_ABOVE)
    tree = BVHTree.FromPolygons(base.tolist(), polys, all_triangles=False)
    nx, nz = round(2 * half / WATER_STEP), round((WATER_BELOW + WATER_ABOVE) / WATER_STEP)
    xs, zs = np.linspace(rect[0], rect[1], nx + 1), np.linspace(rect[2], rect[3], nz + 1)
    depth = np.full((nx + 1, nz + 1), np.nan)
    for i, x in enumerate(xs.tolist()):
        for j, z in enumerate(zs.tolist()):
            hit = tree.ray_cast(Vector((x, -1.0, z)), Vector((0, 1, 0)))[0]
            if hit is not None:
                depth[i, j] = hit.y
    for _ in range(WATER_SMOOTH):  # never behind the surface under it
        padded = np.pad(depth, 1, constant_values=np.nan)
        near = np.stack([padded[:-2, 1:-1], padded[2:, 1:-1], padded[1:-1, :-2], padded[1:-1, 2:], depth])
        depth = np.where(np.isnan(depth), np.nan, np.minimum(depth, np.nanmean(near, axis=0)))
    index = lambda i, j: i * (nz + 1) + j
    faces = [(index(i, j), index(i, j + 1), index(i + 1, j + 1), index(i + 1, j)) for i in range(nx) for j in range(nz) if not np.isnan(depth[i : i + 2, j : j + 2]).any() and min(abs(xs[i]), abs(xs[i + 1])) > WATER_NOSE]
    m = bpy.data.materials.new("water")
    m.use_nodes = True
    t = m.node_tree
    t.nodes.clear()
    out, tex, em, clear, mix = (t.nodes.new(n) for n in ("ShaderNodeOutputMaterial", "ShaderNodeTexImage", "ShaderNodeEmission", "ShaderNodeBsdfTransparent", "ShaderNodeMixShader"))
    tex.extension = "CLIP"
    t.links.new(tex.outputs["Color"], em.inputs["Color"])
    t.links.new(tex.outputs["Alpha"], mix.inputs["Fac"])
    t.links.new(clear.outputs["BSDF"], mix.inputs[1])
    t.links.new(em.outputs["Emission"], mix.inputs[2])
    t.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    m.surface_render_method = "BLENDED"
    m.use_fake_user = True
    for name, origin in WATER_LAYERS:
        verts = [(float(x), float(depth[i, j]) - WATER_LIFT - origin if not np.isnan(depth[i, j]) else 0.0, float(zs[j])) for i, x in enumerate(xs) for j in range(nz + 1)]
        me = bpy.data.meshes.new(name)
        me.from_pydata(verts, [], faces)
        uv = me.uv_layers.new(name="UVMap")
        for loop in me.loops:
            x, _, z = verts[loop.vertex_index]
            uv.data[loop.index].uv = ((x - rect[0]) / (rect[1] - rect[0]), (z - rect[2]) / (rect[3] - rect[2]))
        me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        face.users_collection[0].objects.link(ob)
        ob.location = (0, origin, 0)
        ob["water_patch"] = list(rect)
        ob.hide_render = True
        rig.rigid(ob, arm, "J_Bip_C_Head")


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
    add_eye_keys(face)
    add_iris_dim(face)
    armature = v1.parent
    bpy.data.objects.remove(v1)
    if armature is not None:
        bpy.data.objects.remove(armature)
    mouth, line, clear = bring_materials()
    assert mouth.name == face_expr.MOUTH, "a material of that name was already in the file: " + mouth.name
    mouth_outline(face, line, clear)
    add_overlay()
    add_water(face, bpy.data.objects["Armature"])
    face_expr.use("neutral")
    print("EXPR keys", len(face.data.shape_keys.key_blocks))
    bpy.ops.wm.save_as_mainfile(filepath=str(bm.ROOT / "spica-v2.blend"))


if __name__ == "__main__":
    main()
