#!/bin/sh
# Renders the built model in several colours for one garment, side by side, without rebuilding.
# Usage: run_colour_options.sh <SPICA_HOODIE|SPICA_SOCK> <sheet name> "name lit,shade" ...
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VARIABLE="$1"; SHEET="$2"; shift 2
R="$ROOT/renders/colour/$SHEET"
LIST=""; COUNT=0
for option in "$@"; do
  name=${option%% *}; colours=${option##* }
  rm -f "$R/$name/q.png"
  env "$VARIABLE=$colours" "$B" -b "$ROOT/spica-v2.blend" --python-exit-code 1 -P "$ROOT/build/render.py" -- "$R/$name" toon q 2>&1 | grep -E "Error|Traceback"
  LIST="$LIST $R/$name/q.png"; COUNT=$((COUNT + 1))
done
rm -f "$R.png"
python -I "$ROOT/build/sheet.py" "$R.png" 2500 "$COUNT" $LIST
