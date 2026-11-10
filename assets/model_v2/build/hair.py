# Checkpoint 3: gives her a bob and a side ponytail, copied from two VRoid samples, in her own toon colours.
# The samples' licences allow modification and commercial use. Each piece is one object per hairstyle part.
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import materials as mt
import palette as pal
from palette import linear

BOB_SOURCE = bm.ROOT / "base" / "hair_bob.glb"
PONY_SOURCE = bm.ROOT / "base" / "hair_pony.glb"
SKIN_SOURCE_SLOT = "Face_00_SKIN"
RING_AT = {"hair_bob": 0.25, "hair_ponytail": 0.17}  # how far down each lock the highlight band sits
HULL = 0.0011
PONY_SCALE = 0.80  # the sample's ponytail is as wide as her head; even scale first
PONY_LENGTH = 1.6  # longer than the sample, at its full bushy width
PONY_OUT = (-0.70, 0.24, 0.67)  # the direction from her head's centre to the tie: high on her right, a little behind
# Width along the ponytail: drawn in at the tie, quickly full, tapering a little at the tip.
GATHER = [(0.0, 0.08), (0.03, 0.16), (0.055, 0.38), (0.18, 0.95), (0.6, 1.05), (1.0, 0.72)]
LOCK_CUTS = 2  # extra points along and across each ponytail lock
CHAIN_NODES = 48
CHAIN_SMOOTHING = 6  # passes that round off the curve's corners
CHAIN_PINNED = 6  # these nodes leave the tie angled up; the rest are free to arc over and fall
CHAIN_STEPS = 900
FALL_FORWARD = np.array([0.0, -0.00005, 0.0])
CONTACT_DRAG = 0.96  # how little a touch slows the hair: it slides rather than piles up
CONTACT_GAP = 0.010  # how close hair sits to what it rests on
CONTACT_DEEPEST = 0.025
BAND_MARGIN = 0.004  # how far the band reaches past the hair it covers
BAND_WIDTH = 0.016  # across the flat band
BAND_HEIGHT = 0.0032  # how far it stands off the hair
STAR_RADIUS = 0.016
PONY_FADE, PONY_FADE_CURVE = 0.9, 1.3  # how far the ponytail goes to its end colour at the tips, and how late the fade comes
LOCK_TONE = 0.3
HEAD_BOTTOM = 1.345  # above this the collider is her head, which is built at full size like the hair
HOOD_HALF_WIDTH = 0.115  # cloth nearer her centre than this is the hood, which the ponytail ignores
PONY_TINT = 0.5
PUSH_OUT = 0.0012


def refine(verts, faces, across):
    """Splits every lock's faces so it has enough points to bend smoothly. Returns the new mesh and lock labels."""
    b = bmesh.new()
    try:
        layer = b.verts.layers.float.new("across")
        added = []
        for co, a in zip(verts.tolist(), across.tolist()):
            v = b.verts.new(co)
            v[layer] = a
            added.append(v)
        for f in faces:
            b.faces.new([added[i] for i in f])
        b.edges.ensure_lookup_table()
        bmesh.ops.subdivide_edges(b, edges=b.edges[:], cuts=LOCK_CUTS, use_grid_fill=True)
        b.verts.index_update()
        new_verts = np.array([v.co[:] for v in b.verts])
        new_across = np.array([v[layer] for v in b.verts])
        new_faces = [[v.index for v in f.verts] for f in b.faces]
        edges = np.array([[e.verts[0].index, e.verts[1].index] for e in b.edges])
    finally:
        b.free()
    return new_verts, new_faces, islands_of(len(new_verts), edges), new_across


def islands_of(verts_count, edges):
    """Which connected piece each vertex belongs to."""
    parent = list(range(verts_count))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a, b in edges.tolist():
        parent[find(a)] = find(b)
    roots = np.array([find(i) for i in range(verts_count)])
    return np.unique(roots, return_inverse=True)[1]


def import_sample(path):
    """Imports a sample and returns its hair and face objects, with everything else removed."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    new = [o for o in bpy.data.objects if o not in before]
    bpy.context.view_layer.update()
    hair = next(o for o in new if o.type == "MESH" and o.name.startswith("Hair"))
    face = next(o for o in new if o.type == "MESH" and o.name.startswith("Face"))
    for o in (hair, face):
        assert np.allclose(np.array(o.matrix_world), np.eye(4), atol=1e-5), "sample is not at the origin"
    return hair, face, [o for o in new if o not in (hair, face)]


def skin_points(ob, key):
    """Vertices of the face's skin layer."""
    me = ob.data
    slot = next(i for i, m in enumerate(me.materials) if key in m.name)
    p = bm.get_co(ob)
    used = sorted({v for poly in me.polygons if poly.material_index == slot for v in poly.vertices})
    return p[used]


def fit(source_skin, target_skin, mapped):
    """One even scale and a move that lay a sample's head on hers."""
    s = np.ptp(target_skin[:, 2]) / np.ptp(source_skin[:, 2])
    def centre(q):
        return (q.min(0) + q.max(0)) / 2

    a, b = centre(source_skin * mapped), centre(target_skin)
    return s, b - a * s


def take_hair(hair, keep):
    """Vertices, faces and piece labels of the hair, with only the pieces keep() accepts."""
    p = bm.get_co(hair)
    me = hair.data
    e = np.empty(len(me.edges) * 2, np.int32)
    me.edges.foreach_get("vertices", e)
    island = islands_of(len(p), e.reshape(-1, 2))
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get("uv", uv)
    corner = np.empty(len(me.loops), np.int32)
    me.loops.foreach_get("vertex_index", corner)
    across = np.zeros(len(p))
    across[corner] = uv.reshape(-1, 2)[:, 0]
    wanted = {k for k in range(island.max() + 1) if keep(p[island == k])}
    old_to_new = {}
    verts, labels, widths = [], [], []
    faces = []
    for poly in me.polygons:
        if island[poly.vertices[0]] not in wanted:
            continue
        loop = []
        for v in poly.vertices:
            if v not in old_to_new:
                old_to_new[v] = len(verts)
                verts.append(p[v])
                labels.append(island[v])
                widths.append(across[v])
            loop.append(old_to_new[v])
        faces.append(loop)
    return np.array(verts), faces, np.array(labels), np.array(widths)


def keep_bob(q):
    """Everything but the two-corner slivers and the hair clip."""
    return len(q) > 8 and np.ptp(q, axis=0).max() > 0.06


def keep_pony(q):
    """The locks of the side ponytail on the sample: well to one side, rooted away from the centre."""
    return len(q) > 8 and q[:, 0].mean() < -0.1 and q[:, 2].min() > 1.42 and q[:, 0].max() < -0.04


def push_out_of_head(p, tree):
    """Anything inside her skull or face comes back out to just above the skin."""
    moved = 0
    for i, co in enumerate(p):
        hit, normal, _, dist = tree.find_nearest(co)
        if hit is None or dist > 0.03:
            continue
        if np.dot(co - np.array(hit), np.array(normal)) < 0:
            p[i] = np.array(hit) + np.array(normal) * PUSH_OUT
            moved += 1
    return moved


def head_tree(body, face):
    """A collision shape for her head: the body's top and the face's skin."""
    points, polys = [], []
    for ob, key in ((body, None), (face, "face_skin")):
        me = ob.data
        p = bm.get_co(ob)
        base = len(points)
        points.extend(p.tolist())
        slot = None if key is None else next(i for i, m in enumerate(me.materials) if m.name == key)
        for poly in me.polygons:
            if slot is not None and poly.material_index != slot:
                continue
            if slot is None and p[list(poly.vertices), 2].min() < 1.30:
                continue
            polys.append([base + v for v in poly.vertices])
    return BVHTree.FromPolygons(points, polys, all_triangles=False)


def build_object(name, verts, faces, labels, across, material, centre):
    """The hair object: smooth locks with their position along the lock stored for the shader."""
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts.tolist(), [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.materials.append(material)

    ids, inv = np.unique(labels, return_inverse=True)
    rng = np.random.default_rng(11)
    jitter = rng.random(len(ids))
    tip = np.zeros(len(verts))
    ring = np.zeros(len(verts))
    tone = rng.random(len(ids))[inv]
    outer = np.ones(len(verts))
    tops = np.zeros(len(ids))
    means = np.zeros((len(ids), 3))
    sizes = np.bincount(inv)
    for k in range(len(ids)):
        here = inv == k
        z = verts[here, 2]
        tops[k] = z.max()
        means[k] = verts[here].mean(0)
        tip[here] = (z.max() - z) / max(np.ptp(z), 1e-4)
        if jitter[k] < 0.3:
            continue  # not every lock catches the light
        at = RING_AT[name] + (jitter[k] - 0.65) * 0.05
        width = 0.024 + jitter[k] * 0.02
        u = across[here]
        side = np.abs(2 * (u - u.min()) / max(np.ptp(u), 1e-4) - 1)
        ring[here] = np.clip(1 - np.abs(tip[here] - at) / (width * (1 - 0.8 * side**2) + 1e-4), 0, 1)

    # Each lock is two sheets, front and back. Only the outer sheet carries the outline.
    for k in range(len(ids)):
        twins = np.where((sizes == sizes[k]) & (np.linalg.norm(means - means[k], axis=1) < 0.012))[0]
        twins = [t for t in twins if t != k]
        if twins:
            mine = np.linalg.norm(means[k] - centre)
            theirs = np.linalg.norm(means[twins[0]] - centre)
            if mine < theirs or (mine == theirs and k > twins[0]):
                outer[inv == k] = 0.0

    tint = np.full(len(verts), 1.0 if name == "hair_ponytail" else 0.0)
    for attr_name, values in (("tip", tip), ("ring", ring * outer), ("tone", tone), ("tint", tint), ("strip", np.zeros(len(verts)))):
        a = me.attributes.new(attr_name, "FLOAT", "POINT")
        a.data.foreach_set("value", values.astype(np.float32))
    line_weight = outer.copy()
    if name == "hair_ponytail":
        t = np.clip((tip - 0.04) / 0.26, 0, 1)
        line_weight *= 0.35 + 0.65 * t * t * (3 - 2 * t)  # many locks gather at the top: thinner lines there
    group = ob.vertex_groups.new(name="outline_w")
    for i, w in enumerate(line_weight.tolist()):
        group.add([i], w, "REPLACE")
    return ob, inv


def paint_strip(ob, verts, inv):
    """The saturated cyan runs down the long front locks beside her left cheek."""
    me = ob.data
    count = inv.max() + 1
    candidates = []
    for k in range(count):
        q = verts[inv == k]
        if q[:, 0].mean() > 0.04 and q[:, 1].mean() < -0.02:
            candidates.append((q[:, 2].min(), k))
    chosen = [k for _, k in sorted(candidates)[:4]]
    strip = np.zeros(len(verts))
    tip = np.empty(len(verts), np.float32)
    me.attributes["tip"].data.foreach_get("value", tip)
    for k in chosen:
        here = inv == k
        t = np.clip((tip[here] - 0.05) / 0.3, 0, 1)
        strip[here] = t * t * (3 - 2 * t)
    me.attributes["strip"].data.foreach_set("value", strip.astype(np.float32))
    print("STRIP locks", chosen)


def hair_material():
    """Flat two-tone hair: pale at the root, a touch of periwinkle at the tips, one sharp highlight band."""
    m = bpy.data.materials.new("hair")
    m.use_nodes = True
    t = m.node_tree
    t.nodes.clear()
    new = t.nodes.new

    def attr(name):
        a = new("ShaderNodeAttribute")
        a.attribute_name = name
        return a.outputs["Fac"]

    def mix(a, b, factor):
        n = new("ShaderNodeMix")
        n.data_type = "RGBA"
        for socket, value in ((n.inputs["A"], a), (n.inputs["B"], b)):
            if isinstance(value, str):
                socket.default_value = linear(value)
            else:
                t.links.new(value, socket)
        if isinstance(factor, float):
            n.inputs["Factor"].default_value = factor
        else:
            t.links.new(factor, n.inputs["Factor"])
        return n.outputs["Result"]

    def step(value, at, soft=0.04):
        n = new("ShaderNodeMapRange")
        n.inputs["From Min"].default_value = at - soft
        n.inputs["From Max"].default_value = at + soft
        n.inputs["To Min"].default_value = 0.0
        n.inputs["To Max"].default_value = 1.0
        n.clamp = True
        t.links.new(value, n.inputs["Value"])
        return n.outputs[0]

    def times(value, by):
        n = new("ShaderNodeMath")
        n.operation = "MULTIPLY"
        t.links.new(value, n.inputs[0])
        n.inputs[1].default_value = by
        return n.outputs[0]

    diffuse = new("ShaderNodeBsdfDiffuse")
    to_rgb = new("ShaderNodeShaderToRGB")
    grey = new("ShaderNodeRGBToBW")
    t.links.new(diffuse.outputs[0], to_rgb.inputs[0])
    t.links.new(to_rgb.outputs[0], grey.inputs[0])
    lit = step(grey.outputs[0], 0.40, 0.025)

    # Hair seen from behind (the bob's inner layers) always takes the shadow tone.
    geometry = new("ShaderNodeNewGeometry")
    front = new("ShaderNodeMath")
    front.operation = "SUBTRACT"
    front.inputs[0].default_value = 1.0
    t.links.new(geometry.outputs["Backfacing"], front.inputs[1])
    both = new("ShaderNodeMath")
    both.operation = "MULTIPLY"
    t.links.new(lit, both.inputs[0])
    t.links.new(front.outputs[0], both.inputs[1])
    lit = both.outputs[0]

    tip = attr("tip")
    light = mix(pal.HAIR, pal.HAIR_TIP, times(tip, 0.75))
    dark = mix(pal.HAIR_SHADE, pal.HAIR_DEEP, times(tip, 0.6))
    colour = mix(dark, light, lit)
    colour = mix(colour, pal.HAIR_SHADE, times(attr("tone"), LOCK_TONE))  # each lock a slightly different tone
    colour = mix(colour, pal.HAIR_PONY, times(attr("tint"), PONY_TINT))  # the ponytail reads apart from the bob
    colour = mix(colour, pal.HAIR_PONY_END, times(attr("pony_fade"), PONY_FADE))  # and deepens to the stocking's blue at its tips

    band = step(attr("ring"), 0.5, 0.06)
    band_lit = new("ShaderNodeMath")
    band_lit.operation = "MULTIPLY"
    t.links.new(band, band_lit.inputs[0])
    t.links.new(lit, band_lit.inputs[1])
    colour = mix(colour, pal.HAIR_HIGHLIGHT, band_lit.outputs[0])

    # The cyan fades in from pale hair and is painted last, so no white band crosses it.
    strip = attr("strip")
    cyan = mix(pal.HAIR_STRIP_DEEP, pal.HAIR_STRIP, lit)
    colour = mix(colour, cyan, strip)

    emit = new("ShaderNodeEmission")
    out = new("ShaderNodeOutputMaterial")
    t.links.new(colour, emit.inputs[0])
    t.links.new(emit.outputs[0], out.inputs[0])
    return m


def unit(v):
    v = np.asarray(v, float)
    return v / np.linalg.norm(v)


def radial_hit(tree, co, axis_xy):
    """Where a ray coming in horizontally toward her head's axis first meets the bob. None if it misses."""
    d = co[:2] - axis_xy
    r = np.linalg.norm(d)
    if r < 1e-5:
        return None, None
    d = d / r
    origin = (axis_xy[0] + d[0] * 0.45, axis_xy[1] + d[1] * 0.45, co[2])
    hit = tree.ray_cast(origin, (-d[0], -d[1], 0.0), 0.45)[0]
    if hit is None:
        return None, None
    return np.linalg.norm(np.array(hit[:2]) - axis_xy), d


def hang_chain(start, out, length, half_width, bob_tree, body_tree, axis_xy):
    """The ponytail's centre line, simulated: gravity pulls it down, her head and shoulder hold it off."""
    n = CHAIN_NODES
    seg = length / (n - 1)
    x = np.zeros((n, 3))
    for i in range(n):
        x[i] = start + out * seg * min(i, CHAIN_PINNED - 1) + np.array([0, 0, -seg]) * max(0, i - CHAIN_PINNED + 1)
    pinned = x[:CHAIN_PINNED].copy()
    previous = x.copy()
    gravity = np.array([0.0, 0.0, -0.00022])
    table = np.array(GATHER)
    for _ in range(CHAIN_STEPS):
        step = (x - previous) * 0.96
        previous = x.copy()
        x = x + step + gravity
        x[CHAIN_PINNED:] += FALL_FORWARD  # it was settling on top of her shoulder: this tips it off, to the front
        x[:CHAIN_PINNED] = pinned
        for _ in range(30):
            d = x[1:] - x[:-1]
            r = np.maximum(np.linalg.norm(d, axis=1)[:, None], 1e-6)
            fix = d * (1 - seg / r) * 0.5
            x[:-1] += fix
            x[1:] -= fix
            bend = (x[:-2] + x[2:] - 2 * x[1:-1]) * 0.12  # hair resists bending a little
            x[1:-1] += bend
            x[:CHAIN_PINNED] = pinned
        for i in range(CHAIN_PINNED, n):
            room = CONTACT_GAP + half_width * np.interp((i / (n - 1)), table[:, 0], table[:, 1]) * 0.45
            radius, direction = radial_hit(bob_tree, x[i], axis_xy)
            if radius is not None:
                now = np.linalg.norm(x[i, :2] - axis_xy)
                if now < radius + room:
                    x[i, :2] = axis_xy + direction * (radius + room)
                    previous[i] = previous[i] * CONTACT_DRAG + x[i] * (1 - CONTACT_DRAG)  # contact slows it a little, so it can slide off
            hit, normal, _, dist = body_tree.find_nearest(tuple(x[i]))
            if hit is not None:
                hit, normal = np.array(hit), np.array(normal)
                gap = float(np.dot(x[i] - hit, normal))
                if -CONTACT_DEEPEST < gap < room:  # deeper than this the nearest surface is the wrong side of the cloth, and a push would throw the chain
                    x[i] = hit + normal * room
                    previous[i] = previous[i] * CONTACT_DRAG + x[i] * (1 - CONTACT_DRAG)
    return rounded(x, length)


def gather_at(u):
    """The ponytail's width at positions along it: the GATHER table with its corners rounded off."""
    table = np.array(GATHER)
    grid = np.linspace(0, 1, 401)
    values = np.interp(grid, table[:, 0], table[:, 1])
    kernel = np.exp(-0.5 * (np.arange(-40, 41) / 8.0) ** 2)
    kernel /= kernel.sum()
    return np.interp(u, grid, np.convolve(np.pad(values, 40, mode="edge"), kernel, mode="valid"))


def rounded(x, length):
    """Rounds off the chain's corners and restores its exact length."""
    for _ in range(CHAIN_SMOOTHING):
        x[1:-1] = (x[:-2] + 2 * x[1:-1] + x[2:]) / 4
    return resampled(x, length)


def resampled(x, length):
    """The chain re-spaced to exactly its true length, so gravity cannot have stretched the hair."""
    gaps = np.linalg.norm(x[1:] - x[:-1], axis=1)
    run = np.r_[0.0, np.cumsum(gaps)]
    wanted = np.linspace(0, min(length, run[-1]), len(x))
    return np.column_stack([np.interp(wanted, run, x[:, c]) for c in range(3)])


def press_against(p, edges, bob_tree, body_tree, axis_xy):
    """Hair that would go through her head or body is compressed against it, keeping its layers in order."""
    def squeeze(gap):
        return CONTACT_GAP * np.exp((gap - CONTACT_GAP) / CONTACT_GAP) if gap < CONTACT_GAP else gap

    moved = p.copy()
    touched = np.zeros(len(p), bool)
    for i, co in enumerate(p):
        radius, direction = radial_hit(bob_tree, co, axis_xy)
        if radius is not None:
            gap = np.linalg.norm(co[:2] - axis_xy) - radius
            if gap < CONTACT_GAP:
                moved[i, :2] = axis_xy + direction * (radius + squeeze(gap))
                touched[i] = True
        hit, normal, _, _ = body_tree.find_nearest(tuple(moved[i]))
        if hit is not None:
            hit, normal = np.array(hit), np.array(normal)
            gap = float(np.dot(moved[i] - hit, normal))
            if gap < CONTACT_GAP:
                moved[i] = hit + normal * squeeze(gap)
                touched[i] = True
    change = bm.smooth_field(moved - p, edges, bm.grow(touched, edges, 8), 30)
    print("hair_ponytail pressed", int(touched.sum()), "of", len(p))
    return p + change


def place_ponytail(verts, faces, labels, bob, body_tree, centre):
    """Hangs the ponytail from a tie on the side of her bob. Returns its points, the tie point and direction."""
    root = verts[verts[:, 2] > verts[:, 2].max() - 0.012].mean(0)
    tip = verts[verts[:, 2] < verts[:, 2].min() + 0.03].mean(0)
    old_axis = unit(tip - root)
    old_length = np.dot(tip - root, old_axis)
    rel = verts - root
    along = rel @ old_axis
    side = (rel - along[:, None] * old_axis) * PONY_SCALE
    old_e1 = unit(np.cross(old_axis, (0.0, 1.0, 0.0)))
    if old_e1[0] > 0:
        old_e1 = -old_e1
    old_e2 = np.cross(old_axis, old_e1)
    width_1, width_2 = side @ old_e1, side @ old_e2
    half_width = float(np.percentile(np.abs(width_1), 85))

    me = bob.data
    bob_points = bm.get_co(bob)
    bob_tree = BVHTree.FromPolygons(bob_points.tolist(), [list(f.vertices) for f in me.polygons], all_triangles=False)
    out = unit(PONY_OUT)
    axis_xy = centre[:2].copy()
    hit = bob_tree.ray_cast(tuple(centre + out * 0.5), tuple(-out), 1.0)[0]
    assert hit is not None, "the ponytail root missed the bob"
    start = np.array(hit) - out * 0.004
    length = old_length * PONY_SCALE * PONY_LENGTH
    leaving = unit(out + np.array([-0.15, 0.0, 0.35]))  # the hair leaves the tie angled up, then gravity takes it
    line = hang_chain(start, leaving, length, half_width, bob_tree, body_tree, axis_xy)
    n = len(line)
    print("hair_ponytail tip", line[-1].round(3), "length", round(float(length), 3))

    # Each lock's own top end goes to the tie, so all of them start there and none end in the open.
    u = np.zeros(len(verts))
    for k in np.unique(labels):
        here = labels == k
        first = along[here].min()
        u[here] = (along[here] - first) / max(old_length - first, 1e-4)
    u = np.clip(u, 0, 1)
    position = u * (n - 1)
    low = np.clip(position.astype(int), 0, n - 2)
    f = (position - low)[:, None]
    centre_line = line[low] * (1 - f) + line[low + 1] * f
    tangents = np.gradient(line, axis=0)
    tangents /= np.linalg.norm(tangents, axis=1)[:, None]
    tangent = tangents[low] * (1 - f) + tangents[low + 1] * f
    tangent /= np.linalg.norm(tangent, axis=1)[:, None]

    # The width direction is carried smoothly round the arc, node by node, so it cannot twist.
    frame = np.zeros_like(tangents)
    away = np.array([out[0], out[1], 0.0])
    frame[0] = -unit(away - np.dot(away, tangents[0]) * tangents[0])  # after the arc this faces away from her head
    for i in range(1, n):
        frame[i] = unit(frame[i - 1] - np.dot(frame[i - 1], tangents[i]) * tangents[i])
    e1 = frame[low] * (1 - f) + frame[low + 1] * f
    e1 /= np.linalg.norm(e1, axis=1)[:, None]
    e2 = np.cross(tangent, e1)
    gather = gather_at(u)
    placed = centre_line + e1 * (width_1 * gather)[:, None] + e2 * (width_2 * gather)[:, None]

    pairs = sorted({tuple(sorted(e)) for f_ in faces for e in zip(f_, f_[1:] + f_[:1])})
    placed = press_against(placed, np.array(pairs), bob_tree, body_tree, axis_xy)
    # The band sits on the head's surface, over the point the hair comes out of.
    ring_centre = start + out * 0.0075
    e1, e2 = ring_axes(out)
    rel = placed - ring_centre
    root_part = (u < 0.08) & (np.linalg.norm(rel, axis=1) < 0.07)
    radius = (float(np.percentile(np.abs(rel[root_part] @ e1), 96)), float(np.percentile(np.abs(rel[root_part] @ e2), 96)))
    return placed, ring_centre, out, radius, bob_tree, u


def ring_axes(normal):
    """Two directions lying in the plane of the band."""
    e1 = unit(np.cross(normal, (0.0, 1.0, 0.0)))
    return e1, np.cross(normal, e1)


def mesh_object(name, points, faces, material):
    me = bpy.data.meshes.new(name)
    me.from_pydata(np.array(points).tolist(), [], faces)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.materials.append(material)
    return ob


def add_tie(point, normal, radius, bob_tree):
    """A flat pale-gold band lying on her head over the ponytail's root, and a small five-point star on it."""
    e1, e2 = ring_axes(normal)
    rx, ry = radius[0] + BAND_MARGIN, radius[1] + BAND_MARGIN

    # The band follows the curve of the bob across its whole width: each edge is dropped onto the surface below.
    around, tube = 72, 10
    inner, outer = -0.75 * BAND_WIDTH, 0.25 * BAND_WIDTH

    def surface_ring(spread):
        lift = np.zeros(around)
        for i in range(around):
            a = 2 * np.pi * i / around
            spot = point + (rx + spread) * np.cos(a) * e1 + (ry + spread) * np.sin(a) * e2
            hit = bob_tree.ray_cast(tuple(spot + normal * 0.06), tuple(-normal), 0.12)[0]
            lift[i] = float(np.dot(np.array(hit) - point, normal)) if hit is not None else np.nan
        good = ~np.isnan(lift)
        angles = np.arange(around)
        lift = np.interp(angles, angles[good], lift[good], period=around)
        kernel = np.array([1, 2, 3, 2, 1]) / 9
        return np.convolve(np.r_[lift[-2:], lift, lift[:2]], kernel, mode="valid")

    lift_in, lift_out = surface_ring(inner), surface_ring(outer)

    points, faces = [], []
    for i in range(around):
        a = 2 * np.pi * i / around
        for j in range(tube):
            b = 2 * np.pi * j / tube
            across = np.cos(b) * 0.5 + 0.5
            spread = inner + (outer - inner) * across
            height = lift_in[i] + (lift_out[i] - lift_in[i]) * across
            offset = (rx + spread) * np.cos(a) * e1 + (ry + spread) * np.sin(a) * e2
            points.append(point + offset + normal * (height + 0.0022 + BAND_HEIGHT * np.sin(b)))
    for i in range(around):
        for j in range(tube):
            n, m = (i + 1) % around, (j + 1) % tube
            faces.append([i * tube + j, n * tube + j, n * tube + m, i * tube + m])
    mesh_object("hair_tie", points, faces, mt.toon("hair_tie", pal.ZIP, pal.ZIP_DARK, cut=0.4, soft=0.02))

    # The star sits on the part of the band facing forward and up, turned a little toward the viewer.
    flat = unit(np.array([0.0, -1.0, 0.45]) - normal * np.dot(np.array([0.0, -1.0, 0.45]), normal))
    k = int(((np.arctan2(np.dot(flat, e2) / ry, np.dot(flat, e1) / rx) % (2 * np.pi)) / (2 * np.pi)) * around) % around
    spot = point + np.dot(flat, e1) * rx * e1 + np.dot(flat, e2) * ry * e2 + normal * (lift_out[k] + 0.009)
    facing = unit(normal + np.array([0.0, -0.8, 0.1]))
    up = unit(np.array([0.0, 0.0, 1.0]) - facing * facing[2])
    right = np.cross(facing, up)
    points, faces = [], []
    count = 10
    for layer in (0.0026, -0.0026):
        for i in range(count):
            a = np.pi / 2 + 2 * np.pi * i / count
            r = STAR_RADIUS if i % 2 == 0 else STAR_RADIUS * 0.45
            points.append(spot + r * np.cos(a) * right + r * np.sin(a) * up + layer * facing)
    faces.append(list(range(count)))
    faces.append(list(range(2 * count - 1, count - 1, -1)))
    for i in range(count):
        n = (i + 1) % count
        faces.append([i, i + count, n + count, n])
    star = mesh_object("hair_star", points, faces, mt.toon("hair_star", pal.STAR, pal.TATTOO_RIM, cut=0.25, soft=0.02))
    star.data.polygons.foreach_set("use_smooth", [False] * len(star.data.polygons))
    star.data.update()


def add_piece(name, source, keep, mirror_only, target_skin, tree, material, line, body_tree=None, bob=None):
    hair, face, others = import_sample(source)
    source_skin = skin_points(face, SKIN_SOURCE_SLOT)
    verts, faces, labels, across = take_hair(hair, keep)
    # The samples face +y. The bob is turned round; the ponytail is mirrored so it lands on her right.
    mapped = np.array([1.0, -1.0, 1.0]) if mirror_only else np.array([-1.0, -1.0, 1.0])
    s, offset = fit(source_skin, target_skin, mapped)
    verts = verts * mapped * s + offset
    if mirror_only:
        faces = [list(reversed(f)) for f in faces]
    for o in [hair, face] + others:
        bpy.data.objects.remove(o)
    centre = (target_skin.min(0) + target_skin.max(0)) / 2
    placement = None
    if mirror_only:
        verts, faces, labels, across = refine(verts, faces, across)
        verts, *placement = place_ponytail(verts, faces, labels, bob, body_tree, centre)
    moved = push_out_of_head(verts, tree)
    ob, inv = build_object(name, verts, faces, labels, across, material, centre)
    print(name, "verts", len(verts), "pieces", inv.max() + 1, "scale", round(float(s), 4), "pushed out", moved)
    mod = mt.add_outline(ob, line, HULL)
    mod.vertex_group = "outline_w"
    mod.thickness_vertex_group = 0.0
    return ob, verts, inv, placement


def body_collider(body):
    """Her body and hoodie as one collision shape, from the meshes themselves and not their outline shells."""
    points, polys = [], []
    for ob in [body] + [o for o in bpy.data.objects if o.name == "hoodie"]:
        base = len(points)
        points.extend(bm.get_co(ob).tolist())
        co = bm.get_co(ob)
        # The ponytail rests on the hoodie's shoulder and sleeve; the hood behind her neck must not catch it.
        wanted = [f for f in ob.data.polygons if ob is body or np.abs(co[list(f.vertices), 0]).min() > HOOD_HALF_WIDTH]
        polys.extend([base + v for v in f.vertices] for f in wanted)
    pivot = np.array(bm.HEAD_PIVOT)
    points = np.array(points)
    below = points[:, 2] < HEAD_BOTTOM
    points[below] = pivot + (points[below] - pivot) / bm.HEAD_SCALE
    return BVHTree.FromPolygons(points.tolist(), polys, all_triangles=False)


def main():
    body = bpy.data.objects["Body"]
    face = bpy.data.objects["Face"]
    tree = head_tree(body, face)
    target_skin = skin_points(face, "face_skin")
    material = hair_material()
    line = mt.outline_material("outline_hair", pal.HAIR_LINE)
    bob, verts, inv, _ = add_piece("hair_bob", BOB_SOURCE, keep_bob, False, target_skin, tree, material, line)
    paint_strip(bob, verts, inv)
    bpy.context.view_layer.update()
    _, _, _, (tie_point, normal, radius, bob_tree, chain_t) = add_piece(
        "hair_ponytail", PONY_SOURCE, keep_pony, True, target_skin, tree, material, line, body_collider(body), bob
    )
    add_tie(tie_point, normal, radius, bob_tree)
    pony = bpy.data.objects["hair_ponytail"]
    height = bm.get_co(pony)[:, 2]
    fade = np.clip((height.max() - height) / (height.max() - height.min()), 0, 1) ** PONY_FADE_CURVE
    pony.data.attributes.new("pony_fade", "FLOAT", "POINT").data.foreach_set("value", fade.astype(np.float32))
    pony.data.attributes.new("chain_t", "FLOAT", "POINT").data.foreach_set("value", chain_t.astype(np.float32))  # its place along the hanging line, for the rig
    bpy.ops.wm.save_as_mainfile(filepath=str(bm.ROOT / "spica-v2-hair.blend"))


if __name__ == "__main__":
    main()
