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


FACES = ["observing", "soft_smile", "laugh"]
SCROLL = {
    "width": 1080,
    "height": 1920,
    "frames": 360,
    "faces": [[1, "observing"], [96, "laugh"]],
    "feed": [{"file": "a.mp4", "offset": 0}, {"file": "b.mp4"}, {"file": "a.mp4", "offset": 2.5}],
    "swipes": [130, 250],
}


def scroll_rejects(root, change, words):
    edit = copy.deepcopy(SCROLL)
    change(edit)
    try:
        re_.validate_scroll(edit, FACES, root)
    except ValueError as e:
        assert words in str(e), "expected %r in %r" % (words, str(e))
        return
    raise AssertionError("accepted a bad scroll reel: expected " + words)


def test_scroll():
    with tempfile.TemporaryDirectory() as root:
        root = Path(root)
        for name in ("a.mp4", "b.mp4"):
            (root / name).write_bytes(b"x")
        re_.validate_scroll(SCROLL, FACES, root)
        scroll_rejects(root, lambda e: e["faces"].append([200, "grin"]), "unknown face")
        scroll_rejects(root, lambda e: e["faces"][0].__setitem__(0, 2), "start at 1")
        scroll_rejects(root, lambda e: e["faces"].append([50, "laugh"]), "rise")
        scroll_rejects(root, lambda e: e["faces"].append([361, "laugh"]), "inside")
        scroll_rejects(root, lambda e: e["faces"].append(["x", "laugh"]), "[frame, name]")
        scroll_rejects(root, lambda e: e.update(faces=[]), "no faces")
        scroll_rejects(root, lambda e: e.update(swipes=[130, 160]), "apart")
        scroll_rejects(root, lambda e: e.update(swipes=[250, 130]), "rise")
        scroll_rejects(root, lambda e: e.update(swipes=[30, 250]), "either end")
        scroll_rejects(root, lambda e: e.update(swipes=[130, 330]), "either end")
        scroll_rejects(root, lambda e: e.update(swipes=[130.5, 250]), "list of frames")
        scroll_rejects(root, lambda e: e["feed"].pop(), "one more than the swipes")
        scroll_rejects(root, lambda e: e["feed"][1].update(file="c.mp4"), "feed video 2: ")
        scroll_rejects(root, lambda e: e["feed"][2].update(offset=-1), "feed video 3: offset")
        scroll_rejects(root, lambda e: e["feed"][0].pop("file"), "feed video 1: no file")
        scroll_rejects(root, lambda e: e.update(frames=0), "frames")
        scroll_rejects(root, lambda e: e.update(width=1081), "width")
    assert [re_.face_at(SCROLL["faces"], f) for f in (1, 95, 96, 360)] == ["observing", "observing", "laugh", "laugh"]
    assert re_.feed_spans(SCROLL) == [(1, 138), (130, 258), (250, 361)]
    assert re_.sound_spans(SCROLL) == [(1, 130), (130, 250), (250, 361)]
    edit = re_.scroll_shot(SCROLL, "scroll_test")
    re_.validate(edit, {"clips": [{"name": "scroll_test", "frames": 360, "loops": False}], "faces": FACES, "framings": ["full"]})
    shot = edit["shots"][0]
    assert (shot["face"], shot["faces"], shot["azimuth"], shot["elevation"], shot["framing"], shot["x"]) == ("observing", SCROLL["faces"], 0, 0, "full", 0.5)
    small = re_.preview(SCROLL)
    assert (small["width"], small["height"], SCROLL["width"]) == (540, 960, 1080)


if __name__ == "__main__":
    test_validate()
    test_clip_frame()
    test_backgrounds()
    test_scroll()
    print("REEL_EDIT ok")
