"""
Her colours, in one place. The build reads one palette, chosen by the environment variable SPICA_PALETTE (default DEFAULT, "midnight-noir",
her v1 look); run.sh takes the name as its argument. Plain Python (no Blender), so the texture drawing can use it too.

Every palette fills the same slots:
  outline, skin, skin_shade, brow, mouth
  hair, hair_shade, hair_hi (the lightest blobs of the strands toward white), hair_hi2 (the very top of them), streak (the one
  lock of highlights), streak_deep
  iris (rim, middle, glow), eye_hi (the glint)
  hoodie, hoodie_shade (also the hood), lining, lining_shade (inside of the hoodie and its facing)
  shoe, shoe_shade (sneaker uppers: the hoodie's if left out)
  stocking, stocking_shade (the thigh-high on her left leg: the sock's if left out; the ankle sock on her right is `sock`)
  pants, pants_shade, pants_thread, sock, sock_shade, sole, sole_shade
  star_face (the tattoo), star_sock (the stocking's stars), zip_metal, zip_dark
  orbs (True to build the binary star), orb_a / orb_b (cores: white-ish), orb_a_glow / orb_b_glow (halos and the cores' edge)
"""
import os
from types import SimpleNamespace

SKIN = dict(skin="F8E5DC", skin_shade="ECCFC6")  # the same in every palette: she is one character

PALETTES = {
    # the first v1 look (kept): pale violet and blue-white, a cool-white hoodie with a dark-blue lining, dark shorts, violet stars
    "spacey": dict(
        outline="2B2347", brow="463A78", mouth="C9808A",
        hair="CFC6F2", hair_shade="8E86D0", hair_hi="F6F2FF", hair_hi2="F4F0FF", streak="B4DAFF", streak_deep="6E86C8",
        iris=("160E38", "5A44D4", "A9D6FF"), eye_hi="CFEAFF",
        hoodie="E6E7F3", hoodie_shade="CBCDE4", lining="2D3A8C", lining_shade="1C2566",
        pants="34353E", pants_shade="272830", pants_thread="5A5B68", sock="F8F7F4", sock_shade="DAD8E4",
        sole="9D96D8", sole_shade="7670B0", star_face="5A44D4", star_sock="8E86D0", zip_metal="CDD0DA", zip_dark="7F8294",
    ),
    # midnight-noir: a rich deep-space-blue hoodie, stocking and ankle sock, blue-white hair, pale denim shorts, amber-gold stars
    "midnight-noir": dict(
        outline="02051A", brow="16288A", mouth="D08A96",
        hair="DCE7FF", hair_shade="8EA6E8", hair_hi="FFFFFF", hair_hi2="F4F8FF", streak="18D8F2", streak_deep="0A8CBE", strip_band=(1.0, 0.22),
        iris=("020626", "1A78E6", "6CF2FF"), eye_hi="E0FCFF",
        hoodie="0A1250", hoodie_shade="050A33", lining="A99CFF", lining_shade="7C6CE0",
        shoe="E9ECF7", shoe_shade="C9CFE4", stocking="070D3C", stocking_shade="040829",
        pants="E4E8F5", pants_shade="BAC4E0", pants_thread="95A2C8", sock="070D3C", sock_shade="040829",
        sole="E8B84C", sole_shade="B88E32", star_face="FFF2AE", star_sock="FFF1A6", star_glow=True, orbs=True, orb_a="E8FEFF", orb_a_glow="36DCF6", orb_b="FFF6D2", orb_b_glow="FFC24E", zip_metal="EBCB8A", zip_dark="8C7240",
    ),
}

DEFAULT = "midnight-noir"
NAME = os.environ.get("SPICA_PALETTE", DEFAULT)
P = SimpleNamespace(**SKIN, **PALETTES[NAME])
if not hasattr(P, "shoe"):
    P.shoe, P.shoe_shade = P.hoodie, P.hoodie_shade
if not hasattr(P, "orbs"):
    P.orbs = False  # True: the binary star above her head (orb_a, orb_a_glow, orb_b, orb_b_glow)
if not hasattr(P, "strip_band"):
    P.strip_band = None  # (u, width): a band of adjacent strands of the highlight colour down the highlight lock, by the card's UV
if not hasattr(P, "star_glow"):
    P.star_glow = False  # True: the stars are pale, self-lit and translucent, with a soft glow (and a thin warm rim on the tattoo)
if not hasattr(P, "stocking"):
    P.stocking, P.stocking_shade = P.sock, P.sock_shade


def blend(a, b, t):
    """Hex colour t of the way from a to b."""
    return "".join("%02X" % round(int(a[i:i + 2], 16) * (1 - t) + int(b[i:i + 2], 16) * t) for i in (0, 2, 4))


def luminance(h):
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
