"""
Switches her face to one of her expressions, in any Blender session that has the built model (spica-v1.blend, which run.sh builds with
face_build.py). The expression names and what they set are in expr_defs.py.
    import face_expr
    face_expr.use("smug")          # sets the shape keys, overlays, the mouth and the decal picture
    face_expr.NAMES                # all of them
The pictures (tex/face/*.png, made by expr_draw.py) are read from disk when an expression is used.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import expr_defs  # noqa: E402
import face_decal  # noqa: E402
import face_setup  # noqa: E402

NAMES = list(expr_defs.EXPRESSIONS)
_attached = False


def use(name):
    global _attached
    if not _attached:
        face_setup.attach()
        face_decal.attach()
        _attached = True
    face_setup.apply(expr_defs.EXPRESSIONS[name])
    face_decal.show(name)
