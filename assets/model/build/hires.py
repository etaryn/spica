"""
Builds her high-poly body, face and hair (no clothes yet) and saves assets/model/spica-v3.blend.
Run: blender -b -P assets/model/build/hires.py     (or: sh assets/model/build/run.sh v3)
Z is up and she faces -Y, so her left is +X. The body is lofted limbs and torso fused into one
smooth mannequin by a voxel remesh; the head is a dense sphere sculpted with soft bumps (nose,
lips, cheeks, chin, brow) so the toon outline and shading have forms to follow; each hair clump is
a bundle of locks with feathered tips.
"""
import math
import os

import bpy
import bmesh
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

PAL = dict(navy="1E2340", offwhite="F2EFE8", hair="CFE0F2", hairshade="8FA6C8", amber="FFB23F",
           amberdeep="E08A1E", skin="F7E6DA")
HC = Vector((0.0, 0.0, 1.505))
RX, RY, RZ = 0.119, 0.123, 0.143
V = Vector
MATS = {}


# ---------------------------------------------------------------- materials
def lin(hexstr):
    out = []
    for i in (0, 2, 4):
        c = int(hexstr[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out) + (1.0,)


def lighten(hexstr, t):
    out = []
    for i in (0, 2, 4):
        c = int(hexstr[i:i + 2], 16) / 255
        c = c + (1 - c) * t
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out) + (1.0,)


def toon(name, base_hex, shade_hex, cut=0.30):
    """Three-band toon material: shade, base, light, from a diffuse lighting term."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    d = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.interpolation = "CONSTANT"
    els = cr.color_ramp.elements
    els[0].position, els[0].color = 0.0, lin(shade_hex)
    els[1].position, els[1].color = cut, lin(base_hex)
    els.new(0.92).color = lighten(base_hex, 0.10)
    nt.links.new(d.outputs["BSDF"], s2r.inputs["Shader"])
    nt.links.new(s2r.outputs["Color"], cr.inputs["Fac"])
    nt.links.new(cr.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    MATS[name] = m


def flat_emission(name, hexstr, backface_cull=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = lin(hexstr)
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    m.use_backface_culling = backface_cull
    return m


def face_material(png):
    m = bpy.data.materials.new("face")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(png)
    em = nt.nodes.new("ShaderNodeEmission")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mixn = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    nt.links.new(tex.outputs["Alpha"], mixn.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], mixn.inputs[1])
    nt.links.new(em.outputs["Emission"], mixn.inputs[2])
    nt.links.new(mixn.outputs["Shader"], out.inputs["Surface"])
    return m


# ---------------------------------------------------------------- mesh helpers
def finish(name, bm, mat, th=0.003, sub=0, outline=True):
    """bmesh -> smooth-shaded object with optional subdivision and the inverted-hull outline."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(MATS[mat])
    if sub:
        mod = ob.modifiers.new("smooth", "SUBSURF")
        mod.levels = mod.render_levels = sub
    if outline:
        me.materials.append(OUTLINE)
        mod = ob.modifiers.new("outline", "SOLIDIFY")
        mod.thickness, mod.offset, mod.use_flip_normals, mod.material_offset = th, 1.0, True, 1
    for p in me.polygons:
        p.use_smooth = True
    return ob


def loft_bm(secs, sides=16, cap0=True, apex=False, hint=(0, -1, 0)):
    """Closed tube along a path. secs = [(point, a, b)]; a and b are the ellipse radii across the
    path (a along T x hint). apex=True closes the last section to a point."""
    bm = bmesh.new()
    hint = V(hint).normalized()
    pts = [V(s[0]) for s in secs]
    rings = []
    for i in range(len(secs) - (1 if apex else 0)):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[i] - pts[i - 1]
        else:
            t = pts[i + 1] - pts[i - 1]
        t = t.normalized()
        h = hint if abs(t.dot(hint)) < 0.95 else V((1, 0, 0))
        u = t.cross(h).normalized()
        v = t.cross(u).normalized()
        _, a, b = secs[i]
        rings.append([bm.verts.new(pts[i] + u * a * math.cos(2 * math.pi * k / sides)
                                   + v * b * math.sin(2 * math.pi * k / sides)) for k in range(sides)])
    for i in range(len(rings) - 1):
        for k in range(sides):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % sides],
                          rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
    if cap0:
        bm.faces.new(rings[0])
    if apex:
        tip = bm.verts.new(pts[-1])
        for k in range(sides):
            bm.faces.new((rings[-1][k], rings[-1][(k + 1) % sides], tip))
    else:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def spline(pts, n):
    """n+1 points on a Catmull-Rom curve through pts, each with its position along the control list."""
    out = []
    for i in range(n + 1):
        s = i / n * (len(pts) - 1)
        k = min(int(s), len(pts) - 2)
        t = s - k
        p0, p1, p2, p3 = pts[max(k - 1, 0)], pts[k], pts[k + 1], pts[min(k + 2, len(pts) - 1)]
        out.append((0.5 * ((2 * p1) + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                           + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3), s))
    return out


def smooth_secs(ctrl, n=14):
    """ctrl = [(point, a, b)] -> n+1 smoothly interpolated sections (Catmull-Rom on all three)."""
    pts = [V(c[0]) for c in ctrl]
    wa = [V((c[1], c[2], 0)) for c in ctrl]
    pp = spline(pts, n)
    ww = spline(wa, n)
    return [(p, w.x, w.y) for (p, _), (w, _) in zip(pp, ww)]


# ---------------------------------------------------------------- head
def u_dir(az, el):
    a, e = math.radians(az), math.radians(el)
    return V((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e)))


# (az, el, sigma, amplitude m): soft bumps along the surface normal.
BUMPS = [
    (0, -10, 0.10, 0.0075),    # nose tip
    (0, 4, 0.09, 0.0030),      # nose bridge
    (0, -29, 0.065, 0.0030),   # upper lip
    (0, -35, 0.065, 0.0030),   # lower lip
    (0, -60, 0.17, 0.0060),    # chin
    (35, -18, 0.26, 0.0040),   # cheek, her left
    (-35, -18, 0.26, 0.0040),  # cheek, her right
    (22, 12, 0.14, 0.0022),    # brow
    (-22, 12, 0.14, 0.0022),
    (24, -4, 0.15, -0.0018),   # eye hollows
    (-24, -4, 0.15, -0.0018),
]


def head_bm(sculpt=True):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=128, v_segments=80, radius=1.0)
    for v in bm.verts:
        z = v.co.z
        n = v.co.normalized()
        f = (1 - 0.46 * (-z) ** 1.3) if z < 0 else 1.0
        d = 0.0
        if sculpt:
            for az, el, sg, amp in BUMPS:
                d += amp * math.exp(-(((n - u_dir(az, el)).length) / sg) ** 2)
        v.co = V((n.x * RX * f, n.y * RY * f, n.z * RZ)) + n * d + HC
    bm.normal_update()
    return bm


def build_head():
    finish("head", head_bm(), "skin", th=0.003)

    # Hair cap: the crown, back and sides of the head, pushed out over the skull.
    bm = head_bm(sculpt=False)
    drop = []
    for f in bm.faces:
        c = f.calc_center_median()
        zr = c.z - HC.z
        if not (zr > 0.07 or (c.y > -0.015 and zr > -0.075)):
            drop.append(f)
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * 0.014
    finish("hair_cap", bm, "hair", th=0.003)

    # Face patch: a skin-hugging copy of the front that carries the eye and mouth texture.
    bm = head_bm()
    drop = []
    for f in bm.faces:
        c = f.calc_center_median()
        zr = c.z - HC.z
        if not (c.y < -0.03 and abs(c.x) < 0.105 and -0.125 < zr < 0.085):
            drop.append(f)
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bm.normal_update()
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            p = lp.vert.co
            lp[uv].uv = ((p.x + 0.1) / 0.2, (p.z - HC.z + 0.12) / 0.2)
    for v in bm.verts:
        v.co += v.normal * 0.0012
    me = bpy.data.meshes.new("face")
    bm.to_mesh(me)
    bm.free()
    face = bpy.data.objects.new("face", me)
    bpy.context.scene.collection.objects.link(face)
    me.materials.append(face_material(os.path.join(ROOT, "tex", "face-neutral.png")))
    for p in me.polygons:
        p.use_smooth = True

    # Ears: small, mostly hidden by the hair but there.
    for sgn, side in ((1, "l"), (-1, "r")):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=1.0)
        for v in bm.verts:
            v.co = V((v.co.x * 0.010, v.co.y * 0.020, v.co.z * 0.030))
            v.co += V((0, -0.001 * math.cos(v.co.z * 80), 0))
        for v in bm.verts:
            v.co = V((v.co.x + sgn * 0.116, v.co.y + 0.004, v.co.z + HC.z - 0.012))
        finish(f"ear_{side}", bm, "skin", th=0.002)


# ---------------------------------------------------------------- body
def build_body():
    parts = []

    def add(bm):
        parts.append(bm)

    # Torso: neck base to crotch, slender with a waist and wider hips.
    add(loft_bm(smooth_secs([
        (V((0, 0.005, 1.40)), 0.040, 0.040), (V((0, 0.005, 1.33)), 0.055, 0.050),
        (V((0, 0.0, 1.29)), 0.140, 0.080), (V((0, 0.0, 1.22)), 0.128, 0.093),
        (V((0, 0.0, 1.13)), 0.112, 0.083), (V((0, 0.0, 1.04)), 0.097, 0.072),
        (V((0, 0.0, 0.95)), 0.118, 0.083), (V((0, 0.0, 0.88)), 0.133, 0.094),
        (V((0, 0.0, 0.80)), 0.118, 0.088)], 20), sides=32))
    for sgn in (1, -1):
        # Arm: slightly out, relaxed.
        S = V((sgn * 0.12, 0, 1.285))
        E = V((sgn * 0.205, 0.012, 1.05))
        W = V((sgn * 0.235, -0.008, 0.82))
        add(loft_bm(smooth_secs([(S, 0.050, 0.050), (V((sgn * 0.17, 0.005, 1.20)), 0.044, 0.044),
                                  (E, 0.034, 0.034), (V((sgn * 0.22, 0.0, 0.93)), 0.035, 0.035),
                                  (W, 0.024, 0.026)], 14), sides=20))
        d = (W - E).normalized()
        add(hand_bm(sgn, W, d))
        # Leg: thigh, knee, calf, ankle, then a bare foot.
        H = V((sgn * 0.072, 0.0, 0.86))
        K = V((sgn * 0.070, -0.008, 0.47))
        A = V((sgn * 0.062, 0.006, 0.09))
        add(loft_bm(smooth_secs([(H, 0.068, 0.072), (V((sgn * 0.071, -0.002, 0.68)), 0.060, 0.064),
                                  (K, 0.045, 0.047), (V((sgn * 0.066, 0.012, 0.34)), 0.046, 0.050),
                                  (A, 0.029, 0.030)], 14), sides=20))
        x = sgn * 0.062
        add(loft_bm(smooth_secs([(V((x, 0.050, 0.060)), 0.030, 0.034), (V((x, 0.0, 0.050)), 0.034, 0.036),
                                  (V((x, -0.07, 0.030)), 0.036, 0.024), (V((x, -0.125, 0.018)), 0.034, 0.016),
                                  (V((x, -0.145, 0.014)), 0.0, 0.0)], 10), sides=16, hint=(0, 0, 1),
                    apex=True))

    master = bmesh.new()
    for bm in parts:
        me = bpy.data.meshes.new("tmp")
        bm.to_mesh(me)
        bm.free()
        master.from_mesh(me)
        bpy.data.meshes.remove(me)
    me = bpy.data.meshes.new("body_raw")
    master.to_mesh(me)
    master.free()
    raw = bpy.data.objects.new("body_raw", me)
    bpy.context.scene.collection.objects.link(raw)
    mod = raw.modifiers.new("remesh", "REMESH")
    mod.mode = "VOXEL"
    mod.voxel_size = 0.0045
    mod.adaptivity = 0.0
    mod = raw.modifiers.new("relax", "SMOOTH")
    mod.factor, mod.iterations = 0.6, 8
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(raw.evaluated_get(dg))
    bpy.data.objects.remove(raw)
    bpy.data.meshes.remove(me)
    body = bpy.data.objects.new("body", me2)
    bpy.context.scene.collection.objects.link(body)
    me2.materials.append(MATS["skin"])
    me2.materials.append(OUTLINE)
    mod = body.modifiers.new("outline", "SOLIDIFY")
    mod.thickness, mod.offset, mod.use_flip_normals, mod.material_offset = 0.0035, 1.0, True, 1
    for p in me2.polygons:
        p.use_smooth = True


def hand_bm(sgn, W, d):
    """Palm, four fingers with three joints and a slight curl toward the palm, thumb."""
    inward = V((-sgn, 0, 0))
    bm = loft_bm(smooth_secs([(W - d * 0.02, 0.040, 0.019), (W + d * 0.025, 0.045, 0.021),
                              (W + d * 0.065, 0.045, 0.018)], 6), sides=20, hint=(1, 0, 0))
    spread = (-0.036, -0.012, 0.012, 0.036)
    total = (0.070, 0.082, 0.076, 0.060)
    curl = (6, 10, 8, 14)
    for yo, ln, cl in zip(spread, total, curl):
        p = [W + V((0, yo, 0)) + d * 0.06]
        for j, sl in enumerate((ln * 0.45, ln * 0.30, ln * 0.25)):
            a = math.radians(cl * (j + 1) * 1.6)
            p.append(p[-1] + (d * math.cos(a) + inward * math.sin(a)) * sl)
        rad = (0.0092, 0.0086, 0.0078, 0.0066)
        secs = [(pt, r, r * 0.92) for pt, r in zip(p, rad)]
        secs.append((p[-1] + (d * 0.5 + inward * 0.5).normalized() * 0.006, 0, 0))
        f = loft_bm(smooth_secs(secs, 9), sides=12, apex=True, hint=(1, 0, 0))
        me = bpy.data.meshes.new("t")
        f.to_mesh(me)
        f.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    t0 = W + V((-sgn * 0.024, -0.038, 0)) + d * 0.025
    tp = [t0, t0 + V((-sgn * 0.004, -0.018, 0)) + d * 0.014,
          t0 + V((-sgn * 0.010, -0.030, 0)) + d * 0.034, t0 + V((-sgn * 0.016, -0.036, 0)) + d * 0.052]
    secs = [(pt, r, r * 0.92) for pt, r in zip(tp, (0.0120, 0.0108, 0.0096, 0.0078))]
    secs.append((tp[-1] + (tp[-1] - tp[-2]).normalized() * 0.006, 0, 0))
    f = loft_bm(smooth_secs(secs, 9), sides=12, apex=True, hint=(1, 0, 0))
    me = bpy.data.meshes.new("t")
    f.to_mesh(me)
    f.free()
    bm.from_mesh(me)
    bpy.data.meshes.remove(me)
    return bm


# ---------------------------------------------------------------- hair
def lock(name, pts, widths, hint, mat="hair"):
    """One smooth, leaf-shaped lock along pts; widths per control point, the last one the tip."""
    ctrl = [V(p) for p in pts]
    wa = [V((w, max(0.0055, w * 0.30), 0)) for w in widths]
    pp = spline(ctrl, 16)
    ww = spline(wa, 16)
    secs = [(p, w.x, w.y) for (p, _), (w, _) in zip(pp, ww)]
    bm = loft_bm(secs, sides=10, apex=True, hint=hint)
    return finish(name, bm, mat, th=0.003, sub=1)


def clump(name, pts, widths, hint):
    """A clump is a bundle of three locks with staggered lengths, so its tip feathers."""
    pts = [V(p) for p in pts]
    n = len(pts) - 1
    side = (V(hint).cross(pts[-1] - pts[0])).normalized()
    for k, (cut, off, wscale) in enumerate(((1.0, 0.0, 1.0), (0.86, -0.55, 0.62), (0.72, 0.55, 0.55))):
        end = int(round(n * cut))
        sub = [p + side * off * widths[min(i, n)] * (i / n) * 0.9 for i, p in enumerate(pts[:end + 1])]
        if len(sub) < 3:
            continue
        if end < n:  # shorter locks end where the cut falls, with a pointed tip
            sub = sub[:end] + [sub[end - 1] + (sub[end - 1] - sub[end - 2]) * 0.6]
        w = [widths[min(i, n)] * wscale for i in range(len(sub))]
        w[-1] = 0.0
        lock(f"{name}_{k}", sub, w, hint)


def surf(az, el, off=0.0):
    a, e = math.radians(az), math.radians(el)
    return HC + V((RX * (1 + off) * math.cos(e) * math.sin(a), -RY * (1 + off) * math.cos(e) * math.cos(a),
                   RZ * (1 + off) * math.sin(e)))


def hang(az, z0, z1, off0, off1, n=4):
    a = math.radians(az)
    pts = []
    for i in range(n + 1):
        t = i / n
        zr = z0 + (z1 - z0) * t
        k = max(max(0.0, 1 - (zr / RZ) ** 2) ** 0.5, 0.62)
        r = k + off0 + (off1 - off0) * t ** 1.5
        pts.append(HC + V((RX * r * math.sin(a), -RY * r * math.cos(a), zr)))
    return pts


def radial(az):
    a = math.radians(az)
    return (math.sin(a), -math.cos(a), 0.0)


def build_hair():
    bob = {-62: -0.10, -86: -0.12, -112: -0.135, -138: -0.15, -164: -0.155,
           62: None, 86: -0.12, 112: -0.135, 138: -0.15, 164: -0.155, 180: -0.16}
    for i, (az, z1) in enumerate(bob.items()):
        if z1 is None:
            continue  # her left front is the tie tuft
        layer = (i % 2) * 0.05
        clump(f"bob_{az:+d}", hang(az, 0.11 - 0.03 * (i % 3), z1 - layer * 0.2, 0.03 + layer, 0.36 + layer),
              [0.043, 0.048, 0.046, 0.039, 0.0], radial(az))
    right = [[(18, 62), (0, 42), (-20, 22), (-31, 4)], [(24, 64), (8, 46), (-8, 28), (-20, 8)],
             [(30, 66), (14, 48), (0, 34), (-8, 14)]]
    left = [[(40, 64), (36, 48), (30, 32), (22, 14)], [(50, 60), (48, 44), (44, 28), (38, 12)]]
    for tag, group, ws in (("r", right, [0.036, 0.042, 0.038, 0.0]), ("l", left, [0.032, 0.036, 0.032, 0.0])):
        for i, path in enumerate(group):
            pts = [surf(az, el, 0.17 - 0.012 * j) for j, (az, el) in enumerate(path)]
            clump(f"fringe_{tag}{i + 1}", pts, ws, tuple(pts[1] - HC))
    long_paths = [
        [(0.09, 0.08, 1.50), (0.17, 0.07, 1.42), (0.185, -0.01, 1.37), (0.165, -0.115, 1.30), (0.14, -0.15, 1.16)],
        [(0.07, 0.09, 1.48), (0.16, 0.08, 1.41), (0.195, -0.01, 1.36), (0.18, -0.11, 1.29), (0.165, -0.145, 1.22)],
        [(0.10, 0.07, 1.46), (0.18, 0.05, 1.40), (0.175, -0.02, 1.38), (0.13, -0.12, 1.31), (0.11, -0.15, 1.24)],
    ]
    for i, pts in enumerate(long_paths):
        clump(f"long_{i + 1}", pts, [0.034, 0.044, 0.042, 0.038, 0.0], (1, -0.5, 0))
    return long_paths[0][-1]


def star_obj(name, r_out):
    bm = bmesh.new()
    rim = []
    for k in range(10):
        a = math.pi / 2 + k * math.pi / 5
        r = r_out if k % 2 == 0 else r_out * 0.46
        rim.append(bm.verts.new((r * math.cos(a), r * math.sin(a), 0)))
    top = bm.verts.new((0, 0, r_out * 0.22))
    bot = bm.verts.new((0, 0, -r_out * 0.22))
    for k in range(10):
        bm.faces.new((rim[k], rim[(k + 1) % 10], top))
        bm.faces.new((rim[(k + 1) % 10], rim[k], bot))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = finish(name, bm, "amber", th=0.0025, sub=1)  # puffy matte star, points kept
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def build_tie():
    az = 72
    pts = hang(az, 0.045, -0.075, 0.14, 0.20, n=3)
    clump("tuft", pts, [0.020, 0.024, 0.020, 0.0], radial(az))
    e = pts[1]
    bpy.ops.mesh.primitive_torus_add(major_radius=0.017, minor_radius=0.0055, major_segments=24,
                                     minor_segments=10, location=e)
    ring = bpy.context.active_object
    ring.name = "tie_band"
    ring.data.materials.append(MATS["navy"])
    for p in ring.data.polygons:
        p.use_smooth = True
    n = (V(radial(az)) * 0.55 + V((0, -1, 0)) * 0.85).normalized()
    q = n.to_track_quat("Z", "Y")
    big = star_obj("tie_star_big", 0.034)
    big.location = e + n * 0.022
    big.rotation_euler = q.to_euler()
    small = star_obj("tie_star_small", 0.018)
    small.location = big.location + q @ V((0.029, 0.022, 0.004))
    small.rotation_euler = (q @ Euler((0, 0, math.radians(36))).to_quaternion()).to_euler()


def build_cubes(origin):
    ox, oy, oz = origin
    spec = [(0.000, -0.045, 0.030, 20, "hair"), (0.022, -0.085, 0.025, 48, "hair"),
            (-0.018, -0.122, 0.021, 12, "hair"), (0.030, -0.160, 0.026, 33, "hair"),
            (-0.010, -0.205, 0.017, 60, "amber"), (0.028, -0.245, 0.014, 25, "amber"),
            (-0.022, -0.280, 0.012, 40, "amber")]
    for i, (dx, dz, s, rot, mat) in enumerate(spec):
        bpy.ops.mesh.primitive_cube_add(size=s, location=(ox + dx, oy - 0.005 * i, oz + dz))
        c = bpy.context.active_object
        c.name = f"cube_{i + 1}"
        c.rotation_euler = (math.radians(rot), math.radians(rot * 0.6), math.radians(rot * 1.3))
        c.data.materials.append(MATS[mat])
        c.data.materials.append(OUTLINE)
        mod = c.modifiers.new("outline", "SOLIDIFY")
        mod.thickness, mod.offset, mod.use_flip_normals, mod.material_offset = 0.0022, 1.0, True, 1


def main():
    global OUTLINE
    bpy.ops.wm.read_factory_settings(use_empty=True)
    OUTLINE = flat_emission("outline", PAL["navy"], backface_cull=True)
    toon("navy", PAL["navy"], "12152B")
    toon("skin", PAL["skin"], "F1D8CF", cut=0.16)  # low cut: bumps on the face must not speckle
    toon("hair", PAL["hair"], PAL["hairshade"])
    toon("amber", PAL["amber"], PAL["amberdeep"])
    build_head()
    last = build_hair()
    build_tie()
    build_cubes(last)
    build_body()
    print("POLYS", {o.name: len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH"
                    and len(o.data.polygons) > 5000})
    print("POLYS_TOTAL", sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "spica-v3.blend"))
    print("SAVED")


main()
