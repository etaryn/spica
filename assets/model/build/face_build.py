"""
Builds her expressions into the saved model (run.sh runs this on the .blend clothes.py saved): face_setup.setup (the reference model's
shape keys, the mouth material, the outline shells, the skin overlay slots), face_decal.build (the decal over her face), then her
neutral expression, and saves the file again. Afterwards `face_expr.use(name)` switches her face in any session.
Needs the Expression Pack's reference model (face_setup.REF_VRM); without it this prints a note and leaves the model as it was.
Run: blender -b assets/model/spica-v1.blend -P assets/model/build/face_build.py   (after expr_draw.py, which makes the pictures)
"""
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import face_decal  # noqa: E402
import face_expr  # noqa: E402
import face_setup  # noqa: E402

ref = os.path.abspath(face_setup.REF_VRM)
if not os.path.exists(ref):
    print("FACEBUILD skipped: the reference model is missing:", ref)
elif face_setup.is_built():
    print("FACEBUILD already built into", os.path.basename(bpy.data.filepath))
else:
    added = face_setup.setup(ref)
    face_decal.build()
    face_expr._attached = False
    face_expr.use("neutral")
    bpy.ops.wm.save_mainfile()
    print("FACEBUILD", len(added), "shape keys,", len(face_expr.NAMES), "expressions, saved", os.path.basename(bpy.data.filepath))
