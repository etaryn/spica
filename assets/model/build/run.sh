#!/bin/sh
# Rebuild the model, render the review passes and compose the sheets.
# Usage: sh assets/model/build/run.sh [palette]
# No argument: her default palette (palette.py, DEFAULT: "midnight-noir") into assets/model/spica-v1.blend and
# assets/model/renders/v1. Another palette name from palette.py (for example "spacey", the first v1 look) builds
# assets/model/spica-<name>.blend and renders into assets/model/renders/<name>.
# Needs assets/references/ (the Expression Pack's reference model) for the face's expression shape keys; without it the build still
# finishes, with the sample's own expressions.
cd "$(dirname "$0")/../../.." || exit 1
DEFAULT=$(python -c "import sys; sys.path.insert(0, 'assets/model/build'); import palette; print(palette.DEFAULT)")
export SPICA_PALETTE="${1:-$DEFAULT}"
if [ "$SPICA_PALETTE" = "$DEFAULT" ]; then OUT=v1; BLEND=spica-v1; else OUT="$SPICA_PALETTE"; BLEND="spica-$SPICA_PALETTE"; fi
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
python assets/model/build/cloth_tex.py   # the details drawn on her clothes (Pillow and numpy, outside Blender)
"$B" -b -P assets/model/build/base_prepare.py -P assets/model/build/hair_bob.py -P assets/model/build/clothes.py 2>&1 | grep -E 'POLYS|PUSHED|SAVED|CLOTHES|RIGPREP|Error|Traceback|line '
# her expressions: the face's UV map (once), the drawn pictures (Pillow and numpy), then the shape keys, mouth, outlines, overlays and decal built into the .blend
[ -f assets/model/tex/face/uv_xz.npy ] || "$B" -b "assets/model/$BLEND.blend" -P assets/model/build/face_map.py 2>&1 | grep -E 'UVMAP|Error|Traceback|line '
python assets/model/build/expr_draw.py
"$B" -b "assets/model/$BLEND.blend" -P assets/model/build/face_build.py 2>&1 | grep -E 'FACEBUILD|Error|Traceback|line '
"$B" -b "assets/model/$BLEND.blend" -P assets/model/build/render.py -- "assets/model/renders/$OUT" 2>&1 | grep -E 'RENDERED|Error|Traceback|line '
node assets/model/build/compose.mjs "assets/model/renders/$OUT"
