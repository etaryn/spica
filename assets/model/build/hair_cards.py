"""
Her hair, by editing the sample's own hair cards (no new geometry): the sample is already a clean bob,
so only two cards change. Its long right front lock is cut back to chin length and its long left front
lock is stretched down to her chest (an asymmetric bob, her left longer), leaning forward so it lies
on the front of her shoulder, then any vertex inside her skin is pushed out. Two crossed amber stars
sit on the long left side at ear height. The cards keep the sample's bone weights, so its spring-bone
hair physics still applies for animation. Runs after base_prepare.py in the same Blender session:
  blender -b -P base_prepare.py -P hair_cards.py        (run.sh v4 does this)
Z is up, she faces -Y, her left is +X.
"""
import math
import os

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
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

    retint("N00_000_00_EyeIris_00_EYE", ramp=("1E2340", "7D90AD", "B6C5DB"))
    retint("N00_000_00_EyeHighlight_00_EYE", hexstr="FFB23F")
    retint("N00_000_00_FaceBrow_00_FACE", hexstr="3A4266")
    retint("N00_000_00_FaceEyelash_00_FACE", hexstr="1E2340")
    retint("N00_000_00_FaceEyeline_00_FACE", hexstr="1E2340")
    retint("N00_000_00_FaceMouth_00_FACE", hexstr="B5707A")
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
CHEST = 1.12      # where her left lock now ends


def shorten_right(p):
    if p.z >= CUT:
        return p
    k = (CUT - CHIN) / (CUT - 1.301)  # the sample's lock ended at 1.301
    return V(p.x, p.y, CUT - (CUT - p.z) * k)


def lengthen_left(p):
    if p.z >= CUT:
        return p
    k = (CUT - CHEST) / (CUT - 1.305)  # the sample's lock ended at 1.305
    d = (CUT - p.z) * k
    # lean forward as it falls so it lies on the front of her shoulder and chest
    return V(p.x, p.y - 0.05 * clamp(d / 0.33), CUT - d)


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


def stars(outline):
    """Two crossed amber stars on the outside of the long left lock, at ear height."""
    c = card(59)
    vs = [c.matrix_world @ v.co for v in c.data.vertices if 1.455 < (c.matrix_world @ v.co).z < 1.485]
    e = max(vs, key=lambda p: p.x)
    n = V((0.55, -0.85, 0)).normalized()
    q = n.to_track_quat("Z", "Y")
    amber = amber_toon()
    big = star("tie_star_big", 0.026, amber, outline)
    big.location = e + n * 0.012 + V(-0.012, 0, 0)  # on the lock, not beside it
    big.rotation_euler = q.to_euler()
    small = star("tie_star_small", 0.014, amber, outline)
    small.location = big.location + q @ V((0.022, 0.017, 0.003))
    small.rotation_euler = (q @ Euler((0, 0, math.radians(36))).to_quaternion()).to_euler()
    for o in (big, small):
        vg = o.vertex_groups.new(name="J_Bip_C_Head")
        vg.add([v.index for v in o.data.vertices], 1.0, "REPLACE")
        mod = o.modifiers.new("armature", "ARMATURE")
        mod.object = bpy.data.objects["Armature"]
        o.modifiers.move(len(o.modifiers) - 1, 0)


def main():
    outline = bpy.data.materials["outline"]
    a_pose()
    warp(card(58), shorten_right)
    warp(card(59), lengthen_left)
    dg = bpy.context.evaluated_depsgraph_get()
    bvhs = [skin_bvh(bpy.data.objects["Body"]), skin_bvh(bpy.data.objects["face_outline"])]
    moved = push_out(card(59), bvhs) + push_out(card(58), bvhs)
    print("PUSHED", moved)
    stars(outline)
    recolor_eyes()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "spica-v4.blend"))
    print("SAVED")


if __name__ == "__main__":
    main()
