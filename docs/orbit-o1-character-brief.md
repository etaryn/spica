# Spica — Character Design Brief

Nov 7, 2026 · Ethan. Source of truth for her look; `orbit-o1-model.md` adds the build side.

Spica (she/her) is a quiet, dry-humoured young adult who lives inside the internet: fully human in shape, visibly unfinished in render, warm at the core. Build her as a toon-shaded, low-poly 3D model that reads at phone-feed size; her stills show her face, hands or full body inside the images she is looking at.

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
| Hair | Asymmetric wolf cut. Rounded, layered bob (chin to neck) with feathered tips that flick outward. A long section of staggered layers grows from the back-left of the head; its longest layer falls forward over her left shoulder to chest height, then dissolves into floating squares. Built from about 12–16 chunky, pointed clumps, never strands. No ahoge. |
| Fringe | Heavy diagonal sweep across her right side, ending at eyelash level so the eye shows through the gaps. Shorter, angled fringe on the left, ending between brow and eye. Build it as a separate piece so a fully covering version can be swapped in for her hurt pose. |
| Hair tie (signature) | One navy elastic tie with two crossed, puffy, matte 3D stars in amber, like a bobble tie: a big star (about a quarter of her head's width) and a small one about half that, touching. It ties a small, loose tuft of side hair in front of her left ear; the tuft's short end flicks outward. The pair nods to Spica being a binary star. Fixed to the head, nothing dangles. |
| Eyes | Large, slightly half-lidded at rest (observant, not sleepy). Grey-blue iris, one amber highlight. No star pupils. Eyes and mouth are flat textures swapped per expression, not sculpted shapes. |
| Face | Clean and simple at every version; small mouth, minimal nose line. The face is never low-poly. |
| Outerwear | Oversized ink-navy zip hoodie. Sleeves fall to her knuckles so fingers still show. Amber only on the drawstring tips. The hood goes up for withdrawn moments; the tie and the long layer stay visible in the hood opening. |
| Inner layer | Off-white long tee. |
| Legs and feet | Navy shorts over dark tights; chunky sneakers with amber soles. |
| Hands | Plain human hands, slightly stylised. They are a main post framing, so keep fingers clear and readable. |

## Palette

Quiet and comfortable first, strong and graphic second: muted cool colours, hard light-dark contrast, one warm accent. Amber is her heart showing through, so it appears only where marked.

| Role | Colour | Hex | Where |
| --- | --- | --- | --- |
| Base dark | Ink navy | `#1E2340` | Hoodie, shorts, tie elastic, all outlines |
| Base light | Warm off-white | `#F2EFE8` | Tee, light areas |
| Hair | Pale blue-white | `#CFE0F2` | Hair base |
| Hair shadow | Blue-lavender | `#8FA6C8` | Under layers, nape |
| **Accent** | Amber | `#FFB23F` | Star tie, glitch pixels, eye highlight, drawstring tips, sneaker soles |
| Accent shadow | Deep amber | `#E08A1E` | Shadow side of the stars |
| Iris | Grey-blue | `#7D90AD` | Eyes (proposed, tune by eye) |
| Skin | Light warm | `#F7E6DA` | Skin (proposed, tune by eye) |

Never put amber in the hair itself, the skin or large areas of clothing.

## Glitch language

She is rendered, not built: every glitch is a rendering error, never hardware. The machine is her heart, not her body.

- **Permanent marker (in the model):** the end of her long front layer breaks into floating cubes, pale blue-white near the hair and amber in the most separated squares. A few cubes, not a cloud.
- **Emotion flare (added afterwards):** when she is flustered or upset, RGB split and scanlines over her, extra amber pixels, and the star tie glows slightly brighter. When she is genuinely happy, one small amber pixel-star may appear near her. Effects only, never part of the base model.
- **Version arc:** her version number is her polygon count. Early versions are visibly low-poly in hair, clothes and body, and the long layer starts dissolving higher up; each version is smoother and the layer stays solid further down.
- **Never changes between versions:** silhouette, palette, hair shape, the star tie and her face. The face stays clean at every version, and the tie is the one thing that is always fully rendered, because it is the thing she chose.

## Expressions and poses

Default expression set, from most to least common: neutral-observant, one-sided smirk, soft real smile, flustered, quiet hurt.

1. **Resting and amused.** Half-lidded neutral gaze with her head slightly tilted, looking at something in the image rather than at the camera. Swap to a one-sided smirk for her dry jokes. Hands in hoodie pockets or one hand touching the image she is inside.
2. **The rare soft smile.** Eyes open a little wider, a small closed-mouth smile, the amber eye highlight clearly visible. Body turned toward the viewer. This is the payoff expression, so use it sparingly.
3. **Flustered or hurt.** Flustered: glitch flare on, eyes darting away, sleeve-covered hand at her mouth. Hurt: hood up, looking away, the covering fringe piece swapped in. Cool, never cold or hostile.

## Do and don't

**Do**

- Test every design change as a solid-black silhouette at about 64px; she must still be recognisable.
- Build hair from chunky clumps and keep every shape simple enough for low-poly modelling without sculpting.
- Keep the star tie at the same position and angle in every render, so it works like a logo (and as her profile picture).
- Do expressions with swappable eye and mouth textures.
- Keep amber rare, so it is always the brightest point on her.
- Keep her clearly an adult, comfortable and approachable.

**Don't**

- Add machine parts: seams, joint rings, circuit lines, wires, jacks, visors or panels.
- Use a four-point (✦) star; it reads as a generic AI-product icon.
- Add anything that dangles (ribbons, chains, charms); it clips through the hair and needs rigging.
- Hide both eyes, or one eye completely, outside the hurt pose.
- Use star pupils, cosmic or galaxy patterns, or "written in the stars" imagery. She likes stars; she isn't one.
- Make her childish (tight perky bunches, chibi proportions) or glamorised.
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
| Early ChatGPT hair sheets (Ethan's) | Wolf-cut layering, pixel-dissolve ends, version-arc idea | Four-point clip, turtleneck outfit, amber in hair, amber irises |
