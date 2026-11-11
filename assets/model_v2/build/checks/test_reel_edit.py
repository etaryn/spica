# Tests the edit-list reader without Blender: what it rejects, how shots map onto clip frames, and where relative paths point.
import copy
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import reel_edit as re_

MANIFEST = {
    "fps": 24,
    "clips": [{"name": "walk", "frames": 96, "loops": True, "tags": ["walking"]}, {"name": "look_up", "frames": 48, "loops": False, "tags": ["looking_up"]}],
    "faces": ["observing", "soft_smile"],
    "framings": ["full", "waist", "face"],
}
SHOT = {"clip": "walk", "start": 0, "frames": 72, "face": "soft_smile", "azimuth": -32, "elevation": 0, "framing": "full", "x": 0.35}
EDIT = {"width": 1080, "height": 1920, "shots": [SHOT]}


def rejects(change, words):
    edit = copy.deepcopy(EDIT)
    change(edit)
    try:
        re_.validate(edit, MANIFEST)
    except ValueError as e:
        assert words in str(e), "expected %r in %r" % (words, str(e))
        return
    raise AssertionError("accepted a bad edit list: expected " + words)


def test_validate():
    re_.validate(EDIT, MANIFEST)
    two = copy.deepcopy(EDIT)
    two["shots"].append(dict(SHOT, clip="wlak"))
    try:
        re_.validate(two, MANIFEST)
        raise AssertionError("accepted an unknown clip")
    except ValueError as e:
        assert str(e).startswith("shot 2:"), str(e)
    rejects(lambda e: e["shots"][0].update(clip="wlak"), "unknown clip")
    rejects(lambda e: e["shots"][0].update(face="grin"), "unknown face")
    rejects(lambda e: e["shots"][0].update(framing="wide"), "unknown framing")
    rejects(lambda e: e["shots"][0].update(x=1.2), "x")
    rejects(lambda e: e["shots"][0].update(elevation=45), "elevation")
    rejects(lambda e: e["shots"][0].update(azimuth=181), "azimuth")
    rejects(lambda e: e["shots"][0].update(frames=0), "frames")
    rejects(lambda e: e["shots"][0].update(start=96), "start")
    rejects(lambda e: e["shots"][0].update(x=True), "x")
    rejects(lambda e: e["shots"][0].pop("face"), "missing face")
    rejects(lambda e: e.update(width=1081), "width")
    rejects(lambda e: e.update(shots=[]), "no shots")


def test_clip_frame():
    assert [re_.clip_frame(97, 192, True, 0, i) for i in (0, 95, 96, 97)] == [97, 192, 97, 98]
    assert [re_.clip_frame(97, 192, True, 94, i) for i in (0, 1, 2)] == [191, 192, 97]
    assert [re_.clip_frame(97, 192, True, 0, i) for i in (191, 192)] == [192, 97]  # two whole cycles wrap again
    assert [re_.clip_frame(1, 48, False, 46, i) for i in (0, 1, 2, 30)] == [47, 48, 48, 48]


def test_backgrounds():
    with tempfile.TemporaryDirectory() as root:
        root = Path(root)
        (root / "bg.jpg").write_bytes(b"x")
        edit = copy.deepcopy(EDIT)
        edit["shots"][0]["background"] = {"file": "bg.jpg", "offset": 0, "pan": [0.2, 0.6]}
        here = os.getcwd()
        os.chdir(tempfile.gettempdir())  # relative paths follow the repo root, not the working directory
        try:
            re_.validate_backgrounds(edit, root)
        finally:
            os.chdir(here)
        assert re_.resolve("bg.jpg", root) == root / "bg.jpg"
        for bg, words in (({"file": "none.jpg", "pan": [0, 1]}, "not found"), ({"file": "bg.jpg", "pan": [0, 2]}, "pan"), ({"file": "bg.jpg", "pan": [0.5]}, "pan"), ({"file": "bg.jpg", "offset": -1, "pan": [0, 1]}, "offset")):
            edit["shots"][0]["background"] = bg
            try:
                re_.validate_backgrounds(edit, root)
                raise AssertionError("accepted " + str(bg))
            except ValueError as e:
                assert words in str(e) and str(e).startswith("shot 1:"), str(e)
        edit["shots"][0].pop("background")
        try:
            re_.validate_backgrounds(edit, root)
            raise AssertionError("accepted a shot with no background")
        except ValueError as e:
            assert "background" in str(e)
    assert re_.ROOT == Path(__file__).resolve().parents[4], re_.ROOT


if __name__ == "__main__":
    test_validate()
    test_clip_frame()
    test_backgrounds()
    print("REEL_EDIT ok")
