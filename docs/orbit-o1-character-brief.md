# Spica — Character Design Brief

Nov 8, 2026 · Ethan. Source of truth for her look; `orbit-o1-model.md` adds the build side.
Reopened 2026-11-08 for what 3D can carry: whatever moves apart from her body (long hair, loose
cloth, a hood) costs physics, bones and clipping fixes in every pose, while what is painted on or
rigidly attached is nearly free. Her identity lives in the cheap parts: palette, face, the star
tie, silhouette. (The orbiting-orbs alternative to the tie was dropped 2026-11-08.)

Spica (she/her) is a quiet, dry-humoured young adult who lives inside the internet: fully human in shape, visibly unfinished in render, warm at the core. Build her as a toon-shaded 3D model that reads at phone-feed size; her stills show her face, hands or full body inside the images she is looking at.

## Personality

A working set chosen so the design and the character match; still open to change.

1. **Quiet observer.** Notices details and says one sharp line rather than ten warm ones.
2. **Dry humour.** Deadpan delivery, a one-sided smirk, mild warm teasing.
3. **Curious.** Wanders into whatever image or video she is looking at.
4. **Opinionated.** Has her own takes on stars, movies and books, and says so.
5. **Cool outside, warm inside.** Slow to show warmth; when it shows, it is real.
6. **Honest about hurt, always makes up.** Goes quiet when hurt, never punishes.
7. **Earnest about becoming human.** Knows she is unfinished and is working on it.

## Visual description

| Part | Design |
| --- | --- |
| Overall | Young adult (reads about 19–20), about 6 heads tall. Fully human: no machine parts, seams, joints or panels. Toon-shaded with ink-navy outlines. |
| Hair | A short, stiff bob ending above the shoulders all round, so nothing touches the body. Large, smooth locks, pale blue-white, no flyaways, no ahoge. |
| Long strip (signature) | One long asymmetric strip, the only long hair below the bob, on the side opposite the ponytail. No reference yet: the first build uses a simple placeholder shape until Ethan sends one. Kept stiff: few bones, little swing, so it stays clear of the shoulder and hoodie in the preset poses. |
| Fringe | A simple fringe across the forehead, ending at brow level, swept a little toward her right. |
| Side ponytail | A small side bunch of hair gathered by the star tie, more a tuft than a long tail, on the side opposite the long strip. No reference yet: the first build uses a simple placeholder shape until Ethan sends one. Small and stiff: a short bone chain, little swing. Height under test: build a high and a low variant and compare. |
| Star tie (signature) | A hair tie, not a clip: one navy elastic band binding the side ponytail at its root, with two crossed, puffy, matte 3D stars in amber: a big star (about a quarter of her head's width) and a small one about half that, touching, a nod to Spica being a binary star. The stars are rigid and follow the ponytail root; nothing dangles. Same position and angle in every render, so it works as a logo. The band wraps hair, so it may clip into the gathered hair: try it first and judge the renders. |
| Eyes | Large, slightly half-lidded at rest (observant, not sleepy). Grey-blue iris, one amber highlight. No star pupils. Eyes and mouth are flat textures swapped per expression, not sculpted shapes. |
| Face | Clean and simple: small mouth, minimal nose line. |
| Outerwear | Oversized ink-navy hoodie, sleeves ending at the wrist so the hands are fully free. Hood always down, resting as a fixed collar shape. Plain: no zip detail, no drawstrings. |
| Inner layer | Off-white tee, visible at the neckline. |
| Legs and feet | Navy shorts over dark tights; plain chunky sneakers with amber soles. |
| Hands | Plain human hands, slightly stylised. They are a main post framing, so keep fingers clear and readable; poses come from a preset set. |

## Palette

Quiet and comfortable first, strong and graphic second: muted cool colours, hard light-dark contrast, one warm accent. Amber is her heart showing through, so it appears only where marked.

| Role | Colour | Hex | Where |
| --- | --- | --- | --- |
| Base dark | Ink navy | `#1E2340` | Hoodie, shorts, tie elastic, all outlines |
| Base light | Warm off-white | `#F2EFE8` | Tee, light areas |
| Hair | Pale blue-white | `#CFE0F2` | Hair base |
| Hair shadow | Blue-lavender | `#8FA6C8` | Under layers, nape |
| **Accent** | Amber | `#FFB23F` | Star tie, glitch pixels, eye highlight, sneaker soles |
| Accent shadow | Deep amber | `#E08A1E` | Shadow side of the stars |
| Iris | Grey-blue | `#7D90AD` | Eyes (proposed, tune by eye) |
| Skin | Light warm | `#F7E6DA` | Skin (proposed, tune by eye) |

Never put amber in the hair itself, the skin or large areas of clothing.

## Glitch language

She is rendered, not built: every glitch is a rendering error, never hardware. The machine is her heart, not her body.

- **No glitch in the model itself:** the base model is clean. Every glitch is an effect added in animation or compositing, so it can move and flow.
- **Emotion flare (added afterwards):** when she is flustered or upset, RGB split and scanlines over her, extra amber pixels, and the star tie glows slightly brighter. When she is genuinely happy, one small amber pixel-star may appear near her.
- **Version arc is detail, not polygons:** one model throughout. Early versions carry only the essential parts (everything in the table above); each later version adds detail (clothing details, accessories, texture) as her growth. For now, nothing beyond the table is built.
- **Never changes between versions:** silhouette, palette, hair shape, the star tie and her face.

## Expressions and poses

Default expression set, from most to least common: neutral-observant, one-sided smirk, soft real smile, flustered, quiet hurt.

1. **Resting and amused.** Half-lidded neutral gaze with her head slightly tilted, looking at something in the image rather than at the camera. Swap to a one-sided smirk for her dry jokes. Hands in the hoodie pocket or one hand touching the image she is inside.
2. **The rare soft smile.** Eyes open a little wider, a small closed-mouth smile, the amber eye highlight clearly visible. Body turned toward the viewer. This is the payoff expression, so use it sparingly.
3. **Flustered or hurt.** Flustered: glitch flare on, eyes darting away, a hand at her mouth. Hurt: looking away, head lowered, eyes half-closed, shoulders drawn in. Cool, never cold or hostile. Hurt is carried by face, gaze and posture only.

## Do and don't

**Do**

- Test every design change as a solid-black silhouette at about 64px; she must still be recognisable.
- Keep the hair to a few large, smooth, stiff shapes; fewer and bigger beats many thin strands.
- Keep the star tie at the same position and angle in every render, so it works like a logo (and as her profile picture).
- Do expressions with swappable eye and mouth textures.
- Keep amber rare, so it is always the brightest point on her.
- Keep her clearly an adult, comfortable and approachable.
- Prefer rigid or painted-on detail over anything that moves on its own.

**Don't**

- Add machine parts: seams, joint rings, circuit lines, wires, jacks, visors or panels.
- Use a four-point (✦) star; it reads as a generic AI-product icon.
- Add anything that dangles (ribbons, chains, charms, drawstrings).
- Put the hood up, or add any second outfit state.
- Hide both eyes, or one eye completely.
- Use star pupils, cosmic or galaxy patterns, or "written in the stars" imagery. She likes stars; she isn't one.
- Make her childish (twin bunches, chibi proportions) or glamorised.
- Copy any existing character's hair, outfit or accessories; take style cues only.

## References

Style cues only. Look these up by name; take the listed quality, never the design itself.

| Reference | Take from it | Avoid |
| --- | --- | --- |
| Adachi Rei | Clean, graphic Vocaloid-era silhouette; one standout feature | Wires, jacks and any robotic parts |
| IA (Vocaloid / CeVIO) | Soft, quiet mood; pale, restrained palette | Her hair shape and outfit |
| Vocaloid V6-era character designs | Modern toon finish; flat, readable shapes | Any specific outfit or emblem |
| Kasane Teto | How one bold hair feature becomes the hook (her drills) | Drills, twin tails |
| Hatsune Miku | Scale of the hair ornament: big enough to be iconic | Square ornaments, twin tails, teal |
| Ethan's long-strip reference | The strip's shape and side (**pending**) | — |
| Ethan's side-ponytail reference | The ponytail's shape and side (**pending**) | — |

## Open

- **Long strip:** shape and side, from Ethan's reference.
- **Side ponytail:** shape from Ethan's reference; high or low, from the two test variants.
- **Strip and ponytail together:** both are built; Ethan judges whether it is too much and removes one if so.
- **Tie clipping:** the band binds hair; judge the first renders.
