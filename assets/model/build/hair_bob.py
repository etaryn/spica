"""
Her hair on the first sample's own hair cards (the bob and fringe, reshaped a little), plus one piece that is
not the sample's: a small bun on her right, copied from the third sample (its right-hand bun, cards as they
are, moved onto her head without bending anything) and recoloured in her hair tones. The bun is the
asymmetry of the bob. The star tie is off for now. Hair colour follows the samples' own hair textures, with
the layer under the outer hair darker. Everything added is rigid on the head bone, so it turns with her head.
Runs after base_prepare.py in the same Blender session:
  blender -b -P base_prepare.py -P hair_bob.py -P clothes.py        (run.sh does this)
Z is up, she faces -Y, her left is +X.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hair_cards as hc  # noqa: E402
from palette import P  # noqa: E402

ROOT = hc.ROOT
V = hc.V
HC = V((0, 0.03, 1.495))  # the head's centre: set from her face mesh in fit_head()


def fit_head():
    """The centre of her head from the face mesh, so the hair sits on the real skull. The face mesh stops behind the ears: front to
    back is set by hand (the skull runs on to about y = 0.11, read off the hair that sat on it)."""
    global HC
    face = bpy.data.objects["Face"]
    vs = [face.matrix_world @ v.co for v in face.data.vertices]
    HC = (V([min(v[i] for v in vs) for i in range(3)]) + V([max(v[i] for v in vs) for i in range(3)])) / 2
    HC.y = 0.02
    print("HEAD", tuple(round(x, 3) for x in HC))


# ---------------------------------------------------------------- head binding
def bind_head(ob):
    """Rigid on the head bone, so it turns with her head and nothing else."""
    vg = ob.vertex_groups.new(name="J_Bip_C_Head")
    vg.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")
    mod = ob.modifiers.new("armature", "ARMATURE")
    mod.object = bpy.data.objects["Armature"]
    ob.modifiers.move(len(ob.modifiers) - 1, 0)


# ---------------------------------------------------------------- bob and fringe
def shorten_to_chin(n):
    old_end = {58: 1.301, 59: 1.305}[n]
    k = (hc.CUT - hc.CHIN) / (hc.CUT - old_end)

    def f(p):
        return p if p.z >= hc.CUT else V(p.x, p.y, hc.CUT - (hc.CUT - p.z) * k)

    hc.warp(hc.card(n), f)


FRINGE = range(60, 88)
FRINGE_TOP = 1.60


def reshape_fringe(sweep, span, shorten_left, shorten_all=1.0):
    """The fringe leans toward her right (-X), most near the parting and fading to the temples, so it
    opens no gap. shorten_all pulls every lower edge up, shorten_left only her left half."""
    def f(p):
        t = hc.clamp((FRINGE_TOP - p.z) / span)
        g = hc.clamp(1.0 - (abs(p.x + 0.01) / 0.09 if p.x < -0.01 else (p.x + 0.01) / 0.20))
        front = hc.clamp(-p.y / 0.03)
        z = FRINGE_TOP - (FRINGE_TOP - p.z) * shorten_all
        if p.x > 0.0:
            z = FRINGE_TOP - (FRINGE_TOP - z) * (1.0 - (1.0 - shorten_left) * hc.clamp(p.x / 0.04))
        return V(p.x - sweep * t * g * front, p.y, z)

    for n in FRINGE:
        hc.warp(hc.card(n), f)


# ---------------------------------------------------------------- tie
def tie(root, direction, star_pos, star_out, radius, amber, outline_mat):
    """A navy elastic band round the root of the bunch and two crossed amber stars on the hair beside it."""
    bm = bmesh.new()
    n_major, n_minor, rm, rn = 20, 8, radius, 0.0035
    ring = []
    for i in range(n_major):
        a = 2 * math.pi * i / n_major
        c = V(math.cos(a), math.sin(a), 0.0)
        row = []
        for j in range(n_minor):
            b = 2 * math.pi * j / n_minor
            row.append(bm.verts.new(c * (rm + rn * math.cos(b)) + V(0, 0, rn * math.sin(b))))
        ring.append(row)
    for i in range(n_major):
        for j in range(n_minor):
            bm.faces.new((ring[i][j], ring[(i + 1) % n_major][j], ring[(i + 1) % n_major][(j + 1) % n_minor], ring[i][(j + 1) % n_minor]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    band = hc.mesh_part("tie_band", bm, hc.flat("navy", "1E2340"), outline_mat, 0.0014)
    band.location = root
    band.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    bind_head(band)
    place_stars(star_pos, star_out, amber, outline_mat)


def place_stars(centre, normal, amber, outline_mat):
    q = normal.to_track_quat("Z", "Y")
    big = hc.star("tie_star_big", 0.024, amber, outline_mat)
    big.location = centre
    big.rotation_euler = q.to_euler()
    small = hc.star("tie_star_small", 0.012, amber, outline_mat)
    small.location = centre + q @ V((0.022, 0.017, 0.002))
    small.rotation_euler = (q @ Euler((0, 0, math.radians(36))).to_quaternion()).to_euler()
    for o in (big, small):
        bind_head(o)


# ---------------------------------------------------------------- what is built
SURFACES = []  # her skull and the bob cards, so a point can be put on the outermost hair, not under it


def outer_pt(az, el, off):
    """The point `off` metres outside the outermost surface (skin or bob card) in direction (az, el)
    from the head centre: az from the front toward her left, el above the horizon."""
    a, e = math.radians(az), math.radians(el)
    d = V(math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e))
    far = HC + d * 0.4
    best = None
    for b in SURFACES:
        loc, _, _, dist = b.ray_cast(far, -d)
        if loc is not None and (best is None or dist < best[0]):
            best = (dist, loc)
    return (best[1] if best else HC + d * 0.10) + d * off


def bun_from_sample3(az, el, off):
    """The small bun of the third sample, copied as it is: its right-hand bun cards (Hair119 to Hair152
    with their centres on the right), moved rigidly (no bending) onto her head. Her face and that
    sample's are the same size and place up to 6 mm of height, so they line up; the bun is then turned
    about her head centre to (az, el) and slid along that direction until its base sits `off` outside her
    outermost hair. Returns (base point, axis the hair leaves along, neck radius)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "base", "sample_model_3.glb"))
    new = [o for o in bpy.data.objects if o not in before]
    cards = []
    for o in new:
        base_name = o.name.split(".")[0]
        if o.type == "MESH" and base_name.startswith("Hair") and 119 <= int(base_name[4:]) <= 152:
            c = sum((o.matrix_world @ v.co for v in o.data.vertices), V()) / len(o.data.vertices)
            if c.x < 0:
                cards.append((int(base_name[4:]), o))
    outline_mat = bpy.data.materials["outline"]
    hair = bpy.data.materials["hair"]
    lift = V(0, 0, 0.006)
    objs = []
    for n, o in cards:
        me = o.data.copy()
        me.transform(Matrix.Translation(lift) @ o.matrix_world)
        tex = o.data.materials[0].node_tree.nodes if o.data.materials and o.data.materials[0] else []
        tex_name = next((nd.image.name for nd in tex if nd.bl_idname == "ShaderNodeTexImage" and nd.image), "_18")
        me.materials.clear()
        me.materials.append(hair)
        me.materials.append(outline_mat)
        ob = bpy.data.objects.new(f"tuft_{n}", me)
        bpy.context.scene.collection.objects.link(ob)
        ob["hair_tex"] = tex_name
        objs.append(ob)
    for o in new:  # the rest of the sample (body, clothes, rig) is not used
        bpy.data.objects.remove(o)
    pts = [v.co.copy() for ob in objs for v in ob.data.vertices]
    centre = sum(pts, V()) / len(pts)
    d0 = (centre - HC).normalized()
    a, e = math.radians(az), math.radians(el)
    d1 = V(math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e))
    rot = d0.rotation_difference(d1).to_matrix().to_4x4()
    mat = Matrix.Translation(HC) @ rot @ Matrix.Translation(-HC)
    for ob in objs:
        ob.data.transform(mat)
    pts = [mat @ p for p in pts]
    near = min((p - HC).length for p in pts)
    low = [p for p in pts if (p - HC).length < near + 0.004]
    root = sum(low, V()) / len(low)
    rd = (root - HC).normalized()
    target = outer_pt(math.degrees(math.atan2(rd.x, -rd.y)), math.degrees(math.asin(rd.z)), off)
    shift = target - root
    for ob in objs:
        ob.data.transform(Matrix.Translation(shift))
        for p in ob.data.polygons:
            p.use_smooth = True
        mod = ob.modifiers.new("outline", "SOLIDIFY")
        mod.thickness, mod.offset, mod.use_flip_normals, mod.material_offset = 0.0014, 1.0, True, 1
        bind_head(ob)
    pts = [p + shift for p in pts]
    root = root + shift
    axis = (sum(pts, V()) / len(pts) - root).normalized()
    neck = sorted(((p - root) - axis * (p - root).dot(axis)).length for p in pts if 0.006 < (p - root).dot(axis) < 0.014)
    return root, axis, (neck[int(len(neck) * 0.30)] if neck else 0.015)


# ---------------------------------------------------------------- hair shading
HAIR = dict(base=P.hair, shade=P.hair_shade, streak=P.streak)
STREAK_CARD = "Hair059"  # the one lock that carries the strip of highlights
INNER = 0.5  # how far a card of the inner layer goes toward the shadow colour


def blend(a, b, t):
    """Hex colour t of the way from a to b."""
    return "".join("%02X" % round(int(a[i:i + 2], 16) * (1 - t) + int(b[i:i + 2], 16) * t) for i in (0, 2, 4))


def hair_toon(name, tex, inner=False, clamp_streak=False, streak=None, band=None):
    """Hair as a toon material in her palette that keeps the strands of the sample's own hair texture:
    the texture's brightness (dark roots, lighter tips, the lines between strands, the highlight blobs)
    is mapped onto her tones, then the unlit side goes toward the shadow colour. `inner` darkens the
    cards of the layer under the outer hair. `clamp_streak` keeps the texture's coloured streak (the cyan
    one of the first sample) from standing out, or, with `streak` (a hex colour), paints it in that colour: the strip of highlights."""
    b, sh = HAIR["base"], HAIR["shade"]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    L = nt.links
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")

    def node(kind, **kw):
        n = nt.nodes.new(kind)
        for k, v in kw.items():
            setattr(n, k, v)
        return n

    def put(sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            L.new(v, sock)
        else:
            sock.default_value = v

    def mix(fac, a, b):
        n = node("ShaderNodeMix", data_type="RGBA", blend_type="MIX")
        put(n.inputs[0], fac)
        put(n.inputs[6], a)
        put(n.inputs[7], b)
        return n.outputs[2]

    def math(op, x, y):
        n = node("ShaderNodeMath", operation=op)
        put(n.inputs[0], x)
        put(n.inputs[1], y)
        return n.outputs[0]

    uv = node("ShaderNodeUVMap")
    img = node("ShaderNodeTexImage", image=bpy.data.images[tex])
    L.new(uv.outputs["UV"], img.inputs["Vector"])
    lum = node("ShaderNodeRGBToBW")
    L.new(img.outputs["Color"], lum.inputs["Color"])
    val = lum.outputs["Val"]
    if clamp_streak:
        val = math("MINIMUM", val, 0.20)
    def ramp_of(stops):
        r = node("ShaderNodeValToRGB")
        r.color_ramp.interpolation = "LINEAR"
        el = r.color_ramp.elements
        for k, (pos, hexc) in enumerate(stops):
            e = el[k] if k < len(el) else el.new(pos)
            e.position, e.color = pos, hc.lin(hexc)
        L.new(val, r.inputs["Fac"])
        return r.outputs["Color"]

    col = ramp_of([(0.045, blend(b, sh, 0.70)), (0.09, blend(b, sh, 0.18)), (0.12, b), (0.17, blend(b, P.hair_hi, 0.35)), (0.50, P.hair_hi2)])
    if streak:  # the texture's cyan streak (much blue, little red) in the highlight colour, the strand lines kept
        sep = node("ShaderNodeSeparateColor")
        L.new(img.outputs["Color"], sep.inputs["Color"])
        mask = math("MULTIPLY", math("GREATER_THAN", sep.outputs["Blue"], 0.30), math("SUBTRACT", 1.0, math("GREATER_THAN", sep.outputs["Red"], 0.15)))
        deep = blend(streak, P.streak_deep, 0.5)
        col = mix(mask, col, ramp_of([(0.045, blend(streak, deep, 0.7)), (0.09, blend(streak, deep, 0.2)), (0.12, streak), (0.17, blend(streak, "FFFFFF", 0.45)), (0.20, blend(streak, "FFFFFF", 0.65))]))
    if band:  # a thin vertical strip of the highlight colour down the card, by its UV (u0, width): the strand lines are kept
        u = node("ShaderNodeSeparateXYZ")
        L.new(uv.outputs["UV"], u.inputs["Vector"])
        u0, w = band
        edge = math("SUBTRACT", w, math("ABSOLUTE", math("SUBTRACT", u.outputs["X"], u0), 0.0))
        window = math("MINIMUM", math("MULTIPLY", edge, 1.0 / 0.012), 1.0)  # 1 inside the strip, a short soft edge
        window = math("MAXIMUM", window, 0.0)
        hi = P.streak
        deep = blend(hi, P.streak_deep, 0.5)
        col = mix(window, col, ramp_of([(0.045, blend(hi, deep, 0.7)), (0.09, blend(hi, deep, 0.2)), (0.12, hi), (0.17, blend(hi, "FFFFFF", 0.15)), (0.20, blend(hi, "FFFFFF", 0.30))]))
    if inner:
        col = mix(INNER, col, hc.lin(sh))
    d = node("ShaderNodeBsdfDiffuse")
    s2r = node("ShaderNodeShaderToRGB")
    L.new(d.outputs["BSDF"], s2r.inputs["Shader"])
    step = node("ShaderNodeValToRGB")
    step.color_ramp.interpolation = "CONSTANT"
    step.color_ramp.elements[0].color = (1, 1, 1, 1)
    step.color_ramp.elements[1].position, step.color_ramp.elements[1].color = 0.30, (0, 0, 0, 1)
    L.new(s2r.outputs["Color"], step.inputs["Fac"])  # 1 where unlit, 0 where lit
    col = mix(math("MULTIPLY", step.outputs["Color"], 0.65), col, hc.lin(sh))
    L.new(col, em.inputs["Color"])
    L.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def inner_layer(objs):
    """The hair objects that mostly lie under other hair: a ray from outside, through each vertex toward the
    head centre, meets another object first. Returns their names."""
    for o in objs:
        for md in o.modifiers:
            if md.name == "outline":
                md.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    verts, tris, owner, per = [], [], [], []
    for i, o in enumerate(objs):
        me = o.evaluated_get(dg).to_mesh()
        base = len(verts)
        pts = [o.matrix_world @ v.co for v in me.vertices]
        verts += pts
        me.calc_loop_triangles()
        for t in me.loop_triangles:
            tris.append(tuple(base + k for k in t.vertices))
            owner.append(i)
        per.append(pts)
    for o in objs:
        for md in o.modifiers:
            if md.name == "outline":
                md.show_viewport = True
    tree = BVHTree.FromPolygons(verts, tris)
    names = []
    for i, (o, pts) in enumerate(zip(objs, per)):
        hidden = total = 0
        for w in pts[::2]:
            r = (w - HC).length
            d = (w - HC) / r
            loc, _, idx, _ = tree.ray_cast(w + d * 0.3, -d)
            total += 1
            if loc is not None and owner[idx] != i and (loc - HC).length > r + 0.003:
                hidden += 1
        if total and hidden / total > 0.5:
            names.append(o.name)
    return names


def restyle_hair():
    """One hair for every piece, in the sample's own texture; the inner layer (what lies under other hair)
    darker so the layers of the bob read apart."""
    objs = [o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith(("Hair0", "tuft_"))]
    inner = set(inner_layer(objs))
    print("INNER", len(inner), "of", len(objs), sorted(inner))
    mats = {}
    for o in objs:
        tex = o.get("hair_tex", "_23")
        band = P.strip_band if o.name.split(".")[0] == STREAK_CARD else None  # the one strip of highlights: a band of adjacent strands
        key = (tex, o.name in inner, HAIR["streak"] if o.name.split(".")[0] == STREAK_CARD else None, band)
        if key not in mats:
            mats[key] = hair_toon(f"hair_{len(mats)}", tex, inner=key[1], clamp_streak=(tex == "_25"), streak=key[2], band=key[3])
        o.data.materials[0] = mats[key]


def tidy_view():
    """What she looks like when the .blend is opened: the rig and the bone-end helpers are hidden (the
    armature still deforms her), the 3D views show materials rather than grey solids, and a sun and
    a world are in the file so the Rendered view looks like the review renders (render.py swaps in its
    own). Blender reads a saved Rendered viewport back as Solid when run headless, so Material Preview
    is the one stored."""
    for o in bpy.data.objects:
        if o.type in ("ARMATURE", "EMPTY"):
            o.hide_render = True
            o.hide_set(True)
    world = bpy.data.worlds.new("view_world")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.30, 0.31, 0.36, 1)
    bpy.context.scene.world = world
    sun = bpy.data.objects.new("view_sun", bpy.data.lights.new("view_sun", "SUN"))
    sun.data.energy = math.pi
    sun.rotation_euler = (-V(0.45, 0.65, -0.85).normalized()).to_track_quat("Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(sun)
    for ws in bpy.data.workspaces:
        for scr in ws.screens:
            for area in scr.areas:
                if area.type == "VIEW_3D":
                    sp = area.spaces[0]
                    sp.shading.type = "MATERIAL"
                    sp.overlay.show_bones = False
                    sp.overlay.show_extras = False


def main():
    outline_mat = bpy.data.materials["outline"]
    amber = hc.amber_toon()
    hc.a_pose()
    shorten_to_chin(58)
    shorten_to_chin(59)
    fit_head()
    SURFACES.extend([hc.skin_bvh(bpy.data.objects["Body"]), hc.skin_bvh(bpy.data.objects["Face"])])
    SURFACES.extend(hc.skin_bvh(hc.card(n)) for n in range(1, 88))

    reshape_fringe(sweep=0.016, span=0.075, shorten_left=1.0, shorten_all=0.78)
    root, axis, neck = bun_from_sample3(BUN_AZ, BUN_EL, BUN_OFF)
    restyle_hair()
    hc.recolor_eyes()
    if WITH_TIE:  # the tie and its stars are off for now
        out = V(root.x - HC.x, root.y - HC.y, 0.0).normalized()
        star_out = (out + V(0, -0.55, 0) + V(0, 0, -0.1)).normalized()
        centre = root + axis * 0.007
        trees = [hc.skin_bvh(o) for o in bpy.data.objects if o.name.startswith("tuft_")]
        hits = [t.ray_cast(centre + star_out * 0.3, -star_out) for t in trees]
        hit = min((h for h in hits if h[0] is not None), key=lambda h: h[3])[0]
        tie(centre, axis, hit + star_out * STAR_LIFT, star_out, neck + 0.002, amber, outline_mat)
    tidy_view()
    print("BUN root", tuple(round(c, 3) for c in root), "axis", tuple(round(c, 2) for c in axis), "neck", round(neck, 4))


BUN_AZ = float(os.environ.get("SPICA_BUN_AZ", "-125"))
BUN_EL = float(os.environ.get("SPICA_BUN_EL", "14"))
BUN_OFF = float(os.environ.get("SPICA_BUN_OFF", "-0.022"))  # sunk into the bob so the bun sits on her head, no neck
WITH_TIE = os.environ.get("SPICA_TIE") == "1"  # off for now: the band needs a neck, and the stars were removed too
STAR_LIFT = 0.010  # the big star sits this far outside the bun, so its flat face clears the cards
main()
