#!/bin/sh
# Renders her with arms lifted, to see the clothes clear of them. Run after run.sh.
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
R="$ROOT/renders/pose"
mkdir -p "$R"
"$B" -b "$ROOT/spica-v2-hair.blend" --python-exit-code 1 -P "$ROOT/build/pose.py" -- "$ROOT/spica-v2-pose.blend" 2>&1 | grep -E "Error|Traceback|line " | grep -v Deprecation
for mode in clay toon; do
  "$B" -b "$ROOT/spica-v2-pose.blend" --python-exit-code 1 -P "$ROOT/build/render.py" -- "$R/$mode" "$mode" front,q,side,back 2>&1 | grep -E "Error|Traceback"
  python -I "$ROOT/build/sheet.py" "$R/$mode-sheet.png" 2000 4 "$R/$mode/front.png" "$R/$mode/q.png" "$R/$mode/side.png" "$R/$mode/back.png"
done
