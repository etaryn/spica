#!/bin/sh
# Renders the built model in several colours for one garment, side by side, without rebuilding.
# Usage: run_colour_options.sh <SPICA_HOODIE|SPICA_SOCK|SPICA_SHORTS|SPICA_LINING> <sheet name> "name lit,shade" ...  (SPICA_VIEW picks the view, default q)
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VARIABLE="$1"; SHEET="$2"; shift 2
V="${SPICA_VIEW:-q}"
R="$ROOT/renders/options/$SHEET"
LIST=""; COUNT=0
for option in "$@"; do
  name=${option%% *}; colours=${option##* }
  rm -f "$R/$name/$V.png"
  env "$VARIABLE=$colours" "$B" -b "$ROOT/spica-v2.blend" --python-exit-code 1 -P "$ROOT/build/render.py" -- "$R/$name" toon "$V" 2>&1 | grep -E "Error|Traceback"
  LIST="$LIST $R/$name/$V.png"; COUNT=$((COUNT + 1))
done
rm -f "$R.png"
python -I "$ROOT/build/sheet.py" "$R.png" 2500 "$COUNT" $LIST
rm -rf "$R"  # only the sheet is kept
