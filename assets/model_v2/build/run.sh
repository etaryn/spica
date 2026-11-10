#!/bin/sh
# Builds model v2 from nothing (needs v1's spica-v1.blend, v1's tex/face pictures and assets/model_v2/base) and renders her in colour: the body and head in both arm positions, the dressed model, its T-pose rig, cloth shapes and expressions.
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
R="$ROOT/renders/current"
mkdir -p "$R"
WANT="HEIGHT|HEAD|RIG|DRAPE|EXPR|LIDS|DREW|TBODY|TPOSE|FIT|zip |hair_ponytail tip|Error|Traceback|  File"

step() {  # stops at the first failure: a later step would quietly use the last good file
  out=$("$@" 2>&1)
  echo "$out" | grep -E "$WANT" | grep -v Deprecation | cut -c1-200
  if echo "$out" | grep -q Traceback; then echo "STOPPED at: $*"; exit 1; fi
}

step "$B" -b --factory-startup --python-exit-code 1 -P "$ROOT/build/body.py"
step "$B" -b "$ROOT/spica-v2-body.blend" --python-exit-code 1 -P "$ROOT/build/head.py"
step env SPICA_ARM_TILT=-62 SPICA_STAGE=-t "$B" -b --factory-startup --python-exit-code 1 -P "$ROOT/build/body.py"
step env SPICA_STAGE=-t "$B" -b "$ROOT/spica-v2-body-t.blend" --python-exit-code 1 -P "$ROOT/build/head.py"
step "$B" -b "$ROOT/spica-v2-head-t.blend" --python-exit-code 1 -P "$ROOT/build/tbody.py"
for stage in "head shoulders" "shoulders clothes" "clothes hair" "hair accents" "accents tpose" "tpose drape" "drape expressions"; do
  set -- $stage
  step "$B" -b "$ROOT/spica-v2-$1.blend" --python-exit-code 1 -P "$ROOT/build/$2.py"
done
step "$B" -b "$ROOT/spica-v2.blend" --python-exit-code 1 -P "$ROOT/build/expr2_lids.py"
step python -I "$ROOT/build/expr2_draw.py"
rm -f "$R"/views/*.png "$R/full.png" "$R/legs.png"  # a picture still open in a viewer would block the save
SPICA_POSE=arms_down "$B" -b "$ROOT/spica-v2.blend" --python-exit-code 1 -P "$ROOT/build/render.py" -- "$R/views" toon front,q,side,back,wide,face,foot,hips,legs,torso,torsoq 2>&1 | grep -E "^Error|Traceback"
python -I "$ROOT/build/sheet.py" "$R/full.png" 2000 4 "$R/views/front.png" "$R/views/q.png" "$R/views/side.png" "$R/views/back.png"
python -I "$ROOT/build/sheet.py" "$R/legs.png" 2000 4 "$R/views/legs.png" "$R/views/legsq.png" "$R/views/legss.png" "$R/views/legsb.png"
