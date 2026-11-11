#!/bin/sh
# Renders the sprites that ship, with the frames Ethan picked, and checks them. Output: renders/sprites/final (git-ignored).
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd -W)"
F="$ROOT/spica-v2-clips.blend"
OUT="$ROOT/renders/sprites/final"
F_IDLE=121
F_WALK=97
F_LOOK=48
F_SIT=97
LIST=""
for face in observing curious soft_smile; do
  LIST="$LIST,idle:$F_IDLE:$face,walk:$F_WALK:$face,look_up:$F_LOOK:$face,sit_edge:$F_SIT:$face"
done
"$B" -b "$F" --python-exit-code 1 -P "$ROOT/build/sprites.py" -- sprites "$OUT" "${LIST#,}" 2>&1 | grep -E "^Error|Traceback"
"$B" -b "$F" --python-exit-code 1 -P "$ROOT/build/checks/check_clips.py" -- sprites "$OUT" 2>&1 | grep -E "PROBLEM|SPRITES|CLIPS|Error"
