#!/bin/sh
# Rebuild the model, render the review passes, compose the sheets.
# Usage: sh assets/model/build/run.sh [v1|v2]   (v1 lowest poly, v2 standard poly; default v2)
V="${1:-v2}"
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")/../../.." || exit 1
[ "$V" = "v2" ] && export SPICA_LOD=std
"$B" -b -P assets/model/build/build_model.py 2>&1 | grep -E 'AMBER|POLYS|SAVED|Error|Traceback|line '
"$B" -b "assets/model/spica-$V.blend" -P assets/model/build/render.py -- "assets/model/renders/$V" 2>&1 | grep -E 'RENDERED|Error|Traceback|line '
node assets/model/build/compose.mjs "assets/model/renders/$V"
