"""
Does the secondary motion (spring.py) hold up? A read-only test of assets/model/spica-v1.blend.
Run: blender -b assets/model/spica-v1.blend -P assets/model/build/spring_check.py -- <out dir>
Prints lines starting with SPRING and renders the biggest swing of each scenario (rigid | sprung) to the out dir.
Checks: which meshes the secondary bones move; per scenario (head shake, nod, jump, spine twist): bone lengths stay,
no NaN, swing angle stays sane, it settles after the motion stops, hair cards do not go into her body / hood / hoodie
more than they do rigid, the bun and the hood do not move, baking twice gives the same keys.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import spring  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "assets/model/renders/spring")
os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene
arm = bpy.data.objects["Armature"]
BAD = []


def say(*a):
    print("SPRING", *a)


def bad(m):
    BAD.append(m)
    say("PROBLEM", m)


meshes = [o for o in bpy.data.objects if o.type == "MESH"]
hair = [o for o in meshes if o.name.startswith("Hair")]
skin = [bpy.data.objects["Body"], bpy.data.objects["Face"]]
solid = skin + [bpy.data.objects["hood"], bpy.data.objects["hoodie"]]
for o in meshes:  # outline shells are copies of the same surface
    for m in o.modifiers:
        if m.type == "SOLIDIFY":
            m.show_viewport = False

# ---------------------------------------------------------------- 1. what the secondary bones move
sec = {b.name for b in arm.data.bones if b.name.startswith("J_Sec")}
say("== weights")
for o in meshes:
    names = {vg.index: vg.name for vg in o.vertex_groups}
    n = sum(1 for v in o.data.vertices if any(names.get(g.group) in sec and g.weight > 0.01 for g in v.groups))
    if n:
        say("%-10s %5d of %5d vertices on secondary bones" % (o.name, n, len(o.data.vertices)))
moving = {b.name for c, _ in spring.chains(arm) for b in c}
for o in meshes:  # the bun, hood, shorts, shoes and socks must not be on a bone that moves
    if o.name == "hood" or o.name.startswith(("tuft", "shorts", "sneakers", "sock")):
        names = {vg.index: vg.name for vg in o.vertex_groups}
        n = sum(1 for v in o.data.vertices if any(names.get(g.group) in moving and g.weight > 0.01 for g in v.groups))
        if n:
            bad("%s has %d vertices on bones that move (should be rigid)" % (o.name, n))
    if o.name == "hoodie":  # the hoodie rides the bust bones on purpose
        names = {vg.index: vg.name for vg in o.vertex_groups}
        if any(names.get(g.group, "").startswith("J_Sec_Hair") for v in o.data.vertices for g in v.groups):
            bad("the hoodie is weighted to a hair bone")
used = {vg.name for o in meshes for vg in o.vertex_groups}
chain_bones = [b for c, _ in spring.chains(arm) for b in c]
dead = [b.name for b in chain_bones if b.name not in used]
say("chain bones", len(chain_bones), "| not weighted by any mesh (cannot show):", len(dead), dead[:6])
if len(dead) == len(chain_bones):
    bad("no mesh uses any chain bone, the bake would show nothing")


# ---------------------------------------------------------------- 2. scenarios
def key(bone, frame, rot=None, loc=None):
    pb = arm.pose.bones[bone]
    if rot is not None:
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = [math.radians(a) for a in rot]
        pb.keyframe_insert("rotation_euler", frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=frame)


def clear():
    arm.animation_data_clear()
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.location = (0, 0, 0)


def shake(bone, axis, deg, period, until):
    for f in range(1, until + 1, period // 2):
        s = 1 if (f // (period // 2)) % 2 == 0 else -1
        r = [0, 0, 0]
        r[axis] = s * deg
        key(bone, f, rot=r)
    key(bone, until + 1, rot=(0, 0, 0))


SCEN = {
    "head_shake": lambda: shake("J_Bip_C_Head", 2, 35, 12, 36),   # fast yaw, 6 frames a side
    "nod": lambda: shake("J_Bip_C_Head", 0, 20, 12, 36),
    "jump": lambda: [key("J_Bip_C_Hips", f, loc=(0, 0, z)) for f, z in ((1, 0), (6, 0.12), (12, 0), (13, 0))],
    "twist": lambda: shake("J_Bip_C_Spine", 2, 30, 14, 42),
}
END = 90


def world_P(o, dg):
    me = o.evaluated_get(dg).to_mesh()
    P = np.array([(o.matrix_world @ v.co)[:] for v in me.vertices]).reshape(-1, 3)
    o.evaluated_get(dg).to_mesh_clear()
    return P


def solid_tree(dg):
    verts, tris = [], []
    for o in solid:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        base = len(verts)
        verts += [o.matrix_world @ v.co for v in me.vertices]
        tris += [tuple(base + k for k in t.vertices) for t in me.loop_triangles]
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, tris)


def hair_inside(dg):
    tree, n = solid_tree(dg), 0
    for h in hair:
        for p in world_P(h, dg):
            loc, nrm, _, _ = tree.find_nearest(Vector(p))
            if loc is not None and (Vector(p) - loc).dot(nrm) < -0.001:
                n += 1
    return n


def tips():
    return {b.name: (arm.matrix_world @ arm.pose.bones[b.name].tail).copy() for b in chain_bones}


def sample(frames):
    out = {}
    for f in frames:
        sc.frame_set(f)
        bpy.context.view_layer.update()
        out[f] = tips()
    return out


say("== scenarios")
sc.frame_start, sc.frame_end = 1, END
peaks = {}
for name, make in SCEN.items():
    clear()
    make()
    rigid = sample(range(1, END + 1))
    rigid_in = {f: None for f in range(1, END + 1, 4)}
    for f in rigid_in:
        sc.frame_set(f)
        rigid_in[f] = hair_inside(bpy.context.evaluated_depsgraph_get())
    spring.bake(arm, 1, END)
    sprung = sample(range(1, END + 1))
    # lengths and NaN
    worst = 0.0
    sc.frame_set(END // 2)
    bpy.context.view_layer.update()
    for b in chain_bones:
        pb = arm.pose.bones[b.name]
        worst = max(worst, abs((pb.tail - pb.head).length - b.length))
    allv = [v for fr in sprung.values() for v in fr.values()]
    if any(math.isnan(c) for v in allv for c in v):
        bad("%s: NaN in the sprung tips" % name)
    # swing = distance between sprung and rigid tip
    dev = {f: max((sprung[f][k] - rigid[f][k]).length for k in rigid[f]) for f in rigid}
    pf = max(dev, key=dev.get)
    peaks[name] = pf
    stop = {"head_shake": 37, "nod": 37, "jump": 13, "twist": 43}[name]
    say("%-10s tip lag in mm every 5 frames: %s" % (name, " ".join("%.0f" % (dev[f] * 1000) for f in range(1, END + 1, 5))))
    settle = next((f for f in range(stop, END + 1) if all(dev[g] < 0.005 for g in range(f, END + 1))), None)
    say("%-10s max tip lag %.1f cm at frame %d | length error %.2f mm | settled to <5 mm at frame %s (motion stops %d)" % (
        name, dev[pf] * 100, pf, worst * 1000, settle, stop))
    if worst > 0.0005:
        bad("%s: a chain bone changed length by %.2f mm" % (name, worst * 1000))
    if dev[pf] > 0.15:
        bad("%s: a hair tip lags %.1f cm behind (too wild)" % (name, dev[pf] * 100))
    if dev[pf] < 0.003:
        bad("%s: no visible lag (%.1f mm)" % (name, dev[pf] * 1000))
    if settle is None or settle - stop > 45:
        bad("%s: does not settle within 45 frames of the motion stopping" % name)
    # collisions: sprung vs rigid at the sampled frames
    extra = []
    for f in rigid_in:
        sc.frame_set(f)
        extra.append(hair_inside(bpy.context.evaluated_depsgraph_get()) - rigid_in[f])
    say("%-10s hair vertices inside her/hood/hoodie, sprung minus rigid: max %d, mean %.1f" % (name, max(extra), sum(extra) / len(extra)))
    nh = sum(len(h.data.vertices) for h in hair)
    if max(extra) > 0.03 * nh:
        bad("%s: swinging hair goes into her body or clothes (%d more vertices than rigid, %.1f%% of the hair)" % (name, max(extra), 100.0 * max(extra) / nh))
    # baking twice must give the same result
    keys1 = {(fc.data_path, fc.array_index): [round(k.co[1], 5) for k in fc.keyframe_points]
             for fc in arm.animation_data.action.layers[0].strips[0].channelbag(arm.animation_data.action_slot).fcurves}
    spring.bake(arm, 1, END)
    keys2 = {(fc.data_path, fc.array_index): [round(k.co[1], 5) for k in fc.keyframe_points]
             for fc in arm.animation_data.action.layers[0].strips[0].channelbag(arm.animation_data.action_slot).fcurves}
    if keys1 != keys2:
        bad("%s: baking twice changes the keys" % name)
    # leave the peak frame in the sprung state for the render below
    SCEN[name] = (make, pf)

# ---------------------------------------------------------------- 3. renders: rigid | sprung at each peak
say("== renders")
for _l in [o for o in bpy.data.objects if o.type == "LIGHT"]:
    bpy.data.objects.remove(_l)
for o in meshes:
    for m in o.modifiers:
        if m.type == "SOLIDIFY":
            m.show_viewport = True
sc.render.engine = "BLENDER_EEVEE"
sc.eevee.taa_render_samples = 16
sc.render.film_transparent = True
sc.render.resolution_x, sc.render.resolution_y = 700, 700
sc.view_settings.view_transform = "Standard"
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.30, 0.31, 0.36, 1)
sc.world = world
rig = bpy.data.objects.new("rig", None)
rig.location = (0, 0, 1.35)
sc.collection.objects.link(rig)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = 0.8
cam.location = (0, -6, 0)
cam.rotation_euler = (math.radians(90), 0, 0)
cam.parent = rig
sc.collection.objects.link(cam)
sc.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = math.pi
sun.rotation_euler = (-Vector((0.45, 0.65, -0.85)).normalized()).to_track_quat("Z", "Y").to_euler()
sun.parent = rig
sc.collection.objects.link(sun)
for name, (make, pf) in SCEN.items():
    for tag in ("rigid", "sprung"):
        clear()
        make()
        if tag == "sprung":
            spring.bake(arm, 1, END)
        sc.frame_set(pf)
        for ang in (35, 145):
            rig.rotation_euler = (0, 0, math.radians(ang))
            sc.render.filepath = os.path.join(OUT, "%s-f%d-%s-%d.png" % (name, pf, tag, ang))
            bpy.ops.render.render(write_still=True)
say("rendered to", OUT)
say("%d problems" % len(BAD))
for m in BAD:
    say("  -", m)
