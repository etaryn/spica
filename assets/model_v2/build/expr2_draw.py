# Draws what her second set of expressions needs as pictures: closed mouths as tapered ink lines, flat colour on her skin, and the water in her eyes. Run expr2_lids.py in Blender first.
# Run outside Blender: python -I assets/model_v2/build/expr2_draw.py   -> assets/model/tex/face/set2/
import json
import math
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent / "model" / "build"))
import expr_draw as d  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

OUT = HERE.parent.parent / "model" / "tex" / "face" / "set2"
MZ, INK = d.MZ, d.INK
LID_Z = 1.4505  # just under the lashes of her open eye
TATTOO_CLEAR = 0.058  # the blush stops short of her star tattoo
WATER = "#9CE6FF"  # every tear is this one flat, solid colour
TEARS_START = 1.4615  # inside the opening of her eye, below her upper lid, so no tear on her skin has a visible top
WEEP_X, WEEP_TOP, WEEP_END, WEEP_RADIUS, WEEP_STRIP = 0.0535, 1.445, 1.3975, 0.0092, 0.0053  # the long tear in her own measurements: near the outer corner of her eye (0.066), starting inside the opening, ending over part of her star
TONGUE_X, TONGUE_HALF, TONGUE_TALL, MOUTH_HALF = 0.0080, 0.0126, 0.0085, 0.0225  # the drawn tongue: its middle, on the right as you look at her; half its width; its height; and half the width of the mouth under it


def ink(p, points, width, taper=0.45):
    """A brush line that thins toward both ends, the way a drawn mouth does."""
    n = len(points) - 1
    for i in range(n):
        t = (i + 0.5) / n
        w = width * (taper + (1 - taper) * math.sin(math.pi * t) ** 0.6)
        p.stroke([points[i], points[i + 1]], w, INK)


def curve(x0, x1, z, lift=0.0, tilt=0.0, n=40):
    """A mouth line from x0 to x1: lift raises the ends above the middle (negative turns it down), tilt raises the right end over the left."""
    mid = (x0 + x1) / 2
    half = (x1 - x0) / 2
    return [(mid + half * s, z + lift * s * s + tilt * s / 2) for s in (2 * i / n - 1 for i in range(n + 1))]


def base_line(p):
    d.m_line(p)


def deadpan(p):
    ink(p, curve(-0.0105, 0.0105, MZ, 0, 0), 0.0015, 0.8)


def pulled(p, side, length=0.0125):
    x = side * 0.0035
    ink(p, curve(x - length / 2, x + length / 2, MZ - 0.0004, 0.0006, side * 0.0012), 0.0016)


def smirk(p):
    """Flat from the middle, then it rises only on her left, toward the star. A small crease closes the raised corner."""
    n = 40
    pts = [(-0.0095 + 0.0225 * i / n, MZ - 0.0007 + 0.0058 * (i / n) ** 2.6) for i in range(n + 1)]
    ink(p, pts, 0.0017, 0.55)
    x, z = pts[-1]
    ink(p, [(x - 0.0003, z + 0.0013), (x + 0.0005, z), (x + 0.0002, z - 0.0011)], 0.0006, 0.5)


def smile(p, width, lift, weight, drop=0.0014):
    ink(p, curve(-width, width, MZ - drop, lift, 0), weight, 0.35)


def soft(p):
    smile(p, 0.0135, 0.0040, 0.0009)


def amused(p):
    n = 40
    pts = [(-0.0110 + 0.0225 * i / n, MZ - 0.0012 + 0.0040 * ((2 * i / n - 1) ** 2) + 0.0014 * i / n) for i in range(n + 1)]
    ink(p, pts, 0.0013, 0.4)


def fond(p):
    smile(p, 0.0125, 0.0036, 0.0010)


def thinking(p):
    ink(p, curve(-0.0120, -0.0005, MZ - 0.0006, 0.0005, -0.0016), 0.0015)
    ink(p, [(-0.0127, MZ + 0.0016), (-0.0121, MZ - 0.0000), (-0.0127, MZ - 0.0014)], 0.0007, 0.5)


def wobble(p, width, amp, waves, weight):
    n = 70
    pts = [(width * (2 * i / n - 1), MZ + amp * math.sin(i / n * waves * 2 * math.pi) * (1 - 0.3 * abs(2 * i / n - 1))) for i in range(n + 1)]
    ink(p, pts, weight, 0.5)


def flustered(p):
    wobble(p, 0.0078, 0.0015, 1.0, 0.0014)


def shy(p):
    smile(p, 0.0062, 0.0014, 0.0011, 0.0006)


def hurt(p):
    ink(p, curve(-0.0072, 0.0072, MZ - 0.0002, -0.0012, 0), 0.0010, 0.4)


def tear_mouth(p):
    ink(p, curve(-0.0065, 0.0065, MZ, -0.0009, 0), 0.0012, 0.4)


def sorry(p):
    n = 40
    pts = [(-0.0068 + 0.0136 * i / n, MZ - 0.0004 + 0.0010 * (2 * i / n - 1) ** 2 - 0.0013 * i / n) for i in range(n + 1)]
    ink(p, pts, 0.0011, 0.4)


def annoyed(p):
    ink(p, curve(-0.0085, 0.0065, MZ + 0.0002, -0.0008, -0.0018), 0.0019, 0.6)


def tongue_up(p):
    """A closed mouth, drawn wide, with a tongue poking up from its right side."""
    ink(p, curve(-MOUTH_HALF, MOUTH_HALF, MZ, 0.0005, 0.0006), 0.0015, 0.7)
    shape = d.arc(TONGUE_X, MZ + 0.0003, TONGUE_HALF, TONGUE_TALL, 0, 180)
    p.poly(shape, "#EE98A4")
    p.stroke(shape, 0.0010, INK)


def drowsy(p):
    ink(p, curve(-0.0058, 0.0058, MZ - 0.0002, -0.0005, 0), 0.0012, 0.5)


LINES = {
    "observing": base_line,
    "deadpan": deadpan,
    "side_eye": lambda p: pulled(p, 1),
    "eye_roll": lambda p: ink(p, curve(-0.0085, 0.0085, MZ, -0.0003, 0), 0.0016, 0.8),
    "skeptical": lambda p: ink(p, curve(-0.0095, 0.0095, MZ, 0.0002, 0.0034), 0.0016),
    "smirk": smirk,
    "amused": amused,
    "thinking": thinking,
    "soft_smile": soft,
    "fond": fond,
    "flustered": flustered,
    "shy": shy,
    "quiet_hurt": hurt,
    "teary": tear_mouth,
    "sorry": sorry,
    "annoyed": annoyed,
    "drowsy": drowsy,
    "tongue_focus": tongue_up,
    "pout": lambda p: (ink(p, curve(-0.0066, 0.0066, MZ + 0.0008, -0.0034, 0), 0.0019, 0.55), ink(p, curve(-0.0028, 0.0028, MZ - 0.0034, 0.0008, 0), 0.0006, 0.3)),
}


def blush(p, alpha, half_width, half_height, hatch):
    """A flat lens of colour across each cheek, pointed at both ends and slanting down toward the middle of her face, with a few thin strokes over it."""

    def shapes(q):
        for s in (-1, 1):
            centre, z = s * 0.0445, d.BLUSH_Z - 0.0015
            pts = []
            for a in range(0, 360, 6):
                c, r = math.cos(math.radians(a)), math.sin(math.radians(a))
                pts.append((centre + half_width * c, z + half_height * r * (1 - c * c) ** 0.35 + s * 0.14 * half_width * c))
            q.poly([(min(x, TATTOO_CLEAR), z_) for x, z_ in pts], "#F4A6AE")
            for i in range(hatch):
                x = centre + (i - (hatch - 1) / 2) * 0.0058
                x = min(x, TATTOO_CLEAR - 0.0035)
                q.stroke([(x - 0.0017, z - 0.0026), (x + 0.0017, z + 0.0026)], 0.0007, "#E8798C")

    p.group(shapes, alpha)


def flush(p):
    """Her cheeks going pink when she is crying: a flat shape, no lines."""
    blush(p, 120, 0.0165, 0.0042, 0)


def fright_uv():
    """The shadow over her upper face when she is frightened: flat navy down to an uneven edge under her eyes. Worked out on the skin itself, so it reaches her hairline."""
    m = np.load(d.UVMAP)
    x, z = m[..., 0], m[..., 1]
    edge = 1.4375 + 0.0028 * np.sin(x * 190) + 0.0014 * np.sin(x * 470 + 1)
    on = (np.isfinite(x) & np.isfinite(z) & (np.nan_to_num(z) > np.nan_to_num(edge))).astype(np.float32)
    n = on.shape[0] // 2
    alpha = on.reshape(n, 2, n, 2).mean(axis=(1, 3))
    out = np.zeros((n, n, 4), np.uint8)
    out[..., :3] = (52, 62, 196)
    out[..., 3] = (alpha * 255 + 0.5).astype(np.uint8)
    return Image.fromarray(np.flipud(out), "RGBA")


def streams(p):
    """Crying: two flowing ribbons of water, flat and solid, starting inside the opening of her eye so her lashes cover where they begin, and running to her jaw."""
    n = 60
    for s in (-1, 1):
        left, right = [], []
        for i in range(n + 1):
            t = i / n
            z = TEARS_START + (d.Z0 - TEARS_START) * t
            sway = 0.0016 * math.sin(t * 7.5 + s) + 0.0007 * math.sin(t * 19 + 2 * s)
            w = 0.0190 + (0.0120 - 0.0190) * t + 0.0009 * math.sin(t * 13 + s)
            x = s * d.TEAR_X + sway
            left.append((x - w / 2, z))
            right.append((x + w / 2, z))
        p.poly(left + right[::-1], WATER)


def droopy(p):
    """Between teary and crying: one long tear on the side of her star, from inside her eye to a round end that partly covers the star."""
    p.stroke([(WEEP_X, WEEP_TOP), (WEEP_X, WEEP_END)], WEEP_STRIP, WATER)
    p.ell(WEEP_X, WEEP_END, WEEP_RADIUS, WEEP_RADIUS, WATER)


class WaterPic(d.Pic):
    """A picture of the water patch over her eyes, in her own measured coordinates."""

    def __init__(self, rect):
        self.rect = rect
        self.w, self.h = round((rect[1] - rect[0]) / d.PX), round((rect[3] - rect[2]) / d.PX)
        self.im = Image.new("RGBA", (self.w * d.SS, self.h * d.SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.im)

    def px(self, x, z):
        return ((x - self.rect[0]) / d.PX * d.SS, (self.rect[3] - z) / d.PX * d.SS)

    def group(self, fn, alpha):
        top = WaterPic(self.rect)
        fn(top)
        top.im.putalpha(top.im.getchannel("A").point(lambda v: v * alpha // 255))
        self.im = Image.alpha_composite(self.im, top.im)
        self.d = ImageDraw.Draw(self.im)

    def final(self):
        return self.im.convert("RGBa").resize((self.w, self.h), Image.BOX).convert("RGBA")


def along(chain, n=60):
    """The lid line, evenly spaced from the corner by her nose (0) to the outer corner (1)."""
    a = np.array(chain, float)
    lengths = np.r_[0, np.cumsum(np.linalg.norm(np.diff(a, axis=0), axis=1))]
    t = np.linspace(0, lengths[-1], n + 1)
    return np.c_[np.interp(t, lengths, a[:, 0]), np.interp(t, lengths, a[:, 1])]


def droplet_on_lid(p, chain, half_width, half_height, drop, out):
    """One flat solid droplet at the outer corner of a lower lid."""
    line = along(chain)
    x, z = line[-1]
    p.ell(float(x) + (1 if line[-1, 0] > line[0, 0] else -1) * out, float(z) - drop, half_width, half_height, WATER)


# half width, half height, how far below the corner, how far outward
DROPLETS = {"teary": (0.0110, 0.0080, 0.0030, 0.0025)}


UV = {
    "s2_blush": lambda p: blush(p, 200, 0.0185, 0.0050, 4),
    "s2_blush_light": lambda p: blush(p, 140, 0.0150, 0.0036, 3),
    "s2_flush": flush,
    "s2_cry": lambda p: (flush(p), streams(p)),
}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for name, draw in LINES.items():
        pic = d.Pic()
        draw(pic)
        pic.final().save(OUT / (name + ".png"))
    for name, draw in UV.items():
        pic = d.Pic()
        draw(pic)
        d.to_uv(pic.final()).save(OUT / (name + "_uv.png"))
    fright_uv().save(OUT / "s2_fright_uv.png")
    measured = json.loads((OUT / "lids.json").read_text())
    for name, size in DROPLETS.items():
        pic = WaterPic(measured["rect"])
        for letter in "LR":
            droplet_on_lid(pic, measured["lids"][name][letter], *size)
        pic.final().save(OUT / (name + "_water.png"))
    pic = WaterPic(measured["rect"])
    droopy(pic)
    pic.final().save(OUT / "weeping_water.png")
    print("DREW", len(LINES), "lines,", len(UV), "skin pictures,", len(DROPLETS), "water pictures")
