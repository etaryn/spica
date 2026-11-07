#!/bin/sh
# Rebuild the model, render the review passes, compose the sheets.
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")/../../.." || exit 1
"$B" -b -P assets/model/build/build_model.py 2>&1 | grep -E 'AMBER|POLYS|SAVED|Error|Traceback|line '
"$B" -b assets/model/spica.blend -P assets/model/build/render.py -- assets/model/renders 2>&1 | grep -E 'RENDERED|Error|Traceback|line '
node assets/model/build/compose.mjs
