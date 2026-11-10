# Swing for her ponytail and bust: a spring solver baked into pose keys, trimmed from v1's.
# Each chain tip is pulled back to rest, carried by its own inertia, held at bone length, and kept out of her. 24 fps.
import math

import bpy
import numpy as np
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

import body as shape

# stiffness: share of the way back to rest per frame; drag: speed lost per frame; cone: most it may swing (degrees); margin: gap kept from her (m)
PONY = dict(stiffness=0.10, drag=0.40, cone=12, margin=0.010)
BUST = dict(stiffness=0.20, drag=0.45, cone=15, margin=0.0)
SOLID = ("Body", "Face", "hoodie", "hair_bob")
TORSO = np.array(shape.TORSO)  # her measured outline by height: half width, front, back
ROOTS = (("J_Sec_Pony1", PONY), ("J_Sec_L_Bust1", BUST), ("J_Sec_R_Bust1", BUST))


def chains(arm):
    out = []
    for name, kind in ROOTS:
        chain = [arm.data.bones[name]]
        while chain[-1].children:
            chain.append(chain[-1].children[0])
        out.append((chain, kind))
    return out


def clear(arm):
    """Removes earlier swing keys, so baking twice gives the same result."""
    act = arm.animation_data.action if arm.animation_data else None
    if act:
        for layer in act.layers:
            for strip in layer.strips:
                bag = strip.channelbag(arm.animation_data.action_slot)
                for fc in [f for f in bag.fcurves if f.data_path.startswith('pose.bones["J_Sec')]:
                    bag.fcurves.remove(fc)
    for pb in arm.pose.bones:
        if pb.name.startswith("J_Sec"):
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = (1, 0, 0, 0)


def solid_tree(names=SOLID):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    verts, tris = [], []
    for name in names:
        o = bpy.data.objects[name]
        ev = o.evaluated_get(depsgraph)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        base = len(verts)
        verts += [o.matrix_world @ v.co for v in me.vertices]
        tris += [tuple(base + k for k in t.vertices) for t in me.loop_triangles]
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, tris)


def clearance(tree, p):
    """The way out from the nearest surface, and the distance. Hair cards and layered cloth have no reliable outside, so this is by position alone."""
    loc = tree.find_nearest(p)[0]
    away = p - loc
    return away.normalized(), away.length


def out_of_torso(p, margin):
    """If p is inside her outline, the nearest place just outside it. By measurement, because the skin under the hoodie has been removed."""
    if not TORSO[0, 0] <= p.z <= TORSO[-1, 0]:
        return p
    half, front, back = (float(np.interp(p.z, TORSO[:, 0], TORSO[:, c])) for c in (1, 2, 3))
    if not (abs(p.x) < half and front < p.y < back):
        return p
    moves = (
        Vector((math.copysign(half + margin, p.x), p.y, p.z)),
        Vector((p.x, front - margin, p.z)),
        Vector((p.x, back + margin, p.z)),
    )
    return min(moves, key=lambda m: (m - p).length)


def within_cone(q, degrees):
    limit = math.radians(degrees)
    return Quaternion().slerp(q, limit / q.angle) if q.angle > limit else q


def bake(arm, f0, f1):
    clear(arm)
    scene = bpy.context.scene
    cs = chains(arm)
    mw = arm.matrix_world
    state = {}
    for f in range(f0, f1 + 1):
        scene.frame_set(f)
        bpy.context.view_layer.update()
        tree = solid_tree()
        for chain, k in cs:
            parent_world = mw @ arm.pose.bones[chain[0].parent.name].matrix
            parent_rest = chain[0].parent.matrix_local
            for b in chain:
                rest = parent_world @ (parent_rest.inverted() @ b.matrix_local)
                head, length = rest.translation, b.length
                along = (rest.to_3x3() @ Vector((0, 1, 0))).normalized()
                target = head + along * length
                tail, prev = state.get(b.name, (target.copy(), target.copy()))
                if f == f0:
                    tail = prev = target.copy()
                nxt = tail + (tail - prev) * (1 - k["drag"]) + (target - tail) * k["stiffness"]
                q = along.rotation_difference((nxt - head).normalized())
                q = within_cone(q, k["cone"])
                nxt = head + (q @ along) * length
                state[b.name] = (nxt, tail)  # the free motion: collision only corrects what is keyed, so it can never stick
                if k["margin"]:
                    outside = out_of_torso(nxt, k["margin"])
                    if outside != nxt:
                        q = within_cone(along.rotation_difference((outside - head).normalized()), k["cone"])
                        nxt = head + (q @ along) * length
                    _, rigid_gap = clearance(tree, target)
                    nrm, gap = clearance(tree, nxt)
                    allowed = min(k["margin"], rigid_gap)
                    if gap < allowed:
                        q = within_cone(along.rotation_difference((nxt + nrm * (allowed - gap) - head).normalized()), k["cone"])
                basis = rest.to_3x3().normalized()
                local = (basis.inverted() @ q.to_matrix() @ basis).to_quaternion()
                pb = arm.pose.bones[b.name]
                pb.rotation_mode = "QUATERNION"
                pb.rotation_quaternion = local
                pb.keyframe_insert("rotation_quaternion", frame=f)
                parent_world, parent_rest = rest @ local.to_matrix().to_4x4(), b.matrix_local
