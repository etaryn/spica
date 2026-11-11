# Tests her swing and the binary star: lag, settling, the same result twice, the tail out of her body.
# Run: blender -b assets/model_v2/spica-v2-drape.blend --python-exit-code 1 -P assets/model_v2/build/checks/check_spring.py
import math
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import body as shape
import rig_poses as rp
import spring

torso = np.array(shape.TORSO)

arm = bpy.data.objects["Armature"]
sc = bpy.context.scene
star = bpy.data.objects["accent_orb_heavy"]
sc.frame_set(1)
at_one = star.matrix_world.translation.copy()
sc.frame_set(25)
assert (star.matrix_world.translation - at_one).length > 0.005, "the binary star does not orbit"
sc.frame_set(97)
assert (star.matrix_world.translation - at_one).length < 1e-4, "one orbit should take 96 frames"

rp.apply(arm, "arms_down")  # her resting pose, where the ponytail lies against her shoulder
head = arm.pose.bones["J_Bip_C_Head"]
head.rotation_mode = "XYZ"
for f, deg in ((1, 0), (8, 40), (30, 40)):
    head.rotation_euler = (0, math.radians(deg), 0)  # a head shake, about the bone's own length
    head.keyframe_insert("rotation_euler", frame=f)
spring.bake(arm, 1, 90)


def tip(f):
    sc.frame_set(f)
    bpy.context.view_layer.update()
    return (arm.matrix_world @ arm.pose.bones["J_Sec_Pony8"].tail).copy()


assert (tip(8) - tip(90)).length > 0.001, "the ponytail does not lag"  # small: it hangs, so a head turn moves its resting line only part as far
assert (tip(88) - tip(90)).length < 0.002, "the ponytail has not settled"
first = [tip(f) for f in (8, 20, 40)]
spring.bake(arm, 1, 90)
second = [tip(f) for f in (8, 20, 40)]
assert max((a - b).length for a, b in zip(first, second)) < 1e-5, "two bakes differ"


def in_her_torso(p):
    """By her measured outline, because the skin under the hoodie has been removed. Above the table it is her head, which the hair sits on."""
    if not torso[0, 0] <= p.z <= torso[-1, 0]:
        return False
    half, front, back = (np.interp(p.z, torso[:, 0], torso[:, c]) for c in (1, 2, 3))
    return abs(p.x) < half and front < p.y < back


sc.frame_set(20)
bpy.context.view_layer.update()
for chain, kind in spring.chains(arm):
    for b in chain:
        assert math.degrees(arm.pose.bones[b.name].rotation_quaternion.angle) <= kind["cone"] + 0.5, b.name + " bends past its limit"
        if kind is spring.PONY:
            assert not in_her_torso(arm.matrix_world @ arm.pose.bones[b.name].tail), b.name + " went into her"
print("SPRING passed")
