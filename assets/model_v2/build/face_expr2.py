# Switches her face to one of the second set of expressions, in any session with the built model.
#     import face_expr2; face_expr2.use("smirk")
import expr2_defs
import face_expr

NAMES = list(expr2_defs.EXPRESSIONS)
TEX = face_expr.TEX / "set2"
DRAWN = {n for n, e in expr2_defs.EXPRESSIONS.items() if e.get("mouth", True) is False}


def use(name):
    face_expr.use(name, expr2_defs.EXPRESSIONS, TEX, DRAWN)
