# Spica Orbit — Project Context

This branch, `orbit`, is Spica's **visual design and social-media pipeline** (tracks O1, O2...).
The chatbot backend (mind, memory, spec, tests, prompts) is the `main` branch and is **not here**:
do backend work there, and never merge `orbit` into `main` (it deletes the backend). What crosses
over is data, by hand: her rendered sprites are copied into `assets/poses/` on `main`.

Design docs: `docs/orbit/o1-character-brief.md` (the look, source of truth) and
`docs/orbit/o1-model.md` (the build, flaws, next stages). Choices the docs don't cover go in
`DECISIONS.md`. Expressions (stage 3) are built in: 25, `face_expr.use(name)`; they need `assets/references/` (git-ignored).
Next: O1 stages 4-6 (secondary motion and corrective shapes, clips, sprites); doodles only when Ethan asks.

- **v2 is her current model** (`docs/orbit/o1-v2-spec.md`, later choices in `DECISIONS.md`): build with `sh assets/model_v2/build/run.sh`,
  colours in `assets/model_v2/build/palette.py`. It reads v1's `spica-v1.blend` for her face features. No rig or expressions yet.
- v1 build: `sh assets/model/build/run.sh [palette]`; check: `check_model.py` (see README). All colours
  live in `assets/model/build/palette.py`.
- `.blend`, `.vrm`, textures and renders are git-ignored (the VRoid samples' licence forbids
  committing modified copies).
- Ethan judges by renders and gives short corrective feedback; measure placement, don't eyeball.
- Prettier at 100 columns; every file starts with a short plain-English header.
