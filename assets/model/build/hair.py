"""
Her hair: an asymmetric bob, her left side longer. About ninety locks, each a chain pinned at its
root on her skull and dropped under gravity against her head, neck and shoulders, so it hangs the
way hair does. Locks come in clumps of three with staggered lengths, so the tips feather: a scalp
cap, a bob every 15 degrees round her head (chin length on her right, nape at the back, growing
long on her left until it reaches her chest), a simple fringe, and two crossed amber stars on a navy
band on the long left side at ear height. The chains are bound to the head bone; spring physics for
video comes later.
Runs after base_prepare.py in the same Blender session:
  blender -b -P base_prepare.py -P hair.py        (run.sh v5 does this)
Z is up, she faces -Y, her left is +X.
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from geo import loft_bm, spline  # noqa: E402

ROOT = os.path.dirname(HERE)


def V(*a):
    """Vector from one sequence or from separate numbers."""
    if not a:
        return Vector((0.0, 0.0, 0.0))
    return Vector(a[0] if len(a) == 1 else a)


BEND_W = float(os.environ.get("SPICA_CHAIN_BEND", "0.05"))  # resistance to sharp bends
FRAMES = int(os.environ.get("SPICA_FRAMES", "240"))
N = 28  # particles per lock
HC = V((0, 0.03, 1.495))   # head ellipsoid: set from her face mesh in fit_head()
HR = V((0.0965, 0.088, 0.106))


def finish_lock(name, secs, mat, outline, sub=1, th=0.0016, apex=True, hint=(1, -0.5, 0)):
    bm = loft_bm(secs, sides=14, apex=apex, hint=hint)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    if sub:
        mod = ob.modifiers.new("smooth", "SUBSURF")
        mod.levels = mod.render_levels = sub
    me.materials.append(outline)
    mod = ob.modifiers.new("outline", "SOLIDIFY")
    mod.thickness, mod.offset, mod.use_flip_normals, mod.material_offset = th, 1.0, True, 1
    for p in me.polygons:
        p.use_smooth = True
    return ob




def amber_toon():
    m = bpy.data.materials.new("amber")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    d = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.interpolation = "CONSTANT"
    e = cr.color_ramp.elements
    e[0].position, e[0].color = 0.0, lin("E08A1E")
    e[1].position, e[1].color = 0.30, lin("FFB23F")
    e.new(0.92).color = lin("FFC670")
    nt.links.new(d.outputs["BSDF"], s2r.inputs["Shader"])
    nt.links.new(s2r.outputs["Color"], cr.inputs["Fac"])
    nt.links.new(cr.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def lin(h):
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out) + (1.0,)


def flat(name, hexstr):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = lin(hexstr)
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return m


def mesh_part(name, bm, mat, outline, th, sub=0):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    if sub:
        mod = ob.modifiers.new("smooth", "SUBSURF")
        mod.levels = mod.render_levels = sub
    me.materials.append(outline)
    mod = ob.modifiers.new("outline", "SOLIDIFY")
    mod.thickness, mod.offset, mod.use_flip_normals, mod.material_offset = th, 1.0, True, 1
    for p in me.polygons:
        p.use_smooth = True
    return ob


def star(name, r_out, mat, outline):
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
    return mesh_part(name, bm, mat, outline, 0.0016, sub=1)






def recolor_eyes():
    """Her eye colours: grey-blue iris with an amber highlight, navy lashes and brows."""
    def retint(name, hexstr=None, ramp=None):
        m = bpy.data.materials[name]
        nt = m.node_tree
        tex = [n for n in nt.nodes if n.bl_idname == "ShaderNodeTexImage"][0]
        em = [n for n in nt.nodes if n.bl_idname == "ShaderNodeEmission"][0]
        for l in [l for l in nt.links if l.to_node == em and l.to_socket.name == "Color"]:
            nt.links.remove(l)
        if hexstr:
            em.inputs["Color"].default_value = lin(hexstr)
        else:
            bw = nt.nodes.new("ShaderNodeRGBToBW")
            cr = nt.nodes.new("ShaderNodeValToRGB")
            cr.color_ramp.elements[0].color = lin(ramp[0])
            cr.color_ramp.elements[1].color = lin(ramp[2])
            cr.color_ramp.elements.new(0.5).color = lin(ramp[1])
            nt.links.new(tex.outputs["Color"], bw.inputs["Color"])
            nt.links.new(bw.outputs["Val"], cr.inputs["Fac"])
            nt.links.new(cr.outputs["Color"], em.inputs["Color"])

    retint("N00_000_00_EyeIris_00_EYE", ramp=("1E2340", "7D90AD", "B6C5DB"))
    retint("N00_000_00_EyeHighlight_00_EYE", hexstr="FFB23F")
    retint("N00_000_00_FaceBrow_00_FACE", hexstr="3A4266")
    retint("N00_000_00_FaceEyelash_00_FACE", hexstr="1E2340")
    retint("N00_000_00_FaceEyeline_00_FACE", hexstr="1E2340")
    retint("N00_000_00_FaceMouth_00_FACE", hexstr="B5707A")
    face = bpy.data.objects["Face"]
    face.data.shape_keys.key_blocks["Fcl_EYE_Close"].value = 0.20


def bind_to_head(ob):
    """Rigid on the head bone: the rig carries it; spring physics for video comes later."""
    arm = bpy.data.objects["Armature"]
    vg = ob.vertex_groups.new(name="J_Bip_C_Head")
    vg.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")
    mod = ob.modifiers.new("armature", "ARMATURE")
    mod.object = arm
    ob.modifiers.move(len(ob.modifiers) - 1, 0)


def a_pose(deg=48):
    """Lower both arms from the T-pose, so the hair settles on shoulders that are in the pose she
    will be shown in."""
    arm = bpy.data.objects["Armature"]
    bpy.context.view_layer.objects.active = arm
    for bone, sgn in (("J_Bip_L_UpperArm", 1), ("J_Bip_R_UpperArm", -1)):
        pb = arm.pose.bones[bone]
        head = arm.matrix_world @ pb.head
        rot = Matrix.Translation(head) @ Matrix.Rotation(sgn * math.radians(deg), 4, "Y")             @ Matrix.Translation(-head)
        pb.matrix = arm.matrix_world.inverted() @ rot @ arm.matrix_world @ pb.matrix
        bpy.context.view_layer.update()


def taper(t, wmax):
    """Lock width along its length: full in the middle, pointed at the tip."""
    return wmax * (0.62 + 0.38 * math.sin(math.pi * min(t * 1.1, 1.0))) * max(0.0, 1.0 - t ** 2.4)


def body_bvh():
    body = bpy.data.objects["Body"]
    dg = bpy.context.evaluated_depsgraph_get()
    return BVHTree.FromObject(body, dg)


# ---------------------------------------------------------------- head and layout
def fit_head():
    """Her head ellipsoid from the face mesh, so the hair sits on the real skull."""
    face = bpy.data.objects["Face"]
    vs = [face.matrix_world @ v.co for v in face.data.vertices]
    lo = V([min(v[i] for v in vs) for i in range(3)])
    hi = V([max(v[i] for v in vs) for i in range(3)])
    global HC, HR
    HC = (lo + hi) / 2
    HR = (hi - lo) / 2
    # The face mesh stops behind the ears; the skull runs on to about y = 0.11 (read off the hair
    # that sat on it), so front to back is set by hand.
    HC.y, HR.y = 0.02, 0.088
    print("HEAD", tuple(round(x, 3) for x in HC), tuple(round(x, 3) for x in HR))


HEAD_BVHS = []


def surf_pt(az, el, off=0.0):
    """The point `off` metres outside her skin in direction (az, el) from the head centre: az from the
    front toward her left, el above the horizon. Found by casting a ray at the real head surface."""
    a, e = math.radians(az), math.radians(el)
    d = V(math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e))
    best = None
    for bvh in HEAD_BVHS:
        loc, _, _, dist = bvh.ray_cast(HC, d)
        if loc is not None and (best is None or dist < best):
            best = dist
    if best is None:
        best = 0.09
    return HC + d * (best + off)


def resample(pts, n):
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + (b - a).length)
    out = []
    for i in range(n):
        s = cum[-1] * i / (n - 1)
        j = 0
        while j < len(cum) - 2 and cum[j + 1] < s:
            j += 1
        u = (s - cum[j]) / max(cum[j + 1] - cum[j], 1e-9)
        out.append(pts[j].lerp(pts[j + 1], min(1.0, max(0.0, u))))
    return out


def bob_path(az, root_el, hug_to, drop, flick, off=0.012, wig=0.0, phase=0.0):
    """Down the skull from root_el to hug_to, then hanging `drop` metres with the tips flicking out."""
    pts = [surf_pt(az, root_el + (hug_to - root_el) * k / 8,
                   off * min(1.0, k / 3) - 0.007 * (1 - min(1.0, k / 3))) for k in range(9)]
    last = pts[-1]
    a = math.radians(az)
    out = V(math.sin(a), -math.cos(a), 0)
    side = V(math.cos(a), math.sin(a), 0)
    for k in range(1, 9):
        t = k / 8
        pts.append(last + V(0, 0, -drop * t) + out * flick * t ** 1.6 + side * wig * math.sin(phase + t * 5))
    return resample(pts, N)


def waypoint_path(way, off):
    return resample([surf_pt(az, el, off - 0.001 * j) for j, (az, el) in enumerate(way)], N)












# ---------------------------------------------------------------- the simulation
RAD = 0.008          # how far a lock's centre line stays off the skin
MU = 0.6             # contact friction: hair on a slope slides only when it is steeper than this
SEP = 0.010          # locks of one clump keep at least this far apart


def sim_chains(specs_, bvhs):
    """Position-based chains: pinned at the root, gravity, a little bend resistance, a pull back to the
    shaped rest, sliding over the face, neck, shoulders and head, and keeping their length."""
    g = V((0, 0, -9.8))
    dt = 1 / 60
    chains = [s["chain"] for s in specs_]
    P = [[p.copy() for p in c] for c in chains]
    O = [[p.copy() for p in c] for c in chains]
    L = [[(c[i + 1] - c[i]).length for i in range(len(c) - 1)] for c in chains]
    pins = [s["pin"] for s in specs_]
    rest = [s["rest"] for s in specs_]
    groups = [s["group"] for s in specs_]
    rads = [max(RAD, s["width"] * 0.9) for s in specs_]

    def collide(p, rad=RAD, before=None):
        if p.z > 1.46:  # above the ears the hair is placed on the skin by surf_pt; the body mesh
            return p     # there (scalp) pushes it the wrong way
        for bvh in bvhs:
            loc, nrm, _, _ = bvh.find_nearest(p)
            if loc is not None and (p - loc).dot(nrm) < rad:
                depth = rad - (p - loc).dot(nrm)
                p = loc + nrm * rad
                if before is not None:  # Coulomb friction on the move since the start of the step
                    mv = p - before
                    tang = mv - nrm * mv.dot(nrm)
                    tl = tang.length
                    if tl > 1e-9:
                        p = p - tang * (1.0 if tl < MU * depth else MU * depth / tl)
        return p

    for f in range(FRAMES):
        for ci, c in enumerate(P):
            for i in range(pins[ci], len(c)):
                p = c[i]
                vel = (p - O[ci][i]) * 0.985
                O[ci][i] = p.copy()
                c[i] = p + vel + g * dt * dt
                c[i] = collide(c[i], rads[ci], before=p)
            for i in range(pins[ci]):
                c[i] = chains[ci][i].copy()
                O[ci][i] = c[i].copy()
        for it in range(6):
            for ci, c in enumerate(P):
                for i in range(len(c) - 1):
                    d = c[i + 1] - c[i]
                    ln = d.length or 1e-9
                    corr = d * ((ln - L[ci][i]) / ln)
                    if i < pins[ci] - 1:
                        c[i + 1] = c[i + 1] - corr
                    else:
                        c[i] = c[i] + corr * 0.5
                        c[i + 1] = c[i + 1] - corr * 0.5
                for i in range(1, len(c) - 1):
                    if i + 1 < pins[ci]:
                        continue
                    dv = c[i] - c[i - 1]
                    if dv.length > 1e-9:
                        c[i + 1] = c[i + 1].lerp(c[i] + dv.normalized() * L[ci][i], BEND_W)
                for i in range(pins[ci], len(c)):
                    c[i] = c[i].lerp(chains[ci][i], rest[ci])
                if it % 3 == 0:
                    for i in range(pins[ci], len(c)):
                        c[i] = collide(c[i], rads[ci])
            for a in range(len(P) - 1):
                if groups[a] == groups[a + 1]:
                    for i in range(max(pins[a], pins[a + 1]), len(P[a])):
                        d = P[a + 1][i] - P[a][i]
                        if 1e-9 < d.length < SEP:
                            push = d.normalized() * (SEP - d.length) * 0.5
                            P[a + 1][i] = P[a + 1][i] + push
                            P[a][i] = P[a][i] - push
    for ci, c in enumerate(P):
        for i in range(pins[ci], len(c)):
            c[i] = collide(c[i], rads[ci])
    return P


def bake_and_push(ob, bvhs, margin=0.0025, reach=0.04):
    """Apply the lock's subdivision into real vertices, then move any vertex that lies inside her skin
    out to the surface, so no hair clips into her body."""
    smooth = ob.modifiers.get("smooth")
    outline_mod = ob.modifiers.get("outline")
    if smooth is None:
        return 0
    if outline_mod:
        outline_mod.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    ob.modifiers.remove(smooth)
    if outline_mod:
        outline_mod.show_viewport = True
    moved = 0
    for v in me.vertices:
        for bvh in bvhs:
            loc, nrm, _, d = bvh.find_nearest(v.co)
            if loc is not None and d < reach and (v.co - loc).dot(nrm) < margin:
                v.co = loc + nrm * margin
                moved += 1
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    return moved


def skin_bvh(ob):
    """BVH of an object's posed surface without its outline shell, whose flipped normals would read
    as 'inside' for every point just outside her skin."""
    mod = ob.modifiers.get("outline")
    if mod:
        mod.show_viewport = False
    dg = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(ob, dg)
    if mod:
        mod.show_viewport = True
    return tree


def build_cap(outline, hair_mat):
    """The scalp: crown, back and sides, pushed out over the skull; locks grow from its edge."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=1.0)
    drop = []
    for f in bm.faces:
        n = f.calc_center_median()
        if not ((n.y >= -0.15 and n.z > -0.35) or n.z > 0.62):
            drop.append(f)
    bmesh.ops.delete(bm, geom=drop, context="FACES")
    for v in bm.verts:
        d = v.co.normalized()
        el = math.degrees(math.asin(max(-1.0, min(1.0, d.z))))
        az = math.degrees(math.atan2(d.x, -d.y))
        v.co = surf_pt(az, el, 0.006)
    return he_mesh("hair_cap", bm, hair_mat, outline)


def he_mesh(name, bm, mat, outline):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    me.materials.append(outline)
    mod = ob.modifiers.new("outline", "SOLIDIFY")
    mod.thickness, mod.offset, mod.use_flip_normals, mod.material_offset = 0.0016, 1.0, True, 1
    for p in me.polygons:
        p.use_smooth = True
    return ob


def radial_hint(az):
    a = math.radians(az)
    return (math.sin(a), -math.cos(a), 0.0)


def left_drop(az):
    """How far a left-side clump hangs below the skull: longest just in front of the ear."""
    pts = [(60, 0.24), (75, 0.28), (90, 0.31), (105, 0.29), (120, 0.24), (135, 0.18), (150, 0.13),
           (165, 0.115), (180, 0.105)]
    for (a0, d0), (a1, d1) in zip(pts, pts[1:]):
        if a0 <= az <= a1:
            return d0 + (d1 - d0) * (az - a0) / (a1 - a0)
    return pts[-1][1]


def specs():
    """Every lock: name, initial chain, pinned particles, pull back to the shaped rest, width, clump, hint."""
    rnd = random.Random(11)
    out = []

    def clump(name, chain_fn, pin, rest, width, hint, tie=False):
        """Three locks per clump (the main one and two shorter, narrower neighbours) and a thin strand."""
        for k, (cut, off, wsc) in enumerate(((1.0, 0.0, 1.0), (0.88, -0.6, 0.8))):
            twist = math.radians(rnd.uniform(-10, 10))
            h = V(hint)
            hv = V(h.x * math.cos(twist) - h.y * math.sin(twist), h.x * math.sin(twist) + h.y * math.cos(twist), h.z)
            out.append(dict(name=f"{name}_{k}", chain=chain_fn(cut, off * width), pin=pin, rest=rest,
                            width=width * wsc * rnd.uniform(0.92, 1.08), group=name, hint=tuple(hv),
                            tie=tie and k == 0))

    # The bob: a clump every 20 degrees. Her right and the back are chin to nape; her left keeps growing
    # until it reaches her chest, falling in front of her shoulder.
    for i, az in enumerate(list(range(-160, -59, 20)) + list(range(60, 181, 20))):
        a_ = abs(az)
        left = az > 0
        if left:
            drop = left_drop(az)
        else:
            drop = 0.06 if a_ <= 70 else 0.075 if a_ <= 100 else 0.09 if a_ <= 140 else 0.105
        drop *= 1 + 0.10 * math.sin(i * 1.7)
        layer = 0.05 * (i % 2)
        az += rnd.uniform(-2, 2)
        a = math.radians(az)
        side = V(math.cos(a), math.sin(a), 0)
        long_side = left and az < 140

        def fn(cut, off, az=az, drop=drop, layer=layer, side=side, i=i, long_side=long_side):
            if long_side:
                ch = bob_path(az, 44, 0, drop * cut, 0.0, 0.016 + 0.004 * (i % 2), wig=0.002, phase=i)
                # lean forward as it falls, so it lands on the front of the shoulder, not the back
                ch = [p + V(0.0, -0.075 * max(0.0, (p.z - 1.50) / -0.3), 0.0) for p in ch]
            else:
                ch = bob_path(az, 48, -8, drop * cut, 0.008 + 0.004 * (1 - cut) * 6, 0.012 + layer * 0.1,
                              wig=0.002, phase=i)
            return [p + side * off for p in ch]
        clump(f"bob{int(round(az)):+d}", fn, 10, 0.020 if not long_side else 0.0,
              (0.040 if a_ <= 75 else 0.050) * rnd.uniform(0.92, 1.08), radial_hint(az),
              tie=(left and 70 <= az <= 90 and not any(sp["tie"] for sp in out)))

    # A simple fringe across the forehead, swept a little to her right.
    for i, az0 in enumerate((-22, -7, 8, 23)):
        way = [(az0 + 8, 62), (az0, 44), (az0 - 8, 26), (az0 - 14, 12)]
        base_ = waypoint_path(way, 0.011)

        def fn(cut, off, base_=base_):
            end = max(6, int(round(len(base_) * cut)))
            return resample([p + V(1, 0, 0) * off for p in base_[:end]], N)
        clump(f"fringe{i + 1}", fn, 9, 0.07, 0.036, tuple(base_[2] - HC))
    return out


def tie_accessories(lock, outline, frac=0.16):
    """A navy band round the long left side at ear height and two crossed amber stars on it."""
    vs = sorted(((lock.matrix_world @ v.co) for v in lock.data.vertices), key=lambda p: -p.z)
    top, tip = vs[0].z, vs[-1].z
    ring = [p for p in vs if abs(p.z - (top - (top - tip) * frac)) < 0.004]
    e = sum(ring, V()) / len(ring)
    navy = flat("navy", "1E2340")
    bpy.ops.mesh.primitive_torus_add(major_radius=0.0125, minor_radius=0.0042, major_segments=24,
                                     minor_segments=10, location=e)
    band = bpy.context.active_object
    band.name = "tie_band"
    band.data.materials.append(navy)
    for p in band.data.polygons:
        p.use_smooth = True
    n = V((0.55, -0.85, 0)).normalized()
    q = n.to_track_quat("Z", "Y")
    amber = amber_toon()
    big = star("tie_star_big", 0.026, amber, outline)
    big.location = e + n * 0.024
    big.rotation_euler = q.to_euler()
    small = star("tie_star_small", 0.014, amber, outline)
    small.location = big.location + q @ V((0.022, 0.017, 0.003))
    small.rotation_euler = (q @ Euler((0, 0, math.radians(36))).to_quaternion()).to_euler()
    return e


def main():
    outline = bpy.data.materials["outline"]
    hair_mat = bpy.data.materials["hair"]
    a_pose()
    fit_head()
    for o in [o for o in bpy.data.objects if o.name.startswith("Hair0")]:
        bpy.data.objects.remove(o)
    dg = bpy.context.evaluated_depsgraph_get()
    # Only the body is a collider; the face mesh holds eyeballs and decals, which push hair about.
    bvhs = [skin_bvh(bpy.data.objects["Body"])]
    HEAD_BVHS.extend(bvhs + [skin_bvh(bpy.data.objects["Face"])])
    build_cap(outline, hair_mat)
    sp = specs()
    settled = sim_chains(sp, bvhs)
    tie_lock = None
    for s, c in zip(sp, settled):
        w = s["width"]
        secs = [(p, taper(j / (len(c) - 1), w), 0.0) for j, p in enumerate(c)]
        secs = [(p, wd, max(0.0025 if w < 0.01 else 0.0035, wd * 0.30)) for p, wd, _ in secs]
        ob = finish_lock(s["name"], secs, hair_mat, outline, hint=s["hint"])
        if s["tie"]:
            tie_lock = ob
    skin_bvhs = bvhs + [skin_bvh(bpy.data.objects["face_outline"])]
    pushed = 0
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name.startswith(("bob", "fringe")):
            pushed += bake_and_push(o, skin_bvhs)
    print("PUSHED", pushed)
    tie_accessories(tie_lock, outline)
    for o in bpy.data.objects:
        if o.type == "MESH" and (o.name.startswith(("bob", "fringe", "tie_")) or o.name == "hair_cap"):
            bind_to_head(o)
    recolor_eyes()
    print("LOCKS", len(sp))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "spica-v5.blend"))
    print("SAVED")


if __name__ == "__main__":
    main()
