# Binds her in a T-pose and keeps her approved arms-down look as a pose. Runs on spica-v2-accents.blend, saves spica-v2-tpose.blend.
# The dressed arms-down model is what Ethan approved. Her body is swapped for the T-pose build, point for point, and her clothes are carried up with the bones.
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import body as bd
import drape
import rig
import rig_poses as rp

PIVOT_X = 0.1105  # directly above her armpit
COLLAR_X = 0.025  # the inner end of the collarbone, beside her sternum
RESTING_LIFT = 0.025  # with her arms down her shoulder sits this much above the base body
DOWN_PIVOT_X = 0.119  # where the pivot goes with her arms down, so her shoulders keep their width
CARRIED = ("hoodie", "shorts", "shorts_cuff_L", "shorts_cuff_R", "stocking", "ankle_sock", "sneaker_L", "sneaker_R", "zip_strip", "zip_slider", "accent_stocking_stars")
RIGID = ("hair_bob", "hair_tie", "hair_star", "accent_face_mouth", "accent_tattoo")
SHOULDER_ZONE_X, SHOULDER_ZONE_Z, SHOULDER_ROUNDS = (0.07, 0.20), 1.17, 24  # where the hand-over from collarbone to arm is evened out
POUCH_X, POUCH_Z, POUCH_SOFT = (0.10, 0.36), (1.00, 1.24), 6  # the cloth under her arms in the T-pose, and how softly it joins the rest
POUCH_SHRINK, POUCH_GRAVITY, POUCH_FRAMES, POUCH_ROUND = 0.45, 0.3, 60, 14  # how much it draws in, how much it hangs, how long it settles, and how much it is rounded after
TIGHT_X, TIGHT_Z, TIGHT_GAP, TIGHT_KEEP, TIGHT_BLUR, TIGHT_PASSES = (0.09, 0.26), (1.06, 1.30), 0.022, 0.25, 0.018, 3  # the armpit fit Ethan chose from three
LOWER_BELOW = 1.0  # below this only her arms differ between the two builds
SLEEVE_BLEND = 16  # rounds over which the hoodie changes from following her arm to following her body
HANG_FROM_MM = 1.0  # a shape is only stored if it moves something further than this


def aim(pb, direction):
    """Turns a bone about its head so that it points this way."""
    head = pb.head.copy()
    turn = (pb.tail - pb.head).normalized().rotation_difference(Vector(direction).normalized())
    pb.matrix = Matrix.Translation(head) @ turn.to_matrix().to_4x4() @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


def pose_arms_down(arm, down, full):
    """Her collarbones lower and her arms hang where the approved arms-down body has them. Returns the bones' deformation."""
    drop = full - RESTING_LIFT
    collar = math.degrees(math.asin(drop / (PIVOT_X - COLLAR_X)))
    moved = []
    for side, sign, axis_sign in (("L", 1.0, 1.0), ("R", -1.0, -1.0)):
        shoulder = arm.pose.bones["J_Bip_%s_Shoulder" % side]
        rp.turn(arm, shoulder.name, "Y", collar * axis_sign)
        upper = arm.pose.bones["J_Bip_%s_UpperArm" % side]
        shoulder.matrix = Matrix.Translation((sign * DOWN_PIVOT_X - upper.head.x, 0, 0)) @ shoulder.matrix
        bpy.context.view_layer.update()
        mirror = np.array([sign, 1, 1])
        hand_tip = down["Middle"][0] * mirror
        at = {"UpperArm": down["LowerArm"] * mirror, "LowerArm": down["Hand"] * mirror, "Hand": hand_tip}
        for bone, target in at.items():
            pb = arm.pose.bones["J_Bip_%s_%s" % (side, bone)]
            aim(pb, Vector(target.tolist()) - pb.head)
            moved.append(pb.name)
        moved.append(shoulder.name)
    arm["arms_down"] = json.dumps({n: [list(arm.pose.bones[n].rotation_quaternion), list(arm.pose.bones[n].location)] for n in moved})
    print("TPOSE collarbone turns %.1f degrees; pivot with arms down %s" % (collar, np.round(list(arm.pose.bones["J_Bip_L_UpperArm"].head), 3)))
    return {b.name: np.array(b.matrix @ b.bone.matrix_local.inverted()) for b in arm.pose.bones}


def nearest_shift(points, source, source_shift, k=6):
    """Each point moves by the blended move of the nearest source points."""
    tree = KDTree(len(source))
    for i, c in enumerate(source.tolist()):
        tree.insert(c, i)
    tree.balance()
    out = np.zeros_like(points)
    for i, c in enumerate(points.tolist()):
        found = tree.find_n(c, k)
        weights = np.array([1 / (d + 1e-4) for _, _, d in found])
        out[i] = (source_shift[[j for _, j, _ in found]] * weights[:, None]).sum(0) / weights.sum()
    return out


def hoodie_shift_for(ob, points, swung, p_down, p_tee):
    """The sleeves take the bones' move, which turns them with her arm. The rest takes the move of the skin under it."""
    flag = np.empty(len(points), np.float32)
    ob.data.attributes["arm"].data.foreach_get("value", flag)
    sleeve = np.clip(bm.smooth_field(flag.astype(float), bm.edges_of(ob), np.ones(len(points), bool), SLEEVE_BLEND), 0, 1)[:, None]
    return swung * sleeve + nearest_shift(points, p_down, p_tee - p_down) * (1 - sleeve)


def settle_pouch(hoodie, body, points):
    """Simulates the cloth under her arms, in the T-pose, against her body. It draws in, because that cloth was cut to lie against her ribs. Returns the hoodie's points."""
    edges = bm.edges_of(hoodie)
    side, height = np.abs(points[:, 0]), points[:, 2]
    zone = (side > POUCH_X[0]) & (side < POUCH_X[1]) & (height > POUCH_Z[0]) & (height < POUCH_Z[1])
    free = np.clip(bm.smooth_field(zone.astype(float), edges, np.ones(len(points), bool), POUCH_SOFT), 0, 1)
    sim = hoodie.copy()
    sim.data = hoodie.data.copy()
    sim.name = "settle_sim"
    bpy.context.scene.collection.objects.link(sim)
    sim.modifiers.clear()
    bm.set_co(sim, points)
    pin, shrink = sim.vertex_groups.new(name="settle_pin"), sim.vertex_groups.new(name="settle_shrink")
    for i, weight in enumerate(free.tolist()):
        pin.add([i], 1.0 - weight, "REPLACE")
        shrink.add([i], weight, "REPLACE")
    cloth = sim.modifiers.new("settle", "CLOTH")
    s = cloth.settings
    s.quality, s.mass, s.air_damping = 8, 0.2, 2.0
    s.tension_stiffness, s.compression_stiffness, s.shear_stiffness, s.bending_stiffness = 15.0, 15.0, 5.0, 1.0
    s.vertex_group_mass, s.pin_stiffness = pin.name, 1.0
    s.vertex_group_shrink, s.shrink_min, s.shrink_max = shrink.name, 0.0, POUCH_SHRINK
    s.effector_weights.gravity = POUCH_GRAVITY
    c = cloth.collision_settings
    c.use_collision, c.collision_quality, c.distance_min = True, 4, 0.006
    cloth.point_cache.frame_start, cloth.point_cache.frame_end = 1, POUCH_FRAMES
    outline = [m for m in body.modifiers if m.type == "SOLIDIFY"]
    for m in outline:
        m.show_viewport = False
    body.modifiers.new("settle_collide", "COLLISION")
    body.collision.thickness_outer = 0.005
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, POUCH_FRAMES
    for f in range(1, POUCH_FRAMES + 1):
        scene.frame_set(f)
    bpy.context.view_layer.update()
    ev = sim.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    ev.to_mesh_clear()
    settled = a.reshape(-1, 3)
    assert np.isfinite(settled).all(), "the simulation came apart"
    mesh = sim.data
    bpy.data.objects.remove(sim)
    bpy.data.meshes.remove(mesh)
    body.modifiers.remove(body.modifiers["settle_collide"])
    for m in outline:
        m.show_viewport = True
    scene.frame_set(1)
    print("TPOSE pouch settled: cloth moved up to %.1f mm" % (float(np.linalg.norm(settled - points, axis=1).max()) * 1000))
    settled = bm.smooth_field(settled, edges, free > 0.3, POUCH_ROUND)  # rounds the corners the cloth leaves where sleeve meets ribs
    tree = BVHTree.FromPolygons(bm.get_co(body).tolist(), [list(f.vertices) for f in body.data.polygons], all_triangles=False)
    tight = (free > 0.05) & (side > TIGHT_X[0]) & (side < TIGHT_X[1]) & (height > TIGHT_Z[0]) & (height < TIGHT_Z[1])
    for _ in range(TIGHT_PASSES):  # brings the cloth round her armpit in closer, keeping part of the gap so it does not crease
        pull = np.zeros_like(settled)
        for i in np.where(tight)[0]:
            hit, _, _, dist = tree.find_nearest(tuple(settled[i]))
            if dist > TIGHT_GAP:
                pull[i] = (np.array(hit) - settled[i]) * (1 - (TIGHT_GAP + (dist - TIGHT_GAP) * TIGHT_KEEP) / dist)
        settled = settled + bm.spread(settled, pull, tight, TIGHT_BLUR)
    return points + (settled - points) * free[:, None]


def add_down_shape(ob, points, target, blend):
    """Stores what it takes, on top of the bones, for this mesh to land exactly where she was approved."""
    if not ob.data.shape_keys:
        ob.shape_key_add(name="Basis", from_mix=False)
    key = ob.shape_key_add(name="arms_down", from_mix=False)
    key.value = 0.0
    key.data.foreach_set("co", (points + drape.rest_change(blend, points, target)).astype(np.float32).ravel())


def main():
    body, face = bpy.data.objects["Body"], bpy.data.objects["Face"]
    with bpy.data.libraries.load(str(bm.ROOT / "spica-v2-tbody.blend"), link=False) as (_, wanted):
        wanted.objects = ["Body"]
    tee = wanted.objects[0]
    full = float(tee["t_lift"])
    p_down, p_tee = bm.get_co(body), bm.get_co(tee)
    assert len(p_down) == len(p_tee), "the two bodies no longer match point for point"
    lower = bm.vertices_in_sets(body, bm.PARTS["leg"] | bm.PARTS["foot"]) | ((p_down[:, 2] < LOWER_BELOW) & ~bm.vertices_in_sets(body, bm.PARTS["arm"] | bm.PARTS["hand"]))
    p_tee[lower] = p_down[lower]  # dressing slimmed her feet to fit the shoes, and only her arms and shoulders differ between the two builds
    down_joints = rig.measure(body)
    hidden = rig.covered_faces(body)
    bm.set_co(body, p_tee)

    joints = rig.measure(body)
    pivot_z = bd.SHOULDER_JOINT[2] + full
    joints["UpperArm"] = np.array([PIVOT_X, joints["UpperArm"][1], pivot_z])
    joints["Shoulder"] = np.array([COLLAR_X, joints["Shoulder"][1], pivot_z])
    arm = rig.build_armature(joints, face)
    W, bones, col = rig.heat_weights(arm, body)
    skin = rig.Skin(body, W, bones, col, joints)
    skin.clean()
    skin.neck_and_bust()
    zone = (np.abs(p_tee[:, 0]) > SHOULDER_ZONE_X[0]) & (np.abs(p_tee[:, 0]) < SHOULDER_ZONE_X[1]) & (p_tee[:, 2] > SHOULDER_ZONE_Z)
    skin.W = rig.finish(bm.smooth_field(skin.W, bm.edges_of(body), zone, SHOULDER_ROUNDS))
    rig.write_group(body, skin.W, bones)
    rig.attach(body, arm)

    skin.p = p_down  # her clothes were fitted to this body, so they take their weights from it
    rig.clothes(arm, skin)
    rig.face_parts(arm)
    for name in RIGID:
        rig.rigid(bpy.data.objects[name], arm, "J_Bip_C_Head")
    pony = bpy.data.objects["hair_ponytail"]
    rig.write_group(pony, rig.finish(rig.pony_weights(pony, bones, col)), bones)
    rig.attach(pony, arm)
    rig.parent_to_bone(bpy.data.objects["accent_binary"], arm, "J_Bip_C_Head")
    rig.orbit()

    deform = pose_arms_down(arm, down_joints, full)
    hoodie_was, hoodie_shift = None, None
    for name in CARRIED:
        ob = bpy.data.objects[name]
        now = bm.get_co(ob)
        blend = drape.blended_bones(ob, deform)
        shift = drape.rest_change(blend, now, now)
        if name == "hoodie":  # only the sleeves swing with her arms: the body of the hoodie follows the shape of her body
            shift = hoodie_shift_for(ob, now, shift, p_down, p_tee)
            rp.reset(arm)
            bpy.context.view_layer.update()
            shift = settle_pouch(ob, body, now + shift) - now
            hoodie_was, hoodie_shift = now, shift
        elif name.startswith("zip_"):  # the zip stays on the cloth it lies on
            shift = nearest_shift(now, hoodie_was, hoodie_shift)
        bm.set_co(ob, now + shift)
        left = float(np.linalg.norm(drape.skinned(blend, bm.get_co(ob)) - now, axis=1).max())
        print("TPOSE carried %s: lands within %.2f mm of where it was approved" % (name, left * 1000))
        if left * 1000 > HANG_FROM_MM:
            add_down_shape(ob, bm.get_co(ob), now, blend)
    add_down_shape(body, p_tee, p_down, drape.blended_bones(body, deform))
    rp.reset(arm)
    body["hidden_faces"] = [int(i) for i in hidden]  # removed by drape.py, whose simulations need her whole body
    print("TPOSE saved")
    bpy.ops.wm.save_as_mainfile(filepath=str(bm.ROOT / "spica-v2-tpose.blend"))


if __name__ == "__main__":
    main()
