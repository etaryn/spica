# Makes her hoodie respond to her arms. Runs on spica-v2-tpose.blend and saves spica-v2-drape.blend.
# One cloth simulation per key arm position, from her T-pose rest, is stored as shape keys that blend in by the arm's angle.
# Then the skin hidden under the hoodie is removed: the simulation needed her whole body to collide with.
import os
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import body as bd
import rig
import rig_poses as rp

KEYS = ("arms_forward", "arms_up", "arms_overhead")  # her resting pose has its own shape, made by tpose.py
MOVE_UNTIL, SETTLE_UNTIL = 40, 100  # frames: the arms reach the pose, then the cloth comes to rest
BLEND_REACH = 0.9  # radians: how far from a key position its shape fades to nothing
FREE_ABOVE = 1.05  # the body of the hoodie is pinned below this height
SLEEVE_PIN_X = 0.33  # and the sleeve from about her elbow out
PIN_SOFT = 6  # rounds of blur on the edge of what is pinned
LEAST_STRETCH = 0.5  # the blended bones are never treated as squashing cloth more than this
CACHE = os.environ.get("SPICA_DRAPE_CACHE")  # a folder: keeps each simulation, for tuning what follows it without the nine-minute wait
ARMPIT_X, ARMPIT_Z, ARMPIT_EASE = (0.07, 0.20), (1.04, 1.34), 0.02  # round her armpit, in her rest pose, and how softly the smoothing fades out
LINE_Z, LINE_FADE = (1.13, 1.34), 0.02  # the height of her armpit, and how softly the outline returns below it
LINE_ANGLE, LINE_GROW, LINE_SOFT = np.radians(45), 1, 2  # how sharp a fold counts as a crease; how far round it the outline goes; how softly it comes back
ARMPIT_ROUNDS = 14  # how many rounds of smoothing along the cloth
SHAPE_BLUR = 0.022  # how widely each stored shape is blurred
SPLIT = 0.03  # either side of her middle, a shape fades from one arm's to the other's
SHOULDER, UPPER = "J_Bip_%s_Shoulder", "J_Bip_%s_UpperArm"


def add_key_bones(arm):
    """One bone for each key arm position, held in that position relative to the shoulder, for the shape blending to measure against."""
    held = {}
    for pose in KEYS:
        rp.apply(arm, pose)
        bpy.context.view_layer.update()
        for side in "LR":
            shoulder, upper = arm.pose.bones[SHOULDER % side], arm.pose.bones[UPPER % side]
            held[side, pose] = shoulder.bone.matrix_local @ shoulder.matrix.inverted() @ upper.matrix
    rp.reset(arm)
    bpy.context.view_layer.update()
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for (side, pose), matrix in held.items():
        e = arm.data.edit_bones.new(key_bone(side, pose))
        e.length = 0.1
        e.matrix = Matrix.Translation(arm.data.edit_bones[UPPER % side].head - matrix.translation) @ matrix
        e.parent = arm.data.edit_bones[SHOULDER % side]
        e.use_deform = False
    bpy.ops.object.mode_set(mode="OBJECT")


def key_bone(side, pose):
    return "Drv_%s_%s" % (side, pose)


def pin_weights(hoodie, points, edges):
    flag = np.empty(len(points), np.float32)
    hoodie.data.attributes["arm"].data.foreach_get("value", flag)
    sleeve = flag > 0.5
    x, y, z = points[:, 0], points[:, 1], points[:, 2]
    hood = (y > 0.02) & (z > 1.16) | (z > 1.26) & (np.abs(x) < 0.10)
    zip_band = (np.abs(x) < 0.05) & (y < 0)
    pinned = (~sleeve & ((z < FREE_ABOVE) | hood | zip_band)) | (sleeve & (np.abs(x) > SLEEVE_PIN_X))  # nothing holds a free sleeve to her forearm: it falls off the arm
    return np.clip(bm.smooth_field(pinned.astype(float), edges, np.ones(len(points), bool), PIN_SOFT), 0, 1), sleeve


def drop_action(arm):
    """Only the keys: clearing the animation data would also take any drivers."""
    if arm.animation_data:
        arm.animation_data.action = None


def key_pose(arm, pose):
    """Her arms move from rest into the pose, then hold."""
    drop_action(arm)
    bones = sorted({b for b, _, _ in rp.POSES[pose]})
    rp.reset(arm)
    bpy.context.scene.frame_set(1)
    for name in bones:
        arm.pose.bones[name].keyframe_insert("rotation_quaternion", frame=1)
    rp.apply(arm, pose)
    for name in bones:
        arm.pose.bones[name].keyframe_insert("rotation_quaternion", frame=MOVE_UNTIL)
        arm.pose.bones[name].keyframe_insert("rotation_quaternion", frame=SETTLE_UNTIL)


def simulate(arm, hoodie, pin, pose):
    """The hoodie as cloth, followed through the move. Returns its points at the end, and the bones' deformation at that moment."""
    scene = bpy.context.scene
    sim = hoodie.copy()
    sim.data = hoodie.data.copy()
    sim.name = "drape_sim"
    scene.collection.objects.link(sim)
    for m in [m for m in sim.modifiers if m.type != "ARMATURE"]:
        sim.modifiers.remove(m)
    group = sim.vertex_groups.new(name="drape_pin")
    for i, weight in enumerate(pin.tolist()):
        group.add([i], weight, "REPLACE")
    cloth = sim.modifiers.new("drape", "CLOTH")
    s = cloth.settings
    s.quality, s.mass, s.air_damping = 8, 0.2, 2.0
    s.tension_stiffness, s.compression_stiffness, s.shear_stiffness, s.bending_stiffness = 15.0, 15.0, 5.0, 1.0
    s.vertex_group_mass = group.name
    s.pin_stiffness = 1.0
    c = cloth.collision_settings
    c.use_collision, c.collision_quality, c.distance_min = True, 4, 0.006
    cloth.point_cache.frame_start, cloth.point_cache.frame_end = 1, SETTLE_UNTIL
    key_pose(arm, pose)
    scene.frame_start, scene.frame_end = 1, SETTLE_UNTIL
    for f in range(1, SETTLE_UNTIL + 1):
        scene.frame_set(f)
    bpy.context.view_layer.update()
    ev = sim.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    ev.to_mesh_clear()
    deform = {b.name: np.array(b.matrix @ b.bone.matrix_local.inverted()) for b in arm.pose.bones}
    mesh = sim.data
    bpy.data.objects.remove(sim)
    bpy.data.meshes.remove(mesh)
    return a.reshape(-1, 3), deform


def blended_bones(hoodie, deform):
    """Each point's blend of its bones' movements, as one matrix per point."""
    names = {g.index: g.name for g in hoodie.vertex_groups}
    out = np.zeros((len(hoodie.data.vertices), 4, 4))
    for v in hoodie.data.vertices:
        total = 0.0
        for g in v.groups:
            if names[g.group] in deform:
                out[v.index] += deform[names[g.group]] * g.weight
                total += g.weight
        out[v.index] /= total
    return out


def skinned(blend, points):
    return (blend[:, :3, :3] @ points[:, :, None])[:, :, 0] + blend[:, :3, 3]


def rest_change(blend, points, posed):
    """How far each point must move before the armature so that it lands on `posed`. A shape key sits before the armature.
    Where bones have turned far apart their blend nearly collapses and an exact inverse would be huge, so its stretch is limited."""
    u, size, vt = np.linalg.svd(blend[:, :3, :3])
    away = ((posed - skinned(blend, points))[:, None, :] @ u)[:, 0, :]
    return (np.swapaxes(vt, 1, 2) @ (away / np.maximum(size, LEAST_STRETCH))[:, :, None])[:, :, 0]


def smooth_armpits(blend, points, move, pin, edges):
    """Rounds the hard edges round her armpits, along the cloth's own surface. Done with her arms in the pose, because the edges are made by the pose."""
    side, height = np.abs(points[:, 0]), points[:, 2]
    fade = bd.smoothstep(ARMPIT_X[0], ARMPIT_X[0] + ARMPIT_EASE, side) * (1 - bd.smoothstep(ARMPIT_X[1] - ARMPIT_EASE, ARMPIT_X[1], side))
    fade *= bd.smoothstep(ARMPIT_Z[0], ARMPIT_Z[0] + ARMPIT_EASE, height) * (1 - bd.smoothstep(ARMPIT_Z[1] - ARMPIT_EASE, ARMPIT_Z[1], height)) * (1 - pin)
    zone = fade > 0.001
    now = skinned(blend, points + move)
    smoothed = bm.smooth_field(now, edges, zone, ARMPIT_ROUNDS)
    return move + rest_change(blend, points + move, now + (smoothed - now) * fade[:, None])


def face_normals(points, faces):
    out = np.zeros((len(faces), 3))
    for i, f in enumerate(faces):
        a, b = points[f[2]] - points[f[0]], points[f[-1]] - points[f[1]]
        n = np.cross(a, b)
        out[i] = n / max(np.linalg.norm(n), 1e-12)
    return out


def quiet_armpit_lines(hoodie, points, moves, blends, pin, edges):
    """Thins the drawn outline where the armpit still creases with her arms moved. The creases are found from the arm shapes themselves."""
    side, height = np.abs(points[:, 0]), points[:, 2]
    zone = (side > ARMPIT_X[0]) & (side < ARMPIT_X[1]) & (height > LINE_Z[0]) & (height < LINE_Z[1]) & (pin < 0.5)  # below this it is the side of her body, which keeps its outline
    faces = [list(f.vertices) for f in hoodie.data.polygons]
    faces_of = {}
    for i, f in enumerate(hoodie.data.polygons):
        for key in f.edge_keys:
            faces_of.setdefault(key, []).append(i)
    shared = [(key, fs) for key, fs in faces_of.items() if len(fs) == 2 and zone[key[0]] and zone[key[1]]]
    keys, pairs = np.array([k for k, _ in shared]), np.array([fs for _, fs in shared])
    creased = np.zeros(len(points), bool)
    for pose, move in moves.items():
        n = face_normals(skinned(blends[pose], points + move), faces)
        sharp = np.arccos(np.clip((n[pairs[:, 0]] * n[pairs[:, 1]]).sum(1), -1, 1)) > LINE_ANGLE
        creased[keys[sharp].ravel()] = True
    thin = np.clip(bm.smooth_field(bm.grow(creased, edges, LINE_GROW).astype(float), edges, np.ones(len(points), bool), LINE_SOFT) * 2, 0, 1) * bd.smoothstep(LINE_Z[0] - LINE_FADE, LINE_Z[0], height)
    group = hoodie.vertex_groups["outline_w"]
    changed = 0
    for i in np.where(thin > 0.01)[0]:
        for g in hoodie.data.vertices[int(i)].groups:
            if g.group == group.index:
                group.add([int(i)], g.weight * (1 - float(thin[i])), "REPLACE")
                changed += 1
    print("DRAPE outline thinned at", changed, "points;", int(creased.sum()), "crease points")


def add_shapes(arm, hoodie, moves, points):
    if not hoodie.data.shape_keys:
        hoodie.shape_key_add(name="Basis", from_mix=False)
    left = bd.smoothstep(-SPLIT, SPLIT, points[:, 0])[:, None]
    for pose, change in moves.items():
        for side, share in (("L", left), ("R", 1 - left)):
            key = hoodie.shape_key_add(name="cloth_%s_%s" % (side, pose), from_mix=False)
            key.value = 0.0
            key.data.foreach_set("co", (points + change * share).astype(np.float32).ravel())
            driver = key.driver_add("value").driver
            driver.type = "SCRIPTED"
            letters = dict(zip(KEYS, "abcd"))
            for other, letter in letters.items():
                var = driver.variables.new()
                var.name = letter
                var.type = "ROTATION_DIFF"
                var.targets[0].id, var.targets[0].bone_target = arm, UPPER % side
                var.targets[1].id, var.targets[1].bone_target = arm, key_bone(side, other)
            near = "max(0,1-%%s/%.2f)" % BLEND_REACH
            sharp = lambda letter: "pow(%s,4)" % (near % letter)
            # Sharpened and shared out so neighbouring positions don't dilute each other; the total fades to nothing away from every position.
            driver.expression = "%s/(%s+.0001)*min(1,%s)" % (sharp(letters[pose]), "+".join(sharp(v) for v in letters.values()), "+".join(near % v for v in letters.values()))
            assert len(driver.expression) < 256, "a driver expression is limited to 256 characters"


def main():
    arm, hoodie, body = bpy.data.objects["Armature"], bpy.data.objects["hoodie"], bpy.data.objects["Body"]
    points = bm.get_co(hoodie)
    edges = bm.edges_of(hoodie)
    pin, _ = pin_weights(hoodie, points, edges)
    add_key_bones(arm)
    outline = [m for m in body.modifiers if m.type == "SOLIDIFY"]
    for m in outline:
        m.show_viewport = False
    body.modifiers.new("drape_collide", "COLLISION")
    body.collision.thickness_outer = 0.005
    moves, blends = {}, {}
    for pose in KEYS:
        stored = CACHE and Path(CACHE) / (pose + ".npz")
        if stored and stored.exists():
            saved = np.load(stored, allow_pickle=True)
            posed, deform = saved["posed"], saved["deform"].item()
        else:
            posed, deform = simulate(arm, hoodie, pin, pose)
            if stored:
                np.savez(stored, posed=posed, deform=deform)
        assert np.isfinite(posed).all(), pose + ": the simulation came apart"
        blend = blends[pose] = blended_bones(hoodie, deform)
        change = rest_change(blend, points, posed) * (1 - pin)[:, None]
        change = bm.spread(points, change, pin < 1, SHAPE_BLUR)  # the simulation's fine crumples are noise; the broad shape is what is kept
        moves[pose] = smooth_armpits(blend, points, change, pin, edges)
        print("DRAPE", pose, "moved up to", round(float(np.linalg.norm(moves[pose], axis=1).max()), 3))
    drop_action(arm)
    rp.reset(arm)
    body.modifiers.remove(body.modifiers["drape_collide"])
    for m in outline:
        m.show_viewport = True
    bpy.context.scene.frame_set(1)
    add_shapes(arm, hoodie, moves, points)
    quiet_armpit_lines(hoodie, points, moves, blends, pin, edges)
    rig.delete_faces(body, list(body["hidden_faces"]))
    del body["hidden_faces"]
    bpy.ops.wm.save_as_mainfile(filepath=str(bm.ROOT / "spica-v2-drape.blend"))


if __name__ == "__main__":
    main()
