# Shrinks a silhouette render to 64 pixels tall, then enlarges it without blurring, for review.
import sys

from PIL import Image

src, out = sys.argv[1:3]
image = Image.open(src).convert("L").resize((45, 64), Image.LANCZOS)
canvas = Image.new("L", (800, 800), 255)
image = image.resize((45 * 10, 64 * 10), Image.NEAREST)
canvas.paste(image, ((800 - image.width) // 2, (800 - image.height) // 2))
canvas.save(out)
