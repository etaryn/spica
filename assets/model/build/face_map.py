"""
Bakes the map from her face's UV layout to front-view positions: for every pixel of the face skin's UV picture, the x and z of that point
of her resting face (NaN where the skin has no front-facing surface: eye and mouth cut-outs, the back of the head). expr_draw.py uses it to
turn a picture drawn in front view (x, z) into a skin overlay in UV space (`to_uv`), which is how tears are layered *under* her eyelashes
(they draw over the skin) and run to the skin's own bottom edge. Her face and its UV never change, so this runs once.
Run: blender -b assets/model/spica-v1.blend -P assets/model/build/face_map.py   -> assets/model/tex/face/uv_xz.npy (N x N x 2, row 0 = v 0)
"""
import os

import bpy
import numpy as np

N = 2048  # twice the overlay size, so the overlay can be averaged down (smooth edges)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tex", "face", "uv_xz.npy")

face = bpy.data.objects["Face"]
bpy.context.view_layer.update()
ev = face.evaluated_get(bpy.context.evaluated_depsgraph_get())
me = ev.to_mesh()
skin = next(i for i, m in enumerate(face.data.materials) if m and m.name == "skin_face")
uv = me.uv_layers.active.data
verts = np.array([ev.matrix_world @ v.co for v in me.vertices], dtype=np.float64)
out = np.full((N, N, 2), np.nan, dtype=np.float32)
me.calc_loop_triangles()
done = 0
for t in me.loop_triangles:
    if me.polygons[t.polygon_index].material_index != skin:
        continue
    p = verts[list(t.vertices)]
    n = np.cross(p[1] - p[0], p[2] - p[0])
    ln = np.linalg.norm(n)
    if ln < 1e-12 or n[1] / ln > -0.25:  # only triangles that face the camera (-Y)
        continue
    q = np.array([uv[i].uv[:] for i in t.loops], dtype=np.float64) * N
    c0, c1 = max(int(np.floor(q[:, 0].min())), 0), min(int(np.ceil(q[:, 0].max())), N - 1)
    r0, r1 = max(int(np.floor(q[:, 1].min())), 0), min(int(np.ceil(q[:, 1].max())), N - 1)
    if c1 < c0 or r1 < r0:
        continue
    cc, rr = np.meshgrid(np.arange(c0, c1 + 1) + 0.5, np.arange(r0, r1 + 1) + 0.5)
    d = (q[1, 1] - q[2, 1]) * (q[0, 0] - q[2, 0]) + (q[2, 0] - q[1, 0]) * (q[0, 1] - q[2, 1])
    if abs(d) < 1e-12:
        continue
    w0 = ((q[1, 1] - q[2, 1]) * (cc - q[2, 0]) + (q[2, 0] - q[1, 0]) * (rr - q[2, 1])) / d
    w1 = ((q[2, 1] - q[0, 1]) * (cc - q[2, 0]) + (q[0, 0] - q[2, 0]) * (rr - q[2, 1])) / d
    w2 = 1 - w0 - w1
    inside = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
    if not inside.any():
        continue
    x = w0 * p[0, 0] + w1 * p[1, 0] + w2 * p[2, 0]
    z = w0 * p[0, 2] + w1 * p[1, 2] + w2 * p[2, 2]
    ri, ci = rr[inside].astype(int) - 0, cc[inside].astype(int) - 0
    out[ri - 0, ci, 0] = x[inside]
    out[ri - 0, ci, 1] = z[inside]
    done += 1
ev.to_mesh_clear()
np.save(OUT, out)
print("UVMAP triangles", done, "pixels", int(np.isfinite(out[..., 0]).sum()), "->", os.path.abspath(OUT))
