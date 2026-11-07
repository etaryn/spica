"""
Turns the downloaded VRoid sample (assets/model/base/sample_model.glb, a .vrm renamed) into her
starting point: clothes and helper meshes stripped, skin and hair on her toon materials with the
navy outline, spring bones and expression shape keys kept. Saves assets/model/spica-v4.blend.
Run: blender -b -P assets/model/build/base_prepare.py
"""
import os

import bmesh
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
PAL = dict(navy="1E2340", hair="CFE0F2", hairshade="8FA6C8", skin="F7E6DA")
MATS = {}


def lin(h):
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out) + (1.0,)


def lighten(h, t):
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        c = c + (1 - c) * t
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out) + (1.0,)


def toon(name, base, shade, cut=0.30):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    d = nt.nodes.new("ShaderNodeBsdfDiffuse")
    s2r = nt.nodes.new("ShaderNodeShaderToRGB")
    cr = nt.nodes.new("ShaderNodeValToRGB")
    cr.color_ramp.interpolation = "CONSTANT"
    e = cr.color_ramp.elements
    e[0].position, e[0].color = 0.0, lin(shade)
    e[1].position, e[1].color = cut, lin(base)
    e.new(0.92).color = lighten(base, 0.10)
    nt.links.new(d.outputs["BSDF"], s2r.inputs["Shader"])
    nt.links.new(s2r.outputs["Color"], cr.inputs["Fac"])
    nt.links.new(cr.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    MATS[name] = m
    return m


def outline_mat():
    m = bpy.data.materials.new("outline")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = lin(PAL["navy"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    m.use_backface_culling = True
    return m


def clear_mat():
    m = bpy.data.materials.new("clear")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(nt.nodes.new("ShaderNodeBsdfTransparent").outputs["BSDF"], out.inputs["Surface"])
    m.surface_render_method = "BLENDED"
    return m


def add_outline(ob, th, group=None, offset=None):
    """Inverted-hull outline. With a vertex group only those vertices grow a shell."""
    me = ob.data
    me.materials.append(OUTLINE)
    mod = ob.modifiers.new("outline", "SOLIDIFY")
    mod.thickness, mod.offset, mod.use_flip_normals = th, 1.0, True
    mod.material_offset = (len(me.materials) - 1 - offset) if offset is not None else 1
    if group:
        mod.vertex_group = group
        mod.thickness_vertex_group = 0.0


def main():
    global OUTLINE, CLEAR
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT, "base", "sample_model.glb"))
    OUTLINE = outline_mat()
    CLEAR = clear_mat()
    skin = toon("skin", PAL["skin"], "F1D8CF", cut=0.16)
    hair = toon("hair", PAL["hair"], PAL["hairshade"])

    # Helper mesh from the import (a spring-bone collider), not part of her.
    for o in [o for o in bpy.data.objects if o.name.startswith("Icosphere")]:
        bpy.data.objects.remove(o)

    # Body: keep the skin faces, drop every clothing and back-hair primitive.
    body = bpy.data.objects["Body"]
    me = body.data
    skin_idx = [i for i, m in enumerate(me.materials) if m and m.name.endswith("Body_00_SKIN")][0]
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != skin_idx], context="FACES")
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    for f in bm.faces:
        f.material_index = 0
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()
    me.materials.append(skin)
    add_outline(body, 0.0016)
    for p in me.polygons:
        p.use_smooth = True

    # Face: skin on her toon material; eyes, brows, lashes and mouth keep their own art for now.
    face = bpy.data.objects["Face"]
    fm = face.data
    for i, m in enumerate(fm.materials):
        if m and m.name.endswith("Face_00_SKIN"):
            fm.materials[i] = skin
            skin_slot = i
    # The skin outline lives on a hidden twin of the skin faces: a shell grown on the whole face mesh
    # leaves black spikes where the eye and brow layers share vertices with the skin.
    hull = face.copy()
    hull.name = "face_outline"
    hull.data = face.data.copy()
    hull.data.name = "face_outline"
    bpy.context.scene.collection.objects.link(hull)
    hull.shape_key_clear()
    bm = bmesh.new()
    bm.from_mesh(hull.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index != skin_slot], context="FACES")
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    for f in bm.faces:
        f.material_index = 0
    bm.to_mesh(hull.data)
    bm.free()
    hull.data.materials.clear()
    hull.data.materials.append(CLEAR)
    hull.data.materials.append(OUTLINE)
    mod = hull.modifiers.new("outline", "SOLIDIFY")
    mod.thickness, mod.offset, mod.use_flip_normals, mod.material_offset = 0.0016, 1.0, True, 1

    # Hair cards: her hair material and outline (shapes come later).
    for o in bpy.data.objects:
        if o.name.startswith("Hair0") and o.type == "MESH":
            o.data.materials.clear()
            o.data.materials.append(hair)
            add_outline(o, 0.0012)

    n_poly = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")
    print("POLYS_TOTAL", n_poly, "BODY", len(body.data.polygons))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "spica-v4.blend"))
    print("SAVED")


main()
