#!/bin/sh
# Rebuild the model, render the review passes, compose the sheets.
# Usage: sh assets/model/build/run.sh [v1|v2|v3|v4|v5]   (v1 lowest, v2 standard, v3 own high poly, v4 on the VRoid base; default v4)
V="${1:-v4}"
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")/../../.." || exit 1
[ "$V" = "v2" ] && export SPICA_LOD=std
SCRIPT=build_model.py
[ "$V" = "v3" ] && SCRIPT=hires.py
ARGS="-P assets/model/build/$SCRIPT"
[ "$V" = "v5" ] && ARGS="-P assets/model/build/base_prepare.py -P assets/model/build/hair.py" && export SPICA_WIDE=1   # work in progress: hair rebuilt from simulated locks
[ "$V" = "v4" ] && ARGS="-P assets/model/build/base_prepare.py -P assets/model/build/hair_edit.py -P assets/model/build/hair_settle.py" && export SPICA_WIDE=1
"$B" -b $ARGS 2>&1 | grep -E 'AMBER|POLYS|SAVED|Error|Traceback|line '
"$B" -b "assets/model/spica-$V.blend" -P assets/model/build/render.py -- "assets/model/renders/$V" 2>&1 | grep -E 'RENDERED|Error|Traceback|line '
node assets/model/build/compose.mjs "assets/model/renders/$V"
