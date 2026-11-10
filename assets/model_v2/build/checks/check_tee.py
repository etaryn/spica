# Measures her T-pose hoodie: how far the cloth hangs below her arm, near the armpit. Raises if it is a pouch.
# Run: blender -b assets/model_v2/spica-v2-tpose.blend --python-exit-code 1 -P assets/model_v2/build/checks/check_tee.py
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import base_mesh as bm

POUCH_MOST = 0.052  # the most the cloth may hang below her arm: the moderate fit Ethan chose measures 50 mm
ACROSS = (0.17, 0.20, 0.23, 0.26, 0.30)

with bpy.data.libraries.load(str(bm.ROOT / "spica-v2-tbody.blend"), link=False) as (_, wanted):
    wanted.objects = ["Body"]  # her whole T-pose body: the finished model has lost the skin under the hoodie
skin, cloth = bm.get_co(wanted.objects[0]), bm.get_co(bpy.data.objects["hoodie"])
worst = 0.0
for side in (1, -1):
    for x in ACROSS:
        near = lambda q: q[(np.abs(q[:, 0] * side - x) < 0.008) & (q[:, 2] > 1.0)]
        depth = float(near(skin)[:, 2].min() - near(cloth)[:, 2].min())
        print("POUCH side %d x %.2f cloth hangs %.1f mm below her arm" % (side, x, depth * 1000))
        worst = max(worst, depth)
if worst > POUCH_MOST:
    raise RuntimeError("the cloth hangs %.0f mm below her arm" % (worst * 1000))
print("TEE passed")
