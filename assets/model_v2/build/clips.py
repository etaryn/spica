# Keys her clips on the finished model and saves spica-v2-clips.blend, leaving spica-v2.blend alone. Args after --: <name,...>; only those are replaced.
# A clip is a function from a frame to bone turns in her own axes, each relative to the bone's parent and laid over her arms-down pose. Loops are keyed for two cycles and bake swing over both; the second is the clip.
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import drape
import rig_poses as rp
import spring

OUT = Path(__file__).resolve().parent.parent / "spica-v2-clips.blend"
TAU = 2 * math.pi
AXES = {"X": Vector((1, 0, 0)), "Y": Vector((0, 1, 0)), "Z": Vector((0, 0, 1))}
SPINE, CHEST, UPPER_CHEST, NECK, HEAD, HIPS = (("J_Bip_C_%s" % n) for n in ("Spine", "Chest", "UpperChest", "Neck", "Head", "Hips"))
HEEL = Vector((0, 0.035, -0.127))  # the back of her sole, from her ankle
BALL, TOE_TIP = Vector((0, 0, -0.0401)), Vector((0, -0.0713, -0.0401))  # the sole under the ball of her foot, and the shoe's tip, from the toe joint
SOLE_Z = -0.0318  # her soles standing
# An ordinary human walk (after Winter's and Perry's gait data, a little gentler): degrees through one step of one leg, from heel strike (0); toes leave the ground at 0.6.
HIP_FLEX = ((0, 22), (0.15, 18), (0.5, -9), (0.6, -4), (0.75, 15), (0.87, 24))  # thigh forward
KNEE_FLEX = ((0, 3), (0.12, 14), (0.4, 5), (0.5, 24), (0.6, 40), (0.72, 58), (0.88, 22), (0.96, 3))  # nearly straight at heel strike and mid-stance
ANKLE_UP = ((0, 0), (0.08, -6), (0.4, 8), (0.5, 2), (0.6, -16), (0.7, -6), (0.85, 2))  # toes toward the shin; negative pushes off
BOB_CENTRE = (0.0, -0.012)  # the axis of her head, for the sectors of the bob
BOB_CROWN = 1.58  # the top of the bob
BOB_ROOT_SHARE = 0.6  # how far up from a lock's tip to the crown the swing begins
BOB_FULL_AT = 0.7  # how far down from there a lock is fully free
SIT_DROP = 0.335  # how far her hips come down: her hanging toes clear the ground by about a centimetre
SEAT_ABOVE = 1.0  # hoodie points below this height, in her rest pose, may move for the seat shape
SEAT_MARGIN = 0.006  # the gap the hoodie keeps outside her shorts
SEAT_BLUR = 0.006  # how widely each push is shared with the cloth around it
SEAT_ROUNDS = 6


def B(side, name):
    return "J_Bip_%s_%s" % (side, name)


def turn(axis, degrees):
    return Quaternion(AXES[axis], math.radians(degrees))


def head_of(arm, name):
    return arm.data.bones[name].head_local.copy()


def leg(arm, side, ankle, pitch, hips_turn, hips_at):
    """Turns that put her ankle at a point, knee forward, foot pitched: positive lifts her heel."""
    hip0, knee0, ankle0 = (head_of(arm, B(side, n)) for n in ("UpperLeg", "LowerLeg", "Foot"))
    centre = head_of(arm, HIPS)
    hip = centre + hips_at + hips_turn @ (hip0 - centre)
    upper, lower = (knee0 - hip0).length, (ankle0 - knee0).length
    to_ankle = ankle - hip
    reach = min(to_ankle.length, (upper + lower) * 0.998)
    axis = to_ankle.normalized()
    along = (upper * upper - lower * lower + reach * reach) / (2 * reach)
    forward = Vector((0, -1, 0))
    bend = (forward - axis * forward.dot(axis)).normalized()
    knee = hip + axis * along + bend * math.sqrt(max(upper * upper - along * along, 0.0))
    world_upper = (knee0 - hip0).rotation_difference(knee - hip)
    world_lower = (ankle0 - knee0).rotation_difference(hip + axis * reach - knee)
    return {
        B(side, "UpperLeg"): hips_turn.inverted() @ world_upper,
        B(side, "LowerLeg"): world_upper.inverted() @ world_lower,
        B(side, "Foot"): world_lower.inverted() @ turn("X", pitch),
    }


def idle(arm, frame):
    s = (frame - 1) / 96
    sway, breath = math.sin(TAU * s), math.sin(TAU * 2 * s)
    at = Vector((0.012 * sway, 0, -0.006))
    hips = turn("Y", -1.2 * sway)
    turns = {
        HIPS: hips,
        SPINE: turn("Y", 0.6 * sway),
        CHEST: turn("X", -0.5 * breath),
        UPPER_CHEST: turn("X", -0.6 * breath) @ turn("Y", 0.6 * sway),
        HEAD: turn("Z", 2 * math.sin(TAU * s + 0.8)) @ turn("X", math.sin(TAU * 2 * s)),
        B("L", "UpperArm"): turn("X", math.sin(TAU * s + 1)),
        B("R", "UpperArm"): turn("X", math.sin(TAU * s + 2)),
    }
    for side in "LR":
        turns.update(leg(arm, side, head_of(arm, B(side, "Foot")), 0, hips, at))
    return turns, at


def gait(keys, p):
    """A smooth curve through (phase, degrees) keys that wraps round at the end of the step (cubic Hermite, Catmull-Rom slopes)."""
    n = len(keys)
    t = [k[0] for k in keys]
    v = [k[1] for k in keys]

    def at(j):
        return t[j % n] + (j // n)  # phases past the end belong to the next step

    def slope(j):
        return (v[(j + 1) % n] - v[(j - 1) % n]) / (at(j + 1) - at(j - 1))

    p %= 1
    i = max(j for j in range(n) if t[j] <= p)
    width = at(i + 1) - t[i]
    u = (p - t[i]) / width
    return (2 * u**3 - 3 * u**2 + 1) * v[i] + (u**3 - 2 * u**2 + u) * width * slope(i) + (-2 * u**3 + 3 * u**2) * v[(i + 1) % n] + (u**3 - u**2) * width * slope(i + 1)


def gait_leg(arm, side, p, hips, at):
    """One leg at phase p of its step, from the gait curves: its turns, and the height of its lowest sole point with her hips at `at`."""
    hip0, knee0, ankle0 = (head_of(arm, B(side, n)) for n in ("UpperLeg", "LowerLeg", "Foot"))
    centre = head_of(arm, HIPS)
    toe0 = head_of(arm, B(side, "ToeBase"))
    upper, knee, foot = turn("X", -gait(HIP_FLEX, p)), turn("X", gait(KNEE_FLEX, p)), turn("X", -gait(ANKLE_UP, p))
    world_upper = hips @ upper
    world_lower = world_upper @ knee
    world_foot = world_lower @ foot
    heel_up = math.degrees(math.asin(min(max(-(world_foot @ Vector((0, -1, 0))).z, -1), 1)))  # positive when the foot tips onto its ball
    on_ground = 1 - min(max((p - 0.62) / 0.1, 0), 1)  # the toes stay flat on the ground until the foot leaves it
    toes = turn("X", -max(heel_up, 0) * on_ground)
    ankle = centre + at + hips @ (hip0 - centre) + world_upper @ (knee0 - hip0) + world_lower @ (ankle0 - knee0)
    ball = ankle + world_foot @ (toe0 - ankle0)
    points = (ankle + world_foot @ HEEL, ball + world_foot @ BALL, ball + world_foot @ toes @ TOE_TIP)
    return {B(side, "UpperLeg"): upper, B(side, "LowerLeg"): knee, B(side, "Foot"): foot, B(side, "ToeBase"): toes}, min(point.z for point in points)


def walk(arm, frame):
    """Her legs follow the joint angles of an ordinary human walk; her hips are set each frame so the lowest foot just meets the ground, which gives the rise over a straight leg."""
    p = ((frame - 1) / 32) % 1
    c, s = math.cos(TAU * p), math.sin(TAU * p)
    at = Vector((0.015 * s, 0, 0))
    hips = turn("Z", -6 * c) @ turn("Y", -2.5 * s)
    turns = {
        HIPS: hips,
        SPINE: turn("X", 3) @ turn("Z", 3 * c),
        CHEST: turn("Z", 3 * c) @ turn("Y", 1.5 * s),
        UPPER_CHEST: turn("Z", 2 * c),
        NECK: turn("X", -2),
        HEAD: turn("Z", -2 * c),
        B("L", "UpperArm"): turn("X", 15 * c),
        B("R", "UpperArm"): turn("X", -15 * c),
        B("L", "LowerArm"): turn("X", -18 + 8 * c),
        B("R", "LowerArm"): turn("X", -18 - 8 * c),
    }
    lowest = []
    for side, phase in (("L", p), ("R", (p + 0.5) % 1)):
        legs, low = gait_leg(arm, side, phase, hips, at)
        turns.update(legs)
        lowest.append(low)
    at.z = SOLE_Z - min(lowest)
    return turns, at


def look_up(arm, frame):
    """She stands, then her head and eyes rise to something above her, and she holds."""
    rise = min(max((frame - 8) / 20, 0.0), 1.0)
    rise = rise * rise * (3 - 2 * rise)
    at = Vector((0, 0, -0.004))
    hips = Quaternion()
    turns = {
        HIPS: hips,
        CHEST: turn("X", -2 * rise),
        UPPER_CHEST: turn("X", -4 * rise),
        NECK: turn("X", -8 * rise),
        HEAD: turn("X", -17 * rise),
    }
    for side in "LR":
        turns.update(leg(arm, side, head_of(arm, B(side, "Foot")), 0, hips, at))
    return turns, at


def sit_edge(arm, frame):
    """She sits on an edge, shins hanging, hands beside her hips, one foot swinging slowly."""
    s = (frame - 1) / 96
    breath = math.sin(TAU * 2 * s)
    turns = {
        HIPS: Quaternion(),
        SPINE: turn("X", 4),
        CHEST: turn("X", -0.5 * breath),
        UPPER_CHEST: turn("X", 3 - 0.6 * breath),
        NECK: turn("X", -3),
        HEAD: turn("X", -3) @ turn("Z", 2 * math.sin(TAU * s + 0.8)),
        B("L", "UpperLeg"): turn("Z", 4) @ turn("X", -88),
        B("R", "UpperLeg"): turn("Z", -4) @ turn("X", -88),
        B("L", "LowerLeg"): turn("X", 88 + 9 * math.sin(TAU * s)),
        B("R", "LowerLeg"): turn("X", 86 + 2 * math.sin(TAU * s + 1)),
        B("L", "Foot"): turn("X", 15),
        B("R", "Foot"): turn("X", 15),
        B("L", "UpperArm"): turn("X", -8),
        B("R", "UpperArm"): turn("X", -8),
    }
    return turns, Vector((0, 0, -SIT_DROP))


def evaluated_points(ob):
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    ev.to_mesh_clear()
    return a.reshape(-1, 3)


def gaps(points, tree, zone):
    """Each point's distance out from the nearest surface of the tree, NaN where it is outside the zone or more than 4 cm away."""
    out = np.full(len(points), np.nan)
    hits = [None] * len(points)
    for i in np.where(zone)[0]:
        p = Vector(points[i])
        loc, nrm, _, _ = tree.find_nearest(p)
        if (p - loc).length < 0.04:
            out[i], hits[i] = (p - loc).dot(nrm), (np.array(loc), np.array(nrm))
    return out, hits


def seat_shape(arm, ob, zone, aim):
    """Adds the shape `sit_seat` to a garment: rounds of moving its points, before the armature, until the seated pose puts them where aim(posed) says."""
    keys = ob.data.shape_keys.key_blocks if ob.data.shape_keys else None
    if keys and "sit_seat" in keys:
        ob.shape_key_remove(keys["sit_seat"])
    if not ob.data.shape_keys:
        ob.shape_key_add(name="Basis", from_mix=False)
    keys = ob.data.shape_keys.key_blocks
    basis = bm.get_co(ob)
    before = basis.copy()
    if "arms_down" in keys:
        keys["arms_down"].data.foreach_get("co", before.ravel())  # what the armature receives, with her arms-down shape on
    deform = {b.name: np.array(b.matrix @ b.bone.matrix_local.inverted()) for b in arm.pose.bones}
    blend = drape.blended_bones(ob, deform)
    key = ob.shape_key_add(name="sit_seat", from_mix=False)
    key.value = 1.0
    change = np.zeros_like(basis)
    for _ in range(SEAT_ROUNDS):  # each round moves from where the last left the cloth, so deep points come out without a wide blur diluting them
        key.data.foreach_set("co", (basis + change).astype(np.float32).ravel())
        bpy.context.view_layer.update()
        posed = evaluated_points(ob)
        change = change + bm.spread(basis, drape.rest_change(blend, before + change, aim(posed)), zone, SEAT_BLUR)
    key.data.foreach_set("co", (basis + change).astype(np.float32).ravel())
    print("CLIP seat shape on", ob.name, "moved up to", round(float(np.linalg.norm(change, axis=1).max()), 3))


def add_seat_shapes(arm):
    """Seated, her shorts push through the hoodie's seat; the hoodie is pushed out over them. Only for sit_edge; standing clips are untouched."""
    shorts = ("shorts", "shorts_cuff_L", "shorts_cuff_R")
    hoodie = bpy.data.objects["hoodie"]
    quiet = [m for o in bpy.data.objects if o.type == "MESH" for m in o.modifiers if m.type == "SOLIDIFY"]
    quiet += [m for m in hoodie.modifiers if m.type not in ("ARMATURE", "SOLIDIFY")]  # a shape is per point of the mesh itself, so only the armature may act on it
    for m in quiet:
        m.show_viewport = False
    bpy.context.view_layer.update()
    cloth = spring.solid_tree(shorts)
    zone = bm.get_co(hoodie)[:, 2] < SEAT_ABOVE

    def clear(posed):
        now, hits = gaps(posed, cloth, zone)
        target = posed.copy()
        for i in np.where(now < SEAT_MARGIN)[0]:
            loc, nrm = hits[i]
            target[i] = posed[i] + nrm * (SEAT_MARGIN - now[i])
        return target

    seat_shape(arm, hoodie, zone, clear)
    for m in quiet:
        m.show_viewport = True


CLIPS = {"idle": (idle, 96, True), "walk": (walk, 96, True), "look_up": (look_up, 48, False), "sit_edge": (sit_edge, 96, True)}


def add_bob_bones(arm):
    """One swing bone per sector round her head, for the bob. Roots stay on the head; weight rises toward the tips and is shared between neighbouring sectors, so the bob moves as one sheet and its layers cannot part."""
    bob = bpy.data.objects["hair_bob"]
    if spring.BOB_BONE % 0 in arm.data.bones:
        return
    co = bm.get_co(bob)
    step = TAU / spring.BOB_SECTORS
    sector = (np.arctan2(co[:, 1] - BOB_CENTRE[1], co[:, 0] - BOB_CENTRE[0]) % TAU) / step
    near, share = np.floor(sector).astype(int) % spring.BOB_SECTORS, sector - np.floor(sector)
    tips, roots, ends = np.zeros(spring.BOB_SECTORS), np.zeros(spring.BOB_SECTORS), []
    for k in range(spring.BOB_SECTORS):
        wrapped = (sector - k + spring.BOB_SECTORS / 2) % spring.BOB_SECTORS - spring.BOB_SECTORS / 2
        points = co[np.abs(wrapped) < 0.5]
        tips[k] = np.percentile(points[:, 2], 3)
        roots[k] = tips[k] + BOB_ROOT_SHARE * (BOB_CROWN - tips[k])
        at_root = points[np.abs(points[:, 2] - roots[k]) < 0.012]
        at_tip = points[points[:, 2] < tips[k] + 0.012]
        ends.append((np.median(at_root, axis=0), np.median(at_tip, axis=0)))
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for k, (top, bottom) in enumerate(ends):
        e = arm.data.edit_bones.new(spring.BOB_BONE % k)
        e.head, e.tail = Vector(top), Vector(bottom)
        e.parent = arm.data.edit_bones[HEAD]
    bpy.ops.object.mode_set(mode="OBJECT")
    second = (near + 1) % spring.BOB_SECTORS
    root, tip = roots[near] * (1 - share) + roots[second] * share, tips[near] * (1 - share) + tips[second] * share
    depth = np.clip((root - co[:, 2]) / (root - tip) / BOB_FULL_AT, 0, 1)
    weight = depth * depth * (3 - 2 * depth)
    head = bob.vertex_groups[HEAD]
    groups = [bob.vertex_groups.new(name=spring.BOB_BONE % k) for k in range(spring.BOB_SECTORS)]
    for i in np.where(weight > 0.001)[0].tolist():
        head.add([i], float(1 - weight[i]), "REPLACE")
        groups[near[i]].add([i], float(weight[i] * (1 - share[i])), "REPLACE")
        groups[second[i]].add([i], float(weight[i] * share[i]), "REPLACE")


def build(arm, name):
    function, length, loops = CLIPS[name]
    old = bpy.data.actions.get("clip_" + name)
    if old:
        bpy.data.actions.remove(old)
    arm.animation_data_create()
    arm.animation_data.action = None
    rp.apply(arm, "arms_down")
    bpy.context.view_layer.update()
    action = bpy.data.actions.new("clip_" + name)
    action.use_fake_user = True
    arm.animation_data.action = action
    down = {pb.name: pb.rotation_quaternion.copy() for pb in arm.pose.bones}
    standing = {pb.name: pb.matrix.to_quaternion() @ pb.bone.matrix_local.to_quaternion().inverted() for pb in arm.pose.bones}  # each bone's turn from rest to her arms-down stance
    for bone in json.loads(arm["arms_down"]):
        pb = arm.pose.bones[bone]
        pb.keyframe_insert("rotation_quaternion", frame=1)
        pb.keyframe_insert("location", frame=1)
    hips = arm.pose.bones[HIPS]
    to_bone = hips.bone.matrix_local.to_quaternion().inverted()
    last = 2 * length if loops else length
    for f in range(1, last + 1):
        turns, at = function(arm, f)
        for bone, q in turns.items():
            pb = arm.pose.bones[bone]
            held = standing[pb.parent.name] if pb.parent else Quaternion()
            q = held.inverted() @ q @ held  # a turn in her axes as she stands: a forearm hangs, so its bend is about her X, not the T-pose arm's
            rest = pb.bone.matrix_local.to_quaternion()
            pb.rotation_quaternion = rest.inverted() @ q @ rest @ down[bone]
            pb.keyframe_insert("rotation_quaternion", frame=f)
        hips.location = to_bone @ at
        hips.keyframe_insert("location", frame=f)
    if name == "sit_edge":
        bpy.context.scene.frame_set(1)
        bpy.context.view_layer.update()
        add_seat_shapes(arm)
    spring.bake(arm, 1, last, SIT_DROP if name == "sit_edge" else 0.0)
    if name == "sit_edge":
        for ob in bpy.data.objects:
            if ob.type == "MESH" and ob.data.shape_keys and "sit_seat" in ob.data.shape_keys.key_blocks:
                ob.data.shape_keys.key_blocks["sit_seat"].value = 0.0
    action["first"], action["last"] = (length + 1 if loops else 1), last
    arm.animation_data.action = None


def main():
    arm = bpy.data.objects["Armature"]
    add_bob_bones(arm)
    for name in sys.argv[sys.argv.index("--") + 1].split(","):
        build(arm, name)
    rp.apply(arm, "arms_down")
    bpy.context.scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT))


if __name__ == "__main__":
    main()
