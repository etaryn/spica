# Orbit O1 — her 3D model

Status: **v1 built and accepted 2026-11-08** (body, face, hair, clothes, socks, star tattoo and stars; a first draft, with some
clipping and edginess left, see "v1" below). Look: `docs/orbit-o1-character-brief.md` (source of
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

## Hair design (2026-11-08, Ethan; brief reopened)
A short, stiff bob (chin length, the layer under the outer hair darker so the layers read apart), a simple fringe, and
one small bun at the side-back on her right: nothing else. The long strip, the low bunch, the wolf cut and the cubes
were built or considered and dropped: anything long and loose clips in every pose (a strip down the back clipped
into the bob however it hung). The star tie and stars are off. Each piece is its own object, so removing one is a
delete.

**Built 2026-11-08, rebuilt after review (Ethan to judge):** `hair_bob.py`. The bob and fringe are the
first sample's own cards, reshaped a little (front locks cut to chin, fringe leaned and shortened to brow level).
One piece is not the sample's. A long strip down her back was built and dropped (2026-11-08, Ethan): the bob curves
inward under it and clips through however it hangs, so the bun alone carries the asymmetry. The **bun** is copied from the
third sample (its right-hand bun cards as they are, moved rigidly onto her head, nothing bent), recoloured in her hair
tones and set at the side-back on her right, sunk 2.2 cm into the bob so it sits on her head with no neck. The
star tie (band and stars) is off for now: the band needs a neck and the stars were taken out; `SPICA_TIE=1` builds
them again. Earlier simulated ribbons (strip over the shoulder, cone-of-petals tuft) were dropped: they bent out
and forward, and the tuft read edgy.
Hair colour comes from the samples' own hair textures (`hair_toon`): the texture's brightness, with its dark
roots, lighter tips, lines between strands and highlight blobs, is mapped onto her palette (hair base `#CFE0F2`,
shadow `#8FA6C8`), then the unlit side goes toward the shadow colour. Nothing is invented: no random tones, no
added streaks, no neon, no dyed strips (a pair of purple strips was tried and removed). One addition: the inner
layer is darker, found by ray casts (the cards that lie under other hair: sample cards 020 to 055, 072, 086, 087,
some bun cards), so the layers of the bob read apart. Everything added is rigid on the head bone: no swing yet. The saved .blend
opens tidy: rig and bone helpers hidden (the armature still deforms her), Material Preview, a view sun and world.
**The bun's geometry comes from a sample whose VRM metadata also says modification prohibited**, so the same flag
applies: the derived .blend stays git-ignored until Ethan re-exports with modification allowed.

**Clothes (2026-11-08, Ethan to judge; revised five times after the first pass):** `clothes.py` (saves
`spica-v1.blend`, runs after `hair_bob.py`). The **hoodie** is a shell of her own skin (torso, shoulders and arms to the wrist),
welded at her skin mesh's UV seams (or any offset or smoothing opens gaps there), pushed out 2.4 cm on the body and 1.8 cm on the
sleeves along her skin's normals, so it keeps her shape; smoothed six times (the thicker the knit, the more the offset has to be
eased where she curves in), kept 8 mm off her skin, and only then cut straight at the hip and the wrists. The hem and the cuffs
are rolled (`roll`): the offset gets a thick rim (+8 mm hem, +6 mm cuffs) and then shrinks to 15% at the edge as a quarter circle,
so the edge curves in toward the body and shows the cloth's thickness; the denim shorts' hems curl in the same way (`curl_edge`).
The sample's hood and lining lie on top as the fixed collar. Colour: pale off-white `#F2EFE8` with cool light shadows `#D3D8E0`,
soft wide shading and a pale fuzzy rim. Texture: cotton, a faint fine weave plus a fine grain, drawn in 3D from her rest-pose
coordinates, stored on the mesh as two UV layers (`rest_xy`, `rest_xz`), so they stick to the cloth in any pose. Tried and gone:
the sample's own oversized hoodie (puffed); that hoodie pulled in (the armpits tore); a constant-thickness skin-tight shell
(read as a flat sheet); a drape (the cloth hangs from supports over the waist: Ethan said it lost the hoodie's shape, 2026-11-08);
vertical ribs; a brick-stitch pattern; an inward Solidify for edge thickness (dark creases); navy. The **shorts** are the sample's,
only the part its alpha mask shows (the rest of that mesh is a hidden full-body layer) plus the band of that layer round the hips,
cut just below her crotch and just above the hoodie's hem, in denim blue with a diagonal twill pattern. The legs are bare. The
**sneakers** are the sample's, laces dropped, off-white upper and the lowest 4.5 cm amber. The sample's pieces are skinned with its own weights to her armature (same
bone names) and moved up 5 mm (the sample's body sits that much lower), then pushed off her skin; the shells use her skin's
weights. Known: no pocket; the sample's hood stands as a tall collar behind her neck and its edge is still a flat sheet; the
sneakers are the sample's blocky low-poly shoe; no stress poses tested yet (stage 4). The sample's hood, shorts and shoes carry the
same modification-prohibited flag as the other samples.

**Look (2026-11-08, Ethan: the busy warm style did not fit; blank clothes, a zip, slits, back pockets, a spacey palette; he accepted the palette):**
the clothes are blank again (the patches, the pocket, the heart, the label, the gingham, the elbow patches, the coloured
ribbing, the terracotta lining and the shoe accents were removed). What is added is drawn as textures by `cloth_tex.py`
(Pillow and numpy, run by `run.sh` before Blender; PNGs in the git-ignored `assets/model/tex/cloth/`; layout and colours
in `cloth_layout.py`) and laid on the cloth in the shader from her rest-pose coordinates, so they stay on the cloth in any pose:
on the hoodie a zip (tapes, teeth, slider and pull) and two slanted hand-pocket slits (just the slit, a lip, tone-on-tone
stitching and bar tacks); on the pants a front and a back picture (see below). Palette: off-white hoodie, greyish-black pants,
a violet accent: lavender-periwinkle hair, dark glowing violet eyes, violet sneaker soles, deep indigo outlines.

**Layering and denim (2026-11-08, Ethan: the hoodie loose at the bottom, open above the zip, real denim, light-blue eye and hair highlights):**
- Hoodie layering (revised the same day: a flared hem made the waist look thin and bent back in abruptly to meet the pants,
  and the cut-out V read as a window, not a split neckline). There is no flare. The hem (`HEM_Z` 0.855) is low enough to cover
  the top of the shorts' back pockets and keeps its full thickness to the edge, so it stands clear of the shorts, which hug
  her under it. The zip's slider sits at z 1.22 (`ZIP_TOP`); above it `open_front` cuts a V (half-width 0.7 x height above
  the slider) through the hoodie's shell (the hood's front is cut separately, see below). The front above the
  slider has up to 2 cm more room (`thickness`), and the cut
  edges are given more than their thickness (`lo` 1.7 in `open_front`): they roll outward like lapels, standing off her.
  The edges carry a lining facing (the hoodie and her skin were both warm and about as bright, so the neckline blended in;
  Ethan picked a deeper lining, then asked for a spacey dark blue, darker than her hair, and for the band to be traced and
  applied properly, not pasted on). `LINING` is `2D3A8C` (shadow `1C2566`). The facing is real: `open_front(facing=...)` rolls the
  cut edge first (rolling thin strips one by one made the surface ragged), then splits the faces along the lines `FACING_W` (1.4 cm)
  and a few finer ones from the edge as it lies, so the strip's border is a clean line; its faces get a second material slot (the
  lining), it stands 2 mm proud with a 1.5 mm seam groove where it ends, and a row of tone-on-tone stitches runs beside it on the
  body (drawn in `hoodie_front.png`). The slots are cloth, lining, outline, outline (`line_up`). The inside of the cloth (its back
  faces: seen at the opening, the cuffs and the hem) is the lining colour in the shader (`lining` in `toon`). The lapel's outward
  flare fades out toward the top (`lo_top`), so the band tucks under the hood's flaps and is not run through by them.
- The hood is the sample's own, lying on top of the strip (Ethan: the rebuilt hood was not good; use the original and overlay it
  above the V strip without clipping; the space-blue hood read as a huge patch of blue that cannot be recognised as the hood, so
  its colour is off-white again, inside and outside; and its edges where it meets her shoulder were broken: copy the original
  as much as possible, do not build it). So it is touched as little as possible: its front, a V that would run across the
  opening and the sample's shredded flap ends (a pile of sliver triangles that no smoothing can fix), is cut off with one
  straight plane (`HOOD_FRONT_Y`, y = 0: she faces -y), so the hood ends in two clean flaps beside her neck; the dark strip goes
  under them. Everything behind the plane is the sample's, with no subdivision, no smoothing and no cut along the V. It is
  pushed 6 mm off the finished hoodie and her skin. The sample's thin inner layer is dropped (it pokes through the outer one).
  Tried and removed: `rebuild_hood` (a clean grid cast from the sample: the neck stood well against its dark-blue inside, but
  its lower edge and back looked wrong), cutting the hood along the V (ragged flaps), smoothing the flaps, and a facing, a
  bead or a tint on the sample hood (they showed its messy double-layer mesh). Still: a few tiny slivers where the strip
  meets the lower edge of a flap.
  There is no tee under it: the opening shows her skin (a white tee V at the top of the zip was removed).
  The zip ends above the hem band with a bottom stop (`ZIP_END`); below it `split_hem` cuts a slot (`HEM_SPLIT`, 1.2 cm
  wide, 1.6 cm tall) so the two halves of the hem stand slightly apart.
- Hems of their own (Ethan: a clear hem, a separate, slightly rolled, thicker line with a hem texture, not just outlines).
  `add_loops` puts a ring of edges every 2 mm up the hem (the faces are 1 cm tall), then `hem_band` shapes it: from the lower
  edge up `HEM_BAND` (hoodie, 1 cm) or `PANTS_BAND` (shorts, 1.9 cm) the cloth stands proud (3 mm / 3 mm); the rounded edge and the
  top fall-off shrink with a small band with a rounded
  lower edge, and a narrow groove (the seam) cuts in just above. The hoodie's band moves straight out from the torso axis,
  not along the normal (the normal is noisy in the groove down her spine and the bead folded into dark arrows there). Textures:
  the hoodie's band has fine vertical ribs round the torso in the shader (`ribs`; a whole number of them, `RIBS_ROUND`, so
  there is no seam at the back), a seam line and a row of tone-on-tone stitches above it (`hoodie_hem`, drawn in the front and
  back pictures); the shorts' band has two rows of topstitching and the groove (`hem_lines`). The earlier dark shadow strip
  on the pants under the hoodie hem is gone (it read as a darker strip at the back of the pants).
- Hoodie tone (Ethan: the hoodie `F2EFE8` and her skin `F8E5DC` were both warm and equally bright, so the neckline and the hood
  blended into her neck; the dark-blue hood was rejected, then he asked to try a cooler hoodie tone): `HOODIE` is `E6E7F3`
  (shadow `CBCDE4`) for the hoodie and the hood, a pale lavender-grey tied to the hair, warm skin against cool cloth. The sneakers
  keep the warm off-white (`OFFWHITE`). The same brightness, a different hue.
- Shoes and socks (Ethan: the shoes in a tone like the rest of her; a thigh-high sock on one leg and a normal sock on the other):
  the sneakers' uppers are now `HOODIE`; the soles are a muted periwinkle (`SOLE_TONE` `9D96D8`, shadow `7670B0`; the saturated violet
  accent was too striking, Ethan). `make_sock` builds a sock as a shell of her leg (the
  leg bones' weights select the faces, 2.2 mm out, from inside the shoe at z 0.05 up to `SOCK_TOP_LONG` 0.70 on her left leg or
  `SOCK_TOP_SHORT` 0.19 on her right, a straight top edge cut by a plane), skinned like the leg, and, on the ankle sock only (`band`), a ribbed band `SOCK_BAND`
  (2.2 cm) at the top that stands 2.5 mm proud over a seam groove (`add_loops` and `hem_band(down=True)`); the thigh-high stocking has no
  hem (Ethan), only the straight plane-cut top edge, so it wraps the thigh cleanly (an attempt to make that edge read as elastic, with a
  taper, a sheer top and a squeezed thigh, was reverted: Ethan liked the plain edge better), in `SOCK` `F8F7F4` (a clean off-white, nearly
  white, with the hoodie's cool shadow `DAD8E4`; they were dark violet-grey, then a light cool white that read lavender-grey, and Ethan
  wanted off-white or white)
  with fine vertical ribs round the leg in the shader (`sock` in `toon`, `SOCK_RIBS` of them). The thigh-high sock ends 6 cm below
  the shorts' hem, so a band of skin shows. Rough: the sample shoe's opening is a jagged edge where the sock goes in.
- Stars (Ethan: a small five-pointed tattoo under the corner of her eye, and big stars on the stocking, flush and sticking, not flat
  objects; then: the face star looked a little distorted, and three big stars wrapping round the leg, visible from all angles). They are
  textures, not objects: `face_star.png` and `sock_star.png` are one star each (point up, outer radius `STAR_FILL` 0.45 of the width of a
  square picture) drawn by `cloth_tex.py` (a ten-corner outline, inner radius 0.382 of the outer) and laid on the surface in the shader, so
  they have no thickness to float or clip and follow every bend. The tattoo (`tattoo_face`): her skin material is copied for the face
  alone and the picture is laid by the face mesh's own UV map, which wraps the cheek with hardly any stretch (measured at the star:
  0.29 m per unit along u and 0.26 along v, at right angles), the two directions scaled to metres so the star is the same size both
  ways; it follows the surface exactly even where the cheek turns away. The first version projected the picture straight back along y,
  which looked fine from the front but stretched the star about 2x on the surface (the cheek's normal there is 60 degrees off the front);
  that was the distortion. Only skin within 1 cm of the star's centre gets it (the gate is in the mesh's undeformed 'Generated'
  coordinates), shaded like the skin at 92 % opacity, colour the iris's mid violet `5A44D4`, 9 mm across, centre x 0.058, z 1.4245
  (`FACE_STAR`). Because the cheek really does turn away there, it is foreshortened (narrower) seen from straight on, and a regular star
  from a three-quarter view. The stocking's three stars (`SOCK_STARS`: height, angle round the leg, outer radius, turn: z 0.585 at -32
  degrees and 7 cm, z 0.415 at 135 degrees and 6.4 cm, z 0.245 at -105 degrees and 5.2 cm) are each laid by the true distances on the cloth from
  their own centre: the angle round the leg from the star's centre line (wrapped) times the leg's radius at that height, and the height
  above the star's centre, so none is stretched as the thigh narrows to the calf, and a star wider than the front of the leg wraps round it
  (the three are 120 degrees apart, so one is always showing from the front, the outer side and the back; the inner side is hidden by her other
  leg). The leg's centre and radius are measured on the finished shell at seven heights and interpolated in the shader. Colour: the hair's
  shadow tone `8E86D0`, shaded like the cloth.
- Denim, from what makes it read in a toon render (the real weave is too fine to show, so the cues are big ones): a hard toon
  step (not the soft ramp that read as a melted patch); a twill coarser than the real cloth (ribs 5 mm apart, faint, so it does
  not stripe); a few creases, not mirrored (whiskers from the fly out to each hip: three on her left leg and two on her right, and a
  smile line under each seat, all different), each drawn as shadow (a soft
  dark band with a darker line in it, tapering at both ends; light wear lines read as white scratches and were removed), and
  the mesh (subdivided five-fold, 4-5 mm) is bent along the same lines (`crease_cloth`) so they catch the light as folds;
  front pocket mouths, fly and back pockets in topstitching (a dark groove and a row of thread in a slightly lighter grey, no
  contrast colour).
- Bugs found on the way: the sample's shorts mesh is split along its UV seams, so moving the cloth tore it open and the
  smoothing could not cross the seams (now welded first, then smoothed 80 rounds so hard toon steps do not show its lumps as
  blotches); creases displaced the coordinates the pattern was laid by (rest coordinates are now stored before the creases);
  crinkles added round the hem read as a lace edge (removed; the hem band replaced them); the tee poked through the shorts' waist (the tee is gone now).
- Eyes: the iris glows light blue (`A9D6FF`) at its lower edge and the highlight is light blue (`CFEAFF`). Hair: one lock
  (`STREAK_CARD`, the sample-1 card whose texture carries a cyan streak) has that streak painted light blue (`B4DAFF`)
  with the strand lines kept: a thin strip beside her left cheek. Widen it or move it by changing the card.

## Base model (2026-11-07)
Built on a VRoid Studio sample export (`sample_model.vrm`, kept in `assets/model/base/`, git-ignored).
Its VRM metadata reads: commercial use `personalNonProfit`, redistribution not allowed, modification
**prohibited**. Ethan exported it himself (author field "spica"), so those terms are his to change:
**re-export with commercial use and modification allowed before any of this ships or is committed.**
Until then `spica-v1.blend` (the derived model) is git-ignored (`assets/model/*.blend`); only the scripts and the docs are committed.
Pipeline: `base_prepare.py` (import the glTF, strip clothes, her toon materials, outline), then `hair_bob.py` (the bob, the bun,
the eye colours), then `clothes.py` (clothes, socks, the star tattoo; saves the model); `hair_cards.py` holds the helpers the
last two share. The .vrm is read as a .glb copy, so no VRM add-on is needed.

## v1 (2026-11-08)
Ethan accepted the model as her v1: "good enough to work for her v1" despite some clipping and edginess. It is the file
`assets/model/spica-v1.blend`, rebuilt from the scripts by `sh assets/model/build/run.sh` (the textures of the clothes are drawn
first by `cloth_tex.py`; review renders go to `assets/model/renders/v1`). The older models (the procedural v1 to v3, v4 to v7 and
the 2026-11-08 stages up to v8) were deleted when v1 was saved, with the build scripts only they used (`build_model.py`,
`hires.py`, `hair.py`, `geo.py`, `inspect_base.py`, `make_face.mjs`, the face texture) and the v4 and v5 hair paths in
`hair_cards.py`; their history is in git (the old procedural v1 to v3 are in earlier commits). Rebuilding after the cleanup
gives renders pixel-identical to the model before it (all 32 review images checked).

What is in v1: the asymmetric bob and fringe, one bun on her right, a light-blue strip of highlight in one lock; a glowing
dark-violet iris with a light-blue lower glow and highlight; a small star tattoo under her left eye; a cool-white hoodie (zip,
two slit pockets, ribbed hem band split below the zip, open V neckline with a dark-blue lining facing, the sample's hood as
a collar), greyish-black denim shorts (twill, creases, topstitching, rolled hem, back and front pockets), bare legs with a
thigh-high stocking with three big stars on her left leg and an ankle sock on her right, cool-white sneakers with muted
periwinkle soles. Palette in the brief.

Known flaws (the clipping and edginess Ethan means, for the next pass):
- Where the V strip of the hoodie meets the hood's flaps there are small crumpled knots of outline and a few slivers (the
  sample hood's own folded flap ends; the hood is cut off by a plane in front of her neck, and a rebuilt hood was rejected).
- The sample shoe is a blocky low-poly mesh, with a jagged opening where the socks enter it; the hem slot of the hoodie has a
  small wobble where the bead meets the cut; the hood's lower edge has a few outline ticks.
- Zip, pockets, stitching, creases (partly), the stars and the tattoo are drawn into the shaders, not modelled: right for stills,
  and they stay on the cloth in any pose, but nothing is a real object.
- The hard toon step on the shorts shows a few lighting islands at the hips where the light edge crosses the curves.
- The face star is foreshortened (narrow) seen from the front, because the cheek turns away steeply there; regular from 3/4.
- The hood and neck are both pale: they separate by hue only (cool hoodie against warm skin). The dark-blue hood was rejected.
- No stress poses tested (stage 4), no animation, hair and hood are rigid (no swing).
- Licence: the derived model contains the VRoid samples' geometry and textures (modification and redistribution prohibited in
  their metadata); re-export the samples with modification allowed before the model ships or is committed.

## Tools
Blender 5.2.3 LTS headless. Skills installed to `~/.claude/skills/` from a vetted markdown-only copy
of TMHSDigital/Blender-Developer-Tools (commit 9ce1540; licence CC BY-NC-ND 4.0, so unmodified and
for our own agent use only, never redistributed in this repo): mesh-editing-and-bmesh,
procedural-materials-and-shaders, headless-batch-scripting, uv-and-mesh-attributes,
geometry-nodes-python, constraints-and-parenting, slotted-actions-animation, porting-to-blender-5,
blender-rules. Left out: the live-session MCP (runs unsandboxed code in a running Blender).

## Layout
- `assets/model/spica-v1.blend`: the model (git-ignored, see the licence note; rebuilt by `run.sh`).
- `assets/model/build/`: Python build scripts, so the model is reproducible from code and every change is a diff:
  `run.sh` (the whole build, the renders and the sheets), `base_prepare.py`, `hair_bob.py`, `hair_cards.py` (shared helpers),
  `cloth_layout.py` (positions and colours), `cloth_tex.py` (draws the clothes' details, runs outside Blender),
  `clothes.py`, `render.py`, `compose.mjs`; later `rig.py`, `anim.py`.
- `assets/model/renders/`: git-ignored review renders (`v1/`, and the two VRoid samples).
- `assets/model/tex/cloth/`: git-ignored textures drawn by `cloth_tex.py`.
- Model parts as separate named objects: the body and face, hair cards and the bun, hoodie, hood, denim shorts, sneakers, two socks.
  Built with rigging in mind: nothing dangling.

## Stages and checks
1. **High-poly body, face and hair (no clothes).** Mannequin-smooth body (no anatomical detail),
   sculpted face (nose, lips, brow, cheeks, ears), fine hair locks. Toon material with ink-navy
   outline, palette from the brief.
   Checks: front/side/back/three-quarter turntable renders; 64 px black-silhouette test; palette
   sampled from the render matches the hex codes; amber appears only where the brief allows
   (scripted pixel check). **Ethan reviews the look.** Base approved 2026-11-08; clothes and details added; the whole accepted as v1 on 2026-11-08.
2. **Revise** until Ethan says locked (v1 is a first draft: the known flaws above are the revision list).
3. **Face.** Swappable eye/mouth textures for the five expressions.
4. **Rig.** Humanoid armature with fingers; hair, tie and the fixed hood follow the head; the long strip and side ponytail each get a short stiff chain.
   Check: stress poses (arms up, sit, hand at mouth) without clipping.
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
