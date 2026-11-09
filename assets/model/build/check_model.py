"""
Is the model ready to be animated? A read-only check of assets/model/spica-v1.blend (it changes nothing in the file).
Run: blender -b assets/model/spica-v1.blend -P assets/model/build/check_model.py -- <out dir>
Prints lines starting with CHECK and writes pose renders (<pose>-front.png, <pose>-side.png) to the out dir.
Sections: structure, skinning (every vertex moved by bones that exist, at most 4 of them), the rest pose and animation data, the face's
shape keys, the binary star, a set of stress poses (arms up, arms forward, arms crossed, sit, lean, head turn, stride, twist) with
garment-inside-body counts, stretched edges and floating cloth, and a glTF export.
"""
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else "assets/model/renders/check")
os.makedirs(OUT, exist_ok=True)
sc = bpy.context.scene
arm = bpy.data.objects["Armature"]
BAD = []  # things that are wrong, for the summary
NOTES = []  # limits to know about, not blockers


def say(*a):
    print("CHECK", *a)


def note(msg):
    NOTES.append(msg)
    say("note:", msg)


def bad(msg):
    BAD.append(msg)
    say("PROBLEM:", msg)


meshes = [o for o in bpy.data.objects if o.type == "MESH"]
skinned = [o for o in meshes if any(m.type == "ARMATURE" for m in o.modifiers)]
garments = [bpy.data.objects[n] for n in ("hoodie", "hood", "shorts", "sneakers", "sock_l", "sock_r")]
hair = [o for o in meshes if o.name.startswith(("Hair0", "tuft_"))]
orbs = [bpy.data.objects[n] for n in ("orb_a", "orb_b")] if "orb_a" in bpy.data.objects else []

# ------------------------------------------------------------------ structure
say("== structure")
say("objects", len(bpy.data.objects), "meshes", len(meshes), "skinned meshes", len(skinned), "bones", len(arm.data.bones))
need = ["Root", "J_Bip_C_Hips", "J_Bip_C_Spine", "J_Bip_C_Chest", "J_Bip_C_UpperChest", "J_Bip_C_Neck", "J_Bip_C_Head"]
for side in "LR":
    need += ["J_Bip_%s_%s" % (side, b) for b in ("Shoulder", "UpperArm", "LowerArm", "Hand", "UpperLeg", "LowerLeg", "Foot", "ToeBase")]
    need += ["J_Bip_%s_%s%d" % (side, f, i) for f in ("Thumb", "Index", "Middle", "Ring", "Little") for i in (1, 2, 3)]
miss = [b for b in need if b not in arm.data.bones]
say("humanoid bones (spine, head, arms, legs, 15 finger bones a hand):", "all present" if not miss else "MISSING %s" % miss)
if miss:
    bad("missing humanoid bones %s" % miss)
say("armature transform:", "identity" if arm.matrix_world == Matrix.Identity(4) else "NOT identity")
off = [o.name for o in meshes if (o.scale - Vector((1, 1, 1))).length > 1e-4 or max(abs(a) for a in o.rotation_euler) > 1e-4]
say("mesh objects with scale or rotation not applied:", off or "none")
if off:
    bad("meshes with unapplied scale/rotation: %s" % off)
say("units", sc.unit_settings.scale_length, "fps", sc.render.fps, "frames", sc.frame_start, sc.frame_end)
orphans = {k: [x.name for x in getattr(bpy.data, k) if x.users == 0] for k in ("meshes", "materials", "images", "armatures")}
say("unused data blocks (they go away on save):", {k: len(v) for k, v in orphans.items()})
not_parented = [o.name for o in skinned if o.parent != arm]
say("skinned meshes not parented to the armature (they still deform through their modifier):", not_parented or "none")

# ------------------------------------------------------------------ skinning
say("== skinning")
deform = {b.name for b in arm.data.bones if b.use_deform}
worst = []
for o in skinned:
    names = {g.index: g.name for g in o.vertex_groups}
    me = o.data
    none = weak = many = 0
    for v in me.vertices:
        ws = [g.weight for g in v.groups if names[g.group] in deform and g.weight > 1e-4]
        s = sum(ws)
        if s < 0.01:
            none += 1
        elif s < 0.5:
            weak += 1
        if len(ws) > 4:
            many += 1
    dupes = [n for n in names.values() if n not in deform]
    if none or weak or many or dupes:
        worst.append((o.name, len(me.vertices), none, weak, many, len(dupes)))
for w in worst:
    say("%-12s verts %5d  no bone weight %4d  under half %4d  more than 4 bones %4d  vertex groups that match no bone %3d" % w)
for w in worst:
    if w[2]:
        bad("%s: %d of %d vertices have no weight on any bone of her skeleton (they will not move with her)" % (w[0], w[2], w[1]))
    if w[3]:
        bad("%s: %d vertices have under half their weight on bones of her skeleton" % (w[0], w[3]))
    if w[4]:
        bad("%s: %d vertices are weighted to more than 4 bones (glTF keeps 4)" % (w[0], w[4]))
if not worst:
    say("every skinned vertex has weight on her skeleton, at most 4 bones, no stray vertex groups")
mods_bad = [o.name for o in skinned if [m.type for m in o.modifiers][:1] != ["ARMATURE"] or any(m.type == "ARMATURE" and m.object != arm for m in o.modifiers)]
say("armature modifier first and pointing at her armature on every skinned mesh:", "yes" if not mods_bad else "NO: %s" % mods_bad)

# ------------------------------------------------------------------ rest pose, animation data, face, binary star
say("== rest pose and animation data")
act = arm.animation_data.action if arm.animation_data else None
arms = []
for side in "LR":
    pb = arm.pose.bones["J_Bip_%s_UpperArm" % side]
    arms.append(round(math.degrees((pb.matrix.to_3x3() @ pb.bone.matrix_local.to_3x3().inverted()).to_quaternion().angle), 1))
say("pose as loaded: upper arms lowered", arms, "degrees from the T-pose rest | action assigned:", act.name if act else None, "| actions in file:", [a.name for a in bpy.data.actions] or "none")
if not act or act.name != "A_pose":
    bad("no A_pose action: the pose the model was fitted in is not on record")
loose = [pb.name for pb in arm.pose.bones if not act and (abs(pb.rotation_quaternion[0]) < 0.999 or any(abs(x) > 1e-4 for x in pb.location))]
if loose:
    bad("pose transforms left on bones with no action: %s" % loose[:5])
say("bone constraints:", sum(len(pb.constraints) for pb in arm.pose.bones), "| drivers on:", [(o.name, len(o.animation_data.drivers)) for o in bpy.data.objects if o.animation_data and o.animation_data.drivers])
spring = [b.name for b in arm.data.bones if b.name.startswith("J_Sec_")]
say("secondary bones (hair, bust, coat skirt) present:", len(spring), "- no spring/physics data is in the file (the VRM spring-bone extension is not read), so they only move if animated")
face = bpy.data.objects["Face"]
keys = [k.name for k in face.data.shape_keys.key_blocks] if face.data.shape_keys else []
want = ["Fcl_ALL_Neutral", "Fcl_ALL_Joy", "Fcl_ALL_Sorrow", "Fcl_ALL_Angry", "Fcl_ALL_Surprised", "Fcl_EYE_Close", "Fcl_MTH_A", "Fcl_MTH_I", "Fcl_MTH_U", "Fcl_MTH_E", "Fcl_MTH_O", "Fcl_MTH_Small"]
say("face shape keys:", len(keys), "| the expression and mouth ones a performance needs:", "all present" if all(k in keys for k in want) else "MISSING %s" % [k for k in want if k not in keys])
if not all(k in keys for k in want):
    bad("face shape keys missing: %s" % [k for k in want if k not in keys])
for n in ("J_Adj_L_FaceEye", "J_Adj_R_FaceEye"):
    say("eye bone", n, "present" if n in arm.data.bones else "MISSING")
if orbs:
    pl, sp = bpy.data.objects["orbit_placer"], bpy.data.objects["orbit_spin"]
    say("binary star: placer on bone", pl.parent_bone, "| spin driver:", bool(sp.animation_data and len(sp.animation_data.drivers)), "| orbs", [o.name for o in orbs])

# ------------------------------------------------------------------ stress poses
say("== stress poses")
for o in meshes:  # no outline shells while measuring (they are shells of the same surface)
    for m in o.modifiers:
        if m.type == "SOLIDIFY":
            m.show_viewport = False
if arm.animation_data:
    arm.animation_data.action = None


def reset():
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def turn(bone, axis, deg):
    """Rotate a pose bone about a world axis through its head."""
    pb = arm.pose.bones[bone]
    head = arm.matrix_world @ pb.head
    rot = Matrix.Translation(head) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-head)
    pb.matrix = arm.matrix_world.inverted() @ rot @ arm.matrix_world @ pb.matrix
    bpy.context.view_layer.update()


def B(side, name):
    return "J_Bip_%s_%s" % (side, name)


POSES = {
    "rest": [],
    "a_pose": [(B("L", "UpperArm"), "Y", 48), (B("R", "UpperArm"), "Y", -48)],
    "arms_up": [(B("L", "UpperArm"), "Y", -60), (B("R", "UpperArm"), "Y", 60), (B("L", "LowerArm"), "Y", -30), (B("R", "LowerArm"), "Y", 30)],
    "arms_forward": [(B("L", "UpperArm"), "Z", -80), (B("R", "UpperArm"), "Z", 80)],
    "arms_crossed": [(B("L", "UpperArm"), "Y", 25), (B("R", "UpperArm"), "Y", -25), (B("L", "UpperArm"), "Z", -65), (B("R", "UpperArm"), "Z", 65), (B("L", "LowerArm"), "Z", -100), (B("R", "LowerArm"), "Z", 100)],
    "sit": [(B("L", "UpperLeg"), "X", -90), (B("R", "UpperLeg"), "X", -90), (B("L", "LowerLeg"), "X", 90), (B("R", "LowerLeg"), "X", 90), (B("L", "UpperArm"), "Y", 48), (B("R", "UpperArm"), "Y", -48)],
    "lean": [("J_Bip_C_Spine", "X", 20), ("J_Bip_C_Chest", "X", 15), ("J_Bip_C_UpperChest", "X", 10), ("J_Bip_C_Neck", "X", 10), (B("L", "UpperArm"), "Y", 48), (B("R", "UpperArm"), "Y", -48)],
    "head_turn": [("J_Bip_C_Neck", "Z", 15), ("J_Bip_C_Head", "Z", 40), ("J_Bip_C_Head", "X", 20), ("J_Bip_C_Head", "Y", 15), (B("L", "UpperArm"), "Y", 48), (B("R", "UpperArm"), "Y", -48)],
    "stride": [(B("L", "UpperLeg"), "X", -35), (B("R", "UpperLeg"), "X", 25), (B("L", "LowerLeg"), "X", 20), (B("R", "LowerLeg"), "X", 40), (B("L", "UpperArm"), "Y", 48), (B("R", "UpperArm"), "Y", -48), (B("L", "UpperArm"), "Z", 25), (B("R", "UpperArm"), "Z", 25)],
    "twist": [("J_Bip_C_Spine", "Z", 25), ("J_Bip_C_Chest", "Z", 20), ("J_Bip_C_UpperChest", "Z", 15), (B("L", "UpperArm"), "Y", 48), (B("R", "UpperArm"), "Y", -48)],
}


def world_mesh(o, dg):
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    P = np.array([(o.matrix_world @ v.co)[:] for v in me.vertices]) if len(me.vertices) else np.zeros((0, 3))
    me.calc_loop_triangles()
    T = np.array([t.vertices[:] for t in me.loop_triangles]) if len(me.loop_triangles) else np.zeros((0, 3), int)
    E = np.array([e.vertices[:] for e in me.edges]) if len(me.edges) else np.zeros((0, 2), int)
    ev.to_mesh_clear()
    return P, T, E


def bvh_of(objs, dg):
    verts, tris = [], []
    for o in objs:
        P, T, _ = world_mesh(o, dg)
        verts += [Vector(p) for p in P]
        tris += [tuple(int(k) + len(verts) - len(P) for k in t) for t in T]
    return BVHTree.FromPolygons(verts, tris)


def inside_count(P, tree, tol=-0.0005):
    n, dmin, far = 0, 1.0, 0.0
    for p in P:
        loc, nrm, idx, d = tree.find_nearest(Vector(p))
        if loc is None:
            continue
        s = (Vector(p) - loc).dot(nrm)
        if s < tol:
            n += 1
        dmin = min(dmin, s)
        far = max(far, d)
    return n, dmin, far


skin_objs = [bpy.data.objects["Body"], bpy.data.objects["Face"]]
rest_edges = {}
rest_far = {}
results = {}
dg = bpy.context.evaluated_depsgraph_get()
for pose, ops in POSES.items():
    reset()
    for bone, axis, deg in ops:
        turn(bone, axis, deg)
    dg = bpy.context.evaluated_depsgraph_get()
    body_tree = bvh_of(skin_objs, dg)
    row = {}
    for g in garments:
        P, T, E = world_mesh(g, dg)
        n, dmin, far = inside_count(P, body_tree)
        L = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1) if len(E) else np.zeros(0)
        if pose == "rest":
            rest_edges[g.name] = L
            rest_far[g.name] = far
        ratio = L / np.maximum(rest_edges[g.name], 1e-5)
        ok = rest_edges[g.name] > 0.004  # slivers a few mm long would dominate the ratio
        row[g.name] = (n, dmin, far, float(np.max(ratio[ok])) if ok.any() else 1.0, float(np.percentile(ratio[ok], 99.9)) if ok.any() else 1.0)
    # hair cards inside her body (shoulders, neck)
    hn = 0
    for h in hair:
        P, _, _ = world_mesh(h, dg)
        hn += inside_count(P, body_tree, tol=-0.001)[0]
    row["_hair_inside_body"] = hn
    # the binary star keeps clear of her
    if orbs:
        solid = bvh_of(skin_objs + hair + [bpy.data.objects["hood"], bpy.data.objects["hoodie"]], dg)
        dm = 9.0
        for o, rad in ((orbs[0], 0.016), (orbs[1], 0.012)):
            c = o.evaluated_get(dg).matrix_world.translation
            dm = min(dm, solid.find_nearest(c)[3] - rad)
        row["_orb_clearance"] = dm
    results[pose] = row
    flagged, notes = [], []
    for g in garments:
        n, dmin, far, mx, p999 = row[g.name]
        base = results["rest"][g.name][0] if pose != "rest" else 0
        pct = 100.0 * (n - base) / len(g.data.vertices)
        if pct > 10:
            flagged.append("%s: %.0f%% of its vertices are inside her body" % (g.name, pct))
        elif pct > 1:
            notes.append("%s: %.1f%% of its vertices (%d) are inside her body (the compressed side of a bend)" % (g.name, pct, n - base))
        if mx > 6.0:
            flagged.append("%s: an edge of 4 mm or more is stretched x%.1f" % (g.name, mx))
        elif mx > 3.0:
            notes.append("%s: an edge of 4 mm or more is stretched x%.1f" % (g.name, mx))
        if far > rest_far[g.name] + 0.06:
            flagged.append("%s: %.0f cm from her skin (%.0f at rest)" % (g.name, far * 100, rest_far[g.name] * 100))
    if row["_hair_inside_body"] > results["rest"]["_hair_inside_body"] + 40:
        flagged.append("hair inside body %d (rest %d)" % (row["_hair_inside_body"], results["rest"]["_hair_inside_body"]))
    if orbs and row["_orb_clearance"] < 0.01:
        flagged.append("binary star %.1f cm from her" % (row["_orb_clearance"] * 100))
    say("%-13s garment verts inside body: %s | max edge stretch: %s | hair in body %d%s" % (
        pose,
        " ".join("%s %d" % (g.name, row[g.name][0]) for g in garments),
        " ".join("%.2f" % row[g.name][3] for g in garments),
        row["_hair_inside_body"],
        (" | orb gap %.1f cm" % (row["_orb_clearance"] * 100)) if orbs else ""))
    for f in flagged:
        bad("pose %s: %s" % (pose, f))
    for f in notes:
        note("pose %s: %s" % (pose, f))

# ------------------------------------------------------------------ pose renders
say("== pose renders")
for _l in [o for o in bpy.data.objects if o.type == "LIGHT"]:
    bpy.data.objects.remove(_l)
for o in meshes:
    for m in o.modifiers:
        if m.type == "SOLIDIFY":
            m.show_viewport = True
sc.render.engine = "BLENDER_EEVEE"
sc.eevee.taa_render_samples = 16
sc.render.film_transparent = True
sc.render.resolution_x, sc.render.resolution_y = 760, 900
sc.view_settings.view_transform = "Standard"
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.30, 0.31, 0.36, 1)
sc.world = world
rig = bpy.data.objects.new("rig", None)
rig.location = (0, 0, 0.95)
sc.collection.objects.link(rig)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = 2.15
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
for pose, ops in POSES.items():
    reset()
    for bone, axis, deg in ops:
        turn(bone, axis, deg)
    for view, ang in (("front", 0), ("side", 90)):
        rig.rotation_euler = (0, 0, math.radians(ang))
        sc.render.filepath = os.path.join(OUT, "%s-%s.png" % (pose, view))
        bpy.ops.render.render(write_still=True)
say("rendered", len(POSES) * 2, "images to", OUT)
reset()

# ------------------------------------------------------------------ glTF export
say("== glTF export")
path = os.path.join(OUT, "spica-check.glb")
try:
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=False, export_apply=False, export_animations=False)
    say("export ok:", os.path.getsize(path) // 1024, "KB (toon shader nodes do not export to glTF; the engine renders sprites from Blender, so this is only a structure test)")
except Exception as e:  # noqa: BLE001
    bad("glTF export failed: %s" % str(e)[:200])

say("== summary")
say("%d problem(s), %d note(s)" % (len(BAD), len(NOTES)))
for b in BAD:
    say(" PROBLEM -", b)
for b in NOTES:
    say(" note -", b)
