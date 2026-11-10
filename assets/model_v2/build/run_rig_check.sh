#!/bin/sh
# Runs every check on her finished model, renders every pose, and compares her resting pose with renders/rig/before (fill that from a build you trust before changing anything).
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
F="$ROOT/spica-v2.blend"
R="$ROOT/renders/rig"
"$B" -b "$ROOT/spica-v2-accents.blend" --python-exit-code 1 -P "$ROOT/build/check_fit.py" 2>&1 | grep -E "FIT|Assert|Traceback"
for check in check_rig check_drape check_spring check_expressions; do
  "$B" -b "$F" --python-exit-code 1 -P "$ROOT/build/$check.py" 2>&1 | grep -E "RIG|POSE|PROBLEM|CHECK|DRAPE |SPRING|EXPRESSIONS|Assert|Traceback" | cut -c1-200
done
rm -rf "$R/after" "$R/poses"
SPICA_POSE=arms_down "$B" -b "$F" --python-exit-code 1 -P "$ROOT/build/render.py" -- "$R/after" toon front,q,side,back,face 2>&1 | grep -E "^Error|Traceback"
python -I "$ROOT/build/compare_rest.py" "$R/before" "$R/after"
for pose in a_pose arms_down arms_up arms_overhead arms_forward arms_crossed sit lean head_turn stride twist; do
  SPICA_POSE=$pose "$B" -b "$F" --python-exit-code 1 -P "$ROOT/build/render.py" -- "$R/poses/$pose" toon front,q,side 2>&1 | grep -E "^Error|Traceback"
done
python -I "$ROOT/build/sheet.py" "$R/poses_front.png" 2400 5 "$R"/poses/*/front.png
python -I "$ROOT/build/sheet.py" "$R/poses_q.png" 2400 5 "$R"/poses/*/q.png
python -I "$ROOT/build/sheet.py" "$R/poses_side.png" 2400 5 "$R"/poses/*/side.png
