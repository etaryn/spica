# Brings v1's face features (eyes, lashes, liner, brows, mouth) onto v2's head, keeping v2's skull and jaw.
# Both faces are the same VRoid mesh point for point, so each point takes v1's place, resized to v2's head.
import bpy
import numpy as np
from mathutils import Matrix
from mathutils.kdtree import KDTree

import base_mesh as bm
from body import smoothstep

V1_FILE = bm.ROOT.parent / "model" / "spica-v1.blend"
SKIN_SLOT = 3  # both faces keep their skin in this material slot; every other slot is a feature
LIDS = 0.2  # v1 rests with its eyes this far along Fcl_EYE_Close
LIP_REACH = 0.012  # the skin picture's lip line is painted out this far round the mouth
FULL_NEAR, FADE_TO = 0.008, 0.035  # skin this close to a feature moves with it; beyond the second it stays as v2's


def key_positions(me, name):
    block = me.shape_keys.key_blocks[name]
    a = np.empty(len(block.data) * 3)
    block.data.foreach_get("co", a)
    return a.reshape(-1, 3)


def fitted_scale(source, target):
    """The even scale and shift that best lays source points on target points."""
    a, b = source - source.mean(0), target - target.mean(0)
    scale = float((a * b).sum() / (a * a).sum())
    return scale, target.mean(0) - source.mean(0) * scale


def feature_points(me):
    return sorted({v for p in me.polygons if p.material_index != SKIN_SLOT for v in p.vertices})


def clear_lip_line(face, points):
    """Fills the area round the lips in the skin picture with the skin tone around it."""
    me = face.data
    lips = points[sorted({v for p in me.polygons if p.material_index == 0 for v in p.vertices})]
    image = next(n.image for n in me.materials[SKIN_SLOT].node_tree.nodes if n.type == "TEX_IMAGE")
    uv = me.uv_layers[0].data
    spots = [uv[i].uv[:] for p in me.polygons if p.material_index == SKIN_SLOT and np.linalg.norm(lips - points[list(p.vertices)].mean(0), axis=1).min() < LIP_REACH for i in p.loop_indices]
    w, h = image.size
    pixels = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(h, w, 4)
    low, high = np.array(spots).min(0), np.array(spots).max(0)
    x0, y0, x1, y1 = int(low[0] * w), int(low[1] * h), int(high[0] * w) + 1, int(high[1] * h) + 1
    around = np.concatenate([pixels[y0 - 6:y0, x0:x1], pixels[y1:y1 + 6, x0:x1]]).reshape(-1, 4)
    pixels[y0:y1, x0:x1] = np.median(around, axis=0)
    image.pixels.foreach_set(pixels.ravel())
    image.pack()


def adopt(face):
    """Moves the features and the skin round them to v1's places, and swaps in v1's feature materials and mouth."""
    with bpy.data.libraries.load(str(V1_FILE), link=False) as (_, wanted):
        wanted.objects = ["Face", "face_decal_back"]
    v1, decal = wanted.objects
    assert len(v1.data.vertices) == len(face.data.vertices), "the two faces no longer match point for point"
    assert all(list(a.vertices) == list(b.vertices) for a, b in zip(v1.data.polygons, face.data.polygons)), "their faces are in different orders"

    basis = key_positions(v1.data, "Basis")
    v1_points = basis + LIDS * (key_positions(v1.data, "Fcl_EYE_Close") - basis)
    v2_points = bm.get_co(face)
    skin = np.array(sorted({v for p in face.data.polygons if p.material_index == SKIN_SLOT for v in p.vertices}))
    scale, shift = fitted_scale(v1_points[skin], v2_points[skin])
    target = v1_points * scale + shift

    features = feature_points(face.data)
    tree = KDTree(len(features))
    for k, i in enumerate(features):
        tree.insert(target[i], k)
    tree.balance()
    distance = np.array([tree.find(p)[2] for p in target])
    weight = 1 - smoothstep(FULL_NEAR, FADE_TO, distance)
    delta = (target - v2_points) * weight[:, None]
    for block in face.data.shape_keys.key_blocks:
        a = np.empty(len(block.data) * 3)
        block.data.foreach_get("co", a)
        block.data.foreach_set("co", (a.reshape(-1, 3) + delta).astype(np.float32).ravel())
    bm.set_co(face, v2_points + delta)

    clear_lip_line(face, v2_points)

    # The features' pictures need v1's own layout of them.
    from_uv, to_uv = v1.data.uv_layers[0].data, face.data.uv_layers[0].data
    for polygon in face.data.polygons:
        if polygon.material_index != SKIN_SLOT:
            for i in polygon.loop_indices:
                to_uv[i].uv = from_uv[i].uv
    for slot, material in enumerate(v1.data.materials):
        if slot != SKIN_SLOT:
            face.data.materials[slot] = material

    # v1's neutral mouth is a picture on a skin-hugging patch.
    placed = np.array(decal.matrix_basis)  # its place in v1: only this shift counts, its head-bone parent sits at rest
    in_v1 = bm.get_co(decal) @ placed[:3, :3].T + placed[:3, 3]
    decal.parent = None
    decal.matrix_world = Matrix.Identity(4)
    bm.set_co(decal, in_v1 * scale + shift)
    print("HEAD mouth picture nearest y", round(float((in_v1 * scale + shift)[:, 1].min()), 4), "v2 face front", round(float(bm.get_co(face)[:, 1].min()), 4))
    decal.name = decal.data.name = "accent_face_mouth"
    bpy.context.scene.collection.objects.link(decal)

    armature = v1.parent
    bpy.data.objects.remove(v1)
    if armature is not None:
        bpy.data.objects.remove(armature)
    print("HEAD v1 features: scale", round(scale, 3), "moved", int((weight > 0).sum()), "of", len(weight))
