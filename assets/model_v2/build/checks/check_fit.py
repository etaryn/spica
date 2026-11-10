# Measures how her hoodie sits on her static model and raises if a rule fails: the collarbones, the sleeve's outline.
# Run: blender -b assets/model_v2/spica-v2-accents.blend --python-exit-code 1 -P assets/model_v2/build/checks/check_fit.py
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import base_mesh as bm
import body as shape
import clothes as fit

COLLAR_MOST = 0.024  # the cloth over her collarbones stands at most this far off her
PINCH_MOST = 0.006  # the sleeve's outline may dip at most this far inside a straight line down the upper arm
OUTLINE_FROM, OUTLINE_TO = 1.24, 1.08
CHEST_UNEVEN_MOST = 0.005  # the cloth over her left and right bust may differ by at most this
SHOULDER_MOST = 0.022  # the hoodie's top may stand at most this far above her shoulder
SHOULDER_CORNER = 0.030  # and this far at its point, where her skin falls away 4 cm in 1 cm
WAIST_MOST = 0.024  # the hoodie stands at most this far off her waist at the sides

body, hoodie = bpy.data.objects["Body"], bpy.data.objects["hoodie"]
skin, cloth = bm.get_co(body), bm.get_co(hoodie)
tree = BVHTree.FromPolygons(skin.tolist(), [list(p.vertices) for p in body.data.polygons], all_triangles=False)
problems = []

for z in (1.29, 1.27):
    for x in (0.05, 0.07, 0.09, 0.11):
        here = cloth[(np.abs(np.abs(cloth[:, 0]) - x) < 0.01) & (np.abs(cloth[:, 2] - z) < 0.01) & (cloth[:, 1] < -0.02)]
        if len(here):
            front = here[here[:, 1] <= np.percentile(here[:, 1], 25)]
            gap = float(np.median([tree.find_nearest(Vector(c))[3] for c in front.tolist()]))
            print("COLLAR z %.2f x %.2f gap %.1f mm" % (z, x, gap * 1000))
            if gap > COLLAR_MOST:
                problems.append("cloth floats %.0f mm over her collarbone at x %.2f z %.2f" % (gap * 1000, x, z))


def outer(side, z):
    return float((cloth[np.abs(cloth[:, 2] - z) < 0.006, 0] * side).max())


for side, tag in ((1, "L"), (-1, "R")):
    a, b = outer(side, OUTLINE_FROM), outer(side, OUTLINE_TO)
    dips = {}
    for z in np.arange(OUTLINE_TO + 0.02, OUTLINE_FROM - 0.001, 0.02):
        line = a + (b - a) * (OUTLINE_FROM - z) / (OUTLINE_FROM - OUTLINE_TO)
        dips[round(float(z), 2)] = line - outer(side, z)
    worst = max(dips, key=dips.get)
    print("PINCH %s worst %.1f mm at z %.2f" % (tag, dips[worst] * 1000, worst))
    if dips[worst] > PINCH_MOST:
        problems.append("%s sleeve pinches in %.0f mm at z %.2f" % (tag, dips[worst] * 1000, worst))

flag = np.empty(len(cloth), np.float32)
hoodie.data.attributes["arm"].data.foreach_get("value", flag)
at_waist = cloth[(flag < 0.5) & (np.abs(cloth[:, 2] - fit.WAIST_HEIGHT) < 0.008) & (cloth[:, 1] < 0.12)]
her_waist = float(np.interp(fit.WAIST_HEIGHT, *np.array(shape.TORSO)[:, :2].T))
waist_gap = float(np.abs(at_waist[:, 0]).max()) - her_waist
print("WAIST cloth stands %.1f mm off her at the sides" % (waist_gap * 1000))
if waist_gap > WAIST_MOST:
    problems.append("hoodie stands %.0f mm off her waist" % (waist_gap * 1000))

for x, most in ((0.12, SHOULDER_MOST), (0.13, SHOULDER_MOST), (0.14, SHOULDER_MOST), (0.15, SHOULDER_CORNER)):  # the hoodie rests on her shoulder, so her arm turns from just under the cloth
    over = lambda q: q[(np.abs(q[:, 0] - x) < 0.005) & (np.abs(q[:, 1] - shape.SHOULDER_JOINT[1]) < 0.025) & (q[:, 2] > 1.1) & (q[:, 2] < 1.34)]
    gap = over(cloth)[:, 2].max() - over(skin)[:, 2].max()
    print("SHOULDER x %.2f cloth above skin %.1f mm" % (x, gap * 1000))
    if gap > most:
        problems.append("hoodie floats %.0f mm above her shoulder at x %.2f" % (gap * 1000, x))

shell = BVHTree.FromPolygons(cloth.tolist(), [list(f.vertices) for f in hoodie.data.polygons], all_triangles=False)


def forward(x, z):
    hit = shell.ray_cast((x, -0.5, z), (0, 1, 0))[0]
    return None if hit is None else hit[1]


uneven = {}
for z in (1.19, 1.17, 1.15, 1.13, 1.11, 1.09):
    for x in (0.03, 0.05, 0.07, 0.09, 0.11):
        left, right = forward(x, z), forward(-x, z)
        if left is not None and right is not None:
            uneven[(x, z)] = abs(left - right)
spot = max(uneven, key=uneven.get)
print("CHEST left and right differ by at most %.1f mm, at x %.2f z %.2f" % (uneven[spot] * 1000, *spot))
if uneven[spot] > CHEST_UNEVEN_MOST:
    problems.append("her chest is uneven by %.0f mm at x %.2f z %.2f" % (uneven[spot] * 1000, *spot))

if problems:
    raise RuntimeError("; ".join(problems))
print("FIT passed")
