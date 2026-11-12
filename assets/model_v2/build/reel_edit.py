# Reads and checks a reel's edit list and maps each shot's frames onto her clips. Plain Python, no Blender, so it tests in a second.
# The format is the seam with main's reel engine (docs/orbit/o1-reels-spec.md): change a field there first. Scroll reels: docs/orbit/o1-scroll-reel-spec.md.
import json
import numbers
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # the repo: build, model_v2, assets, repo
FIELDS = ("clip", "start", "frames", "face", "azimuth", "elevation", "framing", "x")
RANGES = {"azimuth": (-180, 180), "elevation": (-30, 30), "x": (0, 1)}
SWIPE_FRAMES = 8  # a swipe's scroll, a third of a second
SWIPE_GAP = 48  # frames between swipes and from either end of the reel: one gesture, wind-up to arm down, is about 36


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


def check_size(edit):
    for k in ("width", "height"):
        if not is_int(edit.get(k)) or edit[k] <= 0 or edit[k] % 2:
            raise ValueError("%s must be a positive even number of pixels (H.264 needs even sizes), not %r" % (k, edit.get(k)))


def validate(edit, manifest):
    """Everything the renderer reads; raises on the first bad field, naming its shot."""
    check_size(edit)
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


def validate_scroll(edit, faces, root=ROOT):
    """A scroll reel's edit list; raises on the first bad field. Video lengths and sound need Blender (reel_review.check_feed)."""
    check_size(edit)
    n = edit.get("frames")
    if not is_int(n) or n < 1:
        raise ValueError("frames must be a whole number from 1, not %r" % n)
    pairs = edit.get("faces")
    if not isinstance(pairs, list) or not pairs:
        raise ValueError("no faces")
    for p in pairs:
        if not (isinstance(p, list) and len(p) == 2 and is_int(p[0])):
            raise ValueError("a face must be [frame, name], not %r" % (p,))
        if p[1] not in faces:
            raise ValueError("unknown face %r" % p[1])
    at = [p[0] for p in pairs]
    if at[0] != 1 or any(b <= a for a, b in zip(at, at[1:])) or at[-1] > n:
        raise ValueError("face frames %s must start at 1, rise, and stay inside the reel's %d frames" % (at, n))
    swipes = edit.get("swipes")
    if not isinstance(swipes, list) or not all(is_int(s) for s in swipes):
        raise ValueError("swipes must be a list of frames, not %r" % (swipes,))
    marks = [1] + swipes + [n]
    if swipes and any(b - a < SWIPE_GAP for a, b in zip(marks, marks[1:])):
        raise ValueError("swipes %s must rise, at least %d frames apart and from either end of the reel's %d" % (swipes, SWIPE_GAP, n))
    feed = edit.get("feed")
    if not isinstance(feed, list) or len(feed) != len(swipes) + 1:
        raise ValueError("the feed needs %d videos, one more than the swipes" % (len(swipes) + 1))
    for k, video in enumerate(feed, 1):
        if not isinstance(video, dict) or "file" not in video:
            raise ValueError("feed video %d: no file" % k)
        if not resolve(video["file"], root).is_file():
            raise ValueError("feed video %d: %s not found" % (k, resolve(video["file"], root)))
        offset = video.get("offset", 0)
        if not is_number(offset) or offset < 0:
            raise ValueError("feed video %d: offset %r must be 0 or more seconds" % (k, offset))


def face_at(faces, frame):
    """Her expression at a frame: the last [frame, name] pair at or before it."""
    return [name for f, name in faces if f <= frame][-1]


def feed_spans(edit):
    """Each feed video's (first frame, end frame) on screen, end exclusive: it comes in with the swipe before it and leaves when the swipe after it ends."""
    swipes = edit["swipes"]
    return list(zip([1] + swipes, [s + SWIPE_FRAMES for s in swipes] + [edit["frames"] + 1]))


def sound_spans(edit):
    """Each feed video's sound, the same way: it switches as a swipe starts."""
    swipes = edit["swipes"]
    return list(zip([1] + swipes, swipes + [edit["frames"] + 1]))


def scroll_shot(edit, clip):
    """A scroll reel as one shot of the old edit list, so reel.py renders it as any shot: her full body, front on, her face per frame."""
    shot = {"clip": clip, "start": 0, "frames": edit["frames"], "face": edit["faces"][0][1], "faces": edit["faces"], "azimuth": 0, "elevation": 0, "framing": "full", "x": 0.5}
    return {"width": edit["width"], "height": edit["height"], "shots": [shot]}


def preview(edit):
    """Half size for checking her motion, kept even for H.264."""
    return dict(edit, width=edit["width"] // 4 * 2, height=edit["height"] // 4 * 2)
