# Spica Orbit — Project Context

This branch, `orbit`, is Spica's **visual design and social-media pipeline** (tracks O1, O2...).
The chatbot backend (mind, memory, spec, tests, prompts) is the `main` branch and is **not here**:
do backend work there, and never merge `orbit` into `main` (it deletes the backend). What crosses
over is data, by hand. Her posts go straight to reels; still sprites only check her model.

Design docs: `docs/orbit/o1-character-brief.md` (the look, source of truth) and
`docs/orbit/o1-model.md` (the build, flaws, next stages). Choices the docs don't cover go in
`DECISIONS.md`. Clips: `docs/orbit/o1-clips-spec.md`. Next: reels; doodles only when Ethan asks.

- **v2 is her current model** (`docs/orbit/o1-v2-spec.md`, rig `docs/orbit/o1-v2-rig-spec.md`, later
  choices in `DECISIONS.md`). Build from nothing: `sh assets/model_v2/build/run.sh`; every check:
  `sh assets/model_v2/build/run_rig_check.sh`; colours: `assets/model_v2/build/palette.py`. It needs
  v1's `spica-v1.blend`, `assets/model/tex/face/` and `assets/references/` (all git-ignored).
- Her rest pose is the T-pose; `rig_poses.apply(arm, "arms_down")` is how she stands. Expressions:
  `face_expr2.use(name)` is the current set of 32 (`expr2_defs.py`), `face_expr.use(name)` the
  original 25. Render through `brow_over.render(scene)`, which puts her brows over her fringe.
- Clips: `blender -b assets/model_v2/spica-v2.blend -P assets/model_v2/build/clips.py -- idle,walk,look_up,sit_edge`
  makes `spica-v2-clips.blend`; check: `checks/check_clips.py -- clip <names>`; stills: `sh assets/model_v2/build/run_sprites.sh`.
- v1 build: `sh assets/model/build/run.sh [palette]`; check: `check_model.py` (see README). All colours
  live in `assets/model/build/palette.py`. v1 has its own 25 expressions and spring bones.
- `.blend`, `.vrm`, textures and renders are git-ignored (the VRoid samples' licence forbids
  committing modified copies).
- Ethan judges by renders and gives short corrective feedback; measure placement, don't eyeball.
- Prettier at 100 columns; every file starts with a short plain-English header.
