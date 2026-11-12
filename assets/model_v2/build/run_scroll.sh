#!/bin/sh
# Builds a scroll reel's motion, checks it, renders her, lays her over the feed with its sound, and checks the result.
# Usage: sh assets/model_v2/build/run_scroll.sh reels/<name> [preview]. Output: renders/reels/<name>/ (git-ignored): frames/, preview.mp4 or reel.mp4.
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
M="$(cd "$(dirname "$0")/.." && pwd -W)"  # assets/model_v2
DIR="$M/${1%/}"
NAME="$(basename "$DIR")"
MODE="${2:-}"
F="$M/spica-v2-clips.blend"
OUT="$M/renders/reels/$NAME"
MP4="$OUT/$([ "$MODE" = preview ] && echo preview || echo reel).mp4"
CHECK="$M/build/checks/check_reel.py"
SHOW="Error|Traceback|PROBLEM|checked|passed|SHOT|REEL|BUILT|CLIP |ok$"
set -e -o pipefail  # a failing Blender run stops the script even through grep
python "$M/build/checks/test_reel_edit.py"
python -c "import json, sys; sys.path.insert(0, sys.argv[1]); import reel_edit as r; r.validate_scroll(r.load(sys.argv[2]), json.load(open(sys.argv[3]))['faces']); print('EDIT LIST ok')" "$M/build" "$DIR/reel.json" "$M/clips.json"
"$B" -b "$F" --python-exit-code 1 -P "$M/build/clips.py" -- "reel:$NAME" 2>&1 | grep -E "$SHOW"
"$B" -b "$F" --python-exit-code 1 -P "$M/build/checks/check_clips.py" -- clip "$NAME" 2>&1 | grep -E "$SHOW"
"$B" -b "$F" --python-exit-code 1 -P "$CHECK" -- scroll "$DIR" 2>&1 | grep -E "$SHOW"
"$B" -b --factory-startup --python-exit-code 1 -P "$CHECK" -- feed "$OUT/feedcheck" 2>&1 | grep -E "$SHOW"
"$B" -b "$F" --python-exit-code 1 -P "$M/build/reel.py" -- scroll "$DIR" "$OUT/frames" $MODE 2>&1 | grep -E "$SHOW"
"$B" -b "$F" --python-exit-code 1 -P "$CHECK" -- frames "$OUT/frames" "$OUT/frames/edit.json" 2>&1 | grep -E "$SHOW"
"$B" -b --factory-startup --python-exit-code 1 -P "$M/build/reel_review.py" -- scroll "$DIR" "$OUT/frames" "$MP4" $MODE 2>&1 | grep -E "$SHOW"
"$B" -b --factory-startup --python-exit-code 1 -P "$CHECK" -- scroll_review "$MP4" "$DIR" $MODE 2>&1 | grep -E "$SHOW"
echo "REEL done: $MP4"
