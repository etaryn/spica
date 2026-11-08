"""
Draws the small details on her clothes: a zip and two slanted hand-pocket slits on the hoodie, back pockets on the pants, and
a twill for the pants. Runs on ordinary Python with Pillow and numpy (not inside Blender) and writes PNGs to
assets/model/tex/cloth/ (git-ignored, rebuilt by run.sh):
  hoodie_front.png, hoodie_back.png, pants_front.png, pants_back.png   the details, transparent elsewhere
  face_star.png, sock_star.png   a star each, point up, in a square picture: the tattoo and the stars on the stocking
  blank.png                          nothing (for the side of a garment that has no details)
  denim_weave.png                    a tileable twill: it multiplies the pants' colour
Layout (boxes, colours) is in cloth_layout.py. Everything is drawn 2x too large and shrunk, so edges are smooth.
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw

import cloth_layout as L

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tex", "cloth")
SS = 2


def rgba(h, a=255):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


class Canvas:
    """A transparent picture of a box of cloth: coordinates are (a, b) in metres inside the box (a0, a1, b0, b1)."""

    def __init__(self, w, h, box):
        self.w, self.h, self.box = w * SS, h * SS, box
        self.img = Image.new("RGBA", (self.w, self.h), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img, "RGBA")
        self.m = self.w / (box[1] - box[0])  # pixels per metre

    def p(self, a, b):
        a0, a1, b0, b1 = self.box
        return ((a - a0) / (a1 - a0) * self.w, (1.0 - (b - b0) / (b1 - b0)) * self.h)

    def px(self, metres):
        return max(1.0, metres * self.m)

    def poly(self, pts, fill):
        self.d.polygon([self.p(*q) for q in pts], fill=fill)

    def line(self, pts, color, width):
        P = [self.p(*q) for q in pts]
        self.d.line(P, fill=color, width=int(round(self.px(width))), joint="curve")
        r = self.px(width) / 2
        for q in (P[0], P[-1]):
            self.d.ellipse((q[0] - r, q[1] - r, q[0] + r, q[1] + r), fill=color)

    def dashed(self, pts, color, width, dash, gap):
        pts = resample(pts, min(dash, gap) / 4)
        run, on, cur = 0.0, True, [pts[0]]
        for a, b in zip(pts, pts[1:]):
            run += math.dist(a, b)
            if on:
                cur.append(b)
            if run >= (dash if on else gap):
                if on and len(cur) > 1:
                    self.line(cur, color, width)
                on, run, cur = (not on), 0.0, [b]
        if on and len(cur) > 1:
            self.line(cur, color, width)

    def save(self, name):
        os.makedirs(OUT, exist_ok=True)
        self.img.resize((self.w // SS, self.h // SS), Image.LANCZOS).save(os.path.join(OUT, name))


def resample(pts, step):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.dist(a, b) / step))
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(1, n + 1)]
    return out


def closed(pts):
    return list(pts) + [pts[0]]


def inset(pts, d):
    """A convex polygon moved inward by d."""
    cx = sum(p[0] for p in pts) / len(pts)
    cy = sum(p[1] for p in pts) / len(pts)
    lines = []
    for a, b in zip(pts, pts[1:] + pts[:1]):
        dx, dy = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dy)
        nx, ny = -dy / ln, dx / ln
        if (cx - a[0]) * nx + (cy - a[1]) * ny < 0:
            nx, ny = -nx, -ny
        lines.append(((a[0] + nx * d, a[1] + ny * d), (dx, dy)))
    out = []
    for i in range(len(lines)):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        den = d1[0] * d2[1] - d1[1] * d2[0]
        t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
        out.append((p1[0] + d1[0] * t, p1[1] + d1[1] * t))
    return out


def hoodie_hem(cv):
    """The seam where the hoodie's hem band meets the body (a shade deeper than the cloth) and a row of tone-on-tone stitches above it."""
    top = L.HEM_Z + L.HEM_BAND
    cv.line([(cv.box[0], top + 0.001), (cv.box[1], top + 0.001)], rgba("B4AEC6", 210), 0.0022)
    cv.dashed([(cv.box[0], top + 0.0050), (cv.box[1], top + 0.0050)], rgba("BDB7CF", 255), 0.0010, 0.0032, 0.0018)


def hoodie_back():
    cv = Canvas(2048, 2048, L.HOODIE_BOX)
    hoodie_hem(cv)
    cv.save("hoodie_back.png")


def hoodie_front():
    cv = Canvas(2048, 2048, L.HOODIE_BOX)
    hoodie_hem(cv)
    for sgn in (-1, 1):  # tone-on-tone stitches on the body beside the facing, along the opening
        zs = [L.ZIP_TOP, 1.38]
        cv.dashed([(sgn * (L.OPEN_SLOPE * (z - L.ZIP_TOP) + L.FACING_W + 0.005), z) for z in zs], rgba("BDB7CF", 255), 0.0010, 0.0032, 0.0018)
    z0, z1 = L.ZIP_END + 0.008, L.ZIP_TOP
    # the zip: a tape each side in a slightly deeper off-white, stitched, and the teeth down the middle
    for sgn in (-1, 1):
        cv.poly([(sgn * 0.0020, z0), (sgn * 0.0085, z0), (sgn * 0.0085, z1), (sgn * 0.0020, z1)], rgba("E4DFEC", 235))
        cv.line([(sgn * 0.0074, z0), (sgn * 0.0074, z1)], rgba("BDB7CF", 255), 0.0008)
    pitch, z = 0.0046, z0
    k = 0
    while z + pitch < z1:
        x = -0.0019 if k % 2 == 0 else 0.0003  # teeth interlock: alternate left and right
        cv.poly([(x, z), (x + 0.0017, z), (x + 0.0017, z + pitch * 0.82), (x, z + pitch * 0.82)], rgba(L.ZIP_METAL, 255))
        cv.line([(x, z), (x + 0.0017, z)], rgba(L.ZIP_DARK, 220), 0.0004)
        z += pitch * 0.5
        k += 1
    # the bottom stop, where the zip ends above the hem (the hem below it is split)
    stop = [(-0.0062, L.ZIP_END), (0.0062, L.ZIP_END), (0.0062, z0), (-0.0062, z0)]
    cv.poly(stop, rgba(L.ZIP_METAL, 255))
    cv.line(closed(stop), rgba(L.ZIP_DARK, 255), 0.0009)
    # the slider and its pull
    slider = [(-0.0058, z1 - 0.0120), (0.0058, z1 - 0.0120), (0.0058, z1 + 0.0050), (-0.0058, z1 + 0.0050)]
    cv.poly(slider, rgba(L.ZIP_METAL, 255))
    cv.line(closed(slider), rgba(L.ZIP_DARK, 255), 0.0009)
    pull = [(-0.0042, z1 - 0.0120), (0.0042, z1 - 0.0120), (0.0042, z1 - 0.0320), (-0.0042, z1 - 0.0320)]
    cv.poly(pull, rgba(L.ZIP_METAL, 255))
    cv.line(closed(pull), rgba(L.ZIP_DARK, 255), 0.0009)
    cv.line([(-0.0018, z1 - 0.0250), (0.0018, z1 - 0.0250)], rgba(L.ZIP_DARK, 255), 0.0008)
    # two slanted hand-pocket slits, one each side: only the slit, no pocket behind it
    for sgn in (-1, 1):
        a, b = (sgn * 0.0900, 0.935), (sgn * 0.0780, 1.017)
        cv.line([a, b], rgba("2E2748", 215), 0.0036)  # the opening
        cv.line([(a[0] + sgn * 0.0030, a[1] + 0.0010), (b[0] + sgn * 0.0030, b[1] + 0.0010)], rgba("FFFFFF", 150), 0.0016)  # the lip, catching the light
        for off in (-0.0050, 0.0050):  # tone-on-tone stitching along both sides
            cv.dashed([(a[0] + off, a[1]), (b[0] + off, b[1])], rgba("BDB7CF", 255), 0.0010, 0.0036, 0.0026)
        for e in (a, b):  # bar tacks at both ends
            cv.line([(e[0] - 0.0050, e[1]), (e[0] + 0.0050, e[1])], rgba("9D97B5", 255), 0.0012)
    cv.save("hoodie_front.png")


def pants_front():
    cv = Canvas(2048, 820, L.SHORTS_BOX)
    thread = rgba(L.PANTS_THREAD, 255)
    for w in L.WHISKERS:
        crease(cv, w)
    for sgn in (-1, 1):  # front pockets: the stitched curve of the pocket mouth, from the waist out to the hip
        mouth = resample([(sgn * 0.052, 0.905), (sgn * 0.082, 0.868), (sgn * 0.118, 0.846), (sgn * 0.158, 0.836)], 0.002)
        topstitch(cv, mouth, thread)
    fly = [(0.0145, 0.905), (0.0145, 0.822), (0.0100, 0.803), (0.0, 0.796)]  # the fly: a J of stitching and the seam beside it
    topstitch(cv, resample(fly, 0.002), thread)
    cv.line([(0.0, 0.905), (0.0, 0.796)], rgba("15161C", 150), 0.0020)
    hem_lines(cv, thread)
    cv.save("pants_front.png")


def crease(cv, pts):
    """A crease of the cloth, drawn as shadow: a soft dark band with a darker line in it, both fading out at the ends."""
    pts = resample(pts, 0.002)
    for i, (a, b) in enumerate(zip(pts, pts[1:])):
        k = math.sin(math.pi * (i + 0.5) / (len(pts) - 1)) ** 0.6
        dx, dz = b[0] - a[0], b[1] - a[1]
        ln = math.hypot(dx, dz)
        for alpha, w in ((75, 0.0062), (185, 0.0026)):
            nx, nz = -dz / ln * w / 2, dx / ln * w / 2
            cv.poly([(a[0] + nx, a[1] + nz), (b[0] + nx, b[1] + nz), (b[0] - nx, b[1] - nz), (a[0] - nx, a[1] - nz)], rgba("0A0B10", int(alpha * k)))


def topstitch(cv, pts, thread):
    """A seam of topstitching: a dark groove with a row of stitches in thread the colour of the cloth beside it."""
    cv.line(pts, rgba("15161C", 150), 0.0022)
    cv.dashed([(x, z + 0.0016) for x, z in pts], thread, 0.0013, 0.0034, 0.0014)


def hem_lines(cv, thread):
    """The shorts' rolled hem: two rows of stitching on the band, and the groove where the band meets the leg."""
    for dz in (0.0065, 0.0135):
        topstitch(cv, [(cv.box[0], L.PANTS_HEM + dz), (cv.box[1], L.PANTS_HEM + dz)], thread)
    top = L.PANTS_HEM + L.PANTS_BAND + 0.001
    cv.line([(cv.box[0], top), (cv.box[1], top)], rgba("0A0B10", 130), 0.0030)


def pants_back():
    cv = Canvas(2048, 820, L.SHORTS_BOX)
    thread = rgba(L.PANTS_THREAD, 255)
    for sgn in (-1, 1):  # back pockets, sewn on in thread the colour of the cloth, a touch lighter
        c = sgn * 0.074
        pocket = [(c - 0.043, 0.890), (c + 0.043, 0.890), (c + 0.043, 0.826), (c, 0.804), (c - 0.043, 0.826)]
        cv.poly(pocket, rgba("5A5B68", 45))
        topstitch(cv, closed(pocket), thread)
        topstitch(cv, closed(inset(pocket, 0.0050)), thread)
    for s in L.SMILES:  # the creases under the seat
        crease(cv, s)
    hem_lines(cv, thread)
    cv.save("pants_back.png")


def star_points(cx, cz, radius, turn):
    """The corners of a five-pointed star (a ten-sided outline: the points, and the corners between them)."""
    return [(cx + (radius if k % 2 == 0 else radius * 0.382) * math.cos(math.radians(turn + 90 + 36 * k)),
             cz + (radius if k % 2 == 0 else radius * 0.382) * math.sin(math.radians(turn + 90 + 36 * k))) for k in range(10)]


def star(name, color):
    """A five-pointed star, point up, in the middle of a square picture (the star's outer radius is STAR_FILL of the width)."""
    cv = Canvas(512, 512, (-0.5, 0.5, -0.5, 0.5))
    cv.poly(star_points(0.0, 0.0, L.STAR_FILL, 0), rgba(color))
    cv.save(name)


def denim_weave():
    """A tileable twill: faint diagonal ribs (8 across the 4 cm the tile covers: about 5 mm), blotchy cells, a little noise.
    Grey: it multiplies the pants' colour."""
    n = 1024
    rng = np.random.default_rng(7)
    y, x = np.mgrid[0:n, 0:n]
    twill = ((x + y) % 128) / 128.0  # ribs about 5 mm apart: coarser than the real cloth, so they read at the distance of a full-body render
    ribs = 0.86 + 0.14 * np.clip(1.0 - np.abs(twill - 0.5) * 3.0, 0.0, 1.0)
    cells = np.kron(rng.random((n // 16, n // 16)), np.ones((16, 16)))
    noise = 1.0 + 0.10 * (cells - 0.5) + 0.04 * (rng.random((n, n)) - 0.5)
    g = np.clip(ribs * noise, 0, 1)
    Image.fromarray((g * 255).astype(np.uint8), "L").convert("RGB").save(os.path.join(OUT, "denim_weave.png"))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):  # the textures of earlier looks are not used any more
        if f.endswith(".png"):
            os.remove(os.path.join(OUT, f))
    hoodie_front()
    hoodie_back()
    pants_front()
    pants_back()
    star("face_star.png", L.STAR_FACE)
    star("sock_star.png", L.STAR_SOCK)
    Image.new("RGBA", (16, 16), (0, 0, 0, 0)).save(os.path.join(OUT, "blank.png"))
    denim_weave()
    print("textures written to", OUT)
