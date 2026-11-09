"""
Copies a richer set of face shape keys onto her Face from a reference VRoid model that already has them (the Expression Pack's
"Reference Model.vrm": ARKit-style mouth shapes, fang / shark / vampire teeth, a tongue, eyeBlink lids, Eye_Fun / Eye_Joy arches, many brow
and eye shapes; 174 keys). Her Face and the reference Face are the same VRoid face (8,280 polygons, the same eight material slots)
but number their vertices differently, so a vertex is matched through its UV position and material slot (the two eyes share
UVs: the nearest one after turning the reference to face -Y wins). Each key is her own Basis plus the reference key's offsets, turned
to face -Y and scaled to her smaller face.
`transfer(vrm_path)` is called from a Blender session that has her Face; it only adds keys (her Fcl_* keys stay). Imported by
expressions.py (and later by the build); runs nothing on its own. The reference model is git-ignored (assets/references/).
"""
import os
import shutil
import tempfile

import bpy
from mathutils import Vector

SCALE = 0.88  # her face is about 0.88 of the reference face's width


def transfer(vrm_path, scale=SCALE, skip=("Basis", "Edited by Expression Pack")):
    mine = bpy.data.objects["Face"]
    me = mine.data
    before = set(bpy.data.objects)
    tmp = os.path.join(tempfile.gettempdir(), "spica_ref_face.glb")  # the .vrm is a glb; copy so the add-on-free importer reads it
    shutil.copy(vrm_path, tmp)
    bpy.ops.import_scene.gltf(filepath=tmp)
    new = [o for o in bpy.data.objects if o not in before]
    ref = next(o for o in new if o.type == "MESH" and o.name.startswith("Face") and o.data.shape_keys)
    assert len(ref.data.vertices) == len(me.vertices), "reference face has a different vertex count"
    rc = [Vector((-v.co.x, -v.co.y, v.co.z)) for v in ref.data.vertices]  # turned to face -Y
    mc = [v.co.copy() for v in me.shape_keys.key_blocks["Basis"].data]

    def keys_by_vertex(o):
        uv = o.data.uv_layers.active.data
        out = {}
        for p in o.data.polygons:
            for li in p.loop_indices:
                u = uv[li].uv
                out.setdefault(o.data.loops[li].vertex_index, set()).add((p.material_index, round(u[0], 4), round(u[1], 4)))
        return out

    km, kr = keys_by_vertex(mine), keys_by_vertex(ref)
    by_key = {}
    for vi, s in kr.items():
        for k in s:
            by_key.setdefault(k, []).append(vi)
    match = []
    for vi in range(len(me.vertices)):
        cands = {c for k in km[vi] for c in by_key.get(k, [])}
        assert cands, "a vertex of hers has no UV match"
        match.append(min(cands, key=lambda c: (mc[vi] - rc[c]).length))
    rbasis = [Vector((-d.co.x, -d.co.y, d.co.z)) for d in ref.data.shape_keys.key_blocks["Basis"].data]
    added = []
    for kb in ref.data.shape_keys.key_blocks:
        if kb.name in skip or kb.name.startswith("-") or kb.name in me.shape_keys.key_blocks:
            continue
        new_kb = mine.shape_key_add(name=kb.name, from_mix=False)
        new_kb.value = 0.0  # a new key starts at 1
        new_kb.slider_min, new_kb.slider_max = -10.0, 10.0  # the pack's presets drive some keys far past 100%
        for i, j in enumerate(match):
            d = Vector((-kb.data[j].co.x, -kb.data[j].co.y, kb.data[j].co.z)) - rbasis[j]
            new_kb.data[i].co = mc[i] + d * scale
        added.append(kb.name)
    for o in new:  # the reference model was only a source
        bpy.data.objects.remove(o)
    return added
