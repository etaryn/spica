# Adds her star accents: the star tattoo on her left cheek and the binary star above her head.
# Runs on spica-v2-hair.blend and saves spica-v2.blend. Objects named accent_* keep their colours in clay renders.
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import palette as pal
from palette import linear

HEAD_SCALE = bm.HEAD_SCALE
HEAD_PIVOT = Vector(bm.HEAD_PIVOT)
NECK_BLEND = (1.29, 1.345)  # her neck eases from full size to the head's size between these heights
NECK_REACH = (0.06, 0.10)  # and only near its middle, so her shoulders stay as they are
HEAD_PARTS = ("Face", "face_outline", "accent_face_mouth", "hair_bob", "hair_ponytail", "hair_tie", "hair_star")
TATTOO_AT = (0.066, 1.408)  # x and height of its middle: under the outer corner of her left eye, measured from the eye
TATTOO_RADIUS = 0.009  # tip to tip it is 1.8 cm
TATTOO_INNER = 0.42  # the star's inner points, as a share of the tips
TATTOO_RIM = 1.17  # the warm rim's outer edge, as a share of the star
TATTOO_LIFT = 0.0004  # how far it sits off her cheek

HEAD_MIDDLE = Vector((0.0, -0.012, 1.47))
BINARY_DIRECTION = Vector((0.42, 0.18, 0.89)).normalized()  # above her head, a little behind and to her left
BINARY_DISTANCE = 0.20
HEAVY_RADIUS, LIGHT_RADIUS = 0.016, 0.012  # the two orbs: 3.2 cm and 2.4 cm across
HEAVY_ORBIT, LIGHT_ORBIT = 0.015, 0.026  # how far each circles from the point between them; the lighter goes wider
HALO = 2.0  # how far each glow reaches, as a share of its orb
RING_THICKNESS = 0.0008
# Each stocking star: height of its middle, how far round her leg (0 is the front, 90 her outer side), width, tilt.
STOCKING_STARS = ((0.575, 15, 0.17, 12), (0.395, 135, 0.13, -18), (0.225, 255, 0.10, 30))
STAR_INNER = 0.42
STAR_RINGS = (0.2, 0.4, 0.6, 0.8, 1.0)  # rings of points, as shares of the star's size
STAR_LIFT = 0.0012  # enough to clear the leg between its points
PHASE = math.radians(25)  # where in their orbit the still shows them, so both read from the front


def emission(name, colour, alpha=1.0, soft=False):
    """Flat light: solid, or see-through, or fading out towards the edge of a sphere (a halo)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree
    t.nodes.clear()
    out = t.nodes.new("ShaderNodeOutputMaterial")
    glow = t.nodes.new("ShaderNodeEmission")
    glow.inputs["Color"].default_value = linear(colour)
    if alpha >= 1.0 and not soft:
        t.links.new(glow.outputs[0], out.inputs[0])
        return m
    m.surface_render_method = "BLENDED"
    mix = t.nodes.new("ShaderNodeMixShader")
    clear = t.nodes.new("ShaderNodeBsdfTransparent")
    t.links.new(clear.outputs[0], mix.inputs[1])
    t.links.new(glow.outputs[0], mix.inputs[2])
    t.links.new(mix.outputs[0], out.inputs[0])
    if soft:
        edge = t.nodes.new("ShaderNodeLayerWeight")
        edge.inputs["Blend"].default_value = 0.5
        fade = t.nodes.new("ShaderNodeMath")
        fade.operation = "SUBTRACT"
        fade.inputs[0].default_value = 1.0
        t.links.new(edge.outputs["Facing"], fade.inputs[1])
        shape = t.nodes.new("ShaderNodeMath")
        shape.operation = "POWER"
        shape.inputs[1].default_value = 2.0
        t.links.new(fade.outputs[0], shape.inputs[0])
        strength = t.nodes.new("ShaderNodeMath")
        strength.operation = "MULTIPLY"
        strength.inputs[1].default_value = alpha
        t.links.new(shape.outputs[0], strength.inputs[0])
        t.links.new(strength.outputs[0], mix.inputs[0])
    else:
        mix.inputs[0].default_value = alpha
    return m


def mesh_object(name, points, faces, materials, face_slots=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in points], [], faces)
    me.update()
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    for m in materials:
        me.materials.append(m)
    if face_slots:
        me.polygons.foreach_set("material_index", face_slots)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def cheek_surface():
    """Her skin alone (not lashes or eye parts), as something to project onto."""
    face = bpy.data.objects["Face"]
    slot = next(i for i, m in enumerate(face.data.materials) if m.name == "face_skin")
    co = bm.get_co(face)
    polys = [list(p.vertices) for p in face.data.polygons if p.material_index == slot]
    return BVHTree.FromPolygons(co.tolist(), polys, all_triangles=False)


def add_tattoo():
    # ponytail: rigid on the cheek; copy Face's shape keys onto it if v2 gets its own expressions
    skin = cheek_surface()
    at = on_head((TATTOO_AT[0], HEAD_PIVOT.y, TATTOO_AT[1]))
    centre, normal, _, _ = skin.ray_cast((at.x, -0.4, at.z), (0, 1, 0))
    up = (Vector((0, 0, 1)) - normal * normal.z).normalized()
    side = up.cross(normal)
    outline = []
    for i in range(10):
        a = math.pi / 2 + i * math.pi / 5
        r = TATTOO_RADIUS * HEAD_SCALE * (1.0 if i % 2 == 0 else TATTOO_INNER)
        outline.append((r * math.cos(a), r * math.sin(a)))
    rings = (0.25, 0.5, 0.75, 1.0, TATTOO_RIM)
    flat = [(0.0, 0.0)] + [(x * k, y * k) for k in rings for x, y in outline]
    points = []
    for x, y in flat:
        hit = skin.ray_cast(centre + side * x + up * y + normal * 0.02, -normal)
        points.append(hit[0] + hit[1] * TATTOO_LIFT)
    faces, slots = [], []
    for i in range(10):
        n = (i + 1) % 10
        faces.append([0, 1 + i, 1 + n])
        slots.append(0)
        for ring in range(len(rings) - 1):
            a, b = 1 + ring * 10, 1 + (ring + 1) * 10
            faces.append([a + i, b + i, b + n, a + n])
            slots.append(1 if ring == len(rings) - 2 else 0)
    mesh_object("accent_tattoo", points, faces, [emission("tattoo", pal.TATTOO), emission("tattoo_rim", pal.TATTOO_RIM)], slots)
    print("tattoo centre", [round(v, 4) for v in centre], "facing", [round(v, 3) for v in normal])


def add_stocking_stars():
    """Three big stars wrapped round the stocking, each drawn in the surface's own width and height."""
    stocking = bpy.data.objects["stocking"]
    leg = bm.get_co(stocking)
    tree = BVHTree.FromPolygons(leg.tolist(), [list(p.vertices) for p in stocking.data.polygons], all_triangles=False)
    heights = np.arange(0.12, 0.70, 0.02)
    middles = np.array([(leg[np.abs(leg[:, 2] - h) < 0.015, :2].min(0) + leg[np.abs(leg[:, 2] - h) < 0.015, :2].max(0)) / 2 for h in heights])
    points, faces = [], []
    for height, turn, width, tilt in STOCKING_STARS:
        band = leg[np.abs(leg[:, 2] - height) < 0.02, :2]
        radius = float(np.linalg.norm(band - band.mean(0), axis=1).mean())
        tilt_c, tilt_s = math.cos(math.radians(tilt)), math.sin(math.radians(tilt))
        corners = [(width / 2 * (1.0 if i % 2 == 0 else STAR_INNER) * math.sin(i * math.pi / 5), width / 2 * (1.0 if i % 2 == 0 else STAR_INNER) * math.cos(i * math.pi / 5)) for i in range(10)]
        outline = [(a[0] + (b[0] - a[0]) * t / 8, a[1] + (b[1] - a[1]) * t / 8) for a, b in zip(corners, corners[1:] + corners[:1]) for t in range(8)]
        start = len(points)
        flat = [(0.0, 0.0)] + [(x * size, y * size) for size in STAR_RINGS for x, y in outline]
        for x, y in flat:
            u, v = x * tilt_c - y * tilt_s, x * tilt_s + y * tilt_c
            angle = math.radians(turn) + u / radius
            z = height + v
            way = Vector((math.sin(angle), -math.cos(angle), 0))
            axis = Vector((float(np.interp(z, heights, middles[:, 0])), float(np.interp(z, heights, middles[:, 1])), z))
            hit = tree.ray_cast(axis + way * 0.3, -way)
            points.append(hit[0] + way * STAR_LIFT)
        n = len(outline)
        for i in range(n):
            next_i = (i + 1) % n
            faces.append([start, start + 1 + i, start + 1 + next_i])
            for ring in range(len(STAR_RINGS) - 1):
                a, b = start + 1 + ring * n, start + 1 + (ring + 1) * n
                faces.append([a + i, b + i, b + next_i, a + next_i])
    mesh_object("accent_stocking_stars", points, faces, [emission("stocking_star", pal.STOCKING_STAR)])


def sphere_object(name, radius, material, position, parent):
    b = bmesh.new()
    try:
        bmesh.ops.create_uvsphere(b, u_segments=32, v_segments=20, radius=radius)
        me = bpy.data.meshes.new(name)
        b.to_mesh(me)
    finally:
        b.free()
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.materials.append(material)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    ob.location = position
    return ob


def ring_object(name, radius, material, parent):
    around, tube = 128, 6
    points = [
        ((radius + RING_THICKNESS * math.cos(2 * math.pi * j / tube)) * math.cos(2 * math.pi * i / around),
         (radius + RING_THICKNESS * math.cos(2 * math.pi * j / tube)) * math.sin(2 * math.pi * i / around),
         RING_THICKNESS * math.sin(2 * math.pi * j / tube))
        for i in range(around) for j in range(tube)
    ]
    faces = [
        [i * tube + j, (i + 1) % around * tube + j, (i + 1) % around * tube + (j + 1) % tube, i * tube + (j + 1) % tube]
        for i in range(around) for j in range(tube)
    ]
    ob = mesh_object(name, points, faces, [material])
    ob.parent = parent
    return ob


def add_binary_star():
    """Two orbs circling the point between them, in a plane square to the line from the middle of her head."""
    centre = on_head(HEAD_MIDDLE) + BINARY_DIRECTION * BINARY_DISTANCE * HEAD_SCALE
    across = BINARY_DIRECTION.cross(Vector((0, 1, 0))).normalized()
    other = BINARY_DIRECTION.cross(across)
    pivot = bpy.data.objects.new("accent_binary", None)
    bpy.context.scene.collection.objects.link(pivot)
    pivot.matrix_world = Matrix((
        (across.x, other.x, BINARY_DIRECTION.x, centre.x),
        (across.y, other.y, BINARY_DIRECTION.y, centre.y),
        (across.z, other.z, BINARY_DIRECTION.z, centre.z),
        (0, 0, 0, 1),
    ))
    way = Vector((math.cos(PHASE), math.sin(PHASE), 0))
    heavy_at, light_at = way * HEAVY_ORBIT, way * -LIGHT_ORBIT
    sphere_object("accent_orb_heavy", HEAVY_RADIUS, emission("orb_cyan", pal.ORB_CYAN), heavy_at, pivot)
    sphere_object("accent_orb_light", LIGHT_RADIUS, emission("orb_gold", pal.ORB_GOLD), light_at, pivot)
    sphere_object("accent_halo_heavy", HEAVY_RADIUS * HALO, emission("halo_cyan", pal.ORB_CYAN_GLOW, 0.75, True), heavy_at, pivot)
    sphere_object("accent_halo_light", LIGHT_RADIUS * HALO, emission("halo_gold", pal.ORB_GOLD_GLOW, 0.75, True), light_at, pivot)
    ring_object("accent_ring_heavy", HEAVY_ORBIT, emission("ring_cyan", pal.ORB_CYAN_GLOW, 0.6), pivot)
    ring_object("accent_ring_light", LIGHT_ORBIT, emission("ring_gold", pal.ORB_GOLD_GLOW, 0.6), pivot)
    return centre, across, other


def report_clearance(centre, across, other):
    """How close each orb comes to her hair over a whole turn."""
    trees = [BVHTree.FromPolygons(bm.get_co(bpy.data.objects[n]).tolist(), [list(p.vertices) for p in bpy.data.objects[n].data.polygons], all_triangles=False) for n in ("hair_bob", "hair_ponytail")]
    gaps = []
    for k in range(72):
        a = 2 * math.pi * k / 72
        way = across * math.cos(a) + other * math.sin(a)
        for offset, radius in ((way * HEAVY_ORBIT, HEAVY_RADIUS), (way * -LIGHT_ORBIT, LIGHT_RADIUS)):
            gaps.append(min(t.find_nearest(centre + offset)[3] for t in trees) - radius)
    print("binary star gap to hair", round(min(gaps), 4), "to", round(max(gaps), 4))


def on_head(point):
    """Where a point measured on the full-size head is now."""
    return HEAD_PIVOT + (Vector(point) - HEAD_PIVOT) * HEAD_SCALE


def shrink_head():
    """Scales the head evenly from the top of the neck, with everything on it; the neck blends into it."""
    pivot = np.array(HEAD_PIVOT)
    for name in HEAD_PARTS:
        ob = bpy.data.objects[name]
        keys = ob.data.shape_keys.key_blocks if ob.data.shape_keys else []
        for block in keys:
            a = np.empty(len(block.data) * 3)
            block.data.foreach_get("co", a)
            block.data.foreach_set("co", (pivot + (a.reshape(-1, 3) - pivot) * HEAD_SCALE).astype(np.float32).ravel())
        bm.set_co(ob, pivot + (bm.get_co(ob) - pivot) * HEAD_SCALE)
    body = bpy.data.objects["Body"]
    co = bm.get_co(body)
    r = np.hypot(co[:, 0] - pivot[0], co[:, 1] - pivot[1])
    def step(x, a, b):
        t = np.clip((x - a) / (b - a), 0, 1)
        return t * t * (3 - 2 * t)
    share = (step(co[:, 2], *NECK_BLEND) * (1 - step(r, *NECK_REACH)))
    share = np.where(co[:, 2] >= NECK_BLEND[1], 1.0, share)
    bm.set_co(body, co + (pivot - co) * ((1 - HEAD_SCALE) * share)[:, None])


def main():
    shrink_head()
    add_tattoo()
    add_stocking_stars()
    centre, across, other = add_binary_star()
    report_clearance(centre, across, other)
    bpy.ops.wm.save_as_mainfile(filepath=str(bm.ROOT / "spica-v2.blend"))


if __name__ == "__main__":
    main()
