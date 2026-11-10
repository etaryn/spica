# Renders a picture with her brows showing through her fringe, the way anime draws them, because brows carry so much of an expression.
# A second pass lights only her brows, with the fringe gone and everything else black, so a hand or her head still hides them; they are then laid over the picture.
import os

import bpy
import numpy as np

FRINGE = "hair_bob"
SEE_THROUGH = (FRINGE, "face_outline", "mouth_outline", "accent_face_mouth", "accent_water", "accent_water_back", "accent_tattoo")  # none of these is solid in front of a brow: the fringe by design, the rest are shells and pictures lying on her skin
FACE = "Face"
BROW_SLOT = 5
STRENGTH = 0.82  # how solid the brow looks where it crosses the hair
COLOUR = np.array((0x16, 0x28, 0x8A)) / 255  # palette.BROW


def flat(name, picture=None):
    """A black emission material, or one lit by a picture's alpha."""
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        t = m.node_tree
        t.nodes.clear()
        e, o = t.nodes.new("ShaderNodeEmission"), t.nodes.new("ShaderNodeOutputMaterial")
        e.inputs["Color"].default_value = (0, 0, 0, 1)
        if picture is not None:
            node = t.nodes.new("ShaderNodeTexImage")
            node.image = picture
            t.links.new(node.outputs["Alpha"], e.inputs["Color"])
        t.links.new(e.outputs[0], o.inputs[0])
    return m


def black_world():
    w = bpy.data.worlds.get("brow_black") or bpy.data.worlds.new("brow_black")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    return w


def pixels_of(path):
    image = bpy.data.images.load(path)
    image.colorspace_settings.name = "Non-Color"
    w, h = image.size
    a = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(a)
    return image, a.reshape(h, w, 4)


def render(scene):
    """Renders to scene.render.filepath, then lays her brows over the fringe in that file."""
    path = bpy.path.abspath(scene.render.filepath)
    bpy.ops.render.render(write_still=True)
    fringe, face = bpy.data.objects.get(FRINGE), bpy.data.objects.get(FACE)
    if fringe is None or face is None:
        return
    mask_path = path[:-4] + "_brows.png"
    world = scene.world
    gone = [(o, o.hide_render) for o in (bpy.data.objects.get(n) for n in SEE_THROUGH) if o is not None]
    swapped = []
    black = flat("brow_mask_black")
    white = flat("brow_mask_lit", next(n.image for n in face.data.materials[BROW_SLOT].node_tree.nodes if n.type == "TEX_IMAGE"))
    for ob in scene.objects:
        if ob.type == "MESH":
            for i, m in enumerate(ob.data.materials):
                swapped.append((ob.data, i, m))
                ob.data.materials[i] = white if ob is face and i == BROW_SLOT else black
    for o, _ in gone:
        o.hide_render = True
    scene.world, scene.render.filepath = black_world(), mask_path
    bpy.ops.render.render(write_still=True)
    for data, i, m in swapped:
        data.materials[i] = m
    for o, was in gone:
        o.hide_render = was
    scene.world, scene.render.filepath = world, path

    mask_image, mask = pixels_of(mask_path)
    amount = mask[:, :, 0, None] * STRENGTH
    if amount.max() > 0:
        image, picture = pixels_of(path)
        picture[:, :, :3] = picture[:, :, :3] * (1 - amount) + COLOUR * amount
        image.pixels.foreach_set(picture.ravel())
        image.save()
        bpy.data.images.remove(image)
    bpy.data.images.remove(mask_image)
    os.remove(mask_path)
