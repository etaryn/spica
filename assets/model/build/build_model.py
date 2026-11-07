"""
Builds her v1 reference model (lowest poly, face clean) from code and saves assets/model/spica.blend.
Run: blender -b -P assets/model/build/build_model.py            (v1, lowest poly, spica-v1.blend)
     SPICA_LOD=std blender -b -P assets/model/build/build_model.py   (v2, standard poly, spica-v2.blend)
v2 smooths the face, hair and hands to full detail; clothes only get rounder, not detailed.
Z is up and she faces -Y, so her left is +X. Every part is its own named object (hair clumps,
fringe pieces, tie, stars, cubes, clothes) so the rig and the expression swaps can find them.
"""
import math
import os

import bpy
import bmesh
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STD = os.environ.get("SPICA_LOD", "low") == "std"

PAL = dict(
    navy="1E2340", offwhite="F2EFE8", hair="CFE0F2", hairshade="8FA6C8", amber="FFB23F",
    amberdeep="E08A1E", skin="F7E6DA", tights="151830",
)

# Head: centre and radii (m). About 6 heads tall.
HC = Vector((0.0, 0.0, 1.505))
RX, RY, RZ = 0.119, 0.123, 0.143


def lin(hexstr):
    out = []
    for i in (0, 2, 4):
        c = int(hexstr[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out) + (1.0,)


def lighten(hexstr, t):
    """Lighten in display (sRGB) space; mixing linear values turns dark navy grey."""
    out = []
    for i in (0, 2, 4):
        c = int(hexstr[i:i + 2], 16) / 255
        c = c + (1 - c) * t
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out) + (1.0,)


MATS = {}


def toon(name, base_hex, shade_hex=None):
    """Three-band toon material: shade, base, light, driven by a diffuse lighting term."""
    base = lin(base_hex)
    shade = lin(shade_hex) if shade_hex else (base[0] * 0.55, base[1] * 0.58, base[2] * 0.85, 1.0)
    light = lighten(base_hex, 0.10)
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
    els[0].position, els[0].color = 0.0, shade
    els[1].position, els[1].color = 0.30, base
    e3 = els.new(0.92)
    e3.color = light
    nt.links.new(d.outputs["BSDF"], s2r.inputs["Shader"])
    nt.links.new(s2r.outputs["Color"], cr.inputs["Fac"])
    nt.links.new(cr.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    m["base_hex"] = base_hex
    MATS[name] = m
    return m


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
    tex.interpolation = "Linear"
    em = nt.nodes.new("ShaderNodeEmission")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    mixn = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    nt.links.new(tex.outputs["Alpha"], mixn.inputs["Fac"])
    nt.links.new(tr.outputs["BSDF"], mixn.inputs[1])
    nt.links.new(em.outputs["Emission"], mixn.inputs[2])
    nt.links.new(mixn.outputs["Shader"], out.inputs["Surface"])
    return m


def new_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    global OUTLINE
    OUTLINE = flat_emission("outline", PAL["navy"], backface_cull=True)
    toon("navy", PAL["navy"], "12152B")
    toon("tights", PAL["tights"], "0C0E1E")
    toon("offwhite", PAL["offwhite"], "B9B6C4")
    toon("skin", PAL["skin"], "F1D8CF")
    toon("hair", PAL["hair"], PAL["hairshade"])
    toon("hair_under", PAL["hairshade"], "6C80A6")
    toon("amber", PAL["amber"], PAL["amberdeep"])


def mesh_obj(name, bm, mat, outline=True, smooth=False, th=0.004, sub=0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(MATS[mat])
    if STD and sub:
        mod = ob.modifiers.new("smooth", "SUBSURF")
        mod.levels = mod.render_levels = sub
        smooth = True
    if outline:
        me.materials.append(OUTLINE)
        mod = ob.modifiers.new("outline", "SOLIDIFY")
        mod.thickness = th
        mod.offset = 1.0
        mod.use_flip_normals = True
        mod.material_offset = 1
    for p in me.polygons:
        p.use_smooth = smooth
    return ob


def loft(name, secs, mat, sides=6, cap0=True, apex=False, hint=(0, -1, 0), smooth=False,
         outline=True, th=0.004, sub=0):
    """Tube along a path. secs = [(point, a, b), ...]; a, b are the ellipse radii across the path:
    a along T x hint, b along the other. apex=True closes the last section to a point."""
    bm = bmesh.new()
    hint = Vector(hint).normalized()
    pts = [Vector(s[0]) for s in secs]
    rings = []
    last = len(secs) - (1 if apex else 0)
    for i in range(last):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[i] - pts[i - 1]
        else:
            t = pts[i + 1] - pts[i - 1]
        t = t.normalized()
        h = hint if abs(t.dot(hint)) < 0.95 else Vector((1, 0, 0))
        u = t.cross(h).normalized()
        v = t.cross(u).normalized()
        _, a, b = secs[i]
        ring = [bm.verts.new(pts[i] + u * a * math.cos(2 * math.pi * k / sides)
                             + v * b * math.sin(2 * math.pi * k / sides)) for k in range(sides)]
        rings.append(ring)
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
    return mesh_obj(name, bm, mat, outline=outline, smooth=smooth, th=th, sub=sub)


def spline(pts, n):
    """n+1 points along a Catmull-Rom curve through pts; also returns each point's position along
    the control list, so widths can be interpolated."""
    out = []
    for i in range(n + 1):
        s = i / n * (len(pts) - 1)
        k = min(int(s), len(pts) - 2)
        t = s - k
        p0, p1, p2, p3 = pts[max(k - 1, 0)], pts[k], pts[k + 1], pts[min(k + 2, len(pts) - 1)]
        out.append((0.5 * ((2 * p1) + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                           + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3), s))
    return out


# ---------------------------------------------------------------- head and face
def surf(az, el, off=0.0):
    """A point on the head ellipsoid: az from the front toward her left, el above the horizon."""
    a, e = math.radians(az), math.radians(el)
    return HC + Vector((RX * (1 + off) * math.cos(e) * math.sin(a),
                        -RY * (1 + off) * math.cos(e) * math.cos(a),
                        RZ * (1 + off) * math.sin(e)))


def head_bmesh():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48 if STD else 32, v_segments=32 if STD else 20,
                              radius=1.0)
    for v in bm.verts:
        z = v.co.z
        f = (1 - (0.46 * (-z) ** 1.3 if STD else 0.38 * (-z) ** 1.6)) if z < 0 else 1.0
        v.co = Vector((v.co.x * RX * f, v.co.y * RY * f, HC.z + z * RZ))
    bm.normal_update()
    return bm


def build_head():
    bm = head_bmesh()
    head = mesh_obj("head", bm, "skin", outline=True, smooth=True, th=0.003)

    # Hair cap: the crown and the back and sides of the head, pushed out over the skull.
    bm = head_bmesh()
    drop = [f for f in bm.faces
            if not ((f.calc_center_median().z - HC.z) > 0.07
                    or (f.calc_center_median().y > -0.015 and (f.calc_center_median().z - HC.z) > -0.075))]
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * 0.014
    mesh_obj("hair_cap", bm, "hair", outline=True, smooth=True, th=0.003)

    # Face patch: a skin-hugging copy of the front that carries the eye and mouth texture.
    bm = head_bmesh()
    keep = []
    for f in bm.faces:
        c = f.calc_center_median()
        zr = c.z - HC.z
        if c.y < -0.03 and abs(c.x) < 0.105 and -0.125 < zr < 0.085:
            keep.append(f)
    drop = [f for f in bm.faces if f not in keep]
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
    return head, face


# ---------------------------------------------------------------- hair
def clump(name, pts, widths, hint, mat="hair", sides=6):
    if STD:
        sm = spline([Vector(p) for p in pts], 8)
        secs = []
        for p, s in sm:
            k = min(int(s), len(widths) - 2)
            w = widths[k] + (widths[k + 1] - widths[k]) * (s - k)
            secs.append((p, w, max(0.006, w * 0.30)))
        return loft(name, secs, mat, sides=8, apex=True, hint=hint, th=0.003, sub=1)
    secs = [(p, w, max(0.007, w * 0.32)) for p, w in zip(pts, widths)]
    return loft(name, secs, mat, sides=sides, apex=True, hint=hint, th=0.003)


def hang(az, z0, z1, off0, off1, n=4):
    a = math.radians(az)
    pts = []
    for i in range(n + 1):
        t = i / n
        zr = z0 + (z1 - z0) * t
        k = max(max(0.0, 1 - (zr / RZ) ** 2) ** 0.5, 0.62)
        r = k + off0 + (off1 - off0) * t ** 1.5
        pts.append(HC + Vector((RX * r * math.sin(a), -RY * r * math.cos(a), zr)))
    return pts


def radial(az):
    a = math.radians(az)
    return (math.sin(a), -math.cos(a), 0.0)


def build_hair():
    # Layered bob: chunky clumps round the sides and back, tips flicking outward.
    bob = {-62: -0.10, -86: -0.12, -112: -0.135, -138: -0.15, -164: -0.155,
           62: None, 86: -0.12, 112: -0.135, 138: -0.15, 164: -0.155, 180: -0.16}
    for i, (az, z1) in enumerate(bob.items()):
        if z1 is None:
            continue  # her left front is the tie tuft
        layer = (i % 2) * 0.05 if STD else 0.0  # every other clump sits a layer further out
        w = 0.85 if STD else 1.0
        clump(f"bob_{az:+d}", hang(az, 0.11, z1 - layer * 0.2, 0.03 + layer, 0.36 + layer),
              [0.050 * w, 0.056 * w, 0.054 * w, 0.046 * w, 0.0], radial(az))

    # Fringe: a heavy diagonal sweep over her right (-X), a shorter angled one on her left.
    right = [
        [(18, 62), (0, 42), (-20, 22), (-31, 4)],
        [(24, 64), (8, 46), (-8, 28), (-20, 8)],
        [(30, 66), (14, 48), (0, 34), (-8, 14)],
    ]
    left = [
        [(40, 64), (36, 48), (30, 32), (22, 14)],
        [(50, 60), (48, 44), (44, 28), (38, 12)],
    ]
    for i, path in enumerate(right):
        pts = [surf(az, el, 0.17 - 0.012 * j) for j, (az, el) in enumerate(path)]
        mid = pts[1] - HC
        clump(f"fringe_r{i + 1}", pts, [0.036, 0.042, 0.038, 0.0], tuple(mid))
    for i, path in enumerate(left):
        pts = [surf(az, el, 0.17 - 0.012 * j) for j, (az, el) in enumerate(path)]
        mid = pts[1] - HC
        clump(f"fringe_l{i + 1}", pts, [0.032, 0.036, 0.032, 0.0], tuple(mid))

    # Long layer: grows from the back-left, falls forward over her left shoulder to the chest.
    long_paths = [
        [(0.09, 0.08, 1.50), (0.17, 0.07, 1.42), (0.185, -0.01, 1.37), (0.165, -0.115, 1.30),
         (0.14, -0.15, 1.16)],
        [(0.07, 0.09, 1.48), (0.16, 0.08, 1.41), (0.195, -0.01, 1.36), (0.18, -0.11, 1.29),
         (0.165, -0.145, 1.22)],
        [(0.10, 0.07, 1.46), (0.18, 0.05, 1.40), (0.175, -0.02, 1.38), (0.13, -0.12, 1.31),
         (0.11, -0.15, 1.24)],
    ]
    for i, pts in enumerate(long_paths):
        clump(f"long_{i + 1}", [Vector(p) for p in pts], [0.034, 0.044, 0.042, 0.038, 0.0],
              (1, -0.5, 0))
    return long_paths[0][-1]


def star_obj(name, r_out, mat):
    bm = bmesh.new()
    rim = []
    for k in range(10):
        a = math.pi / 2 + k * math.pi / 5
        r = r_out if k % 2 == 0 else r_out * 0.52
        rim.append(bm.verts.new((r * math.cos(a), r * math.sin(a), 0)))
    top = bm.verts.new((0, 0, r_out * 0.22))
    bot = bm.verts.new((0, 0, -r_out * 0.22))
    for k in range(10):
        bm.faces.new((rim[k], rim[(k + 1) % 10], top))
        bm.faces.new((rim[(k + 1) % 10], rim[k], bot))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return mesh_obj(name, bm, mat, outline=True, th=0.0025)


def build_tie():
    az = 72
    pts = hang(az, 0.045, -0.075, 0.14, 0.20, n=3)
    clump("tuft", pts, [0.020, 0.024, 0.020, 0.0], radial(az))
    e = pts[1]
    bpy.ops.mesh.primitive_torus_add(major_radius=0.017, minor_radius=0.0055, major_segments=12,
                                     minor_segments=6, location=e)
    ring = bpy.context.active_object
    ring.name = "tie_band"
    ring.data.materials.append(MATS["navy"])
    n = (Vector(radial(az)) * 0.55 + Vector((0, -1, 0)) * 0.85).normalized()
    q = n.to_track_quat("Z", "Y")
    big = star_obj("tie_star_big", 0.034, "amber")
    big.location = e + n * 0.022
    big.rotation_euler = q.to_euler()
    small = star_obj("tie_star_small", 0.018, "amber")
    off = q @ Vector((0.029, 0.022, 0.004))
    small.location = big.location + off
    small.rotation_euler = (q @ __import__("mathutils").Euler((0, 0, math.radians(36))).to_quaternion()).to_euler()
    return ring


def build_cubes(origin):
    ox, oy, oz = origin
    spec = [  # (dx, dz, size, rot, material)
        (0.000, -0.045, 0.030, 20, "hair"), (0.022, -0.085, 0.025, 48, "hair"),
        (-0.018, -0.122, 0.021, 12, "hair"), (0.030, -0.160, 0.026, 33, "hair"),
        (-0.010, -0.205, 0.017, 60, "amber"), (0.028, -0.245, 0.014, 25, "amber"),
        (-0.022, -0.280, 0.012, 40, "amber"),
    ]
    for i, (dx, dz, s, rot, mat) in enumerate(spec):
        bpy.ops.mesh.primitive_cube_add(size=s, location=(ox + dx, oy - 0.005 * i, oz + dz))
        c = bpy.context.active_object
        c.name = f"cube_{i + 1}"
        c.rotation_euler = (math.radians(rot), math.radians(rot * 0.6), math.radians(rot * 1.3))
        c.data.materials.append(MATS[mat])
        c.data.materials.append(OUTLINE)
        mod = c.modifiers.new("outline", "SOLIDIFY")
        mod.thickness, mod.offset, mod.use_flip_normals, mod.material_offset = 0.0022, 1.0, True, 1


# ---------------------------------------------------------------- body
def build_hand(side, sgn, C, d):
    """Full hand: palm, four fingers with three joints and a slight curl toward the palm, thumb.
    C is the cuff end, d the direction down the arm; the palm faces her body."""
    V = Vector
    inward = V((-sgn, 0, 0))
    loft(f"palm_{side}", [(C - d * 0.025, 0.040, 0.019), (C + d * 0.02, 0.043, 0.020),
                          (C + d * 0.05, 0.041, 0.017)], "skin", sides=10, hint=(1, 0, 0), sub=1,
         th=0.002)
    spread = (-0.0295, -0.0098, 0.0098, 0.0295)
    total = (0.068, 0.080, 0.074, 0.058)
    curl = (6, 12, 9, 16)  # degrees at the base joint; each joint curls further
    for k, (yo, ln, cl) in enumerate(zip(spread, total, curl)):
        p = [C + V((0, yo, 0)) + d * 0.045]
        seg = (ln * 0.45, ln * 0.30, ln * 0.25)
        for j, sl in enumerate(seg):
            a = math.radians(cl * (j + 1) * 1.6)
            p.append(p[-1] + (d * math.cos(a) + inward * math.sin(a)) * sl)
        rad = (0.0098, 0.0092, 0.0082, 0.0068)
        secs = [(pt, r, r * 0.92) for pt, r in zip(p, rad)]
        secs.append((p[-1] + (d * 0.5 + inward * 0.5).normalized() * 0.006, 0, 0))
        loft(f"finger_{side}{k + 1}", secs, "skin", sides=8, apex=True, hint=(1, 0, 0), sub=1,
             th=0.0018)
    t0 = C + V((-sgn * 0.022, -0.036, 0.0)) + d * 0.02
    tp = [t0, t0 + V((-sgn * 0.004, -0.018, 0)) + d * 0.014,
          t0 + V((-sgn * 0.010, -0.030, 0)) + d * 0.034, t0 + V((-sgn * 0.016, -0.036, 0)) + d * 0.052]
    secs = [(pt, r, r * 0.92) for pt, r in zip(tp, (0.0125, 0.0112, 0.0098, 0.0078))]
    secs.append((tp[-1] + (tp[-1] - tp[-2]).normalized() * 0.006, 0, 0))
    loft(f"thumb_{side}", secs, "skin", sides=8, apex=True, hint=(1, 0, 0), sub=1, th=0.0018)


def build_body():
    V = Vector
    # Neck and clothes.
    N = 14 if STD else 8  # sides round the clothes; they get rounder in v2, not more detailed
    SU = 1 if STD else 0
    loft("neck", [(V((0, 0.005, 1.28)), 0.045, 0.045), (V((0, 0.005, 1.40)), 0.042, 0.042)],
         "skin", sides=12 if STD else 8, smooth=True)
    loft("tee", [(V((0, 0, 1.25)), 0.145, 0.105), (V((0, 0, 1.0)), 0.14, 0.10),
                 (V((0, 0, 0.84)), 0.16, 0.108)], "offwhite", sides=N, smooth=STD)
    loft("hoodie", [(V((0, 0, 1.335)), 0.075, 0.065), (V((0, 0, 1.315)), 0.12, 0.092),
                    (V((0, 0, 1.29)), 0.165, 0.115), (V((0, 0, 1.15)), 0.16, 0.12),
                    (V((0, 0, 0.91)), 0.17, 0.128)], "navy", sides=N, cap0=False, smooth=STD)
    loft("pelvis", [(V((0, 0, 0.90)), 0.13, 0.092), (V((0, 0, 0.78)), 0.126, 0.09)], "navy", sides=N, smooth=STD)
    loft("hood", [(V((0, 0.115, 1.39)), 0.13, 0.05), (V((0, 0.14, 1.30)), 0.135, 0.065),
                  (V((0, 0.13, 1.20)), 0.10, 0.04)], "navy", sides=N, smooth=STD)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.062, minor_radius=0.016, major_segments=16,
                                     minor_segments=6, location=(0, 0.004, 1.335))
    collar = bpy.context.active_object
    collar.name = "collar"
    collar.data.materials.append(MATS["navy"])

    for sgn, side in ((1, "l"), (-1, "r")):
        S = V((sgn * 0.17, 0.0, 1.29))
        E = V((sgn * 0.225, 0.015, 1.04))
        C = V((sgn * 0.265, -0.01, 0.80))
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.064, segments=8, ring_count=6, location=S)
        sh = bpy.context.active_object
        sh.name = f"shoulder_{side}"
        sh.data.materials.append(MATS["navy"])
        loft(f"sleeve_{side}", [(S, 0.062, 0.062), ((S + E) / 2, 0.056, 0.056), (E, 0.052, 0.052),
                                ((E + C) / 2, 0.055, 0.055), (C, 0.062, 0.062)],
             "navy", sides=N, smooth=STD)
        d = (C - E).normalized()
        if STD:
            build_hand(side, sgn, C, d)
        else:
            loft(f"palm_{side}", [(C - d * 0.02, 0.040, 0.017), (C + d * 0.035, 0.040, 0.016)],
                 "skin", sides=6, hint=(1, 0, 0))
            lens = [0.062, 0.074, 0.068, 0.054]
            for k, (yo, ln) in enumerate(zip((-0.027, -0.009, 0.009, 0.027), lens)):
                st = C + V((0, yo, 0)) + d * 0.03
                loft(f"finger_{side}{k + 1}", [(st, 0.0105, 0.0105), (st + d * ln * 0.55, 0.0100, 0.0100),
                                              (st + d * ln, 0.0075, 0.0075)], "skin", sides=5,
                     hint=(1, 0, 0), th=0.002)
            th0 = C + V((-sgn * 0.02, -0.045, 0.0)) + d * 0.0
            loft(f"thumb_{side}", [(th0, 0.011, 0.011), (th0 + V((0, -0.015, -0.025)), 0.0105, 0.0105),
                                   (th0 + V((0, -0.025, -0.045)), 0.0075, 0.0075)], "skin", sides=5,
                 hint=(1, 0, 0), th=0.002)

        H = V((sgn * 0.075, 0.0, 0.88))
        K = V((sgn * 0.072, -0.01, 0.47))
        A = V((sgn * 0.066, 0.0, 0.10))
        loft(f"leg_{side}", [(H, 0.072, 0.072), ((H + K) / 2, 0.066, 0.066), (K, 0.056, 0.056),
                              ((K + A) / 2, 0.049, 0.049), (A, 0.041, 0.041)], "tights", sides=N, smooth=STD)
        loft(f"shorts_{side}", [(V((sgn * 0.075, 0, 0.83)), 0.084, 0.088),
                                (V((sgn * 0.074, 0, 0.75)), 0.082, 0.087),
                                (V((sgn * 0.073, -0.003, 0.66)), 0.078, 0.084)], "navy", sides=N, smooth=STD)
        x = sgn * 0.066
        loft(f"shoe_{side}", [(V((x, 0.085, 0.085)), 0.047, 0.05), (V((x, 0.0, 0.08)), 0.055, 0.056),
                              (V((x, -0.10, 0.065)), 0.054, 0.048), (V((x, -0.16, 0.05)), 0.036, 0.034)],
             "offwhite", sides=N, hint=(0, 0, 1), sub=SU)
        loft(f"sole_{side}", [(V((x, 0.09, 0.016)), 0.05, 0.016), (V((x, -0.0, 0.016)), 0.058, 0.016),
                              (V((x, -0.17, 0.016)), 0.042, 0.016)], "amber", sides=N,
             hint=(0, 0, 1), sub=SU)

    # Drawstrings: two short strings from the collar, amber only on the tips.
    for sgn, side in ((1, "l"), (-1, "r")):
        top = V((sgn * 0.035, -0.10, 1.33))
        bot = V((sgn * 0.040, -0.122, 1.215))
        loft(f"string_{side}", [(top, 0.0045, 0.0045), (bot, 0.0045, 0.0045)], "navy", sides=5,
             outline=False)
        loft(f"string_tip_{side}", [(bot, 0.0065, 0.0065), (bot + V((0, -0.002, -0.022)), 0.0065, 0.0065)],
             "amber", sides=5, outline=False)


def main():
    new_scene()
    build_head()
    last = build_hair()
    build_tie()
    build_cubes(last)
    build_body()
    amber = sorted(o.name for o in bpy.data.objects
                   if any(m and m.name == "amber" for m in o.data.materials))
    print("AMBER_OBJECTS", amber)
    print("POLYS", sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "spica-v2.blend" if STD else "spica-v1.blend"))
    print("SAVED")


main()
