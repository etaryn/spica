"""
Where things go on her clothes and what colour they are, shared by cloth_tex.py (which draws the textures) and clothes.py
(which lays them on the cloth). All lengths are metres in her rest pose (T-pose, she faces -Y, her left is +X, Z up).
A front or back texture covers a box (x0, x1, z0, z1) of her body seen from the front or the back.
"""
HOODIE_BOX = (-0.30, 0.30, 0.80, 1.40)
SHORTS_BOX = (-0.22, 0.22, 0.74, 0.92)
HEM_Z = 0.855  # the hoodie's hem: low enough to cover the top of the shorts' back pockets
ARM_Y, ARM_Z = 0.025, 1.287  # an arm's axis in the T-pose (the shoulder joint): it runs along x from here
ZIP_TOP = 1.22  # where the zip's slider sits: above it the hoodie hangs open
OPEN_SLOPE = 0.7  # the opening above the slider is a V: half-width = OPEN_SLOPE * (z - ZIP_TOP)
PANTS_HEM = 0.763  # the pants' lower edge (just below her crotch)
HEM_BAND, PANTS_BAND = 0.010, 0.019  # height of the hoodie's hem band and of the shorts' rolled hem, above their lower edges
ZIP_END = HEM_Z + HEM_BAND + 0.006  # the zip ends here, above the hoodie's hem band; below it the hem is split in two
FACING_W = 0.014  # width of the facing (the lining turned out) along the opening
HEM_SPLIT = 0.006  # half the width of the slot between the two halves of the hem
# Denim creases, as (x, z) polylines on the front and on the back, not mirrored (her left is +x): a few whiskers from the fly out to
# each hip, different on each leg, and a smile line under each seat. clothes.py folds the cloth along them, cloth_tex.py draws
# them as shadow.
def smooth_line(pts, rounds=3):
    """A polyline with its corners rounded off (Chaikin), the two ends kept."""
    for _ in range(rounds):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        pts = out + [pts[-1]]
    return pts


WHISKERS = [smooth_line(w) for w in (
    [(0.036, 0.800), (0.082, 0.808), (0.128, 0.826)],
    [(0.040, 0.811), (0.090, 0.823), (0.138, 0.847)],
    [(0.054, 0.792), (0.088, 0.797), (0.114, 0.806)],
    [(-0.034, 0.805), (-0.070, 0.813), (-0.104, 0.831)],
    [(-0.046, 0.793), (-0.095, 0.797), (-0.133, 0.806)],
)]
SMILES = [smooth_line(w) for w in (
    [(0.145, 0.832), (0.112, 0.809), (0.072, 0.798), (0.034, 0.801), (0.014, 0.813)],
    [(-0.128, 0.820), (-0.098, 0.802), (-0.062, 0.794), (-0.030, 0.799)],
)]

# a cool off-white base, a spacey violet accent, greyish-black pants
HOODIE, HOODIE_SHADE = "E6E7F3", "CBCDE4"  # the hoodie, its hood and the sneakers' uppers: a cool white, so it separates from her warm skin
SOCK, SOCK_SHADE = "F8F7F4", "DAD8E4"  # the socks: a clean off-white, nearly white, with the hoodie's cool shadow
SOCK_TOP_LONG, SOCK_TOP_SHORT = 0.700, 0.190  # where the thigh-high sock (her left leg) and the ankle sock (her right) end
SOCK_BAND = 0.022  # height of the ribbed band at the top of a sock
# Stars (Ethan): a small tattoo under the outer corner of her left eye, and a few big ones on the thigh-high stocking. Drawn as
# pictures (cloth_tex.py) and laid on the surface in the shader, so they lie flush on it and stay on it as she moves.
STAR_FACE, STAR_SOCK = "5A44D4", "8E86D0"  # the tattoo's colour (the iris's mid violet) and the stocking stars' (the hair's shadow tone)
FACE_STAR = (0.058, 1.4245, 0.0045)  # x, z of its centre (metres, rest pose, her left is +x) and its outer radius; the picture lies flat on the skin there
SOCK_STARS = [(0.585, -32, 0.070, 0), (0.415, 135, 0.064, -10), (0.245, -105, 0.052, 14)]  # three stars round the thigh-high: height, angle round the leg (0 is the front, + toward her left), outer radius, turn in degrees
STAR_FILL = 0.45  # a star's outer radius as a fraction of the width of its picture
LINING, LINING_SHADE = "2D3A8C", "1C2566"  # the inside of the hoodie and the facing along its opening: a spacey dark blue, darker than her hair
PANTS, PANTS_SHADE, PANTS_THREAD = "34353E", "272830", "5A5B68"
SOLE_TONE, SOLE_TONE_SHADE = "9D96D8", "7670B0"  # the sneaker soles: a muted periwinkle, between the hair's base and shadow tones
OUTLINE = "2B2347"
ZIP_METAL, ZIP_DARK = "CDD0DA", "7F8294"
