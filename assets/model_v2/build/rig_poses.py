# The poses for checking her rig, as turns of bones about world axes from her rest pose, the T-pose.
import json
import math

import bpy
from mathutils import Matrix, Quaternion


def B(side, name):
    return "J_Bip_%s_%s" % (side, name)


def both(name, axis, left):
    """The same turn on both sides; a turn about Y or Z is mirrored, a turn about X is not."""
    return [(B("L", name), axis, left), (B("R", name), axis, left if axis == "X" else -left)]


POSES = {  # from her rest pose, the T-pose. Arms lowered go through lower_arms
    "rest": [],
    "arms_down": [],
    "a_pose": [],
    "arms_forward": [(B("L", "UpperArm"), "Z", -85), (B("R", "UpperArm"), "Z", 85)],
    "arms_crossed": [(B("L", "UpperArm"), "Z", -110), (B("R", "UpperArm"), "Z", 110), (B("L", "LowerArm"), "Z", -45), (B("R", "LowerArm"), "Z", 45)],
    "arms_up": [(B("L", "UpperArm"), "Y", -60), (B("R", "UpperArm"), "Y", 60)],
    "arms_overhead": [(B("L", "UpperArm"), "Y", -85), (B("R", "UpperArm"), "Y", 85)],
    "sit": both("UpperLeg", "X", -90) + both("LowerLeg", "X", 90),
    "lean": [("J_Bip_C_Spine", "X", 20), ("J_Bip_C_Chest", "X", 15), ("J_Bip_C_UpperChest", "X", 10), ("J_Bip_C_Neck", "X", 10)],
    "head_turn": [("J_Bip_C_Neck", "Z", 15), ("J_Bip_C_Head", "Z", 40), ("J_Bip_C_Head", "X", 20), ("J_Bip_C_Head", "Y", 15)],
    "stride": [(B("L", "UpperLeg"), "X", -35), (B("R", "UpperLeg"), "X", 25), (B("L", "LowerLeg"), "X", 20), (B("R", "LowerLeg"), "X", 40)],
    "twist": [("J_Bip_C_Spine", "Z", 25), ("J_Bip_C_Chest", "Z", 20), ("J_Bip_C_UpperChest", "Z", 15)],
}
LOWERED = {"arms_down": 1.0, "a_pose": 40 / 75}  # how far her arms have come down from the T-pose to her resting pose


def set_down_shapes(value):
    """The shapes that hold her approved arms-down look, on the meshes that have one."""
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob.data.shape_keys and "arms_down" in ob.data.shape_keys.key_blocks:
            ob.data.shape_keys.key_blocks["arms_down"].value = value


def reset(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    set_down_shapes(0.0)


def turn(arm, bone, axis, degrees):
    pb = arm.pose.bones[bone]
    head = arm.matrix_world @ pb.head
    spin = Matrix.Translation(head) @ Matrix.Rotation(math.radians(degrees), 4, axis) @ Matrix.Translation(-head)
    pb.matrix = arm.matrix_world.inverted() @ spin @ arm.matrix_world @ pb.matrix
    bpy.context.view_layer.update()


def lower_arms(arm, share):
    """Brings her arms down from the T-pose: 1 is her resting pose, stored on the armature by tpose.py, and her collarbones come with them."""
    for bone, (rotation, location) in json.loads(arm["arms_down"]).items():
        arm.pose.bones[bone].rotation_quaternion = Quaternion().slerp(Quaternion(rotation), share)
        arm.pose.bones[bone].location = [v * share for v in location]
    set_down_shapes(share)
    bpy.context.view_layer.update()


def apply(arm, name):
    reset(arm)
    bpy.context.view_layer.update()
    if name in LOWERED:
        lower_arms(arm, LOWERED[name])
        return
    for bone, axis, degrees in POSES[name]:
        turn(arm, bone, axis, degrees)
