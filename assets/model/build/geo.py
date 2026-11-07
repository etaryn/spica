"""Small geometry helpers shared by the build scripts: lofted tubes and Catmull-Rom curves."""
import math

import bmesh
from mathutils import Vector

V = Vector


def loft_bm(secs, sides=16, cap0=True, apex=False, hint=(0, -1, 0)):
    """Closed tube along a path. secs = [(point, a, b)]; a and b are the ellipse radii across the
    path (a along T x hint). apex=True closes the last section to a point."""
    bm = bmesh.new()
    hint = V(hint).normalized()
    pts = [V(s[0]) for s in secs]
    rings = []
    for i in range(len(secs) - (1 if apex else 0)):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[i] - pts[i - 1]
        else:
            t = pts[i + 1] - pts[i - 1]
        t = t.normalized()
        h = hint if abs(t.dot(hint)) < 0.95 else V((1, 0, 0))
        u = t.cross(h).normalized()
        v = t.cross(u).normalized()
        _, a, b = secs[i]
        rings.append([bm.verts.new(pts[i] + u * a * math.cos(2 * math.pi * k / sides)
                                   + v * b * math.sin(2 * math.pi * k / sides)) for k in range(sides)])
    for i in range(len(rings) - 1):
        for k in range(sides):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % sides],
                          rings[i + 1][(k + 1) % sides], rings[i + 1][k]))
    if cap0:
        bm.faces.new(rings[0])
    if apex:
        tip = bm.verts.new(pts[-1])
        for k in range(sides):
            bm.faces.new((rings[-1][k], rings[-1][(k + 1) % sides], tip))
    else:
        bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return bm


def spline(pts, n):
    """n+1 points on a Catmull-Rom curve through pts, each with its position along the control list."""
    out = []
    for i in range(n + 1):
        s = i / n * (len(pts) - 1)
        k = min(int(s), len(pts) - 2)
        t = s - k
        p0, p1, p2, p3 = pts[max(k - 1, 0)], pts[k], pts[k + 1], pts[min(k + 2, len(pts) - 1)]
        out.append((0.5 * ((2 * p1) + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                           + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3), s))
    return out
