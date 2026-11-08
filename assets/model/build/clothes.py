"""
Her clothes: a thick off-white cotton hoodie that follows her body, greyish-black denim shorts and sneakers from the outfit of
the third sample (the VRoid export with the hoodie, shorts and sneakers). Her legs are bare.
- Hoodie: the sample's hood, lying down as a collar, on top of a close-fitting body and sleeves that are a shell of her own skin
  (so the fit is her shape, with no gaps at the armpits and no puffing), pushed out about 2.4 cm, with soft shading and a fine
  cotton weave; the hem and cuffs are rolled in. A zip down the front and two slanted hand-pocket slits are drawn on it
  (cloth_tex.py). The sample's oversized torso and sleeves are not used.
- Shorts: the sample's shorts (only the part its alpha mask shows; the rest of that mesh is a hidden full-body layer), cut just
  below her crotch, in greyish-black denim with a twill weave and back pockets sewn in thread the colour of the cloth.
- Sneakers: the sample's, in the hoodie's cool white, with the sole (the lowest 4.5 centimetres) in a muted periwinkle.
The sample's pieces are skinned with its own weights to her armature (same bone names), the shells with her skin's weights,
so everything deforms with her.
Runs after base_prepare.py and hair_bob.py in one Blender session:
  blender -b -P base_prepare.py -P hair_bob.py -P clothes.py        (run.sh does this)
Z is up, she faces -Y, her left is +X.
"""
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hair_cards as hc  # noqa: E402
import cloth_layout as CL  # noqa: E402

ROOT = hc.ROOT
V = hc.V
LIFT = Vector((0, 0, 0.005))  # the third sample's body sits 5 mm lower than hers

SOLE = 0.045  # the sneakers' lowest 4.5 centimetres are the sole
HOODIE_HEM = CL.HEM_Z  # the hoodie is cut here, at the hip, so the shorts show
SHORTS_TOP = 0.90  # the shorts start just above it, so the hoodie's hem lies over them
HOOD_FRONT_Y = 0.0  # the hood ends in two flaps beside her neck, cut off by this plane (she faces -y)
KNIT_SCALE = 150.0  # weave cells per metre of cloth (about 3 mm): fine and faint, so it reads as cotton and not as a brick wall
SOCK_RIBS = 140  # ribs round a leg on a sock
RIBS_ROUND = 300  # ribs round the torso on the hoodie's hem band (a whole number, so there is no seam at the back)

PAL = dict(pants=CL.PANTS, pants_shade=CL.PANTS_SHADE)


def lin(h):
    return hc.lin(h)


def lighten(h, t):
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        c = c + (1 - c) * t
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out) + (1.0,)


class NB:
    """Small helpers to build shader nodes without writing every link out."""

    def __init__(self, nt):
        self.nt = nt

    def node(self, kind, **kw):
        n = self.nt.nodes.new(kind)
        for k, v in kw.items():
            setattr(n, k, v)
        return n

    def put(self, sock, v):
        if isinstance(v, bpy.types.NodeSocket):
            self.nt.links.new(v, sock)
        else:
            sock.default_value = v

    def math(self, op, x, y=0.0, z=None):
        n = self.node("ShaderNodeMath", operation=op)
        for i, v in enumerate((x, y, z)):
            if v is not None:
                self.put(n.inputs[i], v)
        return n.outputs[0]

    def mr(self, val, lo, hi):
        n = self.node("ShaderNodeMapRange")
        self.put(n.inputs["Value"], val)
        n.inputs["From Min"].default_value, n.inputs["From Max"].default_value = lo, hi
        return n.outputs["Result"]

    def mixf(self, fac, a, b):
        n = self.node("ShaderNodeMix", data_type="FLOAT")
        self.put(n.inputs[0], fac)
        self.put(n.inputs[2], a)
        self.put(n.inputs[3], b)
        return n.outputs[0]

    def mixc(self, fac, a, b):
        n = self.node("ShaderNodeMix", data_type="RGBA")
        self.put(n.inputs[0], fac)
        self.put(n.inputs[6], a)
        self.put(n.inputs[7], b)
        return n.outputs[2]

    def mulc(self, a, b):
        n = self.node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        n.inputs[0].default_value = 1.0
        self.put(n.inputs[6], a)
        self.put(n.inputs[7], b)
        return n.outputs[2]

    def gray(self, g):
        c = self.node("ShaderNodeCombineColor")
        for ch in ("Red", "Green", "Blue"):
            self.put(c.inputs[ch], g)
        return c.outputs["Color"]

    def bw(self, color):
        n = self.node("ShaderNodeRGBToBW")
        self.put(n.inputs["Color"], color)
        return n.outputs["Val"]

    def vec(self, a, b, c=0.0):
        n = self.node("ShaderNodeCombineXYZ")
        for k, v in zip(("X", "Y", "Z"), (a, b, c)):
            self.put(n.inputs[k], v)
        return n.outputs["Vector"]

    def rest(self):
        """Her rest-pose x, y, z at this point of the cloth (stored on the mesh as the UV layers rest_xy and rest_xz)."""
        a, b = self.node("ShaderNodeUVMap", uv_map="rest_xy"), self.node("ShaderNodeUVMap", uv_map="rest_xz")
        sa, sb = self.node("ShaderNodeSeparateXYZ"), self.node("ShaderNodeSeparateXYZ")
        self.nt.links.new(a.outputs["UV"], sa.inputs["Vector"])
        self.nt.links.new(b.outputs["UV"], sb.inputs["Vector"])
        return sa.outputs["X"], sa.outputs["Y"], sb.outputs["Y"]

    def tex(self, image, u, v, extension="CLIP"):
        t = self.node("ShaderNodeTexImage", image=image, extension=extension, interpolation="Linear")
        self.nt.links.new(self.vec(u, v), t.inputs["Vector"])
        return t.outputs["Color"], t.outputs["Alpha"]


_images = {}


def cloth_image(name):
    """A texture from assets/model/tex/cloth/ (drawn by cloth_tex.py), packed into the .blend."""
    if name not in _images:
        im = bpy.data.images.load(os.path.join(ROOT, "tex", "cloth", name))
        im.alpha_mode = "STRAIGHT"
        im.pack()
        _images[name] = im
    return _images[name]


def toon(name, base, shade, cut=0.30, soft=False, grain=None, decals=None, ease=False, shine=0.10, ribs=None, lining=None, sock=None):
    """The same toon look as her skin and hair: a lit tone, a shadow tone, one hard step between them. `lining` (a hex colour) shows the inside of the cloth (its back faces) in that colour. `sock` (axis (x, y) of the leg, band height z, and optionally `stars`, the leg's centre and radius by height, for the stars laid round it) draws fine vertical ribs round the leg, deeper above z (the ribbed band at the top of a sock), over the stars. `ribs` (a height z) draws fine vertical ribs, round the torso, on everything below z: the ribbed hem band. `shine` is how much lighter the lit-most part is (hard step only). `soft` swaps the hard
    step for a wide smooth one and adds a pale fuzzy rim (wool, not a hard shell). `grain` is the weave drawn on the cloth:
    "cotton" (a fine faint weave and a fine grain) or "denim" (a twill, with faded patches). `decals` lays textures drawn by
    cloth_tex.py over it (a zip, slits, pockets: a front and a back picture of a box of her body), shaded like the cloth."""
    nb = NB(None)
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    nb.nt = nt
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    d = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    cr = nt.nodes.new("ShaderNodeValToRGB")
    e = cr.color_ramp.elements
    if soft:
        cr.color_ramp.interpolation = "EASE"
        e[0].position, e[0].color = 0.0, lin(shade)
        e[1].position, e[1].color = 0.30, lin(base)
        e.new(0.92).color = lighten(base, 0.14)
    elif ease:  # a smooth step without the fuzz
        cr.color_ramp.interpolation = "EASE"
        e[0].position, e[0].color = 0.0, lin(shade)
        e[1].position, e[1].color = 0.45, lin(base)
        e.new(0.95).color = lighten(base, 0.10)
    else:
        cr.color_ramp.interpolation = "CONSTANT"
        e[0].position, e[0].color = 0.0, lin(shade)
        e[1].position, e[1].color = cut, lin(base)
        e.new(0.92).color = lighten(base, shine)
    nt.links.new(d.outputs["BSDF"], s2r.inputs["Shader"])
    nt.links.new(s2r.outputs["Color"], cr.inputs["Fac"])
    col = cr.outputs["Color"]
    if soft:  # fuzz: wool is lighter and softer where it turns away from the eye
        lw = nt.nodes.new("ShaderNodeLayerWeight")
        lw.inputs["Blend"].default_value = 0.30
        rim = nt.nodes.new("ShaderNodeValToRGB")
        rim.color_ramp.elements[0].position, rim.color_ramp.elements[0].color = 0.45, (0.0, 0.0, 0.0, 1.0)
        rim.color_ramp.elements[1].position, rim.color_ramp.elements[1].color = 0.95, (0.35, 0.35, 0.35, 1.0)
        nt.links.new(lw.outputs["Facing"], rim.inputs["Fac"])
        col = nb.mixc(rim.outputs["Color"], col, lighten(base, 0.30))
    if not (grain or decals or sock):
        nt.links.new(col, em.inputs["Color"])
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
        return m

    x, y, z = nb.rest()
    r0 = lin(base)
    ratio = nb.gray(nb.math("DIVIDE", nb.bw(col), 0.2126 * r0[0] + 0.7152 * r0[1] + 0.0722 * r0[2]))  # how much light the cloth has here

    def shaded(rgb):
        return nb.mulc(rgb, ratio)

    yy = nb.math("SUBTRACT", y, 0.02)  # round the torso's axis
    r_t = nb.math("SQRT", nb.math("ADD", nb.math("MULTIPLY", x, x), nb.math("MULTIPLY", yy, yy)))
    w_side = nb.math("GREATER_THAN", nb.math("POWER", nb.math("DIVIDE", x, nb.math("MAXIMUM", r_t, 0.001)), 2.0), 0.5)  # 1 on the sides, 0 front and back
    ax = nb.math("ABSOLUTE", x)
    if grain == "denim":  # a twill, and faded patches, under the stitching
        # the weave tile covers 4 cm: scale the coordinates by 25
        t2, _ = nb.tex(cloth_image("denim_weave.png"), nb.math("MULTIPLY", nb.mixf(w_side, x, yy), 25.0), nb.math("MULTIPLY", z, 25.0), "REPEAT")
        nz = nb.node("ShaderNodeTexNoise", noise_dimensions="3D")
        nz.inputs["Scale"].default_value, nz.inputs["Detail"].default_value = 9.0, 3.0
        nt.links.new(nb.vec(x, y, z), nz.inputs["Vector"])
        fade = nb.math("MULTIPLY", nb.mr(nz.outputs["Fac"], 0.25, 0.75), 0.16)  # wide soft fading, not blotches
        col = nb.mixc(fade, col, lighten(base, 0.38))
        col = nb.mulc(col, nb.gray(nb.math("MULTIPLY", nb.bw(t2), 1.22)))

    if decals:
        x0, x1, z0, z1 = decals["box"]
        u = nb.math("MULTIPLY_ADD", x, 1.0 / (x1 - x0), -x0 / (x1 - x0))
        v = nb.math("MULTIPLY_ADD", z, 1.0 / (z1 - z0), -z0 / (z1 - z0))
        f_rgb, f_a = nb.tex(decals["front"], u, v)
        b_rgb, b_a = nb.tex(decals["back"], u, v)
        wb = nb.math("GREATER_THAN", yy, 0.0)  # behind her axis: the back
        rgb, a = nb.mixc(wb, f_rgb, b_rgb), nb.mixf(wb, f_a, b_a)
        col = nb.mixc(a, col, shaded(rgb))

    if grain == "cotton":  # a fine faint weave projected from her rest pose, and a fine grain over it
        def stitches(a_, b_):
            brick = nb.node("ShaderNodeTexBrick", offset=0.5, offset_frequency=2, squash=1.0)
            brick.inputs["Scale"].default_value = KNIT_SCALE
            brick.inputs["Mortar Size"].default_value = 0.08
            brick.inputs["Mortar Smooth"].default_value = 0.6
            brick.inputs["Brick Width"].default_value = 0.5
            brick.inputs["Row Height"].default_value = 0.3
            brick.inputs["Color1"].default_value = (1.0, 1.0, 1.0, 1.0)
            brick.inputs["Color2"].default_value = (0.97, 0.97, 0.98, 1.0)
            brick.inputs["Mortar"].default_value = (0.91, 0.91, 0.93, 1.0)
            nt.links.new(nb.vec(a_, b_), brick.inputs["Vector"])
            return brick.outputs["Color"]

        torso = nb.mixc(w_side, stitches(x, z), stitches(yy, z))  # front and back draw it on (x, z), the sides on (y, z)
        ya, za = nb.math("SUBTRACT", y, CL.ARM_Y), nb.math("SUBTRACT", z, CL.ARM_Z)
        w_fb = nb.math("GREATER_THAN", nb.math("POWER", nb.math("DIVIDE", ya, nb.math("MAXIMUM", nb.math("SQRT", nb.math("ADD", nb.math("MULTIPLY", ya, ya), nb.math("MULTIPLY", za, za))), 0.001)), 2.0), 0.5)
        arm = nb.mixc(w_fb, stitches(x, ya), stitches(x, za))  # a sleeve: (x, y) on top and below, (x, z) in front and behind
        w_arm = nb.math("MULTIPLY", nb.mr(ax, 0.13, 0.21), nb.mr(z, 1.0, 1.08))
        weave = nb.mixc(nb.math("GREATER_THAN", w_arm, 0.5), torso, arm)
        grain_n = nb.node("ShaderNodeTexNoise", noise_dimensions="3D")
        grain_n.inputs["Scale"].default_value, grain_n.inputs["Detail"].default_value, grain_n.inputs["Roughness"].default_value = 520.0, 2.0, 0.6
        nt.links.new(nb.vec(x, y, z), grain_n.inputs["Vector"])
        g = nb.gray(nb.math("MULTIPLY_ADD", nb.mr(grain_n.outputs["Fac"], 0.3, 0.7), 0.08, 0.92))
        col = nb.mulc(col, nb.mulc(weave, g))
        if ribs:  # fine vertical ribs all round the torso (a whole number of them, so there is no seam at the back), below the seam
            ang = nb.math("ARCTAN2", x, nb.math("MULTIPLY", yy, -1.0))
            wave = nb.math("SINE", nb.math("MULTIPLY", ang, RIBS_ROUND))
            band = nb.math("SUBTRACT", 1.0, nb.mr(z, ribs - 0.002, ribs))
            dip = nb.math("MULTIPLY", band, nb.math("MULTIPLY", nb.math("SUBTRACT", 1.0, wave), 0.070))
            col = nb.mulc(col, nb.gray(nb.math("SUBTRACT", 1.0, dip)))

    if sock and sock.get("stars"):  # the stars: each is laid by the true distances on the cloth from its own centre, so none is stretched
        zs, cxs, cys, rs = sock["stars"]["knots"]

        def along(vals):  # a number that changes with height, straight between the heights zs
            v = vals[0]
            for k in range(len(zs) - 1):
                v = nb.mixf(nb.mr(z, zs[k], zs[k + 1]), v, vals[k + 1])
            return v

        phi = nb.math("ARCTAN2", nb.math("SUBTRACT", x, along(cxs)), nb.math("MULTIPLY", nb.math("SUBTRACT", y, along(cys)), -1.0))
        for zc, deg, rad, turn in CL.SOCK_STARS:
            du = nb.math("MULTIPLY", nb.math("WRAP", nb.math("SUBTRACT", phi, math.radians(deg)), -math.pi, math.pi), float(np.interp(zc, zs, rs)))  # distance round the leg from the star's centre line, at the leg's radius at the star's own height (the same scale across the star, so its sides stay straight)
            dv = nb.math("SUBTRACT", z, zc)
            t, width = math.radians(turn), rad / CL.STAR_FILL
            a_ = nb.math("MULTIPLY_ADD", du, math.cos(t) / width, nb.math("MULTIPLY", dv, math.sin(t) / width))
            b_ = nb.math("MULTIPLY_ADD", dv, math.cos(t) / width, nb.math("MULTIPLY", du, -math.sin(t) / width))
            rgb, alpha = nb.tex(cloth_image("sock_star.png"), nb.math("ADD", a_, 0.5), nb.math("ADD", b_, 0.5))
            col = nb.mixc(alpha, col, shaded(rgb))
    if sock:  # fine ribs round the leg (a whole number of them, so there is no seam at the back), deeper in the band at the top
        ang = nb.math("ARCTAN2", nb.math("SUBTRACT", x, sock["axis"][0]), nb.math("MULTIPLY", nb.math("SUBTRACT", y, sock["axis"][1]), -1.0))
        wave = nb.math("SINE", nb.math("MULTIPLY", ang, SOCK_RIBS))
        depth = nb.math("ADD", 0.05, nb.math("MULTIPLY", nb.mr(z, sock["z"], sock["z"] + 0.002), 0.07))
        col = nb.mulc(col, nb.gray(nb.math("SUBTRACT", 1.0, nb.math("MULTIPLY", nb.math("SUBTRACT", 1.0, wave), depth))))
    if lining:  # the inside of the cloth, seen at the opening, the cuffs and the hem, is the lining colour
        rb, rl = lin(base), lin(lining)
        back = nb.node("ShaderNodeNewGeometry")
        col = nb.mixc(back.outputs["Backfacing"], col, nb.mulc(col, (rl[0] / rb[0], rl[1] / rb[1], rl[2] / rb[2], 1.0)))
    nt.links.new(col, em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def alpha_sampler(image):
    """Function (u, v) -> the image's alpha there."""
    w, h = image.size
    px = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(px)
    a = px.reshape(h, w, 4)[:, :, 3]

    def at(u, v):
        return float(a[min(h - 1, int((v % 1.0) * h)), min(w - 1, int((u % 1.0) * w))])

    return at


def components(bm):
    """Connected pieces of a bmesh, as lists of faces."""
    seen, comps = set(), []
    for f in bm.faces:
        if f.index in seen:
            continue
        stack, comp = [f], []
        seen.add(f.index)
        while stack:
            g = stack.pop()
            comp.append(g)
            for v in g.verts:
                for h in v.link_faces:
                    if h.index not in seen:
                        seen.add(h.index)
                        stack.append(h)
        comps.append(comp)
    return comps


def bind(ob, src, th, outline_mat):
    """Skin it like the sample (same vertex groups, same weights) to her armature, with the ink outline."""
    for vg in src.vertex_groups:
        ob.vertex_groups.new(name=vg.name)
    mod = ob.modifiers.new("armature", "ARMATURE")
    mod.object = bpy.data.objects["Armature"]
    ob.data.materials.append(outline_mat)
    so = ob.modifiers.new("outline", "SOLIDIFY")
    so.thickness, so.offset, so.use_flip_normals, so.material_offset = th, 1.0, True, 1
    for p in ob.data.polygons:
        p.use_smooth = True


def extract(src, slot, name, keep_face=None, drop_comp=None, cut_below=None, cut_above=None, split_z=None, move=LIFT):
    """A copy of one material slot of the sample's body mesh: only the faces keep_face accepts, without the
    pieces drop_comp accepts, moved by `move` (world space) to sit on her body. Returns the new object."""
    me = src.data.copy()
    me.transform(Matrix.Translation(move) @ src.matrix_world)
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.active
    bad = [f for f in bm.faces if f.material_index != slot or (keep_face and not keep_face(f, uv))]
    bmesh.ops.delete(bm, geom=bad, context="FACES")
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    bm.faces.ensure_lookup_table()
    if drop_comp:
        for comp in components(bm):
            vs = [v.co for f in comp for v in f.verts]
            box = (min(v.x for v in vs), max(v.x for v in vs), min(v.y for v in vs), max(v.y for v in vs), min(v.z for v in vs), max(v.z for v in vs))
            if drop_comp(len(comp), box):
                bmesh.ops.delete(bm, geom=comp, context="FACES_ONLY")
        for v in [v for v in bm.verts if not v.link_faces]:
            bm.verts.remove(v)
    if cut_below is not None:  # a straight lower edge
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, cut_below), plane_no=(0, 0, 1), clear_inner=True)
        for v in [v for v in bm.verts if not v.link_faces]:
            bm.verts.remove(v)
    if cut_above is not None:  # a straight upper edge
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, cut_above), plane_no=(0, 0, 1), clear_outer=True)
        for v in [v for v in bm.verts if not v.link_faces]:
            bm.verts.remove(v)
    if split_z is not None:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, split_z), plane_no=(0, 0, 1))
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def rest_skin_bvh(body):
    """An object's surface in its rest pose (the armature and outline modifiers off), to fit the clothes, which are in rest pose."""
    mods = [m for m in body.modifiers if m.type in ("ARMATURE", "SOLIDIFY")]
    for m in mods:
        m.show_viewport = False
    tree = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
    for m in mods:
        m.show_viewport = True
    return tree


def add_rest_uvs(ob):
    """Store each vertex's rest-pose (x, y) and (x, z) as two UV layers: a shader can then draw a pattern on the cloth in
    3D (projected from the rest pose, so it sticks to the surface in any pose and has no UV seams)."""
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    co = co.reshape(n, 3)
    li = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get("vertex_index", li)
    for name, cols in (("rest_xy", [0, 1]), ("rest_xz", [0, 2])):
        me.uv_layers.new(name=name).data.foreach_set("uv", co[li][:, cols].reshape(-1))


def open_front(ob, bvh, z0, slope, roll_width, lo=0.15, lo_top=None, facing=None, yc=0.02, margin=0.006):
    """Cut a V out of the front of a garment, from the point (x=0, z0) opening upward: |x| < slope * (z - z0). With roll_width the
    cut edges curve in toward the body (see `roll`, which they keep `lo` of the thickness at, `lo_top` at the top, 14 cm above
    z0, if given: the hood sits on the top of the opening and must not be run through by a flared edge), like the turned edge of thick cloth.
    With `facing` (a width) the strip that wide along the cut edge, as it lies after the roll, is the lining: its faces get
    material 1, and it stands a little proud with a seam groove where it ends. The strip is traced exactly: once the
    edge is rolled, the faces are split along the line `facing` from it (and a few finer ones), so the border is a clean line.
    (Splitting first, and rolling the thin strips one by one, makes the surface ragged.)"""

    def cut(bm, e):
        for sgn in (1, -1):
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(sgn * e, 0, z0), plane_no=(sgn, 0, -slope))

    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    cut(bm, 0.0)  # split faces along both sides of the V first, so the edge is a clean line
    gone = [f for f in bm.faces if f.calc_center_median().y < yc and all(abs(v.co.x) <= slope * (v.co.z - z0) + 1e-4 for v in f.verts)]
    bmesh.ops.delete(bm, geom=gone, context="FACES")
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    bmesh.ops.dissolve_degenerate(bm, dist=0.0006, edges=bm.edges[:])  # the cuts leave slivers, and they show as ticks in the outline
    if roll_width > 0.0:
        for v in bm.verts:
            if v.co.y < yc and v.co.z > z0 - 0.002:
                u = min(1.0, max(0.0, (abs(v.co.x) - slope * (v.co.z - z0)) / roll_width))
                if u < 1.0:
                    loc, nrm, _, _ = bvh.find_nearest(v.co)
                    if loc is not None and (v.co - loc).dot(nrm) > margin:
                        gap = (v.co - loc).dot(nrm)
                        k = lo if lo_top is None else lo + (lo_top - lo) * smoothstep(v.co.z - z0, 0.06, 0.14)
                        v.co = loc + nrm * (margin + (gap - margin) * roll(u, k))
    if facing:
        for e in (0.002, 0.004, 0.006, 0.008, 0.010, 0.012, facing, facing + 0.0025, facing + 0.005):
            cut(bm, e)
        bm.verts.ensure_lookup_table()
        edge = {v.index: abs(v.co.x) - slope * (v.co.z - z0) for v in bm.verts}
        for f in bm.faces:
            c = f.calc_center_median()
            if c.y < yc and c.z > z0 - 1e-4 and abs(c.x) - slope * (c.z - z0) <= facing + 1e-4:
                f.material_index = 1
        bm.normal_update()
        for v in bm.verts:
            if v.co.y < yc and v.co.z > z0 - 0.002:
                e = edge[v.index]
                d = 0.0020 * (1.0 - smoothstep(e, facing - 0.003, facing)) - 0.0015 * math.exp(-(((e - facing - 0.001) / 0.0016) ** 2))
                v.co = v.co + v.normal * d
    bm.to_mesh(me)
    bm.free()
    me.update()


def split_hem(ob, half, z_top, yc=0.02):
    """Cut a narrow slot up the front, from the lower edge to z_top (|x| < half): the two halves of the hem stand slightly apart."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for x in (half, -half):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(x, 0, 0), plane_no=(1, 0, 0))
    gone = [f for f in bm.faces if f.calc_center_median().y < yc and f.calc_center_median().z < z_top and all(abs(v.co.x) <= half + 1e-4 for v in f.verts)]
    bmesh.ops.delete(bm, geom=gone, context="FACES")
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    bmesh.ops.dissolve_degenerate(bm, dist=0.0006, edges=bm.edges[:])
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def make_sock(body, outline, side, z_top, name, band=True, stars=False):
    """A sock: a shell of her leg, 2 mm out, from inside the shoe up to z_top, skinned like the leg so it bends with it. With `band`
    it has a ribbed band at the top that stands a little proud (and a seam groove under it); without, the top is a clean edge that
    wraps the leg (the thigh-high stocking). With `stars` the stars of cloth_tex.py are laid on its front."""
    bones = tuple("J_Bip_%s_%s" % (side, b) for b in ("UpperLeg", "LowerLeg", "Foot", "ToeBase"))
    z_bot = 0.05

    def leg(ws, c):
        return all(sum(w.get(n, 0.0) for n in bones) > 0.6 for w in ws) and z_bot - 0.02 < c.z < z_top + 0.02

    ob = skin_shell(body, name, leg, 0.0022, cut_below=z_bot)
    bm = bmesh.new()  # a straight top edge
    bm.from_mesh(ob.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z_top), plane_no=(0, 0, 1), clear_outer=True)
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    bm.to_mesh(ob.data)
    bm.free()
    x0 = 0.085 if side == "L" else -0.085
    star_args = None
    if stars:  # where the leg's axis is and how wide it is at each height, measured on the shell, so the stars keep their shape round it
        zs = [0.08, 0.17, 0.27, 0.38, 0.50, 0.62, 0.69]
        cxs, cys, rs = [], [], []
        for zk in zs:
            ring = [v.co for v in ob.data.vertices if abs(v.co.z - zk) < 0.012]
            cx, cy = sum(p.x for p in ring) / len(ring), sum(p.y for p in ring) / len(ring)
            cxs.append(cx)
            cys.append(cy)
            rs.append(sum(math.hypot(p.x - cx, p.y - cy) for p in ring) / len(ring))
        star_args = dict(knots=(zs, cxs, cys, rs))
    ob.data.materials.append(toon(name, CL.SOCK, CL.SOCK_SHADE, soft=True, sock=dict(axis=(x0, 0.015), z=z_top - CL.SOCK_BAND if band else 9.0, stars=star_args)))
    bind(ob, body, 0.0016, outline)
    if band:
        add_loops(ob, [z_top - d for d in (0.002, 0.004, 0.006, 0.008, 0.010, 0.012, 0.014, 0.016, 0.018, CL.SOCK_BAND, CL.SOCK_BAND + 0.002, CL.SOCK_BAND + 0.004, CL.SOCK_BAND + 0.008)])
    add_rest_uvs(ob)
    if band:
        hem_band(ob, z_top, CL.SOCK_BAND, 0.0025, 0.0014, down=True)
    return ob


def tattoo_face(face):
    """The star under the outer corner of her left eye. Her skin material is copied for the face alone and the picture is laid on it
    by the face mesh's own UV map, which wraps the cheek with hardly any stretch (measured at the star: 0.29 m per unit along u and
    0.26 along v, at right angles), so the star follows the surface exactly, even where the cheek turns away, and is not stretched.
    The two directions are scaled to metres so the star is the same size both ways, and only skin within a centimetre of the star's
    centre (measured on the face mesh's undeformed 'Generated' coordinates) gets it, in case the UV map reuses the spot elsewhere.
    It lies on the skin and moves with it, whatever the pose or expression. The picture is shaded like the skin."""
    i = next(k for k, m in enumerate(face.data.materials) if m and m.name == "skin")
    mat = face.data.materials[i].copy()
    mat.name = "skin_face"
    face.data.materials[i] = mat
    nt = mat.node_tree
    nb = NB(nt)
    em = next(n for n in nt.nodes if n.bl_idname == "ShaderNodeEmission")
    col = em.inputs["Color"].links[0].from_socket
    px, pz, radius = CL.FACE_STAR
    bm = bmesh.new()  # the star's centre on the face mesh: where it is on the UV map, and how long a unit of the UV map is there
    bm.from_mesh(face.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    uv = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    hit, _, idx, _ = BVHTree.FromBMesh(bm).ray_cast(Vector((px, -0.3, pz)), Vector((0, 1, 0)))
    tri = bm.faces[idx]
    assert tri.material_index == i, "the star's centre is not on her skin"
    p0, p1, p2 = [l.vert.co for l in tri.loops]
    u0, u1, u2 = [Vector((l[uv].uv[0], l[uv].uv[1], 0.0)) for l in tri.loops]
    centre = barycentric_transform(hit, p0, p1, p2, u0, u1, u2)
    e1, e2, d1, d2 = p1 - p0, p2 - p0, u1 - u0, u2 - u0
    det = d1.x * d2.y - d1.y * d2.x
    dpdu, dpdv = (e1 * d2.y - e2 * d1.y) / det, (e2 * d1.x - e1 * d2.x) / det  # the surface's change per unit of u and of v
    bm.free()
    su = dpdu.length * (1.0 if dpdu.x > 0 else -1.0)  # metres per unit, signed so that the picture is not mirrored and its point is up
    sv = dpdv.length * (1.0 if dpdv.z > 0 else -1.0)
    width = radius / CL.STAR_FILL
    uvm = nb.node("ShaderNodeUVMap", uv_map=face.data.uv_layers.active.name)
    sep = nb.node("ShaderNodeSeparateXYZ")
    nt.links.new(uvm.outputs["UV"], sep.inputs["Vector"])
    a_ = nb.math("ADD", nb.math("MULTIPLY", nb.math("SUBTRACT", sep.outputs["X"], centre.x), su / width), 0.5)
    b_ = nb.math("ADD", nb.math("MULTIPLY", nb.math("SUBTRACT", sep.outputs["Y"], centre.y), sv / width), 0.5)
    rgb, alpha = nb.tex(cloth_image("face_star.png"), a_, b_)
    pts = [v.co for v in face.data.vertices]  # a gate on where in space the star can be, by the undeformed coordinates
    lo = Vector((min(q.x for q in pts), min(q.y for q in pts), min(q.z for q in pts)))
    size = Vector((max(q.x for q in pts), max(q.y for q in pts), max(q.z for q in pts))) - lo
    gsep = nb.node("ShaderNodeSeparateXYZ")
    nt.links.new(nb.node("ShaderNodeTexCoord").outputs["Generated"], gsep.inputs["Vector"])
    dist2 = None
    for k, c in enumerate("XYZ"):
        dk = nb.math("SUBTRACT", nb.math("MULTIPLY_ADD", gsep.outputs[c], size[k], lo[k]), hit[k])
        sq = nb.math("MULTIPLY", dk, dk)
        dist2 = sq if dist2 is None else nb.math("ADD", dist2, sq)
    near = nb.math("LESS_THAN", dist2, 0.012 * 0.012)
    r0 = lin("F8E5DC")
    ratio = nb.gray(nb.math("DIVIDE", nb.bw(col), 0.2126 * r0[0] + 0.7152 * r0[1] + 0.0722 * r0[2]))  # how much light the skin has here
    nt.links.new(nb.mixc(nb.math("MULTIPLY", nb.math("MULTIPLY", alpha, near), 0.92), col, nb.mulc(rgb, ratio)), em.inputs["Color"])


def line_up(ob, cloth, lining, outline):
    """Slots: the cloth, its lining, then the outline twice, so an outline face (its source slot + 2) is an outline whichever of the two it came from."""
    me = ob.data
    me.materials.clear()
    for m in (cloth, lining, outline, outline):
        me.materials.append(m)
    ob.modifiers["outline"].material_offset = 2


def smoothstep(v, lo, hi):
    t = min(1.0, max(0.0, (v - lo) / (hi - lo)))
    return t * t * (3.0 - 2.0 * t)


def add_loops(ob, zs):
    """Horizontal rings of edges at the heights zs, so a hem can be shaped finely (the faces are 1 cm tall, a hem 2 mm)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for z in zs:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, z), plane_no=(0, 0, 1))
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def hem_band(ob, edge_z, height, bead, groove, axis=None, down=False):
    """A rolled hem, a part of its own: from edge_z up `height` the cloth stands `bead` proud of the cloth above it, with a
    rounded lower edge, and a narrow groove (the seam) just above the band. The cloth moves along its normal, or, given an
    axis (x, y), straight out from that vertical line (the normal is noisy in the groove down her spine). With `down` the band is
    below edge_z: the top of a sock."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    for v in bm.verts:
        h = edge_z - v.co.z if down else v.co.z - edge_z
        if h < -1e-5 or h > height + 0.02:
            continue
        rim = min(0.010, 0.6 * height)  # the rounded lower edge, and how soon the band falls away at its top, scale with a small band
        low = math.sqrt(max(0.0, 1.0 - (1.0 - min(1.0, max(0.0, h) / rim)) ** 2))
        d = bead * low * (1.0 - smoothstep(h, height - min(0.004, 0.3 * height), height + 0.002)) - groove * math.exp(-(((h - height - 0.001) / min(0.0022, 0.2 * height + 0.0002)) ** 2))
        out = v.normal
        if axis:
            r = Vector((v.co.x - axis[0], v.co.y - axis[1], 0.0))
            out = r.normalized() if r.length > 1e-6 else out
        v.co = v.co + out * d
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def smooth_inside(ob, rounds):
    """Even out a mesh's surface (its border stays where it is)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _ in range(rounds):
        bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if not v.is_boundary], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def seg_dist(p, a, b):
    """(distance from point p to segment a-b, which side of it p is on (+ left of a->b), how far along 0..1)."""
    abx, abz = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / (abx * abx + abz * abz)))
    qx, qz = a[0] + abx * t, a[1] + abz * t
    d = math.hypot(p[0] - qx, p[1] - qz)
    side = 1.0 if abx * (p[1] - a[1]) - abz * (p[0] - a[0]) >= 0 else -1.0
    return d, side, t


def crease_depth(p, line):
    """How far cloth is pushed out at p by a fold along `line`: a groove with a raised lip beside it, fading out at both ends."""
    best = None
    for i, (a, b) in enumerate(zip(line, line[1:])):
        d, side, t = seg_dist(p, a, b)
        if best is None or d < best[0]:
            best = (d, side, (i + t) / (len(line) - 1))
    d, side, t = best
    s = d * side
    taper = math.sin(math.pi * min(1.0, max(0.0, (t + 0.10) / 1.20))) ** 0.6
    return (-0.0022 * math.exp(-(s / 0.0030) ** 2) + 0.0026 * math.exp(-((s - 0.0095) / 0.0055) ** 2)) * taper


def crease_cloth(ob, front_lines, back_lines, yc=0.02):
    """Stiff cloth holds its folds: bend the pants along the whiskers on the front and the smile lines under the seat."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    for v in bm.verts:
        p = v.co
        pt = (p.x, p.z)
        disp = 0.0
        for line in front_lines if p.y < yc else back_lines:
            disp += crease_depth(pt, line)
        v.co = p + v.normal * disp
    bm.to_mesh(me)
    bm.free()
    me.update()


def roll(u, lo=0.15):
    """How much of its thickness a cloth edge keeps, u = 0 at the edge to 1 a little way in: a quarter circle from `lo`, so
    the edge curves in toward the body like the turned edge of thick cloth, not a cut sheet."""
    return lo + (1.0 - lo) * math.sqrt(max(0.0, 1.0 - (1.0 - u) ** 2))


def curl_edge(ob, bvh, edge_z, width, margin=0.004, rim=0.004):
    """Turn the lower edge of a garment in toward the body (the shorts' hems), like the edge of thick cloth: within `width` of
    edge_z a vertex keeps less and less of its gap to the skin (see `roll`), with a small thick rim just above the edge."""
    for v in ob.data.vertices:
        if v.co.z > edge_z + width * 2:
            continue
        loc, nrm, _, _ = bvh.find_nearest(v.co)
        if loc is None:
            continue
        d = (v.co - loc).dot(nrm)
        if d <= margin:
            continue
        u = min(1.0, max(0.0, (v.co.z - edge_z) / width))
        bump = rim * math.sin(math.pi * min(1.0, max(0.0, (v.co.z - edge_z) / (width * 1.8))))
        v.co = loc + nrm * (margin + (d - margin) * roll(u) + bump)
    ob.data.update()


def skin_shell(body, name, faces_ok, offset, cut_below=None):
    """A shell of her own skin: the faces faces_ok(face verts' weights, centroid) accepts, cut straight at cut_below if
    given, pushed out along the normal by `offset` (a number, or a function of the vertex position and the widest |x| of
    the shell), skinned with the same weights as the skin under it."""
    me = body.data.copy()
    me.transform(body.matrix_world)
    bm = bmesh.new()
    bm.from_mesh(me)
    dv = bm.verts.layers.deform.active
    names = {vg.index: vg.name for vg in body.vertex_groups}

    def weights(v):
        return {names[k]: w for k, w in v[dv].items()}

    bad = [f for f in bm.faces if not faces_ok([weights(v) for v in f.verts], f.calc_center_median())]
    bmesh.ops.delete(bm, geom=bad, context="FACES")
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    if cut_below is not None:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, cut_below), plane_no=(0, 0, 1), clear_inner=True)
        for v in [v for v in bm.verts if not v.link_faces]:
            bm.verts.remove(v)
    # her skin mesh is split along its UV seams: weld the shell, or the offset and any smoothing open gaps there
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0008)
    bmesh.ops.dissolve_degenerate(bm, dist=0.00005, edges=bm.edges[:])
    bm.normal_update()
    xmax = max(abs(v.co.x) for v in bm.verts)
    for v in bm.verts:
        v.co += v.normal * (offset(v.co, xmax) if callable(offset) else offset)
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def main():
    outline = bpy.data.materials["outline"]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "base", "sample_model_3.glb"))
    new = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in new if o.type == "MESH" and o.name.split(".")[0] == "Body")
    mats = {m.name: i for i, m in enumerate(src.data.materials)}

    def slot(prefix):
        return next(i for n, i in mats.items() if n.startswith(prefix))

    def tex(i):
        return next(nd.image for nd in src.data.materials[i].node_tree.nodes if nd.bl_idname == "ShaderNodeTexImage" and nd.image)

    body = bpy.data.objects["Body"]
    skin = [rest_skin_bvh(body)]
    crotch = min(v.co.z for v in body.data.vertices if abs(v.co.x) < 0.012 and 0.6 < v.co.z < 1.0)

    def visible_in(slot_index):
        alpha = alpha_sampler(tex(slot_index))

        def f(face, uv):
            us = [l[uv].uv for l in face.loops]
            return alpha(sum(u[0] for u in us) / len(us), sum(u[1] for u in us) / len(us)) > 0.5

        return f

    parts = {}
    # the sample's hood: the only piece of its hoodie that is used (the oversized torso and sleeves are not, and neither is the hood's
    # thin inner layer: it pokes through the outer one). It lies on top of the finished hoodie, off it and off her skin, untouched
    parts["hood"] = extract(src, slot("N00_005_01_Tops"), "hood", drop_comp=lambda n, box: not (box[4] > 1.20 and n > 300))
    # shorts: only what the alpha mask of its texture shows, between just above the hoodie's hem and just below her crotch
    sh_slot = slot("N00_010_01_Onepiece_00_CLOTH_01")
    shorts_alpha = visible_in(sh_slot)

    def shorts_face(f, uv):  # what the sample shows, plus the band of its hidden layer round the hips, so no skin shows under the hoodie
        return shorts_alpha(f, uv) or f.calc_center_median().z > 0.80

    parts["shorts"] = extract(src, sh_slot, "shorts", keep_face=shorts_face, cut_below=crotch - 0.025, cut_above=SHORTS_TOP)
    bm = bmesh.new()  # weld the pieces the sample's mesh is split into along its UV seams (or they part where the cloth is moved), then a dense mesh, so the creases can be sharp
    bm.from_mesh(parts["shorts"].data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=0.0005)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=4, use_grid_fill=True)
    bm.to_mesh(parts["shorts"].data)
    bm.free()
    for p in parts["shorts"].data.polygons:
        p.use_smooth = True
    parts["sneakers"] = extract(src, slot("N00_004_01_Shoes"), "sneakers", drop_comp=lambda n, box: n < 60 and box[4] > 0.04, split_z=SOLE)

    blank = cloth_image("blank.png")
    hoodie_decals = dict(front=cloth_image("hoodie_front.png"), back=cloth_image("hoodie_back.png"), box=CL.HOODIE_BOX)
    pants_decals = dict(front=cloth_image("pants_front.png"), back=cloth_image("pants_back.png"), box=CL.SHORTS_BOX)
    knit = toon("knit", CL.HOODIE, CL.HOODIE_SHADE, soft=True, grain="cotton", decals=hoodie_decals, ribs=CL.HEM_Z + CL.HEM_BAND, lining=CL.LINING)
    cloth = {
        "hood": toon("hood", CL.HOODIE, CL.HOODIE_SHADE, soft=True, grain="cotton"),
        "shorts": toon("shorts", PAL["pants"], PAL["pants_shade"], cut=0.34, grain="denim", decals=pants_decals, shine=0.0),
        "sneakers": toon("sneakers", CL.HOODIE, CL.HOODIE_SHADE),
    }
    sole = toon("sole", CL.SOLE_TONE, CL.SOLE_TONE_SHADE)
    lining_mat = toon("lining", CL.LINING, CL.LINING_SHADE, soft=True, grain="cotton")
    for k, ob in parts.items():
        ob.data.materials.append(cloth[k])
        bind(ob, src, 0.0016, outline)

    # sneakers: the lowest 4.5 centimetres are the sole. Slots: upper, sole, then the outline twice, so a shell face (its source
    # slot + 2) lands on an outline slot whichever of the two it came from.
    ob = parts["sneakers"]
    me = ob.data
    me.materials.clear()
    for m in (cloth["sneakers"], sole, outline, outline):
        me.materials.append(m)
    for p in me.polygons:
        p.material_index = 1 if sum(me.vertices[i].co.z for i in p.vertices) / len(p.vertices) < SOLE else 0
    ob.modifiers["outline"].material_offset = 2

    # the shorts off her skin, where she is fuller than the sample
    smooth_inside(parts["shorts"], 80)  # the sample's shorts have lumps (and steps where its visible layer meets the hidden one): hard toon steps would show them as blotches
    print("PUSHED shorts", hc.push_out(parts["shorts"], skin, margin=0.004, reach=0.05))
    curl_edge(parts["shorts"], skin[0], crotch - 0.025, 0.035, rim=0.0)
    for v in parts["shorts"].data.vertices:  # the sample's shorts are loose: under the hoodie's hem they hug her, or they poke out above it at her spine
        if v.co.z > HOODIE_HEM - 0.02:
            loc, nrm, _, _ = skin[0].find_nearest(v.co)
            if loc is not None and (v.co - loc).dot(nrm) > 0.006:
                v.co = loc + nrm * 0.006
    smooth_inside(parts["shorts"], 3)  # the push off her skin leaves small steps
    add_loops(parts["shorts"], [crotch - 0.025 + dz for dz in (0.002, 0.004, 0.006, 0.008, 0.010, 0.013, 0.016, 0.018, 0.019, 0.020, 0.021, 0.022, 0.024, 0.027, 0.030)])
    add_rest_uvs(parts["shorts"])  # before the creases and the hem: the pattern is laid on the flat cloth and folds with it
    hem_band(parts["shorts"], crotch - 0.025, CL.PANTS_BAND, 0.0030, 0.0016)
    crease_cloth(parts["shorts"], CL.WHISKERS, CL.SMILES)

    torso = ("J_Bip_C_Hips", "J_Bip_C_Spine", "J_Bip_C_Chest", "J_Bip_C_UpperChest", "J_Sec_L_Bust1", "J_Sec_R_Bust1", "J_Sec_L_Bust2", "J_Sec_R_Bust2")

    # the knit body and sleeves: a shell of her skin about 1.2 cm out with ribbed (thicker) hem and cuffs, so it follows
    # her curves and cannot gap or puff, but is a real garment, not a coat of paint
    wrist_x = abs((bpy.data.objects["Armature"].matrix_world @ bpy.data.objects["Armature"].data.bones["J_Bip_L_Hand"].head_local).x)
    fit = torso + ("J_Bip_L_Hand", "J_Bip_R_Hand", "J_Bip_L_Shoulder", "J_Bip_R_Shoulder", "J_Bip_L_UpperArm", "J_Bip_R_UpperArm", "J_Bip_L_LowerArm", "J_Bip_R_LowerArm", "J_Bip_L_UpperLeg", "J_Bip_R_UpperLeg")  # the hips share weights with the legs

    def knit_body(ws, c):
        return all(sum(w.get(n, 0.0) for n in fit) > 0.6 for w in ws) and 0.80 < c.z < 1.36  # reaches up under the hood's edge

    def ramp(v, lo, hi):
        return min(1.0, max(0.0, (v - lo) / (hi - lo)))

    def thickness(co, xmax):
        """Thick cotton knit: about 2.4 cm on the body and 1.8 cm on the sleeves, following her shape, with more room round the
        upper front; the cuffs are rolled: a thick rim, then the edge curves in toward the body (`roll`), so no edge reads as
        a flat sheet. The hem is shaped later, by hem_band."""
        sleeve = ramp(abs(co.x), 0.15, 0.23)
        hem = 0.0240  # the hem band is thicker, and shaped later (hem_band)
        # unzipped at the top, the front hangs loose: more room round the upper chest, fading out toward the sides and the hood
        hem += 0.0200 * ramp(co.z, CL.ZIP_TOP - 0.02, CL.ZIP_TOP + 0.08) * (1 - ramp(co.z, 1.30, 1.36)) * (1 - ramp(abs(co.x), 0.10, 0.19)) * ramp(0.04 - co.y, 0.0, 0.05)
        cuff = 0.0180 * roll(ramp(wrist_x - abs(co.x), 0.0, 0.035)) + 0.006 * math.sin(math.pi * ramp(wrist_x - abs(co.x), 0.0, 0.06))
        return hem * (1 - sleeve) + cuff * sleeve

    hoodie = skin_shell(body, "hoodie", knit_body, thickness, cut_below=HOODIE_HEM - 0.025)  # cut properly after smoothing
    bind(hoodie, body, 0.0016, outline)
    line_up(hoodie, knit, lining_mat, outline)
    for p in hoodie.data.polygons:
        p.material_index = 0
    # a thick knit does not show the skin's small shapes: smooth the shell a little (its overall curves stay), then keep it off her skin
    bm = bmesh.new()
    bm.from_mesh(hoodie.data)
    for _ in range(6):  # the thicker the knit, the more the offset has to be eased where she curves in
        bmesh.ops.smooth_vert(bm, verts=bm.verts[:], factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    for _ in range(12):  # the groove down her spine is tighter than the cloth is thick: ease it flat, or the offset folds over there
        bmesh.ops.smooth_vert(bm, verts=[v for v in bm.verts if abs(v.co.x) < 0.035 and v.co.z > HOODIE_HEM + 0.012 and not v.is_boundary], factor=0.5, use_axis_x=False, use_axis_y=True, use_axis_z=True)
    bm.to_mesh(hoodie.data)
    bm.free()
    print("PUSHED hoodie", hc.push_out(hoodie, skin, margin=0.008, reach=0.05))
    # now the hem and the cuffs, straight (smoothing leaves a cut edge wavy)
    bm = bmesh.new()
    bm.from_mesh(hoodie.data)
    for co, no, kw in (((0, 0, HOODIE_HEM), (0, 0, 1), {"clear_inner": True}), ((wrist_x, 0, 0), (1, 0, 0), {"clear_outer": True}), ((-wrist_x, 0, 0), (-1, 0, 0), {"clear_outer": True})):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no, **kw)
        for v in [v for v in bm.verts if not v.link_faces]:
            bm.verts.remove(v)
    bm.to_mesh(hoodie.data)
    bm.free()
    add_loops(hoodie, [HOODIE_HEM + dz for dz in sorted({round(d, 4) for d in (0.002, 0.004, 0.006, 0.008, CL.HEM_BAND, CL.HEM_BAND + 0.002, CL.HEM_BAND + 0.004, CL.ZIP_END - HOODIE_HEM, CL.ZIP_END - HOODIE_HEM + 0.004, 0.022)})])
    split_hem(hoodie, CL.HEM_SPLIT, CL.ZIP_END)
    open_front(hoodie, skin[0], CL.ZIP_TOP, CL.OPEN_SLOPE, roll_width=0.05, lo=1.70, lo_top=1.0, facing=CL.FACING_W)  # the edges are thick, rolled outward like lapels, standing off her
    for p in hoodie.data.polygons:
        p.use_smooth = True
    add_rest_uvs(hoodie)
    hem_band(hoodie, HOODIE_HEM, CL.HEM_BAND, 0.0030, 0.0016, axis=(0.0, CL.ARM_Y - 0.005))
    parts["hoodie"] = hoodie
    # the sample's hood lies on top of the finished hoodie, off it and off her skin
    # the hood's front (a V that would run across the opening, and the sample's crumpled flap ends) is cut off with one straight
    # plane, so it ends in two flaps beside her neck; everything behind that is the sample's hood, untouched
    bm = bmesh.new()
    bm.from_mesh(parts["hood"].data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, HOOD_FRONT_Y, 0), plane_no=(0, 1, 0), clear_inner=True)
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    bm.to_mesh(parts["hood"].data)
    bm.free()
    print("PUSHED hood", hc.push_out(parts["hood"], [rest_skin_bvh(hoodie), skin[0]], margin=0.006, reach=0.06))
    add_rest_uvs(parts["hood"])

    # socks: a thigh-high one on her left leg, an ankle sock on her right
    parts["sock_l"] = make_sock(body, outline, "L", CL.SOCK_TOP_LONG, "sock_l", band=False, stars=True)
    parts["sock_r"] = make_sock(body, outline, "R", CL.SOCK_TOP_SHORT, "sock_r")
    tattoo_face(bpy.data.objects["Face"])

    for o in new:
        bpy.data.objects.remove(o)
    print("CLOTHES", {k: len(o.data.polygons) for k, o in parts.items()}, "crotch z %.3f" % crotch)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "spica-v1.blend"))
    print("SAVED spica-v1.blend")


main()
