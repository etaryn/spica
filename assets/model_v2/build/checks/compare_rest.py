# Compares two folders of renders of the same views and fails if her look changed.
import sys
from pathlib import Path

import numpy as np
from PIL import Image

before, after = map(Path, sys.argv[1:3])
worst = 0.0
for f in sorted(before.glob("*.png")):
    a = np.asarray(Image.open(f).convert("RGB"), float)
    b = np.asarray(Image.open(after / f.name).convert("RGB"), float)
    share = float((np.abs(a - b).max(2) > 8).mean())
    worst = max(worst, share)
    print(f.name, "pixels changed %.4f%%" % (share * 100))
assert worst < 0.002, "her look changed"
print("SAME")
