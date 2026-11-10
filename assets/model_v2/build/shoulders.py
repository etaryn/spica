# Raises her outer shoulders and arms on the arms-down body, keeping her neck where it is. Runs on spica-v2-head.blend, saves spica-v2-shoulders.blend.
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import base_mesh as bm
import body as bd

RESTING_LIFT = 0.025  # Ethan chose this from side-by-side silhouettes
RAMP_X, FADE_Z, HEAD_Z = (0.032, 0.125), (1.05, 1.22), (1.30, 1.34)  # nothing at her neck, all of it at the point of her shoulder; her ribs fade out below; nothing above her shoulders


def ramp(x):
    """Rises quickly from the neck and eases in at the shoulder, so the top line runs straight out with no dip."""
    t = np.clip((x - RAMP_X[0]) / (RAMP_X[1] - RAMP_X[0]), 0, 1)
    return 1 - (1 - t) ** 2


def main():
    body = bpy.data.objects["Body"]
    p = bm.get_co(body)
    limb = bm.vertices_in_sets(body, bm.PARTS["arm"] | bm.PARTS["hand"])
    side, z = np.abs(p[:, 0]), p[:, 2]
    w = ramp(side) * bd.smoothstep(*FADE_Z, z) * (1 - bd.smoothstep(*HEAD_Z, z))
    w[limb] = 1.0
    w = bm.smooth_field(w, bm.edges_of(body), ~(limb & (z < 1.12)), 16)
    p[:, 2] += w * RESTING_LIFT
    bm.set_co(body, p)
    bpy.ops.wm.save_as_mainfile(filepath=str(bm.ROOT / "spica-v2-shoulders.blend"))


if __name__ == "__main__":
    main()
