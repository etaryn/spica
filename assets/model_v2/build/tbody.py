# Finishes her T-pose body: the head at its final size, and the top of her arm brought level with the base of her neck. Runs on spica-v2-head-t.blend, saves spica-v2-tbody.blend.
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import accents
import base_mesh as bm
import body as bd

FADE_Z, HEAD_Z = (1.05, 1.22), (1.335, 1.37)


def top_at(points, x):
    q = points[(np.abs(np.abs(points[:, 0]) - x) < 0.005) & (points[:, 2] > 1.05) & (points[:, 2] < 1.40)]
    return float(q[:, 2].max())


def neck_base(points):
    """Where her neck starts widening into her shoulders: a quarter wider than its narrowest."""
    heights = np.arange(1.42, 1.20, -0.004)
    rows = []
    for h in heights:
        q = points[(np.abs(points[:, 2] - h) < 0.004) & (np.abs(points[:, 0]) < 0.09)]
        rows.append(np.abs(q[:, 0]).max() if len(q) else np.nan)
    rows = np.array(rows)
    i = int(np.nanargmin(np.where((heights > 1.27) & (heights < 1.36), rows, np.nan)))
    return next(float(heights[j]) for j in range(i, len(heights)) if rows[j] > rows[i] * 1.25)


def main():
    accents.HEAD_PARTS = tuple(n for n in ("Face", "face_outline", "accent_face_mouth") if n in bpy.data.objects)
    accents.shrink_head()
    body = bpy.data.objects["Body"]
    p = bm.get_co(body)
    limb = bm.vertices_in_sets(body, bm.PARTS["arm"] | bm.PARTS["hand"])
    side, z = np.abs(p[:, 0]), p[:, 2]
    base = neck_base(p)
    full = base - float(np.median([top_at(p, x) for x in np.arange(0.20, 0.46, 0.02)]))
    across = np.arange(0.03, 0.17, 0.005)
    needed = bd.smoothed(np.clip(base - np.array([top_at(p, x) for x in across]), 0, full), 4.0)
    needed[-6:] = full
    d = np.interp(side, np.r_[0.02, across], np.r_[0.0, needed]) * bd.smoothstep(*FADE_Z, z) * (1 - bd.smoothstep(*HEAD_Z, z))
    d[limb] = full
    p[:, 2] += bm.smooth_field(d, bm.edges_of(body), ~(limb & (side > 0.17)), 36)
    bm.set_co(body, p)
    body["t_lift"] = full
    print("TBODY neck base %.3f, arms raised %.1f cm" % (base, full * 100))
    bpy.ops.wm.save_as_mainfile(filepath=str(bm.ROOT / "spica-v2-tbody.blend"))


if __name__ == "__main__":
    main()
