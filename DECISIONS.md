# Orbit decisions

Implementation choices for her model and social pipeline that the design docs do not cover.

| Date | Decision | Why |
|---|---|---|
| 2026-11-07 | Her model: sneaker uppers off-white (soles amber), drawstrings navy with amber tips, five-point stars rotated 55% toward the camera | The brief gives only the soles; off-white lifts the shoes off the navy tights; a sideways star is a sliver from the front, and the tie must read as a logo. |
| 2026-11-09 | Her model: every colour lives in `assets/model/build/palette.py`, one entry per palette; the default is midnight-noir (deep-space-blue hoodie, pale shorts, pale-yellow glowing stars, cyan accents); the first look stays as `spacey` | Ethan chose it from six trials; one file keeps palettes comparable and the texture drawing in step. Supersedes the 2026-11-07 row (off-white uppers, amber soles, navy drawstrings). |
| 2026-11-09 | Her model: the binary star's orbit axis runs through the middle of her head and the pair sits at azimuth 50, elevation 65, 18 cm out, 6.5 cm apart | Measured over a full turn, each orb stays 2.7 to 4.3 cm from her hair; a steeper, lower plane let one orb swing far from her head. |
| 2026-11-09 | Her model: weights on bones her skeleton lacks are moved to the nearest ancestor she has, every piece has at most four weights, skinned pieces are parented to the armature, and the arm-lowered pose is kept as the `A_pose` action with the pose bones cleared | Blender drops weights on missing bones (the hood stretched 3.6x); glTF keeps four; a leftover pose-bone transform is not a record of the pose the model was fitted in. `check_model.py` verifies it. |
