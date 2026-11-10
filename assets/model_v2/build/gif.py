# Joins a folder's frames into a looping GIF for judging motion. Args: <folder> <output.gif> <ms per frame>.
import sys
from pathlib import Path

from PIL import Image

folder, out, ms = sys.argv[1:]
frames = [Image.open(p).convert("RGB") for p in sorted(Path(folder).glob("f*.png"))]
frames[0].save(out, save_all=True, append_images=frames[1:], duration=int(ms), loop=0)
