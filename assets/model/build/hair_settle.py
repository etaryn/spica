"""
Lets gravity shape her hair for stills: every lock is a cloth pinned at its root, dropped under
gravity against the head, shoulders and body, then frozen as the rest shape. Hair that was bent by
hand and floated now hangs and lies on her. Also binds the new locks, tie and cubes to the head
bone so the rig carries them, then adds the tie and the cubes where the hair settled.
Runs after hair_edit.py in the same session:
  blender -b -P base_prepare.py -P hair_edit.py -P hair_settle.py   (run.sh v4 does this)
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hair_edit as he  # noqa: E402  (its main() runs only when it is the entry script)

ROOT = os.path.dirname(HERE)
FRAMES = 90
BEND = float(os.environ.get("SPICA_BEND", "0.06"))   # lower hangs looser, higher keeps the hand-bent shape
MASS = float(os.environ.get("SPICA_MASS", "0.15"))
V = Vector


# Per group: bend stiffness, and how much of the lock (from the root) is held to the head:
# fully pinned down to `hold`, free from `free`. The fringe is left as shaped.
GROUPS = {"bob": (BEND, 0.40, 0.70)}


def group_of(name):
    n = int(name[4:]) if name.startswith("Hair0") else 0
    return "bob" if 1 <= n <= 57 else None


def hair_objects():
    return [o for o in bpy.data.objects if o.type == "MESH" and group_of(o.name)]


def skull_proxy():
    """Hair roots sit on the scalp but the sample has no back of the head; this stands in for it."""
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=32, ring_count=20, location=(0, 0.04, 1.495))
    ob = bpy.context.active_object
    ob.name = "skull_proxy"
    ob.scale = (0.074, 0.080, 0.104)
    ob.hide_render = True
    return ob


def make_collider(ob):
    ob.modifiers.new("collision", "COLLISION")
    ob.collision.thickness_outer = 0.003
    ob.collision.cloth_friction = 8.0


def pin_group(ob, hold, free):
    zs = [(ob.matrix_world @ v.co).z for v in ob.data.vertices]
    top, bot = max(zs), min(zs)
    span = max(top - bot, 1e-3)
    vg = ob.vertex_groups.new(name="pin")
    for v, z in zip(ob.data.vertices, zs):
        t = (top - z) / span
        w = 1.0 if t < hold else max(0.0, 1.0 - (t - hold) / (free - hold))
        vg.add([v.index], w, "REPLACE")


def add_cloth(ob):
    bend, hold, free = GROUPS[group_of(ob.name)]
    pin_group(ob, hold, free)
    mod = ob.modifiers.new("cloth", "CLOTH")
    st = mod.settings
    st.quality = 6
    st.mass = MASS
    st.air_damping = 1.5
    st.tension_stiffness = st.compression_stiffness = 20
    st.shear_stiffness = 10
    st.bending_stiffness = bend
    st.bending_damping = 0.5
    st.vertex_group_mass = "pin"
    st.pin_stiffness = 1.0
    cs = mod.collision_settings
    cs.use_collision = True
    cs.distance_min = 0.006
    cs.use_self_collision = False
    cs.collision_quality = 5
    return mod


def settle(objs):
    sc = bpy.context.scene
    held = {}
    for ob in objs:
        held[ob.name] = [(m, m.show_viewport) for m in ob.modifiers]
        for m in ob.modifiers:
            if m.type in {"SOLIDIFY", "SUBSURF"}:
                m.show_viewport = False
        add_cloth(ob)
    start = {ob.name: [v.co.copy() for v in ob.data.vertices] for ob in objs}
    sc.frame_start, sc.frame_end = 1, FRAMES
    for f in range(1, FRAMES + 1):
        sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    bad = []
    for ob in objs:
        eo = ob.evaluated_get(dg)
        me = eo.to_mesh()
        new = [v.co.copy() for v in me.vertices]
        eo.to_mesh_clear()
        if len(new) != len(ob.data.vertices) or max((a - b).length for a, b in zip(new, start[ob.name])) > 0.15:
            bad.append(ob.name)  # an exploded sim: keep the hand-bent shape
            continue
        for v, c in zip(ob.data.vertices, new):
            v.co = c
        ob.data.update()
    for ob in objs:
        ob.modifiers.remove(ob.modifiers["cloth"])
        ob.vertex_groups.remove(ob.vertex_groups["pin"])
        for m, vis in held[ob.name]:
            m.show_viewport = vis
    sc.frame_set(1)
    return bad


def bind_to_head(ob):
    """Rigid on the head bone: the rig carries it; spring physics for video comes later."""
    arm = bpy.data.objects["Armature"]
    vg = ob.vertex_groups.new(name="J_Bip_C_Head")
    vg.add([v.index for v in ob.data.vertices], 1.0, "REPLACE")
    mod = ob.modifiers.new("armature", "ARMATURE")
    mod.object = arm
    ob.modifiers.move(len(ob.modifiers) - 1, 0)


def a_pose(deg=48):
    """Lower both arms from the T-pose, so the hair settles on shoulders that are in the pose she
    will be shown in."""
    arm = bpy.data.objects["Armature"]
    bpy.context.view_layer.objects.active = arm
    for bone, sgn in (("J_Bip_L_UpperArm", 1), ("J_Bip_R_UpperArm", -1)):
        pb = arm.pose.bones[bone]
        head = arm.matrix_world @ pb.head
        rot = Matrix.Translation(head) @ Matrix.Rotation(sgn * math.radians(deg), 4, "Y")             @ Matrix.Translation(-head)
        pb.matrix = arm.matrix_world.inverted() @ rot @ arm.matrix_world @ pb.matrix
        bpy.context.view_layer.update()


# ---------------------------------------------------------------- chains: the long layer and tuft
HEAD_C = V((0, 0.04, 1.495))
HEAD_R = V((0.074, 0.080, 0.104))
RAD = 0.009          # half a lock's thickness: how far the centre line stays off the skin
BEND_W = float(os.environ.get("SPICA_CHAIN_BEND", "0.07"))  # resistance to sharp bends; lower is looser
SEP = 0.011          # neighbouring locks keep at least this far apart


def sim_chains(chains, pinned, bvh, frames=260, iters=10):
    """Position-based chains: each is pinned at its first points, hangs under gravity, slides over the
    body and head, resists sharp bends a little, and keeps its length. Returns settled points."""
    pins = pinned if isinstance(pinned, list) else [pinned] * len(chains)
    g = V((0, 0, -9.8))
    dt = 1 / 60
    P = [[p.copy() for p in c] for c in chains]
    O = [[p.copy() for p in c] for c in chains]
    L = [[(c[i + 1] - c[i]).length for i in range(len(c) - 1)] for c in chains]

    def collide(p):
        loc, nrm, _, _ = bvh.find_nearest(p)
        if loc is not None and (p - loc).dot(nrm) < RAD:
            p = loc + nrm * RAD
        q = p - HEAD_C
        e = V((q.x / HEAD_R.x, q.y / HEAD_R.y, q.z / HEAD_R.z))
        lim = 1.0 + RAD / 0.08
        if 0 < e.length < lim:
            e = e.normalized() * lim
            p = HEAD_C + V((e.x * HEAD_R.x, e.y * HEAD_R.y, e.z * HEAD_R.z))
        return p

    for f in range(frames):
        for ci, c in enumerate(P):
            for i in range(pins[ci], len(c)):
                p = c[i]
                vel = (p - O[ci][i]) * 0.985
                O[ci][i] = p.copy()
                c[i] = p + vel + g * dt * dt
            for i in range(pins[ci]):
                c[i] = chains[ci][i].copy()
                O[ci][i] = c[i].copy()
        for it in range(iters):
            for ci, c in enumerate(P):
                for i in range(len(c) - 1):
                    d = c[i + 1] - c[i]
                    ln = d.length or 1e-9
                    corr = d * ((ln - L[ci][i]) / ln)
                    if i < pins[ci] - 1:
                        c[i + 1] = c[i + 1] - corr
                    else:
                        c[i] = c[i] + corr * 0.5
                        c[i + 1] = c[i + 1] - corr * 0.5
                for i in range(1, len(c) - 1):
                    if i + 1 < pins[ci]:
                        continue
                    dv = c[i] - c[i - 1]
                    if dv.length > 1e-9:
                        c[i + 1] = c[i + 1].lerp(c[i] + dv.normalized() * L[ci][i], BEND_W)
                if it % 5 == 0:
                    for i in range(pins[ci], len(c)):
                        c[i] = collide(c[i])
            if len(P) > 1:  # keep neighbouring locks from collapsing onto one line
                for i in range(max(pins), len(P[0])):
                    for a in range(len(P) - 1):
                        d = P[a + 1][i] - P[a][i]
                        if 1e-9 < d.length < SEP:
                            push = d.normalized() * (SEP - d.length) * 0.5
                            P[a + 1][i] = P[a + 1][i] + push
                            P[a][i] = P[a][i] - push
    for ci, c in enumerate(P):
        for i in range(pins[ci], len(c)):
            c[i] = collide(c[i])
    return P


def taper(t, wmax):
    """Lock width along its length: full in the middle, pointed at the tip."""
    return wmax * (0.62 + 0.38 * math.sin(math.pi * min(t * 1.1, 1.0))) * max(0.0, 1.0 - t ** 2.4)


def body_bvh():
    body = bpy.data.objects["Body"]
    dg = bpy.context.evaluated_depsgraph_get()
    return BVHTree.FromObject(body, dg)


def settled_long_layer(outline, hair_mat, bvh):
    """Seven locks that start on the back-left of her head and fall over her left shoulder."""
    lanes = (-0.045, -0.030, -0.015, 0.0, 0.015, 0.030, 0.045)
    reach = (0.62, 0.78, 0.9, 1.0, 0.86, 0.72, 0.60)
    from geo import spline
    n = 27
    chains = []
    for lane, share in zip(lanes, reach):
        k = max(4, int(round(len(he.PATH) * share)))
        pts = [p + V((lane * (j / (len(he.PATH) - 1)), lane * 0.35 * (j / (len(he.PATH) - 1)), 0.0))
               for j, p in enumerate(he.PATH[:k])]
        chains.append([p for p, _ in spline(pts, n - 1)])
    pins = []
    for share in reach:
        k = max(4, int(round(len(he.PATH) * share)))
        pins.append(max(4, int(round((n - 1) * min(4.5, k - 1.5) / (k - 1)))))  # held to the shoulder top
    settled = sim_chains(chains, pins, bvh)
    for i, c in enumerate(settled):
        secs = [(p, taper(j / (len(c) - 1), 0.017), 0.0) for j, p in enumerate(c)]
        secs = [(p, w, max(0.0035, w * 0.30)) for p, w, _ in secs]
        he.finish_lock(f"long_{i + 1}", secs, hair_mat, outline)
    return min((p for c in settled for p in c), key=lambda p: p.z)


def main():
    a_pose()
    outline = bpy.data.materials["outline"]
    hair_mat = bpy.data.materials["hair"]
    for n in ("Body", "Face"):
        make_collider(bpy.data.objects[n])
    make_collider(skull_proxy())
    bad = settle(hair_objects())
    print("SETTLE_BAD", bad, "BEND", BEND)
    for n in ("Body", "Face", "skull_proxy"):
        o = bpy.data.objects[n]
        o.modifiers.remove(o.modifiers["collision"])

    bvh = body_bvh()
    he.make_tuft(outline, hair_mat)  # short and tied, so it keeps its shaped curve
    low = settled_long_layer(outline, hair_mat, bvh)
    he.tie_accessories(bpy.data.objects["tuft"], outline)
    he.cubes(low, hair_mat, bpy.data.materials["amber"], outline)
    for o in bpy.data.objects:
        if o.type == "MESH" and (o.name.startswith(("long_", "cube_", "tie_")) or o.name == "tuft"):
            bind_to_head(o)
    bpy.data.objects.remove(bpy.data.objects["skull_proxy"])
    he.recolor_eyes()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "spica-v4.blend"))
    print("SAVED")


main()
