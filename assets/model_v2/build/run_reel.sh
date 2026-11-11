#!/bin/sh
# Checks the reel code, renders an edit list (default: the proof of concept), lays it over its backgrounds, and checks the result.
# Output: renders/reel (git-ignored): frames/, reel.mp4, one still per shot, sheet.png.
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd -W)"
F="$ROOT/spica-v2-clips.blend"
REEL="${1:-$ROOT/build/reel_poc.json}"
OUT="$ROOT/renders/reel"
CHECK="$ROOT/build/checks/check_reel.py"
SHOW="Error|Traceback|PROBLEM|checked|SHOT|REEL|ok$"
set -e -o pipefail  # a failing Blender run stops the script even through grep
python "$ROOT/build/checks/test_reel_edit.py"
python -c "import json, sys; sys.path.insert(0, sys.argv[1]); import reel_edit as r; e = r.load(sys.argv[2]); r.validate(e, json.load(open(sys.argv[3]))); r.validate_backgrounds(e); print('EDIT LIST ok')" "$ROOT/build" "$REEL" "$ROOT/clips.json"  # a bad list fails in a second, not after the render
for m in manifest camera "wrap $OUT/wrap"; do "$B" -b "$F" --python-exit-code 1 -P "$CHECK" -- $m 2>&1 | grep -E "$SHOW"; done
"$B" -b --factory-startup --python-exit-code 1 -P "$CHECK" -- pan "$OUT/pan" 2>&1 | grep -E "$SHOW"
"$B" -b "$F" --python-exit-code 1 -P "$ROOT/build/reel.py" -- "$REEL" "$OUT/frames" 2>&1 | grep -E "$SHOW"
"$B" -b "$F" --python-exit-code 1 -P "$CHECK" -- frames "$OUT/frames" "$REEL" 2>&1 | grep -E "$SHOW"
"$B" -b --factory-startup --python-exit-code 1 -P "$ROOT/build/reel_review.py" -- "$REEL" "$OUT/frames" "$OUT/reel.mp4" 2>&1 | grep -E "$SHOW"
"$B" -b --factory-startup --python-exit-code 1 -P "$CHECK" -- review "$OUT/reel.mp4" "$REEL" 2>&1 | grep -E "$SHOW"
python "$ROOT/build/sheet.py" "$OUT/sheet.png" 1600 4 "$OUT"/reel-shot-*.png
echo "REEL done: $OUT/reel.mp4"
