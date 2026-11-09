# Spica Orbit

Her visual design and social-media pipeline. The chatbot backend lives on the `main` branch; this branch
holds none of it. Design: `docs/orbit/`. Agent context: `CLAUDE.md`.

Rebuild her model (needs Blender, Python with Pillow and numpy, Node; her expressions also need `assets/references/`, see `docs/orbit/o1-model.md`):
`sh assets/model/build/run.sh`. Switch her face in any Blender session: `face_expr.use("smug")` (`assets/model/build/face_expr.py`).
Check it: `blender -b assets/model/spica-v1.blend -P assets/model/build/check_model.py -- assets/model/renders/check`.
Source models and outputs (`assets/model/{base,renders}`, `assets/model_v2/{base,renders}`, `assets/references`, `*.blend`, `*.vrm`) are git-ignored.

Her current model is v2 (`docs/orbit/o1-v2-spec.md`, choices in `DECISIONS.md`): `sh assets/model_v2/build/run.sh` builds it from its `base/` folder and v1's `spica-v1.blend`, and renders her to `assets/model_v2/renders/colour/`.

Credits, required wherever she is shared:

- This work is based on "hoodie and skirt" (https://sketchfab.com/3d-models/hoodie-and-skirt-3a3d8d3fc80c42baab590a63b180a65e) by Takeru (https://sketchfab.com/takeru1124) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)
- This work is based on "Demix sneakers with different laces" (https://sketchfab.com/3d-models/demix-sneakers-with-different-laces-83426311cc3c43709a0556a496bdf61b) by TadenStar (https://sketchfab.com/tadenstar) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)

Shared with `main`: only the sprite hand-off (her rendered poses go into `assets/poses/` on `main`) and the
`sharp` image dependency.
