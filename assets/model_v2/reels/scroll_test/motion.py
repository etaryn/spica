# Her motion for the first scroll reel: she watches the feed over her shoulder, turns back to react to the camera, and swipes to the next video.
# motion(arm, frame, edit) gives bone turns in her own axes and a hips offset, the form of the clips in build/clips.py; the reel.json beside it times everything.
# First version: angles and timings are starting values Ethan corrects from the preview.
import math

from mathutils import Quaternion

import clips as c
import reel_edit as re_

LOOK = {c.HIPS: 8, c.SPINE: 12, c.CHEST: 12, c.UPPER_CHEST: 14, c.NECK: 22, c.HEAD: 32}  # degrees each turns toward her left to look back at the feed: 100 in all, an over-the-shoulder glance
LOOK_UP = -6  # her head tips up a little to the screen behind her (negative X tips it back, as in look_up)
LEAD, RECOVER = 12, 16  # frames of wind-up before a swipe's scroll, and of the arm coming down after it
# Her right arm through a swipe, in frames from the scroll's start: upper arm forward (X; negative raises it, as her seated arms), out to her side (Y), forearm bend (X).
# The wind-up keeps the arm out and the forearm open, so her hand rises beside her face rather than across it.
SWIPE = ((-LEAD, 0, 0, 0), (0, -75, 25, -30),(re_.SWIPE_FRAMES, -160, 28, -12), (re_.SWIPE_FRAMES + 3, -160, 28, -12), (re_.SWIPE_FRAMES + RECOVER, 0, 0, 0))
FADE = 6  # frames a reaction takes to come and go


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def window(frame, a, b, c_, d):
    """0 before a, up to 1 by b, held, back to 0 from c_ to d."""
    return smooth((frame - a) / (b - a)) * (1 - smooth((frame - c_) / (d - c_)))


def keyed(t, keys):
    """Values between keys, eased in and out; zeros outside them."""
    for (t0, *a), (t1, *b) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            k = smooth((t - t0) / (t1 - t0))
            return [x + (y - x) * k for x, y in zip(a, b)]
    return [0.0] * (len(keys[0]) - 1)


def looks(edit):
    """When she looks back at the feed: in each stretch between swipes, from soon after the last swipe until 24 frames before the next wind-up, so she has turned back to react first."""
    swipes, n = edit["swipes"], edit["frames"]
    starts = [1] + [s + re_.SWIPE_FRAMES + RECOVER for s in swipes]
    ends = [s - LEAD for s in swipes] + [n]
    return [(a + 8, a + 24, b - 40, b - 24) for a, b in zip(starts, ends) if b - a >= 72]


def react(name, frame):
    """Her body's part of an expression, at full strength, by bone."""
    if name == "laugh":
        return {c.UPPER_CHEST: c.turn("X", 2.5 * math.sin(math.tau * frame / 7)), c.HEAD: c.turn("X", -5)}  # shoulders shake, head tips back
    if name == "curious":
        return {c.UPPER_CHEST: c.turn("X", 4), c.HEAD: c.turn("Y", 8)}  # leans in, head tilted
    if name == "startled":
        return {c.UPPER_CHEST: c.turn("X", -5), c.HEAD: c.turn("X", -4)}  # pulls back
    if name == "soft_smile":
        return {c.HEAD: c.turn("Y", -6)}
    return {}


def motion(arm, frame, edit):
    turns, at = c.idle(arm, frame)
    look = max([window(frame, *w) for w in looks(edit)], default=0.0)
    extra = {bone: c.turn("Z", degrees * look) for bone, degrees in LOOK.items()}
    extra[c.HEAD] = c.turn("X", LOOK_UP * look) @ extra[c.HEAD]
    faces = edit["faces"]
    for (start, name), end in zip(faces, [f for f, _ in faces[1:]] + [edit["frames"] + 1]):
        weight = window(frame, start, start + FADE, end - FADE, end) * (1 - look)
        for bone, q in react(name, frame).items():
            extra[bone] = Quaternion().slerp(q, weight) @ extra.get(bone, Quaternion())
    for s in edit["swipes"]:
        forward, out, bend = keyed(frame - s, SWIPE)
        if forward or out or bend:
            extra[c.B("R", "UpperArm")] = c.turn("Y", out) @ c.turn("X", forward)
            extra[c.B("R", "LowerArm")] = c.turn("X", bend)
    for bone, q in extra.items():
        turns[bone] = q @ turns.get(bone, Quaternion())
    for side in "LR":  # her hips turn with the look; the legs follow so her feet stay where they stand
        turns.update(c.leg(arm, side, c.head_of(arm, c.B(side, "Foot")), 0, turns[c.HIPS], at))
    return turns, at
