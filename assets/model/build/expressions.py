"""
Review render of the expressions in expr_defs.py on her real face: the reference pack's shape keys, the mouth with teeth and tongue, the
skin overlays and the small decal (face_setup.py, face_decal.py). Read-only on the .blend.
Run: python assets/model/build/expr_draw.py   (draws the decal pictures)
     blender -b assets/model/spica-v1.blend -P assets/model/build/expressions.py -- <outdir> [face|mouth] [names...]
     python -I assets/model/build/expr_sheet.py <outdir> [face|mouth] [names...]
Works on the saved model (run.sh builds the machinery in with face_build.py); on an older .blend it builds it in the session, which needs
the reference pack's Reference Model.vrm (face_setup.REF_VRM, assets/references/, git-ignored).
"""
import math
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import expr_defs
import face_decal
import face_setup

args = sys.argv[sys.argv.index("--") + 1:]
out = os.path.abspath(args[0])
mode = "mouth" if "mouth" in args[1:] else "face"
table = expr_defs.EXPRESSIONS
names = [a for a in args[1:] if a in table] or list(table)
os.makedirs(out, exist_ok=True)
sc = bpy.context.scene
sc.render.engine, sc.render.film_transparent = "BLENDER_EEVEE", True
sc.render.resolution_x = sc.render.resolution_y = 600
sc.view_settings.view_transform = "Standard"
for o in [o for o in bpy.data.objects if o.type == "LIGHT"]:
    bpy.data.objects.remove(o)
w = bpy.data.worlds.new("w")
w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.30, 0.31, 0.36, 1)
sc.world = w
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type, cam.data.ortho_scale = "ORTHO", (0.26 if mode == "face" else 0.075)
cam.location, cam.rotation_euler = (0, -6, 1.45 if mode == "face" else 1.405), (math.radians(90), 0, 0)
sc.collection.objects.link(cam)
sc.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = math.pi
sun.rotation_euler = (math.radians(55), 0, math.radians(-35))
sc.collection.objects.link(sun)
if face_setup.is_built():  # the saved model already has the expression machinery (face_build.py)
    face_setup.attach()
    face_decal.attach()
else:  # an older .blend: build it in this session
    face_setup.setup(os.path.abspath(face_setup.REF_VRM))
    face_decal.build()
for n in names:
    face_setup.apply(table[n])
    face_decal.show(n)
    sc.render.filepath = os.path.join(out, f"{mode}-{n}.png")
    bpy.ops.render.render(write_still=True)
print("RENDERED", names)
