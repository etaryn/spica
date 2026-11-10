# Measures the lower lid of each eye in every expression that has water in her eyes, so the water can be drawn to fit. Saves lids.json beside the pictures.
# Run: blender -b assets/model_v2/spica-v2.blend --python-exit-code 1 -P assets/model_v2/build/expr2_lids.py
import json
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import expr2_defs
import face_expr2

SKIN_SLOT = 3
BIN, MARGIN = 0.0015, 0.001  # how finely the lid is read across the eye; how far past the white of her eye it may run (metres)
WHITE_SLOT = 4
BELOW = 0.004  # a point this far under the middle of the lid is not part of it


def lower_lid(points, rim, side, rect, white):
    """The bottom edge of the eye opening, from the corner by her nose to the outer corner, as [x, z]. The opening is not one clean loop in the mesh, so it is read across the eye, between the ends of the white of her eye."""
    x0, x1, z0, z1 = rect
    used = sorted({v for key in rim for v in key})
    here = points[used]
    eye = np.abs(points[white][points[white][:, 0] * side > 0][:, 0])
    near = here[(here[:, 0] * side > eye.min() - MARGIN) & (here[:, 0] * side < eye.max() + MARGIN) & (here[:, 2] > z0 + 0.012) & (here[:, 2] < z1)]
    assert len(near) > 8, "no eye opening found"
    lowest = {}
    for x, _, z in near.tolist():
        slot = round(abs(x) / BIN)
        if slot not in lowest or z < lowest[slot][1]:
            lowest[slot] = (x, z)
    line = [lowest[k] for k in sorted(lowest)]
    usual = float(np.median([v for _, v in line]))
    line = [p for p in line if p[1] > usual - BELOW]  # the edge of her skin past the eye's corner runs far down her cheek
    z = np.array([v for _, v in line])
    floor = np.array([z[max(0, i - 1) : i + 2].min() for i in range(len(z))])  # some columns only caught the upper lid
    even = [floor[max(0, i - 1) : i + 2].mean() for i in range(len(z))]
    return [[round(x, 5), round(float(v), 5)] for (x, _), v in zip(line, even)]


rect = list(bpy.data.objects["accent_water"]["water_patch"])
face = bpy.data.objects["Face"]
out = {}
for name, e in expr2_defs.EXPRESSIONS.items():
    if not e.get("water"):
        continue
    face_expr2.face_expr.use(name, {name: {**e, "water": False}}, face_expr2.TEX, face_expr2.DRAWN)  # the water is what is being measured for, so it does not exist yet
    bpy.context.view_layer.update()
    ev = face.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    points = a.reshape(-1, 3)
    uses = {}
    for p in me.polygons:
        if p.material_index == SKIN_SLOT:
            for key in p.edge_keys:
                uses[key] = uses.get(key, 0) + 1
    rim = [key for key, n in uses.items() if n == 1]
    white = sorted({v for p in me.polygons if p.material_index == WHITE_SLOT for v in p.vertices})
    out[name] = {letter: lower_lid(points, rim, side, rect, white) for letter, side in (("L", 1), ("R", -1))}
    ev.to_mesh_clear()
face_expr2.face_expr.use("neutral")
Path(face_expr2.TEX).mkdir(parents=True, exist_ok=True)
(Path(face_expr2.TEX) / "lids.json").write_text(json.dumps({"rect": rect, "lids": out}))
print("LIDS", sorted(out), "points", {k: len(v["L"]) for k, v in out.items()})
