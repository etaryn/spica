# Joins review renders side by side. Args: <output.png> <max width> <cols> <input.png> [input.png ...].
import sys

from PIL import Image

out, max_w, cols, *paths = sys.argv[1:]
images = [Image.open(p).convert("RGB") for p in paths]
cols = int(cols)
h_max = max(i.height for i in images)
w_max = max(i.width for i in images)
rows = (len(images) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w_max, rows * h_max), (214, 214, 226))
for k, im in enumerate(images):
    sheet.paste(im, ((k % cols) * w_max + (w_max - im.width) // 2, (k // cols) * h_max))
sheet.thumbnail((int(max_w), 4000))
sheet.save(out)
