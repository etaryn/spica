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


CLIPS = {"idle": (idle, 96, True), "walk": (walk, 96, True)}


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
            rest = pb.bone.matrix_local.to_quaternion()
            pb.rotation_quaternion = rest.inverted() @ q @ rest @ down[bone]
            pb.keyframe_insert("rotation_quaternion", frame=f)
        hips.location = to_bone @ at
        hips.keyframe_insert("location", frame=f)
    spring.bake(arm, 1, last)
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
