# Orbit O1 v2: rig, swing and expressions

What the next stage of her v2 model adds, how it is built, and how each part is checked.
Nov 10, 2026. Status: built. The sections below are the design as agreed; where the build went a
different way, this list and `DECISIONS.md` win.

## What changed while building it

- **Rest pose is the T-pose** (Ethan's call), not arms hanging. Her arms-down look is stored as a
  pose plus an `arms_down` shape key. The chain is body and head in both arm positions, `tbody`,
  `shoulders`, `clothes`, `hair`, `accents`, `tpose`, `drape`, `expressions` (`rig.py` is now only
  the functions `tpose.py` uses).
- **Cloth shapes** are three positions from the T-pose: forward, up, overhead. There are no
  shoulder-lift drivers.
- **Hidden skin under the hoodie is removed for real**, so she cannot be shown without it.
- **Expressions:** the set of 25 from v1 is built as designed here, and a second set of 32 designed
  for her (`expr2_defs.py`) is the current one. It adds real eye movement, and tears drawn flat.
- **Brows show through her fringe** in every render (`brow_over.py`), which changed her rest look on
  purpose. So did the navy star.

## Intent

Make v2 movable and expressive, so clips and sprites can follow, without changing how she looks
at rest. Ethan said: VRoid-style skeleton fitted to her v2 body (approach A), in the order rig, then
swing, then expressions. Nothing new is added to her design. Clips and sprites are the next stage.

**Done means:** at rest she renders the same as today, the stress poses and all 25 expressions
pass Ethan's review of the renders, and `sh assets/model_v2/build/run.sh` builds it all from
nothing.

## What exists today (measured from `spica-v2.blend`)

- No armature. Only `Face` and `face_outline` have weights (79 groups, v1's bone names).
- `Body` is one connected mesh with 88 open edges. Everything else has no bone weights.
- `Face` has 58 shape keys and v1's has 224. The two match point for point.
- `Face`'s Basis has v1's resting lid (0.2 of `Fcl_EYE_Close`) baked in, and its mouth slot holds
  `face_hidden`, because v1 was saved on its neutral expression.
- The ponytail's hanging line is computed in `hair.py` and then thrown away.

## Build

Two new steps run after `accents`: `body head clothes hair accents rig expressions`, then the
renders. Each new step is one file in `assets/model_v2/build/`.

### Checkpoint 1: rig (`rig.py`)

- **Skeleton:** v1's humanoid bone names: `Root`, hips to head, shoulders, arms, 15 finger bones a
  hand, legs, feet, toes, the two bust chains and the eye bones `Face` is weighted to. No bob bones.
- **Joints are measured** from the finished mesh (cross-section centres along each limb), and each
  must land inside its limb.
- **Rest pose is how she stands now**, arms hanging as the sleeves were draped, so no mesh moves.
- **Body weights:** Blender's automatic weights on a closed copy of `Body`, copied back. If those
  come out badly, weights from a VRoid sample body are the fallback (option C). Bust bones get a
  smooth falloff round the measured bust peak.
- **Face** keeps its own weights. Where `Body` meets it at the neck, `Body` takes `Face`'s weights,
  so the join cannot open.
- **Clothes** copy from the nearest skin of the matching limb: the hoodie's existing `arm` attribute
  keeps sleeves on arm skin, and shorts and socks keep each side on its own leg.
  Sneakers are rigid on foot and toe. `zip_strip`, `zip_slider` and `accent_stocking_stars` copy
  from the cloth they lie on. `Armature` goes first on every modifier stack.
- **Rigid on the head bone:** `hair_bob`, `hair_tie`, `hair_star`, `accent_face_mouth`. The binary
  star is parented to the head bone.
- **Limits, as v1:** at most four weights a point, adding up to 1, none on bones she lacks.
- `Root` stays at z = 0 and her soles sit 3 cm below it. The clip stage allows for that.

**Review:** `check_rig.py` (trimmed from v1's `check_model.py`) measures the rules above and the
neck join in a head turn and nod (must stay within 1 mm), and counts cloth points inside skin. It
renders rest, A-pose, arms up, arms forward, arms crossed, sit, lean, head turn, stride and spine
twist. Rest is also compared with today's render, and must match. `pose.py` and `run_pose.sh` are
then deleted.

### Checkpoint 2: swing (`spring.py`)

- Copied from v1's solver and trimmed: no bun logic, and it collides with `Body`, `Face`, `hoodie`
  and `hair_bob`.
- **Ponytail:** `hair.py` gains one attribute, `chain_t`, each point's place along the hanging line.
  `rig.py` builds `J_Sec_Pony*` bones through the final mesh's centres at that value, so the head
  resize is already included. Weights blend along the chain; the part at the tie is rigid.
- **Bust** swings with v1's bust settings. The bob stays stiff.
- **Binary star** orbits on a driver with no keyframes, as v1 does.

**Review:** head shake, nod, jump and twist. Bone lengths hold, a second bake gives the same keys,
the tail stays out of her body and settles after the motion stops, renders rigid beside sprung. The
stiffness numbers are a first guess until the first real clip.

### Checkpoint 3: expressions (`expressions.py`)

- **Basis first:** take the baked 0.2 lid out of `Face`'s Basis and every key. v1's table then
  applies unchanged, and neutral's own 0.2 restores today's eyes. Check: neutral matches today's
  render.
- **Keys:** the 166 keys `Face` lacks are copied from v1 by point number, as offsets, scaled by the
  same fit `v1_face.py` measures, times the head scale.
- **Mouth and shells:** bring in v1's mouth material, rebuild `face_outline` and add `mouth_outline`
  with all the keys, and add one skin overlay slot (no expression uses more), following v1's
  `face_setup.py`.
- **Tattoo:** each of its points takes the key offsets of its nearest face point, so it moves with
  her cheek. Weighted to the head bone.
- **Table and pictures:** v1's `expr_defs.py` and its pictures are reused as they are. The tears are
  laid by UV, and v2's skin has exactly v1's UV layout (measured), so they need no re-bake.
  `use(name)` works as on v1.

**Review:** a sheet of all 25, beside v1's. Blush and tears were placed on v1's face, so those are
the ones to look at. Fixes go through Ethan's notes, as on v1.

### Checkpoint 2b: cloth that responds to her arms (`drape.py`)

Added by Ethan on Nov 10, after the Y pose bent the sleeve into a hard crease at the deltoid.

- **Shoulder lift:** past about 60 degrees the shoulder bone rises with the upper arm, by a driver.
- **Cloth shapes:** one cloth simulation for each key arm position (out, forward, Y, overhead) starts
  from the approved hoodie. Hood, hem, zip and lower body are pinned. Each result is turned back into
  her rest pose and stored as a shape key per side, blended by the arm's angle to that key position.
- **Order:** this step runs after `rig.py`, and the hidden skin is removed after it, because the
  simulation needs her whole body to collide with.

**Review:** `check_drape.py` measures the shapes, and Ethan judges close-ups of the key poses.

## Risks

- **Arms up:** the arms start hanging, so raising them turns the armpit and sleeve the furthest.
  Skin may show through. `pose.py` deleted hidden skin for this. Doing so for real is a design
  change, so it is asked first if the renders need it. Otherwise the fix is corrective shapes, only
  where a render shows a problem.
- **`Body`'s open edges** may upset automatic weights: hence the closed copy and option C.
- **Barefoot is not possible:** her feet are slimmed to fit the shoes, so she always wears them.
- **Build needs** `spica-v1.blend` and `assets/references/`, as v1's expressions do. The Expression
  Pack's licence keeps the transferred keys local, so all of this stays git-ignored.

## Out of scope

Clips, sprites, IK controls, swing on the bob, hood or clothes, doodles, the open flaws in the
handover (hoodie patch, stocking ribs, denim twill), and any change to her look.
