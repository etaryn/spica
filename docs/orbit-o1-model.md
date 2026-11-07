# Orbit O1 — her 3D model

Status: draft for Ethan's approval (2026-11-07). Look: `docs/orbit-o1-character-brief.md` (source of
truth, not repeated here). Branch: `orbit/o1-model`.

## Goal
A fixed, rigged, toon-shaded 3D Spica that the post engine can turn into stills, and later video.
This phase delivers the model and a preset of animations; posting stays with the existing sprite
seam until O2.

## Decisions (Ethan, 2026-11-07)
- No hand-posed sprites: a rigged model with a **preset of animation clips**; any frame can be
  rendered as a still.
- ~~Lowest-poly v1 first~~ **Changed 2026-11-07:** low poly can't carry meaningful detail (v1 and a
  standard-poly v2 were built as checkpoints and judged by Ethan: proportions right, detail missing).
  Go straight to a **high-poly** model. **Body, face and hair first, no clothes yet**: clothes come
  after those three are right. A low-poly derivative (the version arc) is made later from the final
  high-poly model, not built first.
- Skills: Blender-specific Claude skills installed at user scope for this work (see Tools).
- Tool: **Blender 5.2.3 LTS** (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`),
  driven headless by Python scripts.
- Proposed (take as yes unless he says no): face stays clean even in v1 (brief); iris and skin hex
  as proposed, tuned by eye; glitch cubes are real geometry (a few); emotion-flare effects are
  never in the model; one mid-sized version first, the version arc comes later.

## Seam with the post engine
Engine input today: transparent PNG sprites, 400×1000, feet anchor, facing, tags
(`assets/poses/poses.json`). Stage 6 renders any clip frame to that format (plus a higher-res
master), so no mind-side code changes. Replacing the placeholder silhouettes follows the replace
rule: the old PNGs go in the same slice that ships real renders.

## Hair design (2026-11-08, Ethan)
An asymmetric bob, her left side longer, with a simple fringe and the star tie: nothing else. The
earlier wolf cut (staggered layers, diagonal fringe, dissolving cubes) was too complicated to build
and to simulate. No cubes: a permanent mesh can't flow, so any glitch is an animation effect.

The hair is the sample's own hair cards, edited in place (its bob is already clean and keeps its
spring-bone weights): the right front lock cut to chin length, the left front lock stretched to the
chest. A from-scratch version made of physics-simulated locks (`hair.py`, `run.sh v5`) is parked: it
hangs correctly but reads noisier than the sample's smooth cards.

## Base model (2026-11-07)
Built on a VRoid Studio sample export (`sample_model.vrm`, kept in `assets/model/base/`, git-ignored).
Its VRM metadata reads: commercial use `personalNonProfit`, redistribution not allowed, modification
**prohibited**. Ethan exported it himself (author field "spica"), so those terms are his to change:
**re-export with commercial use and modification allowed before any of this ships or is committed.**
Until then `spica-v4.blend` (the derived model) is git-ignored; only the scripts are committed.
Pipeline: `base_prepare.py` (import the glTF, strip clothes, her toon materials, outline) then
`hair_cards.py` (edits two of the sample's own hair cards into the asymmetric bob, adds the stars, eye colours); the .vrm is read as a
.glb copy, so no VRM add-on is needed. v1 to v3 (own-built) remain until v4 is approved, then go.

## Tools
Blender 5.2.3 LTS headless. Skills installed to `~/.claude/skills/` from a vetted markdown-only copy
of TMHSDigital/Blender-Developer-Tools (commit 9ce1540; licence CC BY-NC-ND 4.0, so unmodified and
for our own agent use only, never redistributed in this repo): mesh-editing-and-bmesh,
procedural-materials-and-shaders, headless-batch-scripting, uv-and-mesh-attributes,
geometry-nodes-python, constraints-and-parenting, slotted-actions-animation, porting-to-blender-5,
blender-rules. Left out: the live-session MCP (runs unsandboxed code in a running Blender).

## Layout
- `assets/model/spica.blend`: the model (kept in git; binary, small at v1).
- `assets/model/build/`: Python build scripts (`build_model.py`, later `rig.py`, `anim.py`,
  `render.py`), so the model is reproducible from code and every change is a diff.
- `assets/model/renders/`: git-ignored review renders.
- Model parts as separate named objects: head, face plane (eye/mouth textures), fringe-right,
  fringe-left, fringe-cover (hurt swap), hair clumps (12–16), long layer + cubes, tie + two stars,
  torso/hoodie, hood, tee, shorts, tights, sneakers, hands. Built with rigging in mind: edge loops
  at joints, nothing dangling.

## Stages and checks
1. **High-poly body, face and hair (no clothes).** Mannequin-smooth body (no anatomical detail),
   sculpted face (nose, lips, brow, cheeks, ears), fine hair locks. Toon material with ink-navy
   outline, palette from the brief.
   Checks: front/side/back/three-quarter turntable renders; 64 px black-silhouette test; palette
   sampled from the render matches the hex codes; amber appears only where the brief allows
   (scripted pixel check). **Ethan reviews the look.**
2. **Revise** until Ethan says locked.
3. **Face.** Swappable eye/mouth textures for the five expressions; hurt fringe swap; hood-up.
4. **Rig.** Humanoid armature with fingers; hair, hood, tie and cubes follow the head.
   Check: stress poses (arms up, sit, hood up) without clipping.
5. **Animation preset.** Clips list set with Ethan (starting guess: idle, walk, look-up, sit,
   smirk, flustered). Check: playblast of each.
6. **Export and integration.** `.glb` + `.blend`; `render.py` makes sprites from clip frames; one
   end-to-end test post through `pnpm eval --llm=fake`.

## Limits (be honest)
Rendered looks are judged by Ethan; Claude checks proportions, silhouette, palette and
consistency from renders. Hair is the highest risk. Procedural animation is functional, not
polished.

## Out of scope
Version arc beyond v1, voice, video output, emotion-flare effects, publishing (O2+).
