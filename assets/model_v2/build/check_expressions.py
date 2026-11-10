# Tests both sets of her expressions: every key exists on her face and its shells, the tattoo stays on her cheek in a head turn.
# Run: blender -b assets/model_v2/spica-v2.blend --python-exit-code 1 -P assets/model_v2/build/check_expressions.py
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import expr2_defs
import face_expr
import face_expr2
import rig_poses as rp


def evaluated(ob):
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    ev.to_mesh_clear()
    return a.reshape(-1, 3)


face, tattoo = bpy.data.objects["Face"], bpy.data.objects["accent_tattoo"]
arm = bpy.data.objects["Armature"]
keys = {k.name for k in face.data.shape_keys.key_blocks}
assert len(keys) == 229, "Face has %d keys" % len(keys)
for name, count in (("face_outline", 224), ("mouth_outline", 229), ("accent_tattoo", 224)):  # the outline of the mouth is a copy of her face, so it carries the eye keys too
    assert len(bpy.data.objects[name].data.shape_keys.key_blocks) == count, name
assert len(face_expr.NAMES) == 25
for name, e in {**face_expr.expr_defs.EXPRESSIONS, **expr2_defs.EXPRESSIONS}.items():
    missing = [k for k in e["keys"] if k not in keys]
    assert not missing, (name, missing)


def tattoo_gap():
    f, t = evaluated(face), evaluated(tattoo)
    kd = KDTree(len(f))
    for i, c in enumerate(f.tolist()):
        kd.insert(c, i)
    kd.balance()
    return max(kd.find(c)[2] for c in t.tolist())


face_expr.use("neutral")
bpy.context.view_layer.update()
rest = tattoo_gap()
for expression in ("pout", "happy"):
    face_expr.use(expression)
    rp.apply(arm, "head_turn")
    bpy.context.view_layer.update()
    assert tattoo_gap() < rest + 0.0015, "the tattoo left her cheek in " + expression
rp.reset(arm)
for name in face_expr2.NAMES:
    face_expr2.use(name)
face_expr.use("neutral")
print("EXPRESSIONS passed")
