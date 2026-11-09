"""
Prepares her Face for expressions. `setup(ref_vrm)` (run once by the build, face_build.py, which saves the .blend) does four things:
  1. face_keys.transfer: the richer shape keys (mouth shapes, fangs, tongue, eyeBlink lids, Eye_Joy arches, brow and eye shapes);
  2. the mouth material gets its picture back (it was recoloured to one flat colour, which lost the teeth and the tongue), mapped to
     her palette in flat bands: the inside of the mouth her mouth colour, a darker band at the top, the tongue lighter, the teeth white;
  3. the outline shells are rebuilt with the shape keys (skin: so the chin outline follows an open jaw; mouth: a thin dark-rose line,
     which is how a closed mouth gets its line, as in VRoid), and the two black marks at the mouth corners (skin-shell faces showing
     through a cut-out in the skin) are deleted;
  4. the face skin material gets OVERLAY_SLOTS swappable overlay pictures (blush, gloom, eyebags...) laid by the face's UV map,
     which is the same layout as the reference pack's overlay textures. `set_overlays([(png, strength), ...])` fills them.
`apply(expr)` sets the shape keys, overlays, the sample mouth's visibility and (hide=("brows",)) the brows for one expression of expr_defs.py.
`attach()` finds all of this again in a saved .blend (a new session). Imported by face_build.py, face_expr.py and expressions.py;
builds nothing on its own.
"""
import os

import bmesh
import bpy

import face_keys
import palette

P = palette.P
OVERLAY_SLOTS = 3
BROW_SLOT = 5  # the Face's material slot of the brows
MOUTH_DEEP, MOUTH_TONGUE, MOUTH_TEETH = "B8606F", "EE9BA8", "FFFFFF"  # the four flat tones of an open mouth (the inside is her palette's mouth colour)
MOUTH_LINE = 0.0013  # thickness of the mouth outline shell: the thin line of a closed mouth, the edge of an open one
TEX = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tex", "face")
# the Expression Pack's reference model, the source of the shape keys (git-ignored: its licence forbids redistribution); SPICA_EXPR_REF overrides
REF_VRM = os.environ.get("SPICA_EXPR_REF") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "references", "_x", "pack", "Page 1 - Copy Blendshape", "Reference Model", "Reference Model.vrm")
_state = {"mouth_mat": None, "hidden": None}


def lin(hexstr, a=1.0):
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*c, a)


def _mouth_material():
    """Her mouth material with the sample's picture, mapped to her palette by brightness: inside (dark) / tongue / teeth (white)."""
    m = bpy.data.materials["N00_000_00_FaceMouth_00_FACE"]
    nt = m.node_tree
    tex = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeTexImage")
    em = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeEmission")
    for l in [l for l in nt.links if l.to_node == em and l.to_socket.name == "Color"]:
        nt.links.remove(l)
    bw = nt.nodes.new("ShaderNodeRGBToBW")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    # brightness (linear) of the sample's picture: deep inside 0.29, most of it 0.41, tongue 0.49, teeth 0.96. A CONSTANT ramp turns the
    # picture's gradient into flat bands with hard edges, like her skin, hair and clothes (toon steps, not blended colour)
    ramp.color_ramp.interpolation = "CONSTANT"
    stops = [(0.0, MOUTH_DEEP), (0.35, P.mouth), (0.455, MOUTH_TONGUE), (0.72, MOUTH_TEETH)]  # the top shade, the inside, the tongue, the teeth
    for i, (pos, col) in enumerate(stops):
        e = ramp.color_ramp.elements[i] if i < len(ramp.color_ramp.elements) else ramp.color_ramp.elements.new(pos)
        e.position, e.color = pos, lin(col)
    nt.links.new(tex.outputs["Color"], bw.inputs["Color"])
    nt.links.new(bw.outputs["Val"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
    m.use_fake_user = True  # an expression that hides the mouth leaves it unused: keep it in the saved file
    return m


def _hidden_material():
    m = bpy.data.materials.get("face_hidden")
    if not m:
        m = bpy.data.materials.new("face_hidden")
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(nt.nodes.new("ShaderNodeBsdfTransparent").outputs["BSDF"], out.inputs["Surface"])
        m.surface_render_method = "BLENDED"
        m.use_fake_user = True
    return m


def _hull(name, slot, material, thickness, skip=None):
    """An inverted-hull outline of one material slot of her Face, with the Face's shape keys so it follows every expression
    (the skin outline the build made had no keys: it stayed put when the jaw opened)."""
    face = bpy.data.objects["Face"]
    old = bpy.data.objects.get(name)
    if old:
        mesh = old.data
        bpy.data.objects.remove(old)
        bpy.data.meshes.remove(mesh)
    hull = face.copy()
    hull.name = name
    hull.data = face.data.copy()
    hull.data.name = name
    face.users_collection[0].objects.link(hull)
    bm = bmesh.new()
    bm.from_mesh(hull.data)
    uv = bm.loops.layers.uv.active
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != slot or (skip and skip(f, uv))], context="FACES")
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    for f in bm.faces:
        f.material_index = 0
    bm.to_mesh(hull.data)
    bm.free()
    assert hull.data.shape_keys and len(hull.data.shape_keys.key_blocks) > 100, "the outline hull lost its shape keys"
    hull.data.materials.clear()
    hull.data.materials.append(bpy.data.materials["clear"])
    hull.data.materials.append(material)
    mod = hull.modifiers.new("outline", "SOLIDIFY")
    mod.thickness, mod.offset, mod.use_flip_normals, mod.material_offset = thickness, 1.0, True, 1
    return hull


def _is_tooth(f, uv):
    """The teeth are the faces that sample the white block of the mouth picture (top left); they get no outline."""
    u = sum(l[uv].uv.x for l in f.loops) / len(f.loops)
    v = sum(l[uv].uv.y for l in f.loops) / len(f.loops)
    return u < 0.22 and v > 0.5


def _mouth_outline_material():
    m = bpy.data.materials.new("mouth_outline")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = lin("8E3B50")
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    m.use_backface_culling = True
    return m


def _outlines():
    face = bpy.data.objects["Face"]
    skin = next(i for i, m in enumerate(face.data.materials) if m and m.name == "skin_face")
    skin_hull = _hull("face_outline", skin, bpy.data.materials["outline"], 0.0016)
    _state["hulls"] = [skin_hull, _hull("mouth_outline", 0, _mouth_outline_material(), MOUTH_LINE, skip=_is_tooth)]
    bm = bmesh.new()  # the two black marks at the mouth corners: skin-shell faces showing through a cut-out in the skin
    bm.from_mesh(skin_hull.data)
    gone = [f for f in bm.faces if abs(f.calc_center_median().x) < 0.040 and 1.385 < f.calc_center_median().z < 1.425 and f.calc_center_median().y < -0.03]
    bmesh.ops.delete(bm, geom=gone, context="FACES")
    bm.to_mesh(skin_hull.data)
    bm.free()


def _skin_overlays():
    """Insert OVERLAY_SLOTS overlay layers just before the skin's emission colour; each is picture alpha x a strength value."""
    nt = bpy.data.materials["skin_face"].node_tree
    em = nt.nodes["Emission"]
    link = next(l for l in nt.links if l.to_node == em and l.to_socket.name == "Color")
    prev = link.from_socket
    nt.links.remove(link)
    slots = []
    for i in range(OVERLAY_SLOTS):
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.name = f"overlay_tex_{i}"
        tex.extension = "CLIP"
        k = nt.nodes.new("ShaderNodeMath")
        k.name = f"overlay_k_{i}"
        k.operation = "MULTIPLY"
        k.inputs[1].default_value = 0.0
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        nt.links.new(tex.outputs["Alpha"], k.inputs[0])
        nt.links.new(k.outputs["Value"], mix.inputs["Factor"])
        nt.links.new(prev, mix.inputs["A"])
        nt.links.new(tex.outputs["Color"], mix.inputs["B"])
        prev = mix.outputs["Result"]
        slots.append((tex, k))
    nt.links.new(prev, em.inputs["Color"])


def setup(ref_vrm):
    added = face_keys.transfer(ref_vrm)
    _state["brow_mat"] = bpy.data.objects["Face"].material_slots[BROW_SLOT].material
    _state["mouth_mat"] = _mouth_material()
    _outlines()
    _skin_overlays()
    return added


def attach():
    """Pick the expression machinery up from a saved .blend (setup() was run by the build): the mouth and brow materials and the two
    outline shells. Call once in a new session before apply()."""
    _state["mouth_mat"] = bpy.data.materials["N00_000_00_FaceMouth_00_FACE"]
    _state["brow_mat"] = bpy.data.materials["N00_000_00_FaceBrow_00_FACE"]
    _state["hulls"] = [bpy.data.objects["face_outline"], bpy.data.objects["mouth_outline"]]


def is_built():
    return "mouth_outline" in bpy.data.objects and "overlay_tex_0" in bpy.data.materials["skin_face"].node_tree.nodes


def set_overlays(items):
    """items: [(png file name in assets/model/tex/face, strength 0..1)], at most OVERLAY_SLOTS."""
    nt = bpy.data.materials["skin_face"].node_tree
    for i in range(OVERLAY_SLOTS):
        tex, k = nt.nodes[f"overlay_tex_{i}"], nt.nodes[f"overlay_k_{i}"]
        if i < len(items):
            name, strength = items[i]
            img = bpy.data.images.get(name) or bpy.data.images.load(os.path.abspath(os.path.join(TEX, name)))
            img.alpha_mode = "STRAIGHT"
            tex.image, k.inputs[1].default_value = img, strength
        else:
            k.inputs[1].default_value = 0.0


def apply(expr):
    """expr: a dict from expr_defs.EXPRESSIONS (keys: shape key -> percent; overlays; mesh_mouth)."""
    face = bpy.data.objects["Face"]
    keys = face.data.shape_keys.key_blocks
    for k in keys:
        if k.name != "Basis":
            k.value = 0.0
    for name, pct in expr["keys"].items():
        keys[name].value = pct / 100.0
    for h in _state["hulls"]:  # the outline shells follow the same keys
        for k in h.data.shape_keys.key_blocks:
            if k.name != "Basis":
                k.value = keys[k.name].value
    face.material_slots[BROW_SLOT].material = _hidden_material() if "brows" in expr.get("hide", ()) else _state["brow_mat"]  # hide=("brows",) is for a later doodle
    mouth = expr.get("mesh_mouth", True)
    face.material_slots[0].material = _state["mouth_mat"] if mouth else _hidden_material()
    _state["hulls"][1].hide_render = not mouth  # the mouth outline goes with the mouth
    set_overlays(expr.get("overlays", []))
