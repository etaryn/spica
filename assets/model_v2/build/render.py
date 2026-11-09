# Renders review pictures of a v2 .blend. Args after --: <output dir> <clay|toon> <view,view,...>
# Views: front, q, qr, side, back, head, headq, headside, hand, foot.
import math
import os
import sys

import bpy
from mathutils import Vector

out_dir, mode, names = sys.argv[sys.argv.index("--") + 1:][:3]
os.makedirs(out_dir, exist_ok=True)

scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.view_settings.view_transform = "Standard"
scene.view_settings.look = "None"

for name in filter(None, os.environ.get("SPICA_HIDE", "").split(",")):
    for o in [x for x in scene.objects if x.name.startswith(name)]:
        bpy.data.objects.remove(o)
meshes = [o for o in scene.objects if o.type == "MESH"]
for o in scene.objects:
    if o.name in ("cam", "sun"):
        bpy.data.objects.remove(o)

world = bpy.data.worlds.new("review")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
scene.collection.objects.link(sun)
sun.rotation_euler = (math.radians(55), 0, math.radians(-35))
if mode == "clay":
    bg.inputs[0].default_value = (0.62, 0.62, 0.66, 1)
    bg.inputs[1].default_value = 0.6
    sun.data.energy = 3.0
    clay = bpy.data.materials.new("clay")
    clay.use_nodes = True
    p = clay.node_tree.nodes["Principled BSDF"]
    p.inputs["Base Color"].default_value = (0.62, 0.58, 0.56, 1)
    p.inputs["Roughness"].default_value = 0.55
    for o in meshes:
        for m in [x for x in o.modifiers if x.type == "SOLIDIFY" and x.name == "outline"]:
            o.modifiers.remove(m)
        if o.name.startswith("accent_"):
            continue  # the tattoo and binary star are light: in plain clay they could not be seen
        o.data.materials.clear()
        o.data.materials.append(clay)
elif mode == "sil":
    bg.inputs[0].default_value = (1, 1, 1, 1)
    bg.inputs[1].default_value = 1.0
    black = bpy.data.materials.new("black")
    black.use_nodes = True
    black.node_tree.nodes.clear()
    o_node = black.node_tree.nodes.new("ShaderNodeOutputMaterial")
    e_node = black.node_tree.nodes.new("ShaderNodeEmission")
    e_node.inputs[0].default_value = (0, 0, 0, 1)
    black.node_tree.links.new(e_node.outputs[0], o_node.inputs[0])
    for o in meshes:
        for m in [x for x in o.modifiers if x.type == "SOLIDIFY" and x.name == "outline"]:
            o.modifiers.remove(m)
        o.data.materials.clear()
        o.data.materials.append(black)
        for p_ in o.data.polygons:
            p_.material_index = 0
else:
    bg.inputs[0].default_value = (0.84, 0.84, 0.89, 1)
    bg.inputs[1].default_value = 1.0
    sun.data.energy = 3.0
    sun.data.angle = 0.03
    sun.rotation_euler = (math.radians(33), 0, math.radians(-22))

for variable, material in (("SPICA_HOODIE", "hoodie"), ("SPICA_SOCK", "sock"), ("SPICA_SHORTS", "shorts")):  # tries colours without rebuilding: hoodie "lit,shade"; socks "top lit,top shade,end lit,end shade"
    if os.environ.get(variable):
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from palette import linear
        colours = os.environ[variable].split(",")
        nodes = bpy.data.materials[material].node_tree.nodes
        if len(colours) == 4:
            for tag, near, far in (("fade_lit", colours[0], colours[2]), ("fade_shade", colours[1], colours[3])):
                nodes[tag].inputs["A"].default_value = linear(near)
                nodes[tag].inputs["B"].default_value = linear(far)
        else:
            mix = next(n for n in nodes if n.type == "MIX" and not n.inputs["A"].is_linked and not n.inputs["B"].is_linked)
            mix.inputs["A"].default_value = linear(colours[1])
            mix.inputs["B"].default_value = linear(colours[0])

pts = []
for o in meshes:
    pts.extend(o.matrix_world @ Vector(c) for c in o.bound_box)
lo = Vector((min(p[i] for p in pts) for i in range(3)))
hi = Vector((max(p[i] for p in pts) for i in range(3)))
H = hi.z - lo.z

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.clip_end = 40
scene.collection.objects.link(cam)
scene.camera = cam


def extreme_hand():
    """Centre of her left hand (+x side), from the outermost vertices of the body."""
    body = next(o for o in meshes if o.name == "Body")
    v = [o for o in (body.matrix_world @ w.co for w in body.data.vertices) if o.x > hi.x - 0.17]
    n = len(v)
    return sum(v, Vector()) / n


def shot(name, az, centre, scale, w=700, h=1000, el=0, depth=40):
    a, e = math.radians(az), math.radians(el)
    d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.location = centre + d * 6
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    cam.data.ortho_scale = scale
    cam.data.clip_end = depth
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.filepath = os.path.join(out_dir, name + ".png")
    bpy.ops.render.render(write_still=True)


mid = Vector((0, -0.02, (lo.z + hi.z) / 2))
head = Vector((0, -0.03, hi.z - 0.13))
body_views = {"front": 0, "q": 32, "qr": -32, "side": 90, "back": 180}
head_views = {"head": 0, "headq": 35, "headr": -35, "headrs": -90, "headside": 90, "headback": 180}
face_views = {"face": 0, "faceq": 35}
wide_views = {"wide": 0, "widel": -35, "wides": -90, "wideb": 180}
torso_views = {"torso": 0, "torsoq": 35, "torsor": -35, "torsob": 180}
hip_views = {"hips": 0, "hipsq": 35, "hipss": 90, "hipsb": 180}
for n in names.split(","):
    if n in body_views:
        shot(n, body_views[n], mid, H * 1.06)
    elif n in head_views:
        shot(n, head_views[n], head, 0.42, 800, 800)
    elif n == "hand":
        c = extreme_hand()
        shot("hand", 90, c, 0.24, 800, 800, depth=6.1)
        shot("hand_side", 18, c, 0.24, 800, 800, depth=6.14)
    elif n in wide_views:
        shot(n, wide_views[n], Vector((0, -0.02, 1.40)), 0.78, 800, 800)
    elif n in hip_views:
        shot(n, hip_views[n], Vector((0, -0.02, 0.82)), 0.56, 800, 800)
    elif n in torso_views:
        shot(n, torso_views[n], Vector((0, -0.02, 1.08)), 0.86, 800, 800)
    elif n in face_views:
        shot(n, face_views[n], Vector((0, -0.05, 1.445)), 0.30, 900, 900)
    elif n == "ponytop":
        c = Vector((-0.13, 0.0, 1.55))
        shot("ponytop", 0, c, 0.26, 800, 800)
        shot("ponytop_q", -35, c, 0.26, 800, 800)
        shot("ponytop_s", -90, c, 0.26, 800, 800)
        shot("ponytop_b", 180, c, 0.26, 800, 800)
    elif n == "neck":
        c = Vector((0, -0.01, 1.335))
        shot("neck", 0, c, 0.15, 800, 800)
        shot("neck_q", 40, c, 0.15, 800, 800)
        shot("neck_side", 90, c, 0.15, 800, 800)
        shot("neck_back", 180, c, 0.15, 800, 800)
    elif n == "lower":
        c = Vector((0, -0.09, 1.385))
        shot("lower", 0, c, 0.13, 800, 800)
        shot("lower_side", 90, c, 0.13, 800, 800, depth=6.2)
    elif n == "legs":
        c = Vector((0, -0.03, 0.4))
        for name, az in (("legs", 0), ("legsq", 40), ("legss", 90), ("legsb", 180)):
            shot(name, az, c, 0.9, 800, 800)
    elif n == "foot":
        c = Vector((0.09, -0.05, 0.08))
        shot("foot", 40, c, 0.34, 800, 800, 15)
        shot("foots", 95, c, 0.34, 800, 800, 8)
        shot("footb", 215, c, 0.34, 800, 800, 22)
        shot("footp", 20, c, 0.34, 800, 800, 62)
