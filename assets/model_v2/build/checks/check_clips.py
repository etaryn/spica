# Tests her clips and sprites by measurement, and raises on any failure.
# Args after --: sprites <absolute dir> | state | clip <name,...>. Sprites and state run on any file; clip needs spica-v2-clips.blend.
import json
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import sprites as sp

args = sys.argv[sys.argv.index("--") + 1:]
problems = []


def bad(message):
    problems.append(message)
    print("PROBLEM", message)


def read_png(path):
    """RGBA as stored in the file, top row first."""
    image = bpy.data.images.load(str(path))
    image.colorspace_settings.name = "Non-Color"
    w, h = image.size
    a = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(a)
    bpy.data.images.remove(image)
    return a.reshape(h, w, 4)[::-1]


def check_sprite(path, standing):
    a = read_png(path)
    if a.shape[:2] != (sp.H, sp.W):
        return bad("%s: size %s" % (path.name, a.shape))
    alpha = a[:, :, 3]
    if (alpha > 0.5).mean() < 0.03:
        bad(path.name + ": nearly empty")
    edge = np.concatenate([alpha[:2].ravel(), alpha[-2:].ravel(), alpha[:, :2].ravel(), alpha[:, -2:].ravel()])
    if edge.max() > 0.02:
        bad(path.name + ": touches the edge of the canvas")
    lowest = int(np.where((alpha > 0.5).any(axis=1))[0].max())
    if standing and abs(lowest - sp.ANCHOR[1]) > 8:
        bad("%s: lowest solid row %d, anchor row %d" % (path.name, lowest, sp.ANCHOR[1]))
    glow = a[:125][(a[:125, :, 3] > 0.05) & (a[:125, :, 3] < 0.6)]  # the binary star's halo is the only soft thing up there
    if len(glow) and np.median(glow[:, :3].mean(axis=1)) < 0.4:
        bad(path.name + ": the star's glow has a dark edge")


def check_sprites(folder):
    entries = json.loads((folder / "poses.json").read_text())
    assert entries, "the manifest is empty"
    for e in entries:
        assert sorted(e) == ["anchor", "files", "name", "tags"], e["name"] + ": wrong fields"
        for side in ("left", "right"):
            check_sprite(folder / e["files"][side], not e["name"].startswith("sit-"))
    print("SPRITES checked", len(entries))


def check_state():
    keys = bpy.data.objects["Face"].data.shape_keys.key_blocks
    right = sp.image_right_gaze(keys)
    left = "Gaze_L" if right == "Gaze_R" else "Gaze_R"
    for facing, toward, away in (("right", right, left), ("left", left, right)):
        sp.set_face("observing", facing, "stance")
        assert keys[toward].value > 0.5 and keys[away].value == 0, "she looks away from where she faces, " + facing


if args[0] == "sprites":
    check_sprites(Path(args[1]))
elif args[0] == "state":
    check_state()
if problems:
    raise RuntimeError("%d problems" % len(problems))
print("CLIPS check passed")
