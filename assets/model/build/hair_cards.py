"""
Helpers for her hair and eyes, shared by hair_bob.py and clothes.py: a toon material, flat materials, a star and a mesh part,
the sample's hair cards (`card`, `warp`), the A-pose, a skin BVH, `push_out` (keeps a mesh off her skin) and `recolor_eyes`
(the iris, highlight, brow, lash and mouth, in her palette). Builds nothing on its own.
Z is up, she faces -Y, her left is +X.
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
import sys  # noqa: E402

sys.path.insert(0, HERE)
from palette import P  # noqa: E402
ROOT = os.path.dirname(HERE)


def V(*a):
    """Vector from one sequence or from separate numbers."""
    if not a:
        return Vector((0.0, 0.0, 0.0))
    return Vector(a[0] if len(a) == 1 else a)


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

    retint("N00_000_00_EyeIris_00_EYE", ramp=P.iris)
    retint("N00_000_00_EyeHighlight_00_EYE", hexstr=P.eye_hi)
    retint("N00_000_00_FaceBrow_00_FACE", hexstr=P.brow)
    retint("N00_000_00_FaceEyelash_00_FACE", hexstr=P.outline)
    retint("N00_000_00_FaceEyeline_00_FACE", hexstr=P.outline)
    retint("N00_000_00_FaceMouth_00_FACE", hexstr=P.mouth)
    face = bpy.data.objects["Face"]
    face.data.shape_keys.key_blocks["Fcl_EYE_Close"].value = 0.20


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


CUT = 1.45        # below this height a lock is reshaped; above it the sample is untouched
CHIN = 1.385      # where her right lock now ends


def push_out(ob, bvhs, margin=0.0025, reach=0.04):
    """Move any vertex that lies inside her skin out to the surface."""
    m = ob.matrix_world
    mi = m.inverted()
    moved = 0
    for v in ob.data.vertices:
        w = m @ v.co
        for bvh in bvhs:
            loc, nrm, _, d = bvh.find_nearest(w)
            if loc is not None and d < reach and (w - loc).dot(nrm) < margin:
                w = loc + nrm * margin
                moved += 1
        v.co = mi @ w
    ob.data.update()
    return moved
