# Keys a head shake and a jump, bakes the swing if asked, and saves a demo file to render at chosen frames.
# Args after --: <out .blend> [sprung]
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rig_poses as rp
import spring

arm = bpy.data.objects["Armature"]
rp.apply(arm, "arms_down")  # her resting pose, which is how she is seen; the T-pose is only what she is built on
head, root = arm.pose.bones["J_Bip_C_Head"], arm.pose.bones["Root"]
head.rotation_mode = "XYZ"
for f, deg in ((1, 0), (8, 40), (16, -40), (24, 0)):
    head.rotation_euler = (0, math.radians(deg), 0)  # about the bone's own length: a head shake
    head.keyframe_insert("rotation_euler", frame=f)
for f, z in ((24, 0), (32, 0.25), (40, 0)):
    root.location = (0, 0, z)
    root.keyframe_insert("location", frame=f)
if "sprung" in sys.argv:
    spring.bake(arm, 1, 56)
bpy.ops.wm.save_as_mainfile(filepath=sys.argv[sys.argv.index("--") + 1])
