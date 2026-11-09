#!/bin/sh
# Builds model v2 from nothing (needs v1's spica-v1.blend and assets/model_v2/base) and renders her in colour.
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
R="$ROOT/renders/colour"
mkdir -p "$R"
WANT="HEAD|zip |hair_ponytail tip|Error|Traceback|  File"
"$B" -b --factory-startup --python-exit-code 1 -P "$ROOT/build/body.py" 2>&1 | grep -E "HEIGHT|$WANT" | grep -v Deprecation | cut -c1-200
for step in "body head" "head clothes" "clothes hair" "hair accents"; do
  set -- $step
  "$B" -b "$ROOT/spica-v2-$1.blend" --python-exit-code 1 -P "$ROOT/build/$2.py" 2>&1 | grep -E "$WANT" | grep -v Deprecation | cut -c1-200
done
rm -f "$R"/views/*.png "$R/full.png" "$R/legs.png"  # a picture still open in a viewer would block the save
"$B" -b "$ROOT/spica-v2.blend" --python-exit-code 1 -P "$ROOT/build/render.py" -- "$R/views" toon front,q,side,back,wide,face,foot,hips,legs,torso,torsoq,hand 2>&1 | grep -E "Error|Traceback"
python -I "$ROOT/build/sheet.py" "$R/full.png" 2000 4 "$R/views/front.png" "$R/views/q.png" "$R/views/side.png" "$R/views/back.png"
python -I "$ROOT/build/sheet.py" "$R/legs.png" 2000 4 "$R/views/legs.png" "$R/views/legsq.png" "$R/views/legss.png" "$R/views/legsb.png"
