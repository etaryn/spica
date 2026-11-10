# Renders her expressions, one picture each. Read-only on the .blend. Args after --: <output dir> [set2] [names...]
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import brow_over
import face_expr
import face_expr2

args = sys.argv[sys.argv.index("--") + 1:]
out = Path(args[0])
chosen = face_expr2 if "set2" in args else face_expr
names = [a for a in args[1:] if a != "set2"] or chosen.NAMES
out.mkdir(parents=True, exist_ok=True)
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.view_settings.view_transform = "Standard"
sc.view_settings.look = "None"
sc.render.resolution_x = sc.render.resolution_y = 600
world = bpy.data.worlds.new("review")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.84, 0.84, 0.89, 1)
sc.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy, sun.data.angle = 3.0, 0.03
sun.rotation_euler = (math.radians(33), 0, math.radians(-22))
sc.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type, cam.data.ortho_scale = "ORTHO", 0.30
cam.location = Vector((0, -6.05, 1.445))
cam.rotation_euler = (math.radians(90), 0, 0)
sc.collection.objects.link(cam)
sc.camera = cam
for name in names:
    chosen.use(name)
    sc.render.filepath = str(out / ("face-%s.png" % name))
    brow_over.render(sc)
print("RENDERED", len(names))
