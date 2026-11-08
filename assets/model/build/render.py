"""
Renders review stills of spica.blend: the four views, a flat-colour pass and a black silhouette pass.
Run: blender -b assets/model/spica.blend -P assets/model/build/render.py -- <outdir> [views...]
The camera and the sun ride one empty, so every view is lit the same way.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.path.dirname(os.path.dirname(bpy.data.filepath)), "renders")
OUT = os.path.abspath(OUT)
os.makedirs(OUT, exist_ok=True)
VIEWS = {"front": 0, "threeq": 35, "side": 90, "back": 180, "head": 0, "head3q": 35, "head3qr": -35, "headback": 180, "face": 0, "face3q": 35, "chest": 0, "chest3q": 35, "chest3qr": -35, "chestside": 90, "tuftfront": -45, "tuftside": -90, "tuft3q": -135, "tuftback": 180, "chestback": 180, "chestback3q": 140, "chestbackside": 100}
ZOOM = {"head": (0.50, 1.50), "head3q": (0.50, 1.50), "head3qr": (0.50, 1.50), "headback": (0.50, 1.50), "face": (0.26, 1.45), "face3q": (0.26, 1.45), "chest": (0.60, 1.30), "chest3q": (0.60, 1.30), "chest3qr": (0.60, 1.30), "chestside": (0.60, 1.30), "tuftfront": (0.30, 1.47), "tuftside": (0.30, 1.47), "tuft3q": (0.30, 1.47), "tuftback": (0.30, 1.47), "chestback": (0.60, 1.30), "chestback3q": (0.60, 1.30), "chestbackside": (0.60, 1.30)}  # ortho scale, centre height
CZ = 0.86

sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE"
sc.eevee.taa_render_samples = 24
sc.render.film_transparent = True
WIDE = os.environ.get("SPICA_WIDE") == "1"  # T-pose base: arms out, so a square frame
sc.render.resolution_x, sc.render.resolution_y = (900, 900) if WIDE else (600, 900)
sc.view_settings.view_transform = "Standard"
sc.render.image_settings.file_format = "PNG"
sc.render.image_settings.color_mode = "RGBA"

for _l in [o for o in bpy.data.objects if o.type == "LIGHT"]:  # the saved file's view sun
    bpy.data.objects.remove(_l)
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.30, 0.31, 0.36, 1)
sc.world = world

rig = bpy.data.objects.new("rig", None)
rig.location = (0, 0, CZ)
sc.collection.objects.link(rig)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = 1.95
cam.location = (0, -6, 0)
cam.rotation_euler = (math.radians(90), 0, 0)
cam.parent = rig
sc.collection.objects.link(cam)
sc.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = math.pi
d = Vector((0.45, 0.65, -0.85)).normalized()  # travel direction, from front-left above
sun.rotation_euler = (-d).to_track_quat("Z", "Y").to_euler()
sun.parent = rig
sc.collection.objects.link(sun)


def shoot(name, angle, view="full"):
    scale, cz = ZOOM.get(view, (1.9 if WIDE else 1.95, CZ))
    cam.data.ortho_scale = scale
    rig.location = (0, 0, cz)
    rig.rotation_euler = (0, 0, math.radians(angle))
    sc.render.filepath = os.path.join(OUT, name + ".png")
    bpy.ops.render.render(write_still=True)


names = argv[1:] or list(VIEWS)
body = [n for n in names if n not in ZOOM]
for n in names:
    shoot(f"view-{n}", VIEWS[n], n)

# Flat colour pass: every toon material shows only its base colour (palette check).
for m in bpy.data.materials:
    for nd in m.node_tree.nodes if m.node_tree else []:
        if nd.bl_idname == "ShaderNodeValToRGB":
            base = nd.color_ramp.elements[1].color[:]
            for e in nd.color_ramp.elements:
                e.color = base
for n in names[:1]:
    shoot(f"flat-{n}", VIEWS[n], n)

# Silhouette pass: everything solid black.
black = bpy.data.materials.new("black")
black.use_nodes = True
black.node_tree.nodes.clear()
o = black.node_tree.nodes.new("ShaderNodeOutputMaterial")
e = black.node_tree.nodes.new("ShaderNodeEmission")
e.inputs["Color"].default_value = (0, 0, 0, 1)
black.node_tree.links.new(e.outputs["Emission"], o.inputs["Surface"])
bpy.context.view_layer.material_override = black
for n in body:
    shoot(f"sil-{n}", VIEWS[n], n)
print("RENDERED", names)
