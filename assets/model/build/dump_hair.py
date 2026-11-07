"""Prints each hair card's bounds and main bone, to plan the hair edit. Run on spica-v4.blend."""
import bpy
rows = []
for o in bpy.data.objects:
    if o.name.startswith("Hair0") and o.type == "MESH":
        vs = [o.matrix_world @ v.co for v in o.data.vertices]
        mn = [min(v[i] for v in vs) for i in range(3)]
        mx = [max(v[i] for v in vs) for i in range(3)]
        gs = {}
        for v in o.data.vertices:
            for g in v.groups:
                n = o.vertex_groups[g.group].name
                gs[n] = gs.get(n, 0) + g.weight
        bone = max(gs, key=gs.get) if gs else "-"
        rows.append((o.name, [round(x, 3) for x in mn], [round(x, 3) for x in mx], len(o.data.polygons), bone))
for r in rows:
    print("H", r[0], "x", r[1][0], r[2][0], "y", r[1][1], r[2][1], "z", r[1][2], r[2][2], "p", r[3], r[4])
