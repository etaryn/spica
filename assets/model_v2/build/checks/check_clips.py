# Tests her clips and sprites by measurement, and raises on any failure.
# Args after --: sprites <absolute dir> | state | clip <name,...>. Sprites and state run on any file; clip needs spica-v2-clips.blend.
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import spring
import sprites as sp

args = sys.argv[sys.argv.index("--") + 1:]
problems = []


def bad(message):
    problems.append(message)
    print("PROBLEM", message)


def read_png(path):
    """RGBA as stored in the file, top row first."""
    image = bpy.data.images.load(str(path))
    image.colorspace_settings.name = "Non-Color"
    w, h = image.size
    a = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(a)
    bpy.data.images.remove(image)
    return a.reshape(h, w, 4)[::-1]


def check_sprite(path, standing):
    a = read_png(path)
    if a.shape[:2] != (sp.H, sp.W):
        return bad("%s: size %s" % (path.name, a.shape))
    alpha = a[:, :, 3]
    if (alpha > 0.5).mean() < 0.03:
        bad(path.name + ": nearly empty")
    edge = np.concatenate([alpha[:2].ravel(), alpha[-2:].ravel(), alpha[:, :2].ravel(), alpha[:, -2:].ravel()])
    if edge.max() > 0.02:
        bad(path.name + ": touches the edge of the canvas")
    lowest = int(np.where((alpha > 0.5).any(axis=1))[0].max())
    if standing and abs(lowest - sp.ANCHOR[1]) > 8:
        bad("%s: lowest solid row %d, anchor row %d" % (path.name, lowest, sp.ANCHOR[1]))
    glow = a[:125][(a[:125, :, 3] > 0.05) & (a[:125, :, 3] < 0.6)]  # the binary star's halo is the only soft thing up there
    if len(glow) and np.median(glow[:, :3].mean(axis=1)) < 0.4:
        bad(path.name + ": the star's glow has a dark edge")


def check_sprites(folder):
    entries = json.loads((folder / "poses.json").read_text())
    assert entries, "the manifest is empty"
    for e in entries:
        assert sorted(e) == ["anchor", "files", "name", "tags"], e["name"] + ": wrong fields"
        for side in ("left", "right"):
            check_sprite(folder / e["files"][side], not e["name"].startswith("sit-"))
    print("SPRITES checked", len(entries))


def check_state():
    keys = bpy.data.objects["Face"].data.shape_keys.key_blocks
    right = sp.image_right_gaze(keys)
    left = "Gaze_L" if right == "Gaze_R" else "Gaze_R"
    for facing, toward, away in (("right", right, left), ("left", left, right)):
        sp.set_face("observing", facing, "stance")
        assert keys[toward].value > 0.5 and keys[away].value == 0, "she looks away from where she faces, " + facing


WATCH = ("J_Bip_C_Head", "J_Bip_L_Hand", "J_Bip_R_Hand", "J_Bip_L_Foot", "J_Bip_R_Foot", "J_Sec_Pony8")
LOOPS = ("idle", "walk", "sit_edge")
GARMENTS = ("shorts", "shorts_cuff_L", "shorts_cuff_R", "stocking", "ankle_sock", "sneaker_L", "sneaker_R")
GARMENT_MOST = 10  # percent of a garment's points inside her skin, the limit her rig check uses
KNEE_AT_REST = 7.9  # degrees between her thigh and shin bones standing straight, from their rest positions
KNEE_STRAIGHT, KNEE_SWING = 6, 45  # a walking knee nearly straightens at heel strike and mid-stance and bends about 60 degrees in the swing
PONY_HANG_MOST = 15  # degrees the whole ponytail may turn from its standing line while her head is tipped back 25
SWING_MM = {"idle": {"Pony": (0, 20), "Bust": (0, 3), "Bob": (0, 10)}, "walk": {"Pony": (10, 90), "Bust": (2, 12), "Bob": (4, 30)}}  # least and most a chain's tip may travel against her head or chest: Ethan found the first numbers far too lively


def evaluated(ob):
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    a = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", a)
    ev.to_mesh_clear()
    return a.reshape(-1, 3)


def sole(name):
    """The lowest point of a shoe, with its drawn outline on, because GROUND was measured with it."""
    ob = bpy.data.objects[name]
    outline = [m for m in ob.modifiers if m.type == "SOLIDIFY"]
    for m in outline:
        m.show_viewport = True
    bpy.context.view_layer.update()
    low = float(evaluated(ob)[:, 2].min())
    for m in outline:
        m.show_viewport = False
    return low


def percent_inside(name, tree):
    points = evaluated(bpy.data.objects[name])[::3]
    inside = 0
    for c in points:
        loc, nrm, _, _ = tree.find_nearest(Vector(c))
        inside += (Vector(c) - loc).dot(nrm) < -0.0005
    return 100.0 * inside / len(points)


def check_clip(name):
    arm, scene = bpy.data.objects["Armature"], bpy.context.scene
    found = [a.name for a in bpy.data.actions if a.name.startswith("clip_" + name)]
    assert found == ["clip_" + name], "%s: expected one action, found %s" % (name, found)
    action = bpy.data.actions[found[0]]
    first, last = action["first"], action["last"]
    track, soles, inside = [], [], {g: 0.0 for g in GARMENTS}
    chains = [c for c, _ in spring.chains(arm)]
    tips = {c[-1].name: [] for c in chains}
    knees = {"L": [], "R": []}
    for f in range(first, last + 1):
        sp.pose(arm, scene, name, f)
        track.append([np.array(arm.matrix_world @ arm.pose.bones[b].head) for b in WATCH])
        for side in knees:
            thigh, shin = (arm.pose.bones["J_Bip_%s_%s" % (side, n)] for n in ("UpperLeg", "LowerLeg"))
            knees[side].append(np.degrees((thigh.tail - thigh.head).angle(shin.tail - shin.head)) - KNEE_AT_REST)
        for c in chains:
            frame = arm.pose.bones["J_Bip_C_UpperChest" if "Bust" in c[0].name else "J_Bip_C_Head"].matrix.inverted()
            tips[c[-1].name].append(np.array(frame @ arm.pose.bones[c[-1].name].tail))
        if (f - first) % 4 == 0:
            soles.append((sole("sneaker_L"), sole("sneaker_R")))
        if (f - first) % 24 == 0:
            tree = spring.solid_tree(("Body",))
            for g in GARMENTS:
                inside[g] = max(inside[g], percent_inside(g, tree))
    track = np.array(track)
    step = np.linalg.norm(track[1:] - track[:-1], axis=2).max(axis=0)
    seam = np.linalg.norm(track[0] - track[-1], axis=1)
    if name in LOOPS and (seam > 1.6 * step + 0.001).any():
        bad("%s: the loop jumps at %s" % (name, [b for b, s, t in zip(WATCH, seam, step) if s > 1.6 * t + 0.001]))
    soles = np.array(soles)
    if soles.min() < sp.GROUND - 0.006:
        bad("%s: a foot sinks %.1f mm below the ground" % (name, (sp.GROUND - soles.min()) * 1000))
    if name == "walk" and soles.min(axis=1).max() > sp.GROUND + 0.012:
        bad("walk: both feet leave the ground")
    if name in ("idle", "look_up"):
        drift = np.linalg.norm(track[:, 3:5] - track[0, 3:5], axis=2).max()
        if drift > 0.002:
            bad("%s: a planted foot slides %.1f mm" % (name, drift * 1000))
    for g, pct in inside.items():
        if pct > GARMENT_MOST:
            bad("%s: %s is %.1f%% inside her" % (name, g, pct))
    if name == "look_up":
        pony = [arm.data.bones["J_Sec_Pony%d" % i] for i in (1, 8)]
        standing = pony[1].tail_local - pony[0].head_local
        held = arm.matrix_world @ arm.pose.bones[pony[1].name].tail - arm.matrix_world @ arm.pose.bones[pony[0].name].head
        turned = np.degrees(standing.angle(held))
        print("HANG look_up ponytail turned %.0f degrees from how it hangs standing" % turned)
        if turned > PONY_HANG_MOST:
            bad("look_up: the ponytail turns %.0f degrees with her head; hair hangs" % turned)
    if name == "walk":
        for side, bends in knees.items():
            if min(bends) > KNEE_STRAIGHT or max(bends) < KNEE_SWING:
                bad("walk: %s knee bends %.0f to %.0f degrees; a person's straightens to under %d and bends past %d in the swing" % (side, min(bends), max(bends), KNEE_STRAIGHT, KNEE_SWING))
            print("KNEE walk", side, "%.0f to %.0f degrees" % (min(bends), max(bends)))
    for tip, path in tips.items():
        travel = float(np.ptp(np.array(path), axis=0).max() * 1000)
        print("SWING", name, tip, "tip travel %.1f mm" % travel)
        for kind, (least, most) in SWING_MM.get(name, {}).items():
            if kind in tip and not least <= travel <= most:
                bad("%s: %s travels %.1f mm, allowed %d to %d" % (name, tip, travel, least, most))
    print("CLIP", name, "frames", first, last, "soles", round(float(soles.min() - sp.GROUND) * 1000, 1), "mm", "worst inside", {g: round(p, 1) for g, p in inside.items() if p > 1})


for g in [o for o in bpy.data.objects if o.type == "MESH"]:
    for m in g.modifiers:
        if m.type == "SOLIDIFY":
            m.show_viewport = args[0] != "clip"  # the check measures cloth without its drawn outline
if args[0] == "sprites":
    check_sprites(Path(args[1]))
elif args[0] == "state":
    check_state()
elif args[0] == "clip":
    for clip_name in args[1].split(","):
        check_clip(clip_name)
if problems:
    raise RuntimeError("%d problems" % len(problems))
print("CLIPS check passed")
