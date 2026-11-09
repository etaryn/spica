# Her toon materials for v2: a lit colour ramp between a base and shade colour, and inverted-hull outlines.
import bpy

from palette import linear


def toon(name, base, shade, cut=0.45, soft=0.03):
    """Flat two-tone material: the light's strength is cut into base or shade by a colour ramp."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    t.nodes.clear()
    out = t.nodes.new("ShaderNodeOutputMaterial")
    emit = t.nodes.new("ShaderNodeEmission")
    diffuse = t.nodes.new("ShaderNodeBsdfDiffuse")
    to_rgb = t.nodes.new("ShaderNodeShaderToRGB")
    ramp = t.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "LINEAR"
    ramp.color_ramp.elements[0].position = max(cut - soft, 0)
    ramp.color_ramp.elements[0].color = linear(shade)
    ramp.color_ramp.elements[1].position = min(cut + soft, 1)
    ramp.color_ramp.elements[1].color = linear(base)
    t.links.new(diffuse.outputs[0], to_rgb.inputs[0])
    t.links.new(to_rgb.outputs[0], ramp.inputs[0])
    t.links.new(ramp.outputs[0], emit.inputs[0])
    t.links.new(emit.outputs[0], out.inputs[0])
    return m


def outline_material(name, colour):
    """The hull's colour. Back-face culling hides the side of the hull that faces the camera."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = True
    t = m.node_tree
    t.nodes.clear()
    out = t.nodes.new("ShaderNodeOutputMaterial")
    emit = t.nodes.new("ShaderNodeEmission")
    emit.inputs[0].default_value = linear(colour)
    t.links.new(emit.outputs[0], out.inputs[0])
    return m


def add_outline(ob, line, width):
    """Adds an inverted hull as the last modifier; the line material goes in the next free slot."""
    ob.data.materials.append(line)
    mod = ob.modifiers.new("outline", "SOLIDIFY")
    mod.thickness = width
    mod.offset = 1.0
    mod.use_flip_normals = True
    mod.use_rim = False
    mod.material_offset = len(ob.data.materials) - 1
    return mod
