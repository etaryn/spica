"""
Draws the small extras that are pictures rather than shape keys or skin overlays (Pillow, outside Blender), for the face decal
(face_decal.py): the neutral mouth line, the blush marks; and the tear stream as a skin overlay (to_uv). Only expressions with `decal=True` in
expr_defs.py get one. Mouths, teeth, tongues, closed eyes, blush and gloom are her mesh and the pack's overlay textures now.
Run: python assets/model/build/expr_draw.py   -> assets/model/tex/face/<name>.png and decal.json
The picture covers a front patch of her face: x -0.085..0.085 m, z 1.375..1.52 m, PX metres per pixel (shared with face_decal.py).
Z is up, she faces -Y; her left is +X, so on the picture her left is on the right.
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw

import expr_defs
import palette

P = palette.P
X0, X1, Z0, Z1, PX = -0.085, 0.085, 1.375, 1.52, 0.00015
W, H = round((X1 - X0) / PX), round((Z1 - Z0) / PX)
SS = 4  # draw at 4x and shrink, for smooth edges
EX, EZ = 0.040, 1.457  # eye centre (her left; mirror for her right)
MZ = 1.405  # mouth centre height
INK = "#" + P.outline
LINE = "#7A2F42"
WHITE = "#F6FAFF"
TEAR = "#7CE8FF"
TEAR_X = 0.0375  # the middle of a closed eye (her left; mirror for her right)
SHADE_CUT = 90  # where the pack's shadow (alpha 255 at the top fading to 0) is cut: higher cuts higher up the face
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tex", "face")


class Pic:
    def __init__(self):
        self.im = Image.new("RGBA", (W * SS, H * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def px(self, x, z):
        return ((x - X0) / PX * SS, (Z1 - z) / PX * SS)

    def pts(self, pp):
        return [self.px(x, z) for x, z in pp]

    def stroke(self, pp, w, col=INK):  # a round brush stamped along the path: smooth edges at any width
        q, r = self.pts(pp), w / PX * SS / 2
        for (x0, y0), (x1, y1) in zip(q, q[1:]) if len(q) > 1 else [(q[0], q[0])]:
            n = max(1, int(math.hypot(x1 - x0, y1 - y0) / max(r / 3, 1)))
            for i in range(n + 1):
                x, y = x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n
                self.d.ellipse((x - r, y - r, x + r, y + r), fill=col)

    def poly(self, pp, fill, edge=None, w=0.0013):
        self.d.polygon(self.pts(pp), fill=fill)
        if edge:
            self.stroke(list(pp) + [pp[0]], w, edge)

    def ell(self, cx, cz, rx, rz, fill, edge=None, w=0.0013):
        self.poly(arc(cx, cz, rx, rz, 0, 360, 48)[:-1], fill, edge, w)

    def group(self, fn, alpha):  # draw `fn` on its own layer, then lay it over, translucent (alpha 0..255)
        top = Pic()
        fn(top)
        top.im.putalpha(top.im.getchannel("A").point(lambda v: v * alpha // 255))
        self.im = Image.alpha_composite(self.im, top.im)
        self.d = ImageDraw.Draw(self.im)

    def soft_ell(self, cx, cz, rx, rz, col, peak):
        """A blended blush: an ellipse whose colour fades smoothly to nothing at its edge (peak = alpha at the middle, 0..255)."""
        import numpy as np
        x0, y0 = self.px(cx - rx, cz + rz)
        x1, y1 = self.px(cx + rx, cz - rz)
        w, h = int(x1 - x0) + 1, int(y1 - y0) + 1
        yy, xx = np.mgrid[0:h, 0:w]
        r = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
        a = (np.clip(1 - r, 0, 1) ** 0.9 * peak).astype("uint8")
        layer = Image.new("RGBA", (w, h), col)
        layer.putalpha(Image.fromarray(a, "L"))
        self.im.alpha_composite(layer, (int(x0), int(y0)))

    def final(self):  # the finished picture at its real size
        return self.im.convert("RGBa").resize((W, H), Image.BOX).convert("RGBA")

    def save(self, name):
        os.makedirs(OUT, exist_ok=True)
        self.final().save(os.path.join(OUT, name + ".png"))


UVMAP = os.path.join(OUT, "uv_xz.npy")  # face_map.py: the x, z of her resting face at every pixel of its skin's UV picture


def to_uv(im):
    """Turn a front-view picture (RGBA, the patch) into a skin overlay in her face's UV layout (1024 x 1024): each skin pixel takes the
    colour of the picture at its place on her face. Laid on the skin, it sits under her eyelash and eyebrow layers and ends at the skin's
    own edge. The map is twice as fine as the result, which averages 2 x 2 for smooth edges."""
    m = np.load(UVMAP)
    a = np.asarray(im, dtype=np.float32) / 255.0
    a[..., :3] *= a[..., 3:4]  # premultiplied, so edges blend cleanly
    fx, fy = (m[..., 0] - X0) / PX - 0.5, (Z1 - m[..., 1]) / PX - 0.5
    ok = np.isfinite(fx) & np.isfinite(fy) & (fx >= 0) & (fy >= 0) & (fx <= W - 1.001) & (fy <= H - 1.001)
    x0, y0 = np.floor(np.where(ok, fx, 0)).astype(int), np.floor(np.where(ok, fy, 0)).astype(int)
    tx, ty = (np.where(ok, fx, 0) - x0)[..., None], (np.where(ok, fy, 0) - y0)[..., None]
    out = (a[y0, x0] * (1 - tx) * (1 - ty) + a[y0, x0 + 1] * tx * (1 - ty) + a[y0 + 1, x0] * (1 - tx) * ty + a[y0 + 1, x0 + 1] * tx * ty) * ok[..., None]
    n = out.shape[0] // 2
    out = out.reshape(n, 2, n, 2, 4).mean(axis=(1, 3))
    rgb = np.where(out[..., 3:4] > 1e-4, out[..., :3] / np.maximum(out[..., 3:4], 1e-4), 0)
    res = np.concatenate([rgb, out[..., 3:4]], axis=-1)
    return Image.fromarray(np.flipud((res * 255 + 0.5).clip(0, 255).astype(np.uint8)), "RGBA")  # row 0 of the file is the top of the UV picture


def arc(cx, cz, rx, rz, a0, a1, n=32):
    return [(cx + rx * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cz + rz * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def m_line(p, w=0.007):  # her neutral mouth: a short thin line (kept as Ethan liked it)
    p.stroke([(-w, MZ), (w, MZ)], 0.0022, INK)


def tear_stream(p, s):
    """A thick tear stream from a closed eye, down to the bottom of her face: over half the eye wide (0.027 at the top, 0.022 at the
    bottom, of the eye's 0.05), two flat tones, translucent, no outline. It is drawn from inside the eye's cut-out (where her skin has no
    surface, so nothing is laid there) down to the patch's lower edge; as a skin overlay it sits under her eyelash layers and ends at
    the skin's own edge, her jaw."""
    x, z0, z1, w0, w1 = s * TEAR_X, 1.4620, Z0, 0.0270, 0.0220
    top = lambda f: x - w0 / 2 + w0 * f  # f: 0 at the left edge of the stream, 1 at the right
    bot = lambda f: x - w1 / 2 + w1 * f

    def band(f0):  # the part of the stream from f0 to the right edge
        return [(top(f0), z0), (top(1), z0), (bot(1), z1), (bot(f0), z1)]

    def body(q):
        q.poly(band(0.0), "#8FE4FF")
        q.poly(band(0.67), "#62CBEC")  # the darker right third
    p.group(body, 205)
    for f, wd in ((0.14, 0.0016), (0.30, 0.0007)):  # two highlight stripes down the left
        p.stroke([(top(f), z0 - 0.012), (bot(f), z1 + 0.004)], wd, "#F4FDFF")


# blush on the cheeks, drawn here (not the pack's overlay): a soft blended glow with //// lines on top (Ethan's pick)
BLUSH_X, BLUSH_Z = 0.0455, 1.4310  # the middle of a cheek's blush (her left; mirrored), just under the eye


def blush_lines(p):  # //// on each cheek
    def marks(q):
        for sgn in (-1, 1):
            for i in range(4):
                cx = sgn * BLUSH_X + (i - 1.5) * 0.0042
                q.stroke([(cx - 0.0026, BLUSH_Z - 0.0034), (cx + 0.0026, BLUSH_Z + 0.0038)], 0.0016, "#EE6482")
    p.group(marks, 235)


def blush_soft(p):  # a blended pink glow on each cheek
    for sgn in (-1, 1):
        p.soft_ell(sgn * BLUSH_X, BLUSH_Z, 0.0165, 0.0098, "#F7788E", 235)


def smile_line(p, w=0.0125):  # a soft thin line smile: a gentle curve, as thin as sad_old's mouth line (0.34 mm, measured)
    n = 24
    p.stroke([(w * (2 * i / n - 1), MZ - 0.0016 + 0.0030 * (2 * i / n - 1) ** 2) for i in range(n + 1)], 0.00034, INK)


def wavy(p, w=0.011, amp=0.0022, waves=2.0):  # a small unsure wobble of a mouth
    n = 60
    p.stroke([(-w + 2 * w * i / n, MZ + amp * math.sin(i / n * waves * 2 * math.pi)) for i in range(n + 1)], 0.0022, INK)


def flat_line(p, w=0.009):  # a flat mouth, a touch off-centre
    p.stroke([(-w, MZ), (w + 0.001, MZ - 0.0008)], 0.0022, INK)


PICTURES_UV = {  # drawn in front view, laid on the skin in UV space (to_uv): under her eyelashes
    "cry": lambda p: (tear_stream(p, -1), tear_stream(p, 1)),
}

PICTURES = {
    "neutral": lambda p: m_line(p),
    "cross_eyed": lambda p: m_line(p),
    "soft_smile": lambda p: smile_line(p),
    "flustered": lambda p: (blush_soft(p), blush_lines(p)),
    "shy": lambda p: (blush_soft(p), blush_lines(p)),
    "confused": lambda p: wavy(p),
    "bored": lambda p: flat_line(p),
}

FRONT = {}  # pictures drawn over her eyes (the decal's front layer): none now; the doodles used it and were removed


def flat_overlays():
    """A hard-edged version of the pack's soft overlay picture (her look is flat tones, not blended): the frightened shadow."""
    src = os.path.join(OUT, "shade_1.png")
    if os.path.exists(src):  # the pack's forehead shadow fades out toward the cheeks: cut it at one level for a clear boundary
        a = Image.open(src).convert("RGBA").getchannel("A").point(lambda v: 255 if v > SHADE_CUT else 0)
        hard = Image.new("RGBA", a.size, (52, 62, 196, 0))
        hard.putalpha(a)
        hard.save(os.path.join(OUT, "shade_hard.png"))


if __name__ == "__main__":
    wanted = [n for n, e in expr_defs.EXPRESSIONS.items() if e.get("decal")]
    back = [n for n in wanted if n in PICTURES]
    front = [n for n in wanted if n in FRONT]
    for name in back:
        pic = Pic()
        PICTURES[name](pic)
        pic.save(name)
    for name in front:
        pic = Pic()
        FRONT[name](pic)
        pic.save(name + "_front")
    os.makedirs(OUT, exist_ok=True)
    for name, draw in PICTURES_UV.items():
        pic = Pic()
        draw(pic)
        to_uv(pic.final()).save(os.path.join(OUT, name + "_uv.png"))
    flat_overlays()
    with open(os.path.join(OUT, "decal.json"), "w") as f:  # what Blender needs (it has no Pillow)
        json.dump(dict(patch=[X0, X1, Z0, Z1], back=back, front=front), f)
    print("DREW back", back, "front", front, "->", os.path.abspath(OUT))
