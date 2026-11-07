"""
Turns the sample's bob into her wolf cut by bending its hair cards, no new strands: a heavy
diagonal fringe sweeping to her right and a shorter one on her left, a rounder bob with flicked
tips, a long staggered layer from the back-left that falls over her left shoulder to the chest,
and the star tie on a short tuft in front of her left ear. Runs after base_prepare.py in the same
Blender session: blender -b -P base_prepare.py -P hair_edit.py
Z is up, she faces -Y, her left is +X.
"""
import math
import os

import bmesh
import bpy
from mathutils import Euler, Vector

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geo import loft_bm, spline  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
V = Vector


def card(n):
    return bpy.data.objects[f"Hair{n:03d}"]


def warp(ob, fn):
    """Move every vertex of a card: fn takes and returns a world-space point."""
    m = ob.matrix_world
    mi = m.inverted()
    for v in ob.data.vertices:
        v.co = mi @ fn(m @ v.co)
    ob.data.update()


def clamp(x, a=0.0, b=1.0):
    return max(a, min(b, x))


def smooth(x):
    x = clamp(x)
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------- fringe
FRINGE = list(range(60, 83)) + [85, 86, 87]


def fringe(p):
    """Shear the lower part of the bangs toward her right (-X) and lift her left side."""
    t = smooth((1.59 - p.z) / 0.15)
    x = p.x - 0.075 * t
    z = p.z + t * (0.004 + 0.015 * clamp(p.x / 0.06, -1, 1))
    return V((x, p.y, z))


# ---------------------------------------------------------------- bob
BACK = list(range(1, 58))
HEAD_AXIS = V((0.0, 0.04, 0.0))


def flick(p):
    """Round the bob out and flick the tips outward."""
    d = clamp((1.43 - p.z) / 0.10)
    out = V((p.x, p.y, 0)) - HEAD_AXIS
    if out.length < 1e-6:
        return p
    out.normalize()
    k = 0.030 * d ** 1.4
    return p + out * k


# ---------------------------------------------------------------- long layer
# Back-left cards stay in the bob (they get the flick); the long layer is new locks along a path
# from the back-left of the head, over her left shoulder, down to the chest.
PATH = [V(c) for c in [(0.06, 0.12, 1.47), (0.095, 0.11, 1.41), (0.115, 0.07, 1.385), (0.12, 0.0, 1.375),
                       (0.112, -0.06, 1.355), (0.105, -0.105, 1.30), (0.097, -0.122, 1.22),
                       (0.092, -0.126, 1.15)]]


def finish_lock(name, secs, mat, outline, sub=1, th=0.0016, apex=True, hint=(1, -0.5, 0)):
    bm = loft_bm(secs, sides=10, apex=apex, hint=hint)
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


def lock_secs(path_pts, widths, n=14):
    """Sections along a spline through path_pts with widths interpolated per control point."""
    sm = spline(path_pts, n)
    secs = []
    for p, s in sm:
        k = min(int(s), len(widths) - 2)
        w = widths[k] + (widths[k + 1] - widths[k]) * (s - k)
        secs.append((p, w, max(0.0035, w * 0.30)))
    return secs


def long_layer(outline, hair_mat):
    """Seven staggered locks of different lengths and lanes."""
    lanes = (-0.045, -0.030, -0.015, 0.0, 0.015, 0.030, 0.045)
    reach = (0.62, 0.78, 0.9, 1.0, 0.86, 0.72, 0.60)  # share of the path each lock covers
    end = None
    for i, (lane, share) in enumerate(zip(lanes, reach)):
        n_ctrl = max(4, int(round(len(PATH) * share)))
        pts = [p + V((lane * (j / (len(PATH) - 1)), lane * 0.35 * (j / (len(PATH) - 1)), 0.0))
               for j, p in enumerate(PATH[:n_ctrl])]
        widths = [0.011, 0.015, 0.016, 0.016, 0.015, 0.014, 0.011, 0.0][:n_ctrl]
        widths[-1] = 0.0
        secs = lock_secs(pts, widths)
        finish_lock(f"long_{i + 1}", secs, hair_mat, outline)
        if end is None or pts[-1].z < end.z:
            end = pts[-1]
    return end


# ---------------------------------------------------------------- tie
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


def tie(outline, hair_mat):
    """A short tuft in front of her left ear, tied with a navy band and two crossed amber stars."""
    bpy.data.objects.remove(card(59))  # the sample's long left lock; the tuft replaces it
    pts = [V(c) for c in [(0.097, -0.006, 1.545), (0.108, -0.004, 1.505), (0.112, -0.001, 1.470),
                          (0.121, 0.004, 1.440)]]
    secs = lock_secs(pts, [0.009, 0.012, 0.010, 0.0], n=10)
    finish_lock("tuft", secs, hair_mat, outline, hint=(1, 0, 0))
    e = pts[1].lerp(pts[2], 0.4)
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
    big.location = e + n * 0.016
    big.rotation_euler = q.to_euler()
    small = star("tie_star_small", 0.014, amber, outline)
    small.location = big.location + q @ V((0.022, 0.017, 0.003))
    small.rotation_euler = (q @ Euler((0, 0, math.radians(36))).to_quaternion()).to_euler()
    return e


def cubes(origin, hair_mat, amber, outline):
    ox, oy, oz = origin
    spec = [(0.000, -0.040, 0.026, 20, hair_mat), (0.018, -0.075, 0.022, 48, hair_mat),
            (-0.014, -0.108, 0.018, 12, hair_mat), (0.024, -0.140, 0.022, 33, hair_mat),
            (-0.008, -0.178, 0.015, 60, amber), (0.022, -0.212, 0.012, 25, amber),
            (-0.018, -0.242, 0.010, 40, amber)]
    for i, (dx, dz, s, rot, mat) in enumerate(spec):
        bpy.ops.mesh.primitive_cube_add(size=s, location=(ox + dx, oy - 0.004 * i, oz + dz))
        c = bpy.context.active_object
        c.name = f"cube_{i + 1}"
        c.rotation_euler = (math.radians(rot), math.radians(rot * 0.6), math.radians(rot * 1.3))
        c.data.materials.append(mat)
        c.data.materials.append(outline)
        mod = c.modifiers.new("outline", "SOLIDIFY")
        mod.thickness, mod.offset, mod.use_flip_normals, mod.material_offset = 0.0018, 1.0, True, 1


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
    face.data.shape_keys.key_blocks["Fcl_EYE_Close"].value = 0.20  # half-lidded at rest


def main():
    outline = bpy.data.materials["outline"]
    hair_mat = bpy.data.materials["hair"]
    for n in FRINGE:
        warp(card(n), fringe)
    for n in BACK:
        warp(card(n), flick)
    e = tie(outline, hair_mat)
    low = long_layer(outline, hair_mat)
    amber = bpy.data.materials["amber"]
    cubes(low, hair_mat, amber, outline)
    recolor_eyes()
    print("LONG_END", tuple(round(x, 3) for x in low), "TIE", tuple(round(x, 3) for x in e))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "spica-v4.blend"))
    print("SAVED")


main()
