"""Secondary motion for Spica's rig: bakes hair and bust follow-through into pose keys.

The VRoid file carries no spring-bone data, so this is a small spring-bone solver (the same idea as
the VRM one: each chain tip is pulled back to its rest direction, dragged by its own inertia, kept
at bone length), with two additions her stiff short bob needs: a cone (a strand never swings more
than `cone` degrees from where its parent holds it) and a collision (a tail is kept out of her
skin, hood and hoodie by up to `margin`, never closer than the rigid pose already is).
Call bake(arm, f0, f1) after the main motion is keyed; it replaces any earlier secondary keys and
adds rotation keys on the J_Sec_Hair* and J_Sec_*_Bust* bones only. Rigid on purpose: the bun (its
cards use hair chains 08 and 09, which are left out), hood, clothes, binary star. Tuned for 24 fps.
Run this file in Blender (-P) for a quick self-check; spring_check.py is the full test.
"""
import math

import bpy
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

# stiffness: fraction of the way back to rest per frame; drag: velocity lost per frame;
# cone: most a strand may swing from rest (degrees); margin: clearance kept from her body (m)
HAIR = dict(stiffness=0.12, drag=0.40, cone=20, margin=0.012)
BUST = dict(stiffness=0.20, drag=0.45, cone=15, margin=0.0)
SOLID = ("Body", "Face", "hood", "hoodie")  # what a tail must stay out of


def chains(arm):
    """(bones root first, settings) for every hair / bust chain that is allowed to move."""
    bun = {vg.name for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("tuft") for vg in o.vertex_groups}
    out = []
    for b in arm.data.bones:
        kind = HAIR if "J_Sec_Hair" in b.name else BUST if "_Bust" in b.name else None
        if kind is None or b.parent.name.startswith("J_Sec"):
            continue
        chain = [b]
        while chain[-1].children:
            chain.append(chain[-1].children[0])
        if not any(c.name in bun for c in chain):
            out.append((chain, kind))
    return out


def _clear(arm):
    """Remove earlier secondary keys, so baking twice gives the same result."""
    act = arm.animation_data.action if arm.animation_data else None
    if act is None:
        return
    for layer in act.layers:
        for strip in layer.strips:
            cb = strip.channelbag(arm.animation_data.action_slot)
            for fc in [f for f in cb.fcurves if f.data_path.startswith('pose.bones["J_Sec')]:
                cb.fcurves.remove(fc)
    for pb in arm.pose.bones:
        if pb.name.startswith("J_Sec"):
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = (1, 0, 0, 0)


def _solid_tree():
    dg = bpy.context.evaluated_depsgraph_get()
    verts, tris = [], []
    for name in SOLID:
        o = bpy.data.objects.get(name)
        if o is None:
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        base = len(verts)
        verts += [o.matrix_world @ v.co for v in me.vertices]
        tris += [tuple(base + k for k in t.vertices) for t in me.loop_triangles]
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, tris)


def _clearance(tree, p):
    loc, nrm, _, _ = tree.find_nearest(p)
    return loc, nrm, (p - loc).dot(nrm)


def bake(arm, f0, f1):
    """Simulate frames f0..f1 (inclusive) and key the secondary bones."""
    _clear(arm)
    sc = bpy.context.scene
    cs = chains(arm)
    mw = arm.matrix_world
    scale = mw.to_scale()[0]
    state = {}  # bone name -> [tail, previous tail] in world space
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        tree = _solid_tree()
        for chain, k in cs:
            parent_world = mw @ arm.pose.bones[chain[0].parent.name].matrix
            parent_rest = chain[0].parent.matrix_local
            for b in chain:
                rest = parent_world @ (parent_rest.inverted() @ b.matrix_local)
                head, L = rest.translation, b.length * scale
                ydir = (rest.to_3x3() @ Vector((0, 1, 0))).normalized()
                target = head + ydir * L
                tail, prev = state.get(b.name, [target.copy(), target.copy()])
                if f == f0:
                    tail = prev = target.copy()
                nxt = tail + (tail - prev) * (1 - k["drag"]) + (target - tail) * k["stiffness"]
                d = (nxt - head)
                d = d.normalized() if d.length > 1e-9 else ydir
                q = ydir.rotation_difference(d)
                if q.angle > math.radians(k["cone"]):  # a strand holds near where its parent puts it
                    q = Quaternion().slerp(q, math.radians(k["cone"]) / q.angle)
                nxt = head + (q @ ydir) * L
                state[b.name] = [nxt, tail]  # the free motion; collision below only corrects what is keyed, so a
                # strand wedged behind the hood can never get stuck there
                if k["margin"]:  # stay out of her, but never closer than the rigid pose is
                    _, _, s_rigid = _clearance(tree, target)
                    _, nrm, s = _clearance(tree, nxt)
                    m = min(k["margin"], s_rigid)
                    if s < m:
                        d = nxt + nrm * (m - s) - head
                        nxt = head + d.normalized() * L
                        q = ydir.rotation_difference(d.normalized())
                basis = rest.to_3x3().normalized()
                local = (basis.inverted() @ q.to_matrix() @ basis).to_quaternion()
                pb = arm.pose.bones[b.name]
                pb.rotation_mode = "QUATERNION"
                pb.rotation_quaternion = local
                pb.keyframe_insert("rotation_quaternion", frame=f)
                # the next bone in the chain hangs off this one's new orientation
                parent_world, parent_rest = rest @ local.to_matrix().to_4x4(), b.matrix_local


def _check():
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    arm.animation_data_clear()
    head = arm.pose.bones["J_Bip_C_Head"]
    head.rotation_mode = "XYZ"
    for f, deg in ((1, 0), (8, 40), (30, 40)):
        head.rotation_euler = (0, 0, deg * math.pi / 180)
        head.keyframe_insert("rotation_euler", frame=f)
    bake(arm, 1, 40)
    sc = bpy.context.scene
    tips = {}
    for f in (1, 8, 40):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        pb = arm.pose.bones["J_Sec_Hair3_04"]
        tips[f] = (arm.matrix_world @ pb.tail).copy()
    assert (tips[8] - tips[40]).length > 0.003, "no lag after the head stopped"
    assert not any(c.name in ("J_Sec_Hair1_08", "J_Sec_Hair1_09") for ch, _ in chains(arm) for c in ch), "bun chains must stay rigid"
    sc.frame_set(1)
    print("spring check OK")


if __name__ == "__main__":
    _check()
