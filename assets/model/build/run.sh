#!/bin/sh
# Rebuild the model (assets/model/spica-v1.blend), render the review passes (assets/model/renders/v1) and compose the sheets.
# Usage: sh assets/model/build/run.sh
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")/../../.." || exit 1
python assets/model/build/cloth_tex.py   # the details drawn on her clothes (Pillow and numpy, outside Blender)
"$B" -b -P assets/model/build/base_prepare.py -P assets/model/build/hair_bob.py -P assets/model/build/clothes.py 2>&1 | grep -E 'POLYS|PUSHED|SAVED|CLOTHES|Error|Traceback|line '
"$B" -b assets/model/spica-v1.blend -P assets/model/build/render.py -- assets/model/renders/v1 2>&1 | grep -E 'RENDERED|Error|Traceback|line '
node assets/model/build/compose.mjs assets/model/renders/v1
