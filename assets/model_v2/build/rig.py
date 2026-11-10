# Her skeleton and skin weights: the pieces tpose.py binds her with.
# Joints are measured from the finished mesh; bone names are v1's. Her rest pose is how she stands now.
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import body as bd

SPINE = (("J_Bip_C_Hips", 0.90), ("J_Bip_C_Spine", 0.97), ("J_Bip_C_Chest", 1.06), ("J_Bip_C_UpperChest", 1.16), ("J_Bip_C_Neck", 1.285), ("J_Bip_C_Head", 1.345))
HEAD_TOP = 1.58
HIP_ABOVE_CREASE = 0.02  # the hip joint sits this far above the top of the slanted crease at her thigh
TOE_AT = 0.72  # the ball of her foot, as a share of the way from heel to toe tip
FINGERS = {"Index": (278, 283, 282), "Middle": (277, 279, 272), "Ring": (280, 274, 275), "Little": (281, 286, 276), "Thumb": (359, 285, 284)}  # face sets, root to tip
PALM = {273}
MIRROR = np.array([-1.0, 1.0, 1.0])
HAND_SETS = bm.PARTS["hand"]

PONY_BONES = 8
PONY_RIGID = 0.04  # the part at the tie, as a share of its length, stays on the head
HIDE_ARM_ABOVE = 0.93  # on her arms it goes down to here, well inside the sleeve but clear of the cuff
HIDE_ABOVE, HIDE_RAYS, HIDE_MARGIN, HIDE_REACH, HIDE_SEEN_LEAST = 1.0, 96, 2, 0.12, 2  # skin above the shorts' waistband goes; how many lines of sight are tried; how many rings stay round what can be seen; how far above it cloth counts as over it; how many lines must get out for skin to count as seen
NOT_IN_HEAT = ("J_Adj_", "J_Sec_")  # eyes keep their own weights, bust is a falloff, ponytail goes by its own line
NECK_REACH, HEAD_ABOVE = (0.04, 0.07), (1.335, 1.35)  # how far out from her middle her neck goes, and the height above which everything is her head
NECK_TO_HEAD = (1.30, 1.345)  # her body's skin goes fully to the head bone by the height the face begins
BUST_RADIUS, BUST_INNER, BUST_SHARE = 0.085, 0.03, 0.8
ARMPIT_X, ARMPIT_Z, ARMPIT_RADIUS = (0.07, 0.175), (1.06, 1.26), 0.03  # the hoodie around her underarm, and how widely its weights are spread


def pony_t(pony):
    t = np.empty(len(pony.data.vertices), np.float32)
    pony.data.attributes["chain_t"].data.foreach_get("value", t)
    return t


def pony_nodes(pony):
    """Points through the final mesh's middle at even places along the hanging line."""
    p, t = bm.get_co(pony), pony_t(pony)
    half = 0.5 / PONY_BONES
    return [p[np.abs(t - i / PONY_BONES) <= half].mean(0) for i in range(PONY_BONES + 1)]


def pony_weights(pony, bones, col):
    t = pony_t(pony)
    W = np.zeros((len(t), len(bones)), np.float32)
    s = np.clip(t * PONY_BONES - 0.5, 0, PONY_BONES - 1)
    low = np.clip(s.astype(int), 0, PONY_BONES - 2)
    f = s - low
    for k in range(PONY_BONES - 1):
        a, b = col["J_Sec_Pony%d" % (k + 1)], col["J_Sec_Pony%d" % (k + 2)]
        here = low == k
        W[here, a] += 1 - f[here]
        W[here, b] += f[here]
    head = (1 - bd.smoothstep(0.0, PONY_RIGID, t)).astype(np.float32)
    W *= (1 - head)[:, None]
    W[:, col["J_Bip_C_Head"]] += head
    return W


def slab_centre(points, mask, at, axis, half=0.006):
    """The middle of her mesh in a thin slice across a limb."""
    q = points[mask]
    near = q[np.abs((q - at) @ axis) < half]
    assert len(near) >= 8, "too few points in the slice at %s" % at
    return (near.min(0) + near.max(0)) / 2


def measure(body):
    p = bm.get_co(body)
    in_sets = lambda sets: bm.vertices_in_sets(body, sets)
    left = p[:, 0] > 0
    border = lambda a, b: p[in_sets(a) & in_sets(b) & left]
    j = {}

    torso_mask = (np.abs(p[:, 0]) < 0.16) & ~in_sets(bm.PARTS["arm"] | HAND_SETS)
    for name, z in SPINE:
        mid = slab_centre(p, torso_mask, np.array([0, 0, z]), np.array([0.0, 0, 1]))
        j[name] = np.array([0.0, mid[1], z])
    j["J_Bip_C_Head"][1] = bm.HEAD_PIVOT[1]

    j["Shoulder"] = border(bm.PARTS["torso"], bm.PARTS["shoulder"]).mean(0)
    ring = border(bm.PARTS["shoulder"], bm.PARTS["arm"]).mean(0)
    j["UpperArm"] = np.array([ring[0], ring[1], bd.SHOULDER_JOINT[2]])
    j["Hand"] = border(bm.PARTS["arm"], HAND_SETS).mean(0)
    axis = (j["Hand"] - j["UpperArm"]) / np.linalg.norm(j["Hand"] - j["UpperArm"])
    j["LowerArm"] = slab_centre(p, in_sets(bm.PARTS["arm"]) & left, (j["UpperArm"] + j["Hand"]) / 2, axis)

    crease = border(bm.PARTS["torso"], bm.PARTS["leg"])
    j["UpperLeg"] = np.array([crease[:, 0].mean(), crease[:, 1].mean(), crease[:, 2].max() + HIP_ABOVE_CREASE])
    j["Foot"] = border(bm.PARTS["leg"], bm.PARTS["foot"]).mean(0)
    leg = in_sets(bm.PARTS["leg"]) & left
    j["LowerLeg"] = slab_centre(p, leg, (j["UpperLeg"] + j["Foot"]) / 2, np.array([0.0, 0, 1]))

    foot = p[in_sets(bm.PARTS["foot"]) & left]
    heel, toe = foot[:, 1].max(), foot[:, 1].min()
    y = heel + TOE_AT * (toe - heel)
    j["ToeBase"] = slab_centre(foot, np.ones(len(foot), bool), np.array([0, y, 0]), np.array([0.0, 1, 0]))
    j["ToeTip"] = np.array([j["ToeBase"][0], toe, j["ToeBase"][2]])

    for finger, (a, b, c) in FINGERS.items():
        first, second, third = in_sets({a}) & left, in_sets({b}) & left, in_sets({c}) & left
        one, two = p[first & second].mean(0), p[second & third].mean(0)
        palm = first & in_sets(PALM)
        root = p[palm].mean(0) if palm.any() else 2 * p[first].mean(0) - one
        tip = p[third][np.argmax(np.linalg.norm(p[third] - two, axis=1))]
        j[finger] = (root, one, two, tip)

    chest = in_sets(bm.PARTS["torso"]) & left & (p[:, 2] > 1.10) & (p[:, 2] < 1.25)
    j["Bust"] = p[chest][np.argmin(p[chest][:, 1])]
    return j


def bone_list(j, face):
    """(name, head, tail, parent) for every bone, left side measured and right side mirrored."""
    out = [("Root", np.zeros(3), np.array([0, 0, 0.1]), None)]
    spine = [n for n, _ in SPINE]
    for k, n in enumerate(spine):
        tail = j[spine[k + 1]] if k + 1 < len(spine) else np.array([0, j[n][1], HEAD_TOP])
        out.append((n, j[n], tail, spine[k - 1] if k else "Root"))
    for side, m in (("L", np.ones(3)), ("R", MIRROR)):
        b = lambda n: "J_Bip_%s_%s" % (side, n)
        hand_tip = j["Middle"][0]
        out += [
            (b("Shoulder"), j["Shoulder"] * m, j["UpperArm"] * m, "J_Bip_C_UpperChest"),
            (b("UpperArm"), j["UpperArm"] * m, j["LowerArm"] * m, b("Shoulder")),
            (b("LowerArm"), j["LowerArm"] * m, j["Hand"] * m, b("UpperArm")),
            (b("Hand"), j["Hand"] * m, hand_tip * m, b("LowerArm")),
            (b("UpperLeg"), j["UpperLeg"] * m, j["LowerLeg"] * m, "J_Bip_C_Hips"),
            (b("LowerLeg"), j["LowerLeg"] * m, j["Foot"] * m, b("UpperLeg")),
            (b("Foot"), j["Foot"] * m, j["ToeBase"] * m, b("LowerLeg")),
            (b("ToeBase"), j["ToeBase"] * m, j["ToeTip"] * m, b("Foot")),
        ]
        for finger in FINGERS:
            root, one, two, tip = j[finger]
            for k, (h, t) in enumerate(((root, one), (one, two), (two, tip))):
                out.append(("J_Bip_%s_%s%d" % (side, finger, k + 1), h * m, t * m, b("Hand") if k == 0 else "J_Bip_%s_%s%d" % (side, finger, k)))
        peak = j["Bust"] * m
        sec = lambda n: "J_Sec_%s_Bust%d" % (side, n)
        out += [
            (sec(1), peak + [0, 0.05, 0], peak + [0, 0.025, 0], "J_Bip_C_UpperChest"),
            (sec(2), peak + [0, 0.025, 0], peak, sec(1)),
        ]
        eye = "J_Adj_%s_FaceEye" % side
        g = face.vertex_groups[eye].index
        points = bm.get_co(face)[[v.index for v in face.data.vertices if any(x.group == g and x.weight > 0.5 for x in v.groups)]]
        out.append((eye, points.mean(0), points.mean(0) + [0, -0.02, 0], "J_Bip_C_Head"))
    nodes = pony_nodes(bpy.data.objects["hair_ponytail"])
    for k in range(PONY_BONES):
        out.append(("J_Sec_Pony%d" % (k + 1), nodes[k], nodes[k + 1], "J_Sec_Pony%d" % k if k else "J_Bip_C_Head"))
    return out


def build_armature(j, face):
    data = bpy.data.armatures.new("Armature")
    arm = bpy.data.objects.new("Armature", data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    made = {}
    for name, head, tail, parent in bone_list(j, face):
        e = data.edit_bones.new(name)
        e.head, e.tail = head.tolist(), tail.tolist()
        if parent:
            e.parent = made[parent]
        made[name] = e
    bpy.ops.object.mode_set(mode="OBJECT")
    data.bones["Root"].use_deform = False
    return arm


def heat_weights(arm, body):
    """Blender's automatic weights, on a closed copy so the opening for her face cannot upset them. Same points, same order."""
    temp = body.copy()
    temp.data = body.data.copy()
    temp.name = "rig_temp"
    temp.modifiers.clear()
    bpy.context.scene.collection.objects.link(temp)
    b = bmesh.new()
    try:
        b.from_mesh(temp.data)
        made = bmesh.ops.holes_fill(b, edges=[e for e in b.edges if e.is_boundary], sides=0)["faces"]
        bmesh.ops.triangulate(b, faces=made)
        b.to_mesh(temp.data)
    finally:
        b.free()
    assert len(temp.data.vertices) == len(body.data.vertices)
    skip = [b.name for b in arm.data.bones if b.name.startswith(NOT_IN_HEAT)]
    for n in skip:
        arm.data.bones[n].use_deform = False
    bpy.ops.object.select_all(action="DESELECT")
    temp.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    for n in skip:
        arm.data.bones[n].use_deform = True
    bones = [b.name for b in arm.data.bones]
    col = {n: i for i, n in enumerate(bones)}
    W = np.zeros((len(temp.data.vertices), len(bones)), np.float32)
    by_group = {g.index: col[g.name] for g in temp.vertex_groups if g.name in col}
    for v in temp.data.vertices:
        for g in v.groups:
            if g.group in by_group:
                W[v.index, by_group[g.group]] = g.weight
    mesh = temp.data
    bpy.data.objects.remove(temp)
    bpy.data.meshes.remove(mesh)
    assert W.sum(1).min() > 1e-4, "automatic weights left %d points unweighted: try option C from the spec" % int((W.sum(1) <= 1e-4).sum())
    return W, bones, col


def finish(W, limit=4):
    W = W.copy()
    np.put_along_axis(W, np.argsort(W, axis=1)[:, :-limit], 0, 1)
    total = W.sum(1, keepdims=True)
    assert total.min() > 1e-6, "a point has no weight left"
    return W / total


class Skin:
    """Her body's weights, and which of its points belong to which limb."""

    def __init__(self, body, W, bones, col, j):
        self.p = bm.get_co(body)
        self.W, self.bones, self.col = W, bones, col
        self.in_sets = lambda sets: bm.vertices_in_sets(body, sets)
        self.side = {"L": self.p[:, 0] > 0, "R": self.p[:, 0] < 0}
        self.peak = j["Bust"]

    def part(self, *names):
        out = np.zeros(len(self.p), bool)
        for n in names:
            out |= self.in_sets(bm.PARTS[n])
        return out

    def clean(self):
        """Removes weights that automatic weighting bled across limbs; each limb keeps its own bones."""
        W, col = self.W, self.col

        def wipe(mask, names):
            W[np.ix_(mask, [col[n] for n in names if n in col])] = 0

        spine = [n for n in self.bones if n.startswith("J_Bip_C_")]
        fingers = lambda s, f: ["J_Bip_%s_%s%d" % (s, f, i) for i in (1, 2, 3)]
        for s, other in (("L", "R"), ("R", "L")):
            b = lambda n: "J_Bip_%s_%s" % (s, n)
            arm_here = self.part("arm", "hand") & self.side[s]
            shoulder = self.part("shoulder") & self.side[s]
            leg_here = self.part("leg", "foot") & self.side[s]
            below_arm = [b("LowerArm"), b("Hand")] + [n for f in FINGERS for n in fingers(s, f)]
            wipe(~arm_here, below_arm)
            wipe(~(arm_here | shoulder), [b("UpperArm")])
            wipe(~leg_here, [b("LowerLeg"), b("Foot"), b("ToeBase")])
            wipe(arm_here, spine)
            wipe(self.part("leg", "foot"), [b("Shoulder")])
            wipe(self.side[other], [b("UpperLeg"), b("Shoulder")])
            on = {f: self.in_sets(set(sets)) & self.side[s] for f, sets in FINGERS.items()}
            for finger in FINGERS:
                shared = np.any([on[f] for f in FINGERS if f != finger], axis=0)  # points in the web between two fingers keep both
                wipe(on[finger] & ~shared, [n for f in FINGERS if f != finger for n in fingers(s, f)])

    def neck_and_bust(self):
        W, col, p = self.W, self.col, self.p
        at_neck = np.maximum(1 - bd.smoothstep(*NECK_REACH, np.abs(p[:, 0])), bd.smoothstep(*HEAD_ABOVE, p[:, 2]))  # by height alone, raised arms would count as her head
        share = (bd.smoothstep(NECK_TO_HEAD[0], NECK_TO_HEAD[1], p[:, 2]) * at_neck)[:, None]
        W *= (1 - share).astype(np.float32)
        W[:, col["J_Bip_C_Head"]] += share[:, 0].astype(np.float32)
        torso = self.part("torso")
        for s, m in (("L", np.ones(3)), ("R", MIRROR)):
            d = np.linalg.norm(p - self.peak * m, axis=1)
            w = ((1 - bd.smoothstep(BUST_INNER, BUST_RADIUS, d)) * BUST_SHARE * (torso & self.side[s])).astype(np.float32)
            W *= (1 - w)[:, None]
            W[:, col["J_Sec_%s_Bust1" % s]] += 0.4 * w
            W[:, col["J_Sec_%s_Bust2" % s]] += 0.6 * w


def transfer(points, source_points, source_W, k=4):
    """Each point takes the blended weights of the nearest source points."""
    kd = KDTree(len(source_points))
    for i, c in enumerate(source_points.tolist()):
        kd.insert(c, i)
    kd.balance()
    out = np.zeros((len(points), source_W.shape[1]), np.float32)
    for i, c in enumerate(points.tolist()):
        for _, index, distance in kd.find_n(c, k):
            out[i] += source_W[index] / (distance + 1e-4)
    return out / out.sum(1, keepdims=True)


def write_group(ob, W, bones):
    for j in np.where((W > 0).any(0))[0]:
        g = ob.vertex_groups.new(name=bones[j])
        for i in np.where(W[:, j] > 0)[0]:
            g.add([int(i)], float(W[i, j]), "REPLACE")


def attach(ob, arm):
    mod = ob.modifiers.new("rig", "ARMATURE")
    mod.object = arm
    ob.modifiers.move(len(ob.modifiers) - 1, 0)
    ob.parent = arm
    ob.matrix_parent_inverse.identity()


def rigid(ob, arm, bone):
    ob.vertex_groups.new(name=bone).add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
    attach(ob, arm)


def skin_cloth(ob, arm, skin, W, smooth=0):
    if smooth:
        W = bm.smooth_field(W, bm.edges_of(ob), np.ones(len(W), bool), smooth)
    W = finish(W)
    write_group(ob, W, skin.bones)
    attach(ob, arm)
    return W


def clothes(arm, skin):
    core = skin.part("torso", "shoulder", "neck") | ~skin.part("torso", "shoulder", "neck", "arm", "hand", "leg", "foot", "head")
    legs = skin.part("leg", "foot")
    ob = bpy.data.objects["hoodie"]
    points = bm.get_co(ob)
    flag = np.empty(len(points), np.float32)
    ob.data.attributes["arm"].data.foreach_get("value", flag)
    sleeve = flag > 0.5
    W = np.zeros((len(points), len(skin.bones)), np.float32)
    for s, sign in (("L", 1), ("R", -1)):
        here = sleeve & (points[:, 0] * sign > 0)
        src = skin.part("arm", "hand", "shoulder") & skin.side[s]
        W[here] = transfer(points[here], skin.p[src], skin.W[src])
    src = (core & (skin.p[:, 2] < NECK_TO_HEAD[0])) | legs  # below where her skin starts turning with her head: the hood stays on her shoulders
    W[~sleeve] = transfer(points[~sleeve], skin.p[src], skin.W[src])
    side, height = np.abs(points[:, 0]), points[:, 2]
    underarm = (side > ARMPIT_X[0]) & (side < ARMPIT_X[1]) & (height > ARMPIT_Z[0]) & (height < ARMPIT_Z[1])
    W = bm.spread(points, W, underarm, ARMPIT_RADIUS).astype(np.float32)  # a wide change from arm to body, or raising her arm tears the cloth here
    hoodie_W = skin_cloth(ob, arm, skin, W, smooth=6)

    ob = bpy.data.objects["shorts"]
    points = bm.get_co(ob)
    W = np.zeros((len(points), len(skin.bones)), np.float32)
    for s, sign in (("L", 1), ("R", -1)):
        here = points[:, 0] * sign >= 0
        src = (skin.part("torso") | legs) & (skin.side[s] | skin.part("torso"))
        W[here] = transfer(points[here], skin.p[src], skin.W[src])
    skin_cloth(ob, arm, skin, W, smooth=4)

    stocking_W = None
    for name, s, parts in (("shorts_cuff_L", "L", ("leg",)), ("shorts_cuff_R", "R", ("leg",)), ("stocking", "L", ("leg", "foot")), ("ankle_sock", "R", ("leg", "foot")), ("sneaker_L", "L", ("foot",)), ("sneaker_R", "R", ("foot",))):
        ob = bpy.data.objects[name]
        src = skin.part(*parts) & skin.side[s]
        done = skin_cloth(ob, arm, skin, transfer(bm.get_co(ob), skin.p[src], skin.W[src]))
        if name == "stocking":
            stocking_W = done

    for name, under, under_W in (("zip_strip", "hoodie", hoodie_W), ("zip_slider", "hoodie", hoodie_W), ("accent_stocking_stars", "stocking", stocking_W)):
        ob = bpy.data.objects[name]
        skin_cloth(ob, arm, skin, transfer(bm.get_co(ob), bm.get_co(bpy.data.objects[under]), under_W))


def parent_to_bone(ob, arm, bone):
    """Keeps the object where it is. A bone child hangs off the bone's tail, hence the length."""
    bpy.context.view_layer.update()
    pb = arm.pose.bones[bone]
    inverse = (arm.matrix_world @ pb.matrix @ Matrix.Translation((0, pb.bone.length, 0))).inverted()
    ob.parent, ob.parent_type, ob.parent_bone = arm, "BONE", bone
    ob.matrix_parent_inverse = inverse


def orbit():
    """One empty turning the pair about the line through them. Frame 1 is the pose of her still."""
    pivot = bpy.data.objects["accent_binary"]
    spin = bpy.data.objects.new("accent_spin", None)
    bpy.context.scene.collection.objects.link(spin)
    for child in list(pivot.children):
        child.parent = spin
    spin.parent = pivot
    fc = spin.driver_add("rotation_euler", 2)
    fc.driver.type = "SCRIPTED"
    fc.driver.expression = "(frame - 1) * 6.283185307 / 96"


def directions(n):
    """Even directions over a sphere."""
    i = np.arange(n) + 0.5
    z = 1 - 2 * i / n
    r = np.sqrt(1 - z * z)
    turn = np.pi * (1 + 5**0.5) * i
    return np.column_stack([r * np.cos(turn), r * np.sin(turn), z])


def covered_faces(body):
    """Deletes the skin that can never be seen under her hoodie, so it cannot poke through the cloth when she moves. A point goes if cloth lies straight over it, or if no line of sight from it gets out."""
    p = bm.get_co(body)
    trunk = bm.vertices_in_sets(body, bm.PARTS["torso"] | bm.PARTS["shoulder"]) & (p[:, 2] > HIDE_ABOVE)
    wanted = trunk | (bm.vertices_in_sets(body, bm.PARTS["arm"]) & (p[:, 2] > HIDE_ARM_ABOVE))
    points, polys = [], []
    for name in ("Body", "hoodie", "shorts"):
        ob = bpy.data.objects[name]
        base = len(points)
        points.extend(bm.get_co(ob).tolist())
        polys.extend([base + v for v in f.vertices] for f in ob.data.polygons)
    tree = BVHTree.FromPolygons(points, polys, all_triangles=False)
    hoodie = bpy.data.objects["hoodie"]
    cloth = BVHTree.FromPolygons(bm.get_co(hoodie).tolist(), [list(f.vertices) for f in hoodie.data.polygons], all_triangles=False)
    normals = np.empty(len(p) * 3, np.float32)
    body.data.vertex_normals.foreach_get("vector", normals)
    normals = normals.reshape(-1, 3)
    ways = [Vector(d) for d in directions(HIDE_RAYS)]
    visible = np.zeros(len(p), bool)
    for i in np.where(trunk)[0]:  # the sleeve covers her arm all the way down to here, so only her trunk needs testing
        at, out = Vector(p[i]), Vector(normals[i].tolist())
        under_cloth = cloth.ray_cast(at + out * 0.001, out, HIDE_REACH)[0] is not None
        visible[i] = not under_cloth and sum(tree.ray_cast(at + d * 0.003, d)[0] is None for d in ways) >= HIDE_SEEN_LEAST  # one stray line up through the neck hole is not skin anyone sees
    seen = ~wanted | bm.grow(visible, bm.edges_of(body), HIDE_MARGIN)  # stay a little inside the cloth's edge, growing only from skin that really shows
    return [f.index for f in body.data.polygons if not any(seen[v] for v in f.vertices)]


def delete_faces(body, indices):
    b = bmesh.new()
    try:
        b.from_mesh(body.data)
        b.faces.ensure_lookup_table()
        bmesh.ops.delete(b, geom=[b.faces[i] for i in indices], context="FACES")
        b.to_mesh(body.data)
    finally:
        b.free()
    body.data.update()
    print("RIG hidden skin removed:", len(indices), "faces")


def face_parts(arm):
    for name in ("Face", "face_outline"):
        ob = bpy.data.objects[name]
        keep = {"J_Bip_C_Head", "J_Adj_L_FaceEye", "J_Adj_R_FaceEye"}  # outline_w is not a bone and stays
        for g in [g for g in ob.vertex_groups if g.name.startswith(("J_", "Root")) and g.name not in keep]:
            ob.vertex_groups.remove(g)
        attach(ob, arm)
