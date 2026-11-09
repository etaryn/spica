"""
Makes the finished model ready to be animated. Called by clothes.py just before it saves, while the third sample's armature (whose
bone tree the garments' weights were made for) is still in the scene.
- clean_weights: the sample's pieces (hood, shorts, sneakers, the bun) are weighted to bones her skeleton does not have (hood strings,
  hood secondary bones); Blender then drops those weights and the pieces follow what is left. Each such weight is moved to the nearest
  ancestor bone that she has. Every skinned piece then has weights only on her bones, at most 4 of them (what glTF keeps), adding up
  to 1, and no stray or duplicate vertex groups.
- parent_to_armature: skinned pieces are children of the armature (it is at the origin, so nothing moves).
- make_pose_action: the arms are lowered 48 degrees from the T-pose (the pose the hair and clothes were fitted in). That pose is kept as
  an action, "A_pose" (fake user, assigned), and the pose bones themselves are cleared, so the rest pose is a clean T-pose and an
  animation starts from a pose that is on record instead of a leftover transform.
"""
import bpy

GARMENTS = ("hood", "hoodie", "shorts", "sneakers", "sock_l", "sock_r")


def clean_weights(ob, her, parent_of):
    """her: names of the deforming bones of her armature; parent_of: bone name -> parent name, for the sample's armature."""
    me = ob.data
    names = {g.index: g.name for g in ob.vertex_groups}

    def target(n):
        for _ in range(60):
            if n is None or n in her:
                return n
            n = parent_of.get(n)
        return None

    tgt = {i: target(n) for i, n in names.items()}
    keep = []
    for v in me.vertices:
        acc = {}
        for g in v.groups:
            t = tgt.get(g.group)
            if t and g.weight > 1e-4:
                acc[t] = acc.get(t, 0.0) + g.weight
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:4]
        s = sum(w for _, w in top)
        keep.append([(n, w / s) for n, w in top] if s > 0 else [])
    ob.vertex_groups.clear()
    groups = {}
    for vi, ws in enumerate(keep):
        for n, w in ws:
            if n not in groups:
                groups[n] = ob.vertex_groups.new(name=n)
            groups[n].add([vi], w, "REPLACE")
    return sum(1 for ws in keep if not ws)


def parent_to_armature(arm, objs):
    for o in objs:
        if o.parent != arm:
            o.parent = arm
            o.matrix_parent_inverse.identity()


def make_pose_action(arm):
    arm.animation_data_create()
    keyed = [pb for pb in arm.pose.bones if pb.name == "Root" or pb.name.startswith("J_Bip_")]
    for pb in keyed:
        pb.rotation_mode = "QUATERNION"
        for path in ("rotation_quaternion", "location", "scale"):
            pb.keyframe_insert(path, frame=1, group=pb.name)
    act = arm.animation_data.action
    act.name = "A_pose"
    act.use_fake_user = True
    for pb in arm.pose.bones:  # the pose bones are clear: the action is what holds the pose now
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    return act


def prepare(arm, src_arm, extra_skinned):
    her = {b.name for b in arm.data.bones if b.use_deform}
    parent_of = {b.name: (b.parent.name if b.parent else None) for b in src_arm.data.bones}
    todo = [bpy.data.objects[n] for n in GARMENTS] + list(extra_skinned)
    bare = {o.name: clean_weights(o, her, parent_of) for o in todo}
    print("RIGPREP vertices left with no weight:", {k: v for k, v in bare.items() if v} or "none")
    parent_to_armature(arm, [o for o in bpy.data.objects if o.type == "MESH" and any(m.type == "ARMATURE" for m in o.modifiers)])
    act = make_pose_action(arm)
    print("RIGPREP action", act.name, "keyed bones", len({fc.group.name for fc in act.layers[0].strips[0].channelbags[0].fcurves if fc.group}) if act.layers else "?")
