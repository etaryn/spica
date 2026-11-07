#!/bin/sh
# Rebuild the model, render the review passes, compose the sheets.
# Usage: sh assets/model/build/run.sh [v1|v2|v3]   (v1 lowest, v2 standard, v3 high poly; default v3)
V="${1:-v3}"
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")/../../.." || exit 1
[ "$V" = "v2" ] && export SPICA_LOD=std
SCRIPT=build_model.py
[ "$V" = "v3" ] && SCRIPT=hires.py
"$B" -b -P "assets/model/build/$SCRIPT" 2>&1 | grep -E 'AMBER|POLYS|SAVED|Error|Traceback|line '
"$B" -b "assets/model/spica-$V.blend" -P assets/model/build/render.py -- "assets/model/renders/$V" 2>&1 | grep -E 'RENDERED|Error|Traceback|line '
node assets/model/build/compose.mjs "assets/model/renders/$V"
