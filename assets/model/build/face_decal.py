"""
The face decal: a thin patch that hugs the front of her face and shows expression pictures from expr_draw.py (the neutral mouth line,
tears, blush)). `build()` makes it (ray-cast from the front onto her face, lifted 1.2 mm, rigid on the head bone) as two
layers on the same surface: a BACK layer that sorts behind her eyelash and eye layers (tears, blush: they flow from under the lid) and a FRONT
layer that sorts over them (unused now: the doodles that used it were removed; they will be worked on later). `show(name)` swaps the pictures (or hides a layer that
has none for this expression); the front layer is rebuilt from the face as it is posed (her lids move when her eyes are hidden or
closed, and a surface built from the resting face would sit behind them), so call it after face_setup.apply().
Imported by face_build.py, face_expr.py and expressions.py; builds nothing on its own.
"""
import json
import os

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tex", "face")  # the pictures and decal.json (expr_draw.py)
with open(os.path.join(OUT, "decal.json")) as _f:
    _J = json.load(_f)
LAYERS = {"back": _J["back"], "front": _J["front"]}  # layer -> the expressions that have a picture on it (<name>.png / <name>_front.png)
X0, X1, Z0, Z1 = _J["patch"]
HEAD_BONE = "J_Bip_C_Head"
LIFT = 0.003  # metres in front of the surface under it
STEP = 0.0012  # grid spacing
HOLE_LIFT = 0.004  # extra lift over the bridged cut-outs (eye sockets, mouth)
BEHIND = 0.05  # a layer's origin sits this far behind (back) or in front of (front) the face: the transparent eyelash and eye layers
# (origin at the face) sort between them, so the back layer draws before them (they cover its top) and the front layer after (it covers them)
_state = {}


def _decal_material():
    m = bpy.data.materials.new("face_decal")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.extension = "CLIP"
    em = nt.nodes.new("ShaderNodeEmission")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    nt.links.new(tex.outputs["Alpha"], mix.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], mix.inputs[1])
    nt.links.new(em.outputs["Emission"], mix.inputs[2])
    nt.links.new(mix.outputs["Shader"], out.inputs["Surface"])
    m.surface_render_method = "BLENDED"
    return m


def _surface():
    """The depth of the front of her face (y) on a grid over the patch, for the face as it is now: {(i, j): y or None}, nx, nz."""
    face = bpy.data.objects["Face"]
    bpy.context.view_layer.update()
    ev = face.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    skin = next(i for i, m in enumerate(face.data.materials) if m and m.name == "skin_face")
    verts = [ev.matrix_world @ v.co for v in me.vertices]
    bvh = BVHTree.FromPolygons(verts, [tuple(p.vertices) for p in me.polygons if p.material_index == skin])  # the skin surface only
    ev.to_mesh_clear()
    nx, nz = round((X1 - X0) / STEP), round((Z1 - Z0) / STEP)
    ys = {}
    for i in range(nx + 1):
        for j in range(nz + 1):
            hit = bvh.ray_cast(Vector((X0 + (X1 - X0) * i / nx, -0.4, Z0 + (Z1 - Z0) * j / nz)), Vector((0, 1, 0)))
            ys[i, j] = hit[0].y if hit[0] else None
    # the eye sockets and the mouth are cut-outs: a ray through one finds the inside of the back of the head, far behind the face. A cell much
    # deeper than the surface around it is such a hole: it is bridged from the skin around it below
    R, DEEP = 10, 0.015
    deep = set()
    for (i, j), y in ys.items():
        if y is None:
            continue
        near = [ys[a, b] for a in range(max(0, i - R), min(nx, i + R) + 1) for b in range(max(0, j - R), min(nz, j + R) + 1) if ys[a, b] is not None]
        if y > min(near) + DEEP:
            deep.add((i, j))
    for _ in range(2):  # take in the rim, which curves down into the cut-out
        deep |= {(a, b) for (i, j) in deep for a in (i - 1, i, i + 1) for b in (j - 1, j, j + 1) if (a, b) in ys and ys[a, b] is not None}
    for k in deep:
        ys[k] = None
    # None cells reachable from the grid's border are off the face (below the jaw, past the cheek): they stay None; the others are holes
    outside, todo = set(), [(i, j) for (i, j) in ys if (i in (0, nx) or j in (0, nz)) and ys[i, j] is None]
    while todo:
        c = todo.pop()
        if c in outside:
            continue
        outside.add(c)
        todo += [n for n in ((c[0] + 1, c[1]), (c[0] - 1, c[1]), (c[0], c[1] + 1), (c[0], c[1] - 1)) if n in ys and ys[n] is None and n not in outside]
    holes = [k for k, y in ys.items() if y is None and k not in outside]
    known = sum(y for y in ys.values() if y is not None) / max(1, sum(1 for y in ys.values() if y is not None))
    for k in holes:
        ys[k] = known
    for _ in range(300):  # bridge the holes: relax them toward the average of their neighbours
        for (i, j) in holes:
            nb = [ys[a, b] for a, b in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)) if (a, b) in ys and ys[a, b] is not None]
            ys[i, j] = sum(nb) / len(nb)
    for k in holes:  # sit a little proud over the cut-outs
        ys[k] -= HOLE_LIFT
    for _ in range(3):  # smooth a little
        new = {}
        for (i, j), y in ys.items():
            nb = [ys[a, b] for a in (i - 1, i, i + 1) for b in (j - 1, j, j + 1) if (a, b) in ys and ys[a, b] is not None]
            new[i, j] = sum(nb) / len(nb) if y is not None else None
        ys = {k: None if ys[k] is None else min(new[k], ys[k]) for k in ys}  # never behind the surface
    return ys, nx, nz


def _mesh(layer, ys, nx, nz, origin):
    idx = lambda i, j: i * (nz + 1) + j
    vs = [(X0 + (X1 - X0) * i / nx, (ys[i, j] or 0) - LIFT - origin, Z0 + (Z1 - Z0) * j / nz) for i in range(nx + 1) for j in range(nz + 1)]
    fs = [(idx(i, j), idx(i, j + 1), idx(i + 1, j + 1), idx(i + 1, j)) for i in range(nx) for j in range(nz) if None not in (ys[i, j], ys[i, j + 1], ys[i + 1, j + 1], ys[i + 1, j])]
    me = bpy.data.meshes.new("face_decal_" + layer)
    me.from_pydata(vs, [], fs)
    uv = me.uv_layers.new(name="UVMap")
    for l in me.loops:
        x, _, z = vs[l.vertex_index]
        uv.data[l.index].uv = ((x - X0) / (X1 - X0), (z - Z0) / (Z1 - Z0))
    me.shade_smooth()
    me.materials.append(_decal_material())
    return me


def build():
    arm = bpy.data.objects["Armature"]
    ys, nx, nz = _surface()
    bpy.context.view_layer.update()
    pb = arm.pose.bones[HEAD_BONE]  # a bone child hangs off the bone's tail, hence the length
    parent_inverse = (arm.matrix_world @ pb.matrix @ Matrix.Translation((0, pb.bone.length, 0))).inverted()
    for layer, origin in (("back", BEHIND), ("front", -BEHIND)):
        ob = bpy.data.objects.new("face_decal_" + layer, _mesh(layer, ys, nx, nz, origin))
        bpy.context.scene.collection.objects.link(ob)
        ob.location = (0, origin, 0)
        ob.parent, ob.parent_type, ob.parent_bone = arm, "BONE", HEAD_BONE
        ob.matrix_parent_inverse = parent_inverse
        _state[layer] = ob
    return _state


def attach():
    """Pick the two decal layers up from a saved .blend."""
    _state["back"], _state["front"] = bpy.data.objects["face_decal_back"], bpy.data.objects["face_decal_front"]


def show(name):
    """Show the expression's pictures on each layer, or hide a layer that has none."""
    for layer in ("back", "front"):
        ob = _state[layer]
        has = name in LAYERS[layer]
        ob.hide_render = not has
        if not has:
            continue
        if layer == "front":  # her lids and sockets move with the expression: build the surface for the face as it is posed now
            ys, nx, nz = _surface()
            old = ob.data
            ob.data = _mesh(layer, ys, nx, nz, -BEHIND)
            bpy.data.meshes.remove(old)
        img = bpy.data.images.load(os.path.abspath(os.path.join(OUT, name + ("" if layer == "back" else "_front") + ".png")), check_existing=False)
        img.alpha_mode = "STRAIGHT"
        ob.data.materials[0].node_tree.nodes["Image Texture"].image = img
