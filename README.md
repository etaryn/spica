# Spica Orbit

Her visual design and social-media pipeline. The chatbot backend lives on the `main` branch; this branch
holds none of it. Design: `docs/orbit/`. Agent context: `CLAUDE.md`.

Rebuild her model (needs Blender, Python with Pillow and numpy, Node; her expressions also need `assets/references/`, see `docs/orbit/o1-model.md`):
`sh assets/model/build/run.sh`. Switch her face in any Blender session: `face_expr.use("smug")` (`assets/model/build/face_expr.py`).
Check it: `blender -b assets/model/spica-v1.blend -P assets/model/build/check_model.py -- assets/model/renders/check`.
Source models and outputs (`assets/model/{base,renders}`, `assets/references`, `*.blend`, `*.vrm`) are git-ignored.

Shared with `main`: only the sprite hand-off (her rendered poses go into `assets/poses/` on `main`) and the
`sharp` image dependency.
