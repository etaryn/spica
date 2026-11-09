"""
Her binary star: two glowing orbs that circle each other above her head, on the side opposite her bun (Spica is a close binary).
Called by clothes.py before it saves. Built from separate parts, none of which touches her body:
  orbit_placer  an empty rigid on her head bone, at the pair's centre, its Z axis along the line from the middle of her head
                through that centre (the pair's axis of rotation)
  orbit_spin    a child of the placer that turns about that Z axis (a driver: one turn every ORBIT_FRAMES frames, for ever)
  orb_a, orb_b  the two orbs (a bright core each), children of the spin, with a bigger soft halo each (orb_a_halo, orb_b_halo)
  orbit_ring_a, orbit_ring_b  two thin faint rings on the placer, one per orbit, so a single still reads as orbiting
The glow is made of the shader, not of the renderer: a halo sphere whose alpha rises from the core's edge and falls to nothing at
its rim (the real-time renderer has no bloom). Colours come from palette.py.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# Where the pair is, as a direction from the middle of her head. The orbit plane is perpendicular to it, so it lies parallel to the top
# of her head under the pair, and both orbs stay about as far from her hair all the way round (measured over a full turn: within
# about 1.3 cm of 7 cm; the first, lower and nearer setting varied by 2.4 cm). Her bun is at azimuth 37 degrees on the other side.
AZIMUTH = 50.0  # degrees from her left (+x) toward behind her (+y): the mirror of the bun side, a little further back
ELEVATION = 65.0  # degrees above the horizon: above her head, the plane tilted 25 degrees from the horizontal
DISTANCE = 0.18  # from the middle of her head to the pair's centre, in metres (clear of the hair, which reaches about 0.12)
SEPARATION = 0.065  # distance between the two orbs
MASS_A, MASS_B = 1.5, 1.0  # the heavier orb stays closer to the pair's centre
RADIUS_A, RADIUS_B = 0.016, 0.012  # the orbs
HALO = 3.2  # the halo sphere is this many times the orb's radius
HALO_ALPHA = 0.75  # the halo's opacity at the core's edge
ORBIT_FRAMES = 96  # frames per turn
START_TURN = 20.0  # degrees: where the orbs are at frame 0
RING = 0.0008  # thickness of the orbit rings (the tube's radius)
RING_ALPHA = 0.30
HEAD_BONE = "J_Bip_C_Head"


def head_centre():
    """The middle of her head: the middle of her face mesh's box, with front to back set by hand (as the hair does)."""
    face = bpy.data.objects["Face"]
    vs = [face.matrix_world @ v.co for v in face.data.vertices]
    lo = Vector([min(v[i] for v in vs) for i in range(3)])
    hi = Vector([max(v[i] for v in vs) for i in range(3)])
    c = (lo + hi) / 2
    c.y = 0.02
    return c


def sphere(name, radius, parent):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=4, radius=radius)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    return ob


def ring(name, radius, tube, parent):
    """A thin torus in the XY plane of its parent."""
    bm = bmesh.new()
    n, m = 128, 8
    rows = []
    for i in range(n):
        a = 2 * math.pi * i / n
        c = Vector((math.cos(a) * radius, math.sin(a) * radius, 0.0))
        out = Vector((math.cos(a), math.sin(a), 0.0))
        rows.append([bm.verts.new(c + (out * math.cos(b) + Vector((0, 0, 1)) * math.sin(b)) * tube) for b in (2 * math.pi * j / m for j in range(m))])
    for i in range(n):
        for j in range(m):
            bm.faces.new((rows[i][j], rows[i][(j + 1) % m], rows[(i + 1) % n][(j + 1) % m], rows[(i + 1) % n][j]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    return ob


def build(NB, lin, P):
    """NB: the node-builder class of clothes.py; lin: hex to linear colour; P: the palette."""

    def new_material(name, blended):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.node_tree.nodes.clear()
        if blended:
            m.surface_render_method = "BLENDED"
            m.use_backface_culling = True
        return m

    def rho_of(nb):
        """How far out from the middle of the disc the sphere is seen at this pixel: 0 at the centre, 1 at the rim."""
        g = nb.node("ShaderNodeNewGeometry")
        dot = nb.node("ShaderNodeVectorMath", operation="DOT_PRODUCT")
        nb.nt.links.new(g.outputs["Normal"], dot.inputs[0])
        nb.nt.links.new(g.outputs["Incoming"], dot.inputs[1])
        c = dot.outputs["Value"]
        return nb.math("SQRT", nb.math("SUBTRACT", 1.0, nb.math("MULTIPLY", c, c)))

    def core(name, white, glow):
        m = new_material(name, False)
        nb = NB(m.node_tree)
        out = nb.node("ShaderNodeOutputMaterial")
        em = nb.node("ShaderNodeEmission")
        t = nb.math("POWER", rho_of(nb), 1.6)  # white at the middle, tinted toward the rim
        m.node_tree.links.new(nb.mixc(t, lin(white), lin(glow)), em.inputs["Color"])
        m.node_tree.links.new(em.outputs["Emission"], out.inputs["Surface"])
        return m

    def halo(name, glow, orb_fraction):
        m = new_material(name, True)
        nb = NB(m.node_tree)
        out = nb.node("ShaderNodeOutputMaterial")
        em = nb.node("ShaderNodeEmission")
        em.inputs["Color"].default_value = lin(glow)
        rho = rho_of(nb)
        x = nb.math("MAXIMUM", nb.math("DIVIDE", nb.math("SUBTRACT", 1.0, rho), 1.0 - orb_fraction), 0.0)
        alpha = nb.math("MULTIPLY", nb.math("MULTIPLY", nb.math("POWER", x, 2.2), nb.math("GREATER_THAN", rho, orb_fraction)), HALO_ALPHA)
        mix = nb.node("ShaderNodeMixShader")
        m.node_tree.links.new(alpha, mix.inputs[0])
        m.node_tree.links.new(nb.node("ShaderNodeBsdfTransparent").outputs["BSDF"], mix.inputs[1])
        m.node_tree.links.new(em.outputs["Emission"], mix.inputs[2])
        m.node_tree.links.new(mix.outputs["Shader"], out.inputs["Surface"])
        return m

    def ring_material(name, glow):
        m = new_material(name, True)
        nb = NB(m.node_tree)
        out = nb.node("ShaderNodeOutputMaterial")
        em = nb.node("ShaderNodeEmission")
        em.inputs["Color"].default_value = lin(glow)
        mix = nb.node("ShaderNodeMixShader")
        mix.inputs[0].default_value = RING_ALPHA
        m.node_tree.links.new(nb.node("ShaderNodeBsdfTransparent").outputs["BSDF"], mix.inputs[1])
        m.node_tree.links.new(em.outputs["Emission"], mix.inputs[2])
        m.node_tree.links.new(mix.outputs["Shader"], out.inputs["Surface"])
        return m

    # where the pair is: the mirror of her bun, raised, on the line from the middle of her head
    hc_ = head_centre()
    el = math.radians(ELEVATION)
    az = math.radians(AZIMUTH)
    d = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))  # +x: her left
    centre = hc_ + d * DISTANCE
    arm = bpy.data.objects["Armature"]
    placer = bpy.data.objects.new("orbit_placer", None)
    placer.empty_display_type = "SINGLE_ARROW"
    placer.empty_display_size = 0.05
    bpy.context.scene.collection.objects.link(placer)
    placer.parent, placer.parent_type, placer.parent_bone = arm, "BONE", HEAD_BONE
    bpy.context.view_layer.update()
    wanted = Matrix.Translation(centre) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
    placer.matrix_basis = placer.matrix_world.inverted() @ wanted  # the bone's own transform is whatever it is: undo it, so she keeps the place wanted
    bpy.context.view_layer.update()
    err = (placer.matrix_world.translation - centre).length
    assert err < 1e-4, "the pair is not where it should be (%.5f m off)" % err

    spin = bpy.data.objects.new("orbit_spin", None)
    spin.empty_display_type = "ARROWS"
    spin.empty_display_size = 0.03
    bpy.context.scene.collection.objects.link(spin)
    spin.parent = placer
    spin.rotation_euler[2] = math.radians(START_TURN)
    drv = spin.driver_add("rotation_euler", 2).driver
    drv.type = "SCRIPTED"
    drv.expression = "%f + frame * %f" % (math.radians(START_TURN), 2 * math.pi / ORBIT_FRAMES)

    ra, rb = SEPARATION * MASS_B / (MASS_A + MASS_B), SEPARATION * MASS_A / (MASS_A + MASS_B)  # each orb's distance from the centre
    pairs = (("orb_a", RADIUS_A, ra, +1.0, P.orb_a, P.orb_a_glow), ("orb_b", RADIUS_B, rb, -1.0, P.orb_b, P.orb_b_glow))
    for name, rad, orbit, side, white, glow in pairs:
        o = sphere(name, rad, spin)
        o.location = (side * orbit, 0.0, 0.0)
        o.data.materials.append(core(name, white, glow))
        h = sphere(name + "_halo", rad * HALO, spin)
        h.location = o.location
        h.data.materials.append(halo(name + "_halo", glow, 1.0 / HALO))
        r = ring(name.replace("orb", "orbit_ring"), orbit, RING, placer)
        r.data.materials.append(ring_material(name + "_ring", glow))
    return placer
