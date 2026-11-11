# Reads and checks a reel's edit list and maps each shot's frames onto her clips. Plain Python, no Blender, so it tests in a second.
# The format is the seam with main's reel engine (docs/orbit/o1-reels-spec.md): change a field there first.
import json
import numbers
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # the repo: build, model_v2, assets, repo
FIELDS = ("clip", "start", "frames", "face", "azimuth", "elevation", "framing", "x")
RANGES = {"azimuth": (-180, 180), "elevation": (-30, 30), "x": (0, 1)}


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def resolve(file, root=ROOT):
    p = Path(file)
    return p if p.is_absolute() else Path(root) / p


def fail(n, message):
    raise ValueError("shot %d: %s" % (n, message))


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def is_number(v):
    return isinstance(v, numbers.Real) and not isinstance(v, bool)


def validate(edit, manifest):
    """Everything the renderer reads; raises on the first bad field, naming its shot."""
    for k in ("width", "height"):
        if not is_int(edit.get(k)) or edit[k] <= 0 or edit[k] % 2:
            raise ValueError("%s must be a positive even number of pixels (H.264 needs even sizes), not %r" % (k, edit.get(k)))
    if not edit.get("shots"):
        raise ValueError("no shots")
    clips = {c["name"]: c for c in manifest["clips"]}
    for n, s in enumerate(edit["shots"], 1):
        missing = [k for k in FIELDS if k not in s]
        if missing:
            fail(n, "missing " + ", ".join(missing))
        if s["clip"] not in clips:
            fail(n, "unknown clip %r" % s["clip"])
        if s["face"] not in manifest["faces"]:
            fail(n, "unknown face %r" % s["face"])
        if s["framing"] not in manifest["framings"]:
            fail(n, "unknown framing %r" % s["framing"])
        if not is_int(s["frames"]) or s["frames"] < 1:
            fail(n, "frames must be a whole number from 1, not %r" % s["frames"])
        length = clips[s["clip"]]["frames"]
        if not is_int(s["start"]) or not 0 <= s["start"] < length:
            fail(n, "start %r is outside the clip's %d frames" % (s["start"], length))
        for k, (lo, hi) in RANGES.items():
            if not is_number(s[k]) or not lo <= s[k] <= hi:
                fail(n, "%s %r is outside %s to %s" % (k, s[k], lo, hi))


def validate_backgrounds(edit, root=ROOT):
    """The fields only the compositor reads (the review script here, main's engine there)."""
    for n, s in enumerate(edit["shots"], 1):
        bg = s.get("background")
        if not isinstance(bg, dict) or "file" not in bg:
            fail(n, "no background file")
        if not resolve(bg["file"], root).is_file():
            fail(n, "background %s not found" % resolve(bg["file"], root))
        offset = bg.get("offset", 0)
        if not is_number(offset) or offset < 0:
            fail(n, "background offset %r must be 0 or more seconds" % offset)
        pan = bg.get("pan")
        if not isinstance(pan, list) or len(pan) != 2 or not all(is_number(p) and 0 <= p <= 1 for p in pan):
            fail(n, "background pan %r must be two numbers from 0 to 1" % pan)


def clip_frame(first, last, loops, start, i):
    """The clip frame for shot frame i: a loop wraps within first..last, a one-shot holds last."""
    if loops:
        return first + (start + i) % (last - first + 1)
    return min(first + start + i, last)
