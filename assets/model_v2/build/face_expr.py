# Switches her face to one of her 25 expressions in any session with the built model. The table is v1's expr_defs.py.
#     import face_expr; face_expr.use("smug")
import json
import sys
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
TEX = HERE.parent.parent / "model" / "tex" / "face"
sys.path.append(str(HERE.parent.parent / "model" / "build"))
import expr_defs  # noqa: E402

NAMES = list(expr_defs.EXPRESSIONS)
FOLLOWERS = ("face_outline", "mouth_outline", "accent_tattoo")
MOUTH = "N00_000_00_FaceMouth_00_FACE"
IRIS_SLOT = 1
DRAWN = set(json.loads((TEX / "decal.json").read_text())["back"])


def set_overlay(items, tex):
    nodes = bpy.data.materials["face_skin"].node_tree.nodes
    if items:
        name, strength = items[0]
        image = bpy.data.images.get(name) or bpy.data.images.load(str(tex / name))
        image.alpha_mode = "STRAIGHT"
        nodes["overlay_tex"].image = image
        nodes["overlay_k"].inputs[1].default_value = strength
    else:
        nodes["overlay_k"].inputs[1].default_value = 0.0


def show_drawn(name, tex, drawn):
    ob = bpy.data.objects["accent_face_mouth"]
    ob.hide_render = name not in drawn
    if name in drawn:
        image = bpy.data.images.load(str(tex / (name + ".png")), check_existing=True)
        image.alpha_mode = "STRAIGHT"
        ob.data.materials[0].node_tree.nodes["Image Texture"].image = image


def show_water(name, tex, on):
    front, back = bpy.data.objects["accent_water"], bpy.data.objects["accent_water_back"]
    front.hide_render, back.hide_render = on is not True, on != "back"
    ob = back if on == "back" else front
    if on:
        image = bpy.data.images.load(str(tex / (name + "_water.png")), check_existing=True)
        image.alpha_mode = "STRAIGHT"
        ob.data.materials[0].node_tree.nodes["Image Texture"].image = image


def set_iris(value):
    nodes = bpy.data.objects["Face"].data.materials[IRIS_SLOT].node_tree.nodes
    colour = next(s for s in nodes["iris_dim"].inputs if s.identifier == "B_Color")
    colour.default_value = (value, value, value, 1)


def use(name, table=expr_defs.EXPRESSIONS, tex=TEX, drawn=DRAWN):
    e = table[name]
    face = bpy.data.objects["Face"]
    keys = face.data.shape_keys.key_blocks
    for k in keys:
        if k.name != "Basis":
            k.value = 0.0
    for key, percent in e["keys"].items():
        keys[key].value = percent / 100.0
    for follower in FOLLOWERS:
        for k in bpy.data.objects[follower].data.shape_keys.key_blocks:
            if k.name != "Basis":
                k.value = keys[k.name].value
    mouth = e.get("mouth", e.get("mesh_mouth", True))
    face.material_slots[0].material = bpy.data.materials[MOUTH if mouth else "face_hidden"]
    bpy.data.objects["mouth_outline"].hide_render = not mouth
    set_overlay(e.get("overlays", []), tex)
    show_drawn(name, tex, drawn)
    bpy.data.objects["accent_face_mouth"].delta_location = (0, -e.get("mouth_forward", 0.0), 0)  # puffed cheeks would otherwise swallow a drawn mouth
    show_water(name, tex, e.get("water", False))
    set_iris(e.get("iris", 1.0))
