# Orbit O1 v2 — design spec

What v2 of her model is, what it is built from, and the order it is built and reviewed in.
Nov 10, 2026. Status: checkpoints 1 to 4 accepted; final sheet against v1 made, awaiting Ethan's verdict. Later choices (v1 face features, cream zip hoodie, washed denim, gradient socks) are in DECISIONS.md and override the brief.

## Intent

Ethan is handing the model to a more skilled builder: rebuild stage 1 (body, face, hair, clothes) as
v2, judged against v1 by renders. The limits written for v1's builder do not apply. Any tool or source
may be used if it gives a better result. v1 stays as it is, so he can pick between them.

## Design

The look is roughly v1's: Spica, a girl with stars as her theme, soft and comfortable-looking.
`o1-character-brief.md` remains the starting point (midnight-noir palette, blue-white hair with one
cyan strip, binary star above her head, star tattoo, thigh-high star stocking and ankle sock, hoodie,
pale denim shorts, sneakers). Where the brief describes how v1 was made, v2 follows the look only.

Changes from the brief, from Ethan's direction of 2026-11-09:

| Part | v1 brief | v2 |
| --- | --- | --- |
| Mood | Cool, observant | Soft and comfortable first, with the dry character kept in the expression |
| Hoodie | Cut close to her body, deep open V | Relaxed fit with real folds, zipped higher, a hood with real volume |
| Hoodie and shorts detail | Mostly drawn in the shader | Modelled where it shows: pockets, zip, hems, cuffs, seams |
| Hair | Stiff bob and a small side bun | A bob and a **side ponytail** (Ethan: the bun was only ever a fallback), more stylised: large sculpted locks with clean shapes |

**Rule for additions:** design choices inside the theme are the builder's. Anything new on her that
the brief does not list (an accessory, a new garment detail with its own identity) is asked first.

## Base and references

- **Body:** `GEO-body_female_stylized` from Blender Studio's Human Base Meshes v1.4.1 (CC0; 12,500
  quads, about 6 heads tall, A-pose, real fingers and toes, loops around eyes and mouth). One
  continuous mesh for head and body, so there is no neck seam.
- **Why not a VRoid body:** the CC0 `Base_Female` has its clothes merged into a 7.8k-vertex body and
  low-detail hands. It suits use as a measuring reference better than as a mesh.
- **Measuring references:** orthographic renders of the VRoid samples in `assets/references/`, whose
  own metadata allows modification and commercial use (`Base_Female` and `HairSample_Female` are
  marked CC0). Used for anime head proportions and plane placement. No geometry or textures from them.
- **Licence result:** v2's face features are now v1's (Ethan, 2026-11-10), so v1's condition applies again: re-export the source VRoid sample with modification and commercial use allowed before she ships. The hoodie and sneakers need their CC-BY credits.

## Build, part by part

- **Body:** reshape the base with landmark-driven smooth deformation to softer anime proportions:
  narrower shoulders, soft waist and hips, fuller thighs, smaller hands and feet, fingers kept clear.
- **Head and face:** copied from an existing VRoid head and joined to the body at the neck, scaled
  uniformly only, so its jaw and skull stay as authored. (A head reshaped from the base mesh by
  measured proportions was built and rejected by Ethan on 2026-11-09: compressed, elongated, no
  jawline, skull off.) Eyes, shading and small adjustments are then done on the copied head.
- **Hair:** copied, like the head: the bob from `AvatarSample_D`, the side ponytail's locks from
  `AvatarSample_G` (mirrored to her right, scaled evenly), both cleared for modification and commercial
  use by their own metadata. Flat colour: a root-to-tip gradient, a small highlight on some locks, and
  the cyan strip fading in on the long lock by her left cheek. The ponytail is its own object for a
  swing rig later.
- **Clothes:** copied where possible. The hoodie shape is "hoodie and skirt" by Takeru (CC-BY-4.0, so
  the credit in `base/hoodie_a/license.txt` must go wherever she is shared), fitted to her body and
  drawn in her colours. A roomy VRoid hoodie was tried first and rejected as too puffy. The shorts are
  a fitted shell of her own skin in the proportions of Ethan's reference, because the references he
  liked are fused to their bodies or tore when fitted. Hoodie and shorts colours are decided last.
  Socks are tight shells of her own leg, as the brief lays them out. The sneakers are "Demix sneakers
  with different laces" by TadenStar (CC-BY-4.0, so the credit in `base/sneaker_a/license.txt` must go
  wherever she is shared), scaled evenly to her foot; the shape only, not its textures. The shoe is a
  solid shell, so her foot is slimmed to sit inside it, and the sole sits below the height she stands at.
- **Accents:** `accents.py` adds the star tattoo (a thin mesh following her left cheek) and the binary
  star, on the brief's numbers except that the pair sits 20 cm from the middle of her head, because her
  v2 hair is taller. It is still; the orbit turns once the rig exists. Saved as `spica-v2.blend`.
- **Shading:** one toon material family with controlled ramps, a rim term, cloth grain and an
  inverted-hull outline driven by smoothed normals, so lines stay unbroken at hard edges.

## Checkpoints

Each ends with renders for Ethan; the next starts after his word.

1. **Body and hands**, clay and toon, front, three-quarter, side, hand close-up.
2. **Head and neutral face**, including close-ups beside v1. **Hair waits for this gate.**
3. **Hair**, with silhouette at 64px.
4. **Clothes and details**: hoodie, shorts, socks, sneakers, tattoo, stocking stars, binary star.
5. **Final sheet against v1**: front, three-quarter, side, back, silhouette.

## Layout

- `assets/model_v2/build/`: v2's own scripts, with `palette.py` copied by value from the brief's table.
- `assets/model_v2/base/`, `spica-v2.blend`, `renders/`: git-ignored, as for v1.
- Blender 5.2 LTS, headless. Placement is measured, not eyeballed.

## Out of scope for stage 1

Rig, skin weights, spring bones and clips. Expressions: the 25 built for v1 rely on its VRoid face and
do not carry over, so v2 gets its own expression stage only if Ethan picks it.

## Risks

The face is the main risk, which is why gate 2 stops before hair. Cloth simulation can produce noisy
folds, so the fallback there is to model the large folds directly.
