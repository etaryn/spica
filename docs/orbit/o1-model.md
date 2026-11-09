# Orbit O1 — her 3D model

Status: **v1 built and accepted 2026-11-08; default look midnight-noir since 2026-11-09; checked for the animation phase 2026-11-09**
(a first draft with some clipping and edginess left, see "Known flaws"). Look: `docs/orbit/o1-character-brief.md` (source of truth, not
repeated here). Branch: `orbit/o1-model`. This file is the build side: what exists, how it is made, why it is made that way, and what
was tried and dropped. The day-by-day history is in git.

## Goal
A fixed, rigged, toon-shaded 3D Spica that the post engine can turn into stills, and later video. This phase delivers the model and a
preset of animations; posting stays with the existing sprite seam until O2.

## Decisions (Ethan, 2026-11-07)
- No hand-posed sprites: a rigged model with a **preset of animation clips**; any frame can be rendered as a still.
- High-poly from the start (a low-poly and a standard-poly checkpoint were judged: proportions right, detail missing). The low-poly
  version arc is derived later from the final model.
- Tool: **Blender 5.2.3 LTS** (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`), driven headless by Python scripts.
- The face stays clean; emotion-flare effects are never in the model; one mid-sized version first, the version arc comes later.

## Seam with the post engine
Engine input today: transparent PNG sprites, 400×1000, feet anchor, facing, tags (`assets/poses/poses.json`). Stage 6 renders any clip
frame to that format (plus a higher-res master), so no mind-side code changes. Replacing the placeholder silhouettes follows the replace
rule: the old PNGs go in the same slice that ships real renders. The look is made by Blender's materials (toon shader nodes, shader
glows), which do not export to glTF, so sprites are rendered from Blender, not from a `.glb`.

## How it is built
`sh assets/model/build/run.sh` builds `assets/model/spica-v1.blend` and its review renders (`renders/v1`); `run.sh <palette>` builds
another palette into `spica-<palette>.blend` (the first look is `spacey`). The chain runs in one Blender session:
`base_prepare.py` (import the VRoid sample as glTF, strip its clothes, her toon materials and outline) → `hair_bob.py` (bob, fringe, bun,
hair colours, eye colours) → `clothes.py` (clothes, socks, face tattoo, binary star, then `rig_prep.py`; saves the file).
`cloth_tex.py` (Pillow and numpy, outside Blender) draws the pictures the shaders lay on the cloth first. Shared files: `palette.py` (every
colour, one entry per palette), `cloth_layout.py` (positions and sizes), `hair_cards.py` (helpers: toon material, `push_out`, eye colours),
`binary_stars.py`, `render.py` and `compose.mjs` (review renders and sheets), `check_model.py` (the animation-readiness check, below), and the
expression files `expr_defs.py`, `expr_draw.py`, `expr_sheet.py`, `expressions.py`, `face_keys.py`, `face_setup.py`, `face_decal.py`, `face_map.py`,
`face_build.py`, `face_expr.py`.
The .vrm is read as a .glb copy, so no VRM add-on is needed. All model files are git-ignored (licence, below); only scripts and docs are
committed. Older models and their scripts were deleted when v1 was saved; they are in git history.

## Parts (separate named objects, all skinned to one armature)
- **Body, Face** (the sample's skin: the Face carries 58 VRM expression shape keys and the eye and mouth materials), `face_outline`.
- **Hair001–087** (the sample's hair cards, front locks cut to chin, fringe leaned and shortened), **tuft_122–152** (the bun: the third
  sample's bun cards, moved rigidly onto her head). **hoodie**, **hood**, **shorts**, **sneakers**, **sock_l** (thigh-high), **sock_r**
  (ankle). **orbit_placer / orbit_spin, orb_a, orb_b, their halos, orbit_ring_a / _b** (the binary star, not skinned).
- Each piece is its own object, so removing one is a delete. Skinned pieces have an Armature modifier first and an outline Solidify
  after it.

## Hair
A short stiff bob, a fringe and one small bun on her right: nothing long or loose (a long strip down her back, a low bunch, a wolf cut
and cubes were built or considered and dropped: anything long clips in every pose). The bob and fringe are the first sample's own cards,
reshaped a little. The bun is copied from the third sample, recoloured, sunk 2.2 cm into the bob so it sits on her head with no neck.
The star tie is off (`SPICA_TIE=1` rebuilds it). Hair colour comes from the samples' own strand textures (`hair_toon`): the texture's
brightness (dark roots, lighter tips, lines between strands) is mapped onto the palette's ramp, then the unlit side goes toward the
shadow tone; nothing is invented. The layer under the outer hair is darker, found by ray casts (the cards that lie under other hair), so
the layers of the bob read apart. One wide band of cyan (`strip_band` in the palette: where along the card's u, which runs 0.75 to 1.41
on that card, and how wide) is painted on the lock beside her left cheek, strand lines kept; thin strips on many locks were tried and
rejected. The bun's geometry comes from a sample whose VRM metadata says modification prohibited, so the same flag applies.

## Clothes
The sample's pieces (hood, shorts, shoes) are skinned with their own weights to her armature (same bone names), moved up 5 mm (the
sample's body sits that much lower) and pushed off her skin; the hoodie and the socks are **shells of her own skin**, so they keep her
shape and deform with the same weights.
- **Hoodie:** a shell of her torso, shoulders and arms (welded at her skin mesh's UV seams, or any offset or smoothing opens gaps),
  pushed out 2.4 cm on the body and 1.8 cm on the sleeves along her skin's normals, smoothed six times, kept 8 mm off her skin, then
  cut straight at the hip and wrists. Cuffs are rolled (the offset shrinks to 15% at the edge as a quarter circle). **Hem:** a band of
  its own (1 cm, 3 mm proud, rounded lower edge, a seam groove above, fine vertical ribs in the shader, tone-on-tone stitches), no
  flare, low enough to cover the top of the shorts' back pockets, split by a slot (1.2 cm wide, 1.6 cm tall) below where the zip ends.
  **Neckline:** the zip's slider sits at z 1.22; above it a V (half-width 0.7 x height above the slider) is cut through the shell, the
  front has up to 2 cm more room, and the cut edges roll outward like lapels with a real 1.4 cm facing (a second material slot, 2 mm
  proud, a seam groove, stitches beside it) in the lining colour. The inside of the cloth (back faces) is the lining colour too.
  **Underbust:** the hard bend where the breast meets the body turned into a line and a shadow on the dark cloth. It is rounded on a
  regular grid of angle by height (`UNDERBUST_EASE`): the shell's distance from the torso's axis is blurred and only the positive change
  (the inside corner of the bend) is added back, so the bust keeps its size, place and top. A taper that ran the cloth straight from the
  nipples to the upper belly made her look saggy and was reverted; smoothing along the mesh edges left diagonal facets.
- **Hood:** the sample's own hood, a collar draped round the back and sides of her neck. Its front (a V that would run across the
  opening, and the sample's shredded flap ends, a pile of sliver triangles no smoothing fixes) is cut off with one straight plane
  (`HOOD_FRONT_Y`), so it ends in two clean flaps beside her neck; the rest is untouched, pushed 6 mm off the finished hoodie and her
  skin. Its thin inner layer is dropped.
- **Shorts:** the sample's, only the part its alpha mask shows plus the hip band of its hidden layer, cut just below her crotch and
  above the hoodie's hem, welded then smoothed 80 times (hard toon steps show any lump as a blotch), subdivided to 4–5 mm so creases can
  be real folds. A rolled hem band of its own (1.9 cm, 3 mm proud, two stitch rows, a groove above).
- **Socks:** `make_sock` builds a shell of her leg 2.2 mm out from inside the shoe: a thigh-high stocking on her left leg (top at z 0.70,
  a clean plane-cut edge, no hem; an attempt to make that edge read as elastic was reverted) and an ankle sock on her right (top at z 0.19, with
  a ribbed band 2.2 cm tall, 2.5 mm proud). Fine vertical ribs round the leg in the shader.
- **Sneakers:** the sample's blocky shoe, laces dropped; the lowest 4.5 cm is the sole.

## Details drawn into the shaders
Everything below is a picture (drawn by `cloth_tex.py`) laid on the surface in the shader from her **rest-pose coordinates** (stored on
each mesh as two UV layers, `rest_xy` and `rest_xz`), so it stays on the cloth in any pose and has no thickness to float or clip:
the zip (tapes, teeth, bottom stop, slider and pull), two slanted hand-pocket slits, stitching, and on the shorts front pockets, a fly,
back pockets, a twill (ribs 5 mm apart, coarser than real so it reads at distance) and creases. **Creases** are drawn as shadow (a soft
dark band with a darker line, tapering; light wear lines read as white scratches) and the mesh is bent along the same lines
(`crease_cloth`): three whiskers on her left leg, two on her right, a smile line under each seat, all different. The shorts use a hard
toon step (the soft ramp read as a melted patch).
- **Stars** are textures too (`face_star.png`, `sock_star.png`: one five-point star each, point up). `star_glow` makes them pale,
  slightly translucent, self-lit, with a soft halo; the tattoo also gets a thin warm rim or a pale star vanishes on pale skin.
  **Tattoo** (`tattoo_face`): her skin material is copied for the face alone and the picture is laid by the face mesh's own UV map (it
  wraps the cheek with hardly any stretch there; a straight projection along y stretched the star about 2x because the cheek's normal is
  60 degrees off the front), 1.8 cm across, centre x 0.058, z 1.4245. **Stocking stars** (`SOCK_STARS`): three, 10 to 17 cm, each laid
  by true distances on the cloth from its own centre (angle round the leg x the leg's radius at that height, and height), so none is
  stretched as the thigh narrows; 120 degrees apart, so one always shows from the front, the side and the back.

## Palette
All colours are in `palette.py` (slots documented in its header). **midnight-noir** is the default (chosen 2026-11-09 from six trials);
`spacey` is the first look. Colours and where they go: the brief's Palette section. How it was chosen: Ethan wanted the name Spica in the
palette (a blue-white star, and "spica" means an ear of wheat, hence pale-gold stars), an accent to break up an all-purple look, darker
and richer clothes, a pale pair of shorts, light then dark stockings; he rejected a muted navy, a too-bright blue, yellow-orange stars
and a dark-blue hood (a huge patch that could not be read as a hood).

## Binary star (`binary_stars.py`)
Two glowing orbs (icy cyan-white, 3.2 cm; pale gold, 2.4 cm) that circle each other above her head, on the side opposite her bun.
`orbit_placer` is an empty rigid on the head bone (its transform is solved from the evaluated parent matrix so the pair keeps its place
whatever the bone's own transform is) with its Z axis along the line from the middle of her head through the pair's centre; its child
`orbit_spin` turns about that axis by a driver (`start + frame * 2 pi / 96`, no keyframes, so it runs for ever); the orbs and halos are
its children, two thin faint torus rings (children of the placer) mark the orbits so a still reads as orbiting. The glow is the shader's
(the real-time renderer has no bloom): a halo sphere 3.2 times the orb whose alpha is zero over the core, 0.75 at the core's edge and
nothing at the rim. **Placement was measured, not guessed:** the pair sits at azimuth 50 degrees from her left toward behind, elevation
65, 18 cm from the middle of her head, 6.5 cm apart, so the orbit plane lies parallel to the top of her head and each orb stays 2.7 to
4.3 cm from her hair all the way round (the first, steeper setting varied by 2.4 cm at 7 cm: one orb swung out, the other hung over the
hair). It follows the head bone (checked by posing the head).

## Rig and animation readiness (2026-11-09)
The rig is the VRoid humanoid armature: 149 bones with Root, hips, spine, chest, upper chest, neck, head, shoulders, arms, 15 finger
bones a hand, legs, feet, toes, two eye bones, bust bones, 94 secondary bones (hair, bust, coat skirt) and the face's 58 expression shape
keys (neutral, joy, sorrow, angry, surprised, fun, eye close, the five mouth vowels A I U E O, and more).
**`rig_prep.py`** (the last build step) makes it clean:
- **Weights:** the sample's pieces were weighted to bones her skeleton does not have (hood strings, hood bones); Blender dropped those
  weights and the hood followed what was left (its edges stretched up to 3.6x under a head turn). Each weight is now moved to the nearest
  ancestor bone she has; every skinned piece has weights only on her bones, at most four of them (what glTF keeps), adding up to 1, and
  no stray or duplicate vertex groups (the garments had 130 to 149 each). The hoodie had 610 vertices on more than four bones.
- **Parenting:** every skinned piece is a child of the armature (it sits at the origin, so nothing moved).
- **Rest pose:** the arms used to be left lowered 48 degrees as a leftover pose-bone transform (the hair and clothes were fitted in that
  pose). It is now an action, **`A_pose`** (fake user, assigned, keyed on the Root and J_Bip bones), and the pose bones are clear, so the
  rest pose is a clean T-pose and the file opens in A-pose. Start animations from it (or push it down in the NLA) and clear the action to
  get the T-pose.

**`check_model.py`** (read-only; `blender -b assets/model/spica-v1.blend -P assets/model/build/check_model.py -- <out dir>`) checks the
structure (all humanoid bones, identity transforms, parenting), the skinning (no unweighted vertex, at most 4 bones, no stray groups,
armature modifier first), the rest pose and action, the expression keys, the binary star, ten stress poses (rest, A-pose, arms up, arms
forward, arms crossed, sit, lean forward, head turn and nod, stride, spine twist) with garment-vertices-inside-body counts, stretched
edges (4 mm or longer), floating cloth, hair inside her body and the orbs' clearance, renders each pose from the front and side, and test-exports
a `.glb`. **Result 2026-11-09: no problems, four notes:**
- Hoodie 2.8% and shorts 5.5% of their vertices are inside her skin in the **sit** pose (90 degrees of hip flexion; the compressed side of
  the bend; not visible in the render), the sneakers 4.1% in a long **stride** (15 vertices), and one hoodie edge is stretched 4.5x in
  the **crossed-arms** pose (the armpit; not visible). Everything else is clean: no garment more than 1% inside her in the other poses,
  the hood's stretch is now at most 1.6x, the orbs stay at least 3 cm from her in every pose, the glTF exports (7 MB).
**For the animation phase (not done yet):**
- **Secondary motion:** no spring-bone or physics data is in the file (the VRM spring-bone extension is not read). The hair cards are
  weighted to the sample's `J_Sec_Hair*` bones and the bust to `J_Sec_*_Bust*`, so a physics layer can drive them; the bun, the hood, the
  clothes and the binary star are rigid on their bones (no swing yet).
- **Corrective shapes** for the hip crease (shorts and hoodie hem in a seated pose) and the armpit if clips need them.
- **Expressions:** the face shape keys are there; the swappable eye and mouth textures (stage 3) are not built.
- Export: the toon materials, shader glows and the driver do not survive a `.glb`; sprites and video are rendered from Blender.

## Expressions (stage 3, started 2026-11-09; the standard set first, doodles after approval)
**Copied, not drawn** (Ethan: copy from references, do not improvise the art). Her Face is the same VRoid face as the ReForge Mode
*Expression Pack* reference model (8,280 polygons, the same eight material slots, different vertex numbering), so that model's
174 shape keys are transferred onto her by UV position (`face_keys.py`): ARKit-style mouth shapes, `Teeth_Vampire/Shark/FrontFang`
(real fangs, canines leaning inward), a tongue, `eyeBlink` (thin, fully closed lids: the sample's own `Fcl_EYE_Close` was the thick,
half-closed one), `Eye_Joy` / `Eye_Fun` arches, brow and eye shapes, eye look keys. The pack's named presets (`re_Mouth Smirk 2`,
`re_Eye Happy 3`...) are plain key weights, read out of its Unity `.anim` files into `assets/references/pack_presets.json`;
`expr_defs.py` is her expression table built from them. Its overlay textures (blush, forehead lines, eyebags) lie in the same face UV
layout and are copied to `tex/face/`; `face_setup.py` lays them on her skin material (3 swappable slots).
Her mouth material lost its picture when it was recoloured to one flat colour (no teeth, no tongue): `face_setup` maps the sample's
mouth picture to her palette by brightness (inside, tongue, teeth). The VRoid look of a closed mouth is a thin outline shell, so a
`mouth_outline` shell (1.3 mm, dark rose) is built with the keys, and the skin outline shell is rebuilt with the keys (it had none: it
stayed put when the jaw opened). The two black marks at the mouth corners were outline-shell faces showing through the skin cut-out:
those faces are deleted. A flat pressed mouth collapses to nothing on the mesh, so neutral, bored and confused keep a small **drawn
decal** (`expr_draw.py`, `face_decal.py`: a skin-hugging patch built from the skin surface with the mouth and eye cut-outs bridged),
which also carries the tears and sweat drops. Neutral is exactly what Ethan liked (a short thin black line).
**Style rule (Ethan, 2026-11-09): solid, separated colours, little blending** (her skin, hair and clothes are toon steps, so the mouth and
the extras must be too). The mouth picture is mapped by a CONSTANT colour ramp into four flat bands (a darker top band, the inside,
the tongue, the teeth: `MOUTH_*` in `face_setup.py`), the teeth carry no outline (only the lips do). The pack's soft blush is cut into
flat ovals and its Shade 1 into a hard-edged navy shadow (`blush_flat.png`, `shade_hard.png`, made by `expr_draw.py`; the frightened
expression uses the shadow instead of forehead lines). There are no sweat drops and no tear in sad (Ethan removed them). The cry tears are a thick two-tone stream (0.027 wide, tapering to 0.022, over half the
eye's 0.05), translucent, no outline, **laid on the skin as an overlay in UV space** (`cry_uv.png`, made by `to_uv` in `expr_draw.py` from a
front-view picture through the map `uv_xz.npy` that `face_map.py` bakes from her face's UV layout): her eyelash and eyebrow layers draw
over skin, so the stream starts under the lid, and it runs to the skin's own bottom edge (her jaw) with no stair-steps. (The decal can't
do this: it is a separate surface that sorts against the eye layers and ends in a 1.2 mm staircase at the face border.) Blush is drawn on the decal (not the pack's overlay), just under the eye, and may cover the star tattoo: a soft blended pink glow with
`////` lines on top, for flustered and shy (Ethan's pick; the solid lines, solid ovals and glow-only versions were deleted).
Review: `python assets/model/build/expr_draw.py`, then `blender -b assets/model/spica-v1.blend -P assets/model/build/expressions.py -- assets/model/renders/expr`,
then `python -I assets/model/build/expr_sheet.py assets/model/renders/expr face` (sheets of six). Once, `blender -b assets/model/spica-v1.blend -P assets/model/build/face_map.py` makes the UV map the tears need. expressions: neutral, happy, laugh, soft_smile, smug, smirk, devious, teasing, wink, angry, furious, sad, sad_old (both sads kept), hurt,
cry, flustered, shy, surprised, frightened, confused (the wavy-mouth one), pout, cross_eyed, disappointed, bored, sleepy (yawn was removed;
angry uses the `angry_c` mouth and surprised `Mouth_Surprised`, Ethan's picks). (Names: `smug` is the closed lens smile with smiling eyes, `smirk` the one-sided half-lidded one, `soft_smile` a
soft thin drawn line smile (a gentle curve, 0.34 mm like sad_old's mouth line) with eyes a little wider; Ethan kept `wink`.)
**Doodles** (thick unstable black lines) were built (8 hybrids) and **removed by Ethan** ("not ideal, will be worked on in the future"): the
entries, drawings and pictures are gone. What stays, unused, is the infrastructure they needed: the decal's FRONT layer (draws over her
eyes, rebuilt from the posed face; `FRONT` in `expr_draw.py` is empty) and `hide=("brows",)`. **Rule (Ethan):** render whatever was tried for him to see before deciding it is not needed (he picks from the renders; the rejected candidates were then deleted at his request, nothing is kept). Not yet in `run.sh`, not saved in the
.blend, front view at rest pose only. The decal is a 1.2 mm grid, so its edge stair-steps where it meets the face border.
**Licence:** the pack's EULA forbids redistributing any part of it; it, the references, the transferred keys and its textures stay
local (git-ignored: `assets/references/`, `tex/face/`, `.blend`), like the VRoid samples.

## Known flaws (the clipping and edginess Ethan means, for the next pass)
- Where the hoodie's V strip meets the hood's flaps there are small crumpled knots of outline and a few slivers (the sample hood's own
  folded flap ends); a rebuilt hood was rejected.
- The sample shoe is a blocky low-poly mesh, with a jagged opening where the socks enter it; the hoodie's hem slot has a small wobble
  where the bead meets the cut; the hood's lower edge has a few outline ticks.
- Zip, pockets, stitching, creases (partly), the stars and the tattoo are drawn into shaders, not modelled: right for stills and they
  stay on the cloth in any pose, but nothing is a real object.
- The hard toon step on the shorts shows a few lighting islands at the hips; the dark outfit makes any mesh edge more visible than the
  pale one did.
- The face star is foreshortened (narrow) seen from the front, because the cheek turns away steeply there; regular from 3/4.
- The binary star's rings are faint at full-body size (best in head close-ups); the glow is a shader halo, so a 2D glow may be better for
  sprites later.
- **Licence:** the derived model contains the VRoid samples' geometry and textures (modification and redistribution prohibited in their
  metadata; Ethan exported them himself, so the terms are his to change): **re-export the samples with commercial use and modification
  allowed before the model ships or is committed.**

## Tried and dropped (so it is not tried again)
Hoodie: the sample's own oversized hoodie (puffed); that hoodie pulled in (the armpits tore); a constant-thickness skin-tight shell (a flat
sheet); a drape over the waist (lost the hoodie's shape); a flared hem (thin-looking waist, abrupt bend); an inward Solidify for edge
thickness (dark creases); vertical ribs on the body; a brick-stitch pattern (read as a wall); a tee under the opening (a white V at the
neckline); a rebuilt hood grid, cutting the hood along the V, smoothing its flaps, a facing or bead or tint on the sample hood. Shorts:
crinkles round the hem (a lace edge); a dark shadow strip under the hoodie (a darker strip on the pants); light wear lines on creases
(white scratches); an elastic-looking stocking edge (taper, sheer top, squeezed thigh). Hair: a strip down the back (clips), purple strips,
neon highlights, thin cyan strips on many locks. Palette: warm homemade trial, saturated violet soles, a dark-blue hood.

## Tools
Blender 5.2.3 LTS headless. Skills installed to `~/.claude/skills/` from a vetted markdown-only copy of TMHSDigital/Blender-Developer-Tools
(commit 9ce1540; licence CC BY-NC-ND 4.0, so unmodified and for our own agent use only, never redistributed in this repo):
mesh-editing-and-bmesh, procedural-materials-and-shaders, headless-batch-scripting, uv-and-mesh-attributes, geometry-nodes-python,
constraints-and-parenting, slotted-actions-animation, porting-to-blender-5, blender-rules. Left out: the live-session MCP (runs unsandboxed
code in a running Blender).

## Layout
- `assets/model/spica-v1.blend`: the model (git-ignored, see the licence note; rebuilt by `run.sh`); `spica-<palette>.blend` for other palettes.
- `assets/model/build/`: `run.sh`, `base_prepare.py`, `hair_bob.py`, `hair_cards.py`, `palette.py`, `cloth_layout.py`, `cloth_tex.py`,
  `clothes.py`, `binary_stars.py`, `rig_prep.py`, `spring.py`, `spring_check.py`, `render.py`, `compose.mjs`, `check_model.py`, the expression files (above); later `anim.py`.
- `assets/model/renders/`: git-ignored review renders (`v1/`, `check/` from the check, the two VRoid samples).
- `assets/model/tex/cloth/`: git-ignored textures drawn by `cloth_tex.py`; `tex/face/`: the expression pictures, overlays and `uv_xz.npy`.
- `assets/references/`: git-ignored: the Expression Pack (its reference model is the source of the face's extra shape keys), the VRoid CC0 samples.

## Stages and checks
1. **High-poly body, face, hair, clothes.** Done; Ethan accepted it as v1 (2026-11-08) and chose the palette (2026-11-09).
2. **Revise** until Ethan says locked (v1 is a first draft: "Known flaws" is the revision list).
3. **Face.** Built into the model (2026-11-09): 25 expressions, `face_expr.use(name)` switches them (see "Expressions"). Ethan is still choosing and polishing them.
4. **Rig.** The humanoid armature with fingers exists and is checked (above). **Secondary motion** is `spring.py` (2026-11-09): a spring-bone
   solver baked into pose keys on the hair and bust chains (`spring.bake(arm, f0, f1)`, after the main motion is keyed; 24 fps). A cone
   (20 degrees per hair bone, 15 bust) keeps the stiff bob stiff, a collision keeps tails 12 mm out of skin, hood and hoodie, and
   the bun's chains (08, 09: its cards use them) stay rigid. Test: `blender -b assets/model/spica-v1.blend -P assets/model/build/spring_check.py -- assets/model/renders/spring`
   (head shake, nod, jump, spine twist: bone lengths, NaN, lag, settling, collisions against rigid, same keys on a second bake, renders rigid | sprung;
   0 problems). Bust: a jump moves the bust bones' tips up to 34 mm and the chest and hoodie follow them, no tearing in the side or 3/4 renders.
   **Corrective shapes: decided not needed** (2026-11-09): renders of the sit (side, 3/4, hip close-up) and crossed arms (front, 3/4, side)
   show no skin through cloth and no torn armpit; the counts in `check_model.py` (hoodie 2.8% and shorts 5.5% in sit) are the compressed side of the
   bend. Build them only if a clip shows a problem. Stage 4 is closed; the stiffness and drag numbers (`HAIR`, `BUST` in `spring.py`) are
   a first guess to tune on the first real clip (stage 5), by eye.
5. **Animation preset.** Clips list set with Ethan (starting guess: idle, walk, look-up, sit, smirk, flustered). Check: playblast of each.
6. **Export and integration.** `.blend` plus renders (a `.glb` is a structure test only); `render.py` makes sprites from clip frames; one
   end-to-end test post through `pnpm eval --llm=fake`.

## Limits (be honest)
Rendered looks are judged by Ethan; Claude checks proportions, silhouette, palette and consistency from renders and measures what can be
measured (distances, weights, clipping counts). Hair is the highest risk. Procedural animation is functional, not polished.

## Out of scope
Version arc beyond v1, voice, video output, emotion-flare effects, publishing (O2+).
