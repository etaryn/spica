# Spica Orbit

Her visual design and social-media pipeline. The chatbot backend lives on the `main` branch; this branch
holds none of it. Design: `docs/orbit/`. Agent context: `CLAUDE.md`.

Rebuild her model (needs Blender, Python with Pillow and numpy, Node): `sh assets/model/build/run.sh`.
Check it: `blender -b assets/model/spica-v1.blend -P assets/model/build/check_model.py -- assets/model/renders/check`.
Source models and outputs (`assets/model/{base,renders}`, `*.blend`, `*.vrm`) are git-ignored.

Shared with `main`: only the sprite hand-off (her rendered poses go into `assets/poses/` on `main`) and the
`sharp` image dependency.
