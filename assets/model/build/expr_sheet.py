"""
Contact sheets of the expression renders, six to a sheet (3 x 2), labelled. Run with `python -I` from the build folder or the repo:
  python -I assets/model/build/expr_sheet.py <dir> [face|mouth] [names...]   -> <dir>/<mode>-sheet-1.png, -2.png ...
"""
import os
import re
import sys

from PIL import Image, ImageDraw

d = sys.argv[1]
mode = "mouth" if "mouth" in sys.argv[2:] else "face"
here = os.path.dirname(os.path.abspath(__file__))
every = re.findall(r'^    "(\w+)": dict\(', open(os.path.join(here, "expr_defs.py")).read(), re.M)  # the order in expr_defs.py
names = [a for a in sys.argv[2:] if a in every] or every
S = 600
for s in range(0, len(names), 6):
    sheet = Image.new("RGB", (S * 3, S * 2), (214, 212, 224))
    for i, n in enumerate(names[s:s + 6]):
        im = Image.open(os.path.join(d, f"{mode}-{n}.png")).convert("RGBA")
        sheet.paste(im, ((i % 3) * S, (i // 3) * S), im)
        ImageDraw.Draw(sheet).text(((i % 3) * S + 10, (i // 3) * S + 8), n, fill=(20, 20, 40))
    sheet.save(os.path.join(d, f"{mode}-sheet-{s // 6 + 1}.png"))
