# Spica — Character Design Brief

Nov 8, 2026 · Ethan. Source of truth for her look; `o1-model.md` adds the build side.
Reopened 2026-11-08 for what 3D can carry: whatever moves apart from her body (long hair, loose
cloth, a hood) costs physics, bones and clipping fixes in every pose, while what is painted on or
rigidly attached is nearly free. Her identity lives in the cheap parts: palette, face, the star
tie, silhouette. (The orbiting-orbs alternative to the tie was dropped 2026-11-08, then came back on 2026-11-09 as a trait of its own: the binary star above her head, below.)
The base (body, face, hair) was approved 2026-11-08, and the whole look (with clothes, socks and the star tattoo and stars) was accepted as her **v1** the same day, a first draft with some clipping and edginess left (listed in `o1-model.md`). On 2026-11-09 the palette was changed to **midnight-noir** (dark space blue, pale denim, pale-yellow glowing stars, cyan accents) and the binary star was added; that is now v1's default look. The first palette (pale violet on cool white) is kept as `spacey` in `palette.py`.

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
| Overall | Young adult (reads about 19–20), about 6 heads tall. Fully human: no machine parts, seams, joints or panels. Toon-shaded with deep blue-black outlines. A night-sky palette: a deep space-blue outfit, blue-white hair, cyan and pale-yellow light as the accents (Spica is a blue-white star; the name also means an ear of wheat, so the stars are wheat-gold pale). A binary star orbits above her head. |
| Hair | A short, stiff bob, chin length, ending above the shoulders all round, so nothing touches the body. Large, smooth locks, blue-white with a periwinkle shadow, no flyaways, no ahoge. The layer under the outer hair is a darker shade, so the layers of the bob read apart. One wide strip of saturated cyan (about two thirds of the lock, adjacent strands together) runs down the long lock beside her left cheek. Strand detail follows the hair textures of the VRoid samples, mapped onto her palette, nothing invented. |
| Fringe | A simple fringe across the forehead, ending at brow level, swept a little toward her right. |
| Side bun | One small bun at the side-back of her head on her right, copied from a VRoid sample's bun (moved rigidly, nothing bent) and recoloured in her hair tones; it sits flush on her head with no neck. It carries the asymmetry of her silhouette; there is no long strip (one was built and dropped 2026-11-08: the bob curves inward under it and clips through however it hangs). Rigid on the head bone, no swing yet. |
| Binary star | Two glowing orbs that circle each other above her head, on the side opposite her bun (Spica is a close binary star). One is icy cyan-white and the heavier (3.2 cm across), one is pale gold (2.4 cm) and circles wider; each has a bright core and a soft halo, and two thin faint rings mark the orbits so a still reads as orbiting. The pair sits above and a little behind her left side, 18 cm from the middle of her head; the orbit plane is perpendicular to the line through the middle of her head, so it lies parallel to the top of her head and both orbs stay about as far from her hair all the way round (2.7 to 4.3 cm over a full turn). It is rigid on the head bone (turns with her head), one turn every 96 frames. Nothing touches her, so nothing clips. The star tie is still off (see Open). |
| Eyes | Large, slightly half-lidded at rest (observant, not sleepy). A dark, glowing blue iris (near-black blue rim, azure middle) that glows bright cyan at its lower edge, one cyan-white highlight. No star pupils. Eyes and mouth are flat textures swapped per expression, not sculpted shapes. |
| Face | Clean and simple: small mouth, minimal nose line. A five-pointed star tattoo (about 1.8 cm across) under the outer corner of her left eye, pale yellow with a thin warm rim so it reads on pale skin, flush on the skin and following the cheek's surface (so it is foreshortened seen from the front, where the cheek turns away, and a regular star from the side). |
| Outerwear | Deep-space-blue cotton-knit hoodie, soft and thick (about 2.4 cm) but cut to her shape: it follows her chest, waist and hips so her natural curves still show (no flare); under each breast the hard bend where the cloth meets her body is rounded off into a long soft curve (only the inside corner is filled, so the bust keeps its size and place), slim sleeves ending at the wrist, rolled cuffs. A hem of its own: a ribbed band about 1 cm tall, thicker than the body (about 3 mm proud, with a rounded lower edge), separated from the body by a seam groove with a row of tone-on-tone stitches above it. The hem band ends below the top of the shorts, over the upper part of the back pockets, and stands clear of them, so hoodie and pants read as two layers. The zip stops above the hem band, with a bottom stop; below it the hem is split in two, the halves slightly apart (a slot about 1.2 cm wide and 1.6 cm tall). At the top the zip stops at the chest: above the slider the neckline splits in one V from the hood's collar down to the slider, the front hangs looser there, and the cut edges are thick and roll outward like lapels, with a 1.4 cm facing along them (the lining turned out: a real strip of the cloth in the lining colour, a bright violet, standing a little proud, a seam groove where it ends and a row of stitches beside it), showing a little of her skin. The inside of the hoodie is the lining colour too, so the neckline reads against her skin. Two slanted hand-pocket slits (only the slits, no pockets behind). Otherwise plain: no patches, no drawstrings. Soft shading and a fine fabric grain. Hood always down, resting as a fixed collar shape (the hoodie's blue, inside and outside), open at the front: it ends in two clean flaps beside her neck, over the top of the dark facing. |
| Inner layer | None: the opening of the hoodie shows her skin. |
| Legs and feet | Bare legs. Pale ice-grey-white denim shorts ending just below the crotch (a pale piece breaks up the dark outfit): a diagonal twill, a few creases (whiskers from the fly out to each hip, three on her left leg and two on her right, and a smile line under each seat, all different), drawn as shadow, never as light lines, and the cloth really folded along them; front pockets, a fly and back pockets, all topstitched in thread the colour of the cloth (no contrast stitching). A rolled hem of its own: a band about 1.9 cm tall, 3 mm proud, with two rows of stitching and a seam groove above it. Socks, asymmetric like the rest of her: a thigh-high stocking on her left leg, ending about 6 cm below the shorts, and an ankle sock on her right, both in the deep space blue, slightly darker than the hoodie, fine vertical ribs round the leg. The ankle sock has a ribbed band at the top (standing a little proud, with a seam groove under it); the thigh-high stocking has no hem, just a clean straight top edge that wraps the thigh. Three big five-pointed stars, pale yellow and softly glowing (slightly see-through, self-lit, with a halo), 10 to 17 cm across, wrap round the stocking, each at its own height, turn and place round the leg (120 degrees apart), so one shows from the front, the side and the back. Plain chunky sneakers: cool-white uppers, soles in a muted gold. |
| Hands | Plain human hands, slightly stylised. They are a main post framing, so keep fingers clear and readable; poses come from a preset set. |

## Palette

**midnight-noir** (chosen 2026-11-09 from six trials; it replaces the first, pale violet palette, kept as `spacey`). A deep-space-blue outfit with a night sky of light: the hair and the pale shorts are the light parts, cyan and pale yellow the accents. Colours live in `assets/model/build/palette.py` (one entry per palette; `run.sh <name>` builds any of them).

| Role | Colour | Hex | Where |
| --- | --- | --- | --- |
| Hoodie | Deep space blue | `#0A1250` (shadow `#050A33`) | Hoodie and hood |
| Stocking, ankle sock | Deeper space blue | `#070D3C` (shadow `#040829`) | Slightly darker than the hoodie |
| Lining | Bright violet | `#A99CFF` (shadow `#7C6CE0`) | The inside of the hoodie and the facing along its opening, so the neckline reads against her skin |
| Shorts | Pale ice grey-white | `#E4E8F5` (shadow `#BAC4E0`, thread `#95A2C8`) | Shorts, to break up the dark outfit |
| Sneaker uppers | Cool white | `#E9ECF7` (shadow `#C9CFE4`) | Sneakers |
| Soles, zip | Muted gold | `#E8B84C` (shadow `#B88E32`); zip `#EBCB8A` (dark `#8C7240`) | Sneaker soles, zip |
| Outline | Blue-black | `#02051A` | All outlines, lashes |
| Hair | Blue-white | `#DCE7FF` (shadow `#8EA6E8`) | Hair base and under layers |
| Hair strip | Saturated cyan | `#18D8F2` (deep `#0A8CBE`) | One wide strip down the lock beside her left cheek |
| Iris | Dark blue to bright cyan | `#020626` rim, `#1A78E6` middle, `#6CF2FF` glow | Eyes; highlight `#E0FCFF`; brows `#16288A` |
| Stars | Pale yellow | `#FFF2AE` tattoo, `#FFF1A6` stocking (self-lit, translucent, soft halo) | Face tattoo (with a warm rim `#E8A83C`) and stocking stars |
| Binary star | Cyan-white and pale gold | cores `#E8FEFF` / `#FFF6D2`, glows `#36DCF6` / `#FFC24E` | The two orbs |
| Skin | Light neutral peach | `#F8E5DC` (shadow `#ECCFC6`) | Skin (the same in every palette) |

Keep the glowing colours (cyan, pale yellow) to the eyes, the hair strip, the stars and the binary star, so they stay the brightest points on her. The first palette (`spacey`: pale violet hair, a cool-white hoodie with a dark-blue lining, dark shorts, violet stars) is still in `palette.py`.

## Glitch language

She is rendered, not built: every glitch is a rendering error, never hardware. The machine is her heart, not her body.

- **No glitch in the model itself:** the base model is clean. Every glitch is an effect added in animation or compositing, so it can move and flow.
- **Emotion flare (added afterwards):** when she is flustered or upset, RGB split and scanlines over her, extra pale-yellow pixels, and the binary star above her head glows slightly brighter. When she is genuinely happy, one small pale-yellow pixel-star may appear near her.
- **Version arc is detail, not polygons:** one model throughout. Early versions carry only the essential parts (everything in the table above); each later version adds detail (clothing details, accessories, texture) as her growth. For now, nothing beyond the table is built.
- **Never changes between versions:** silhouette, palette, hair shape, the binary star above her head and her face.

## Expressions and poses

Default expression set, from most to least common: neutral-observant, one-sided smirk, soft real smile, flustered, quiet hurt.

1. **Resting and amused.** Half-lidded neutral gaze with her head slightly tilted, looking at something in the image rather than at the camera. Swap to a one-sided smirk for her dry jokes. Hands in the hoodie pocket or one hand touching the image she is inside.
2. **The rare soft smile.** Eyes open a little wider, a small closed-mouth smile, the cyan eye highlight clearly visible. Body turned toward the viewer. This is the payoff expression, so use it sparingly.
3. **Flustered or hurt.** Flustered: glitch flare on, eyes darting away, a hand at her mouth. Hurt: looking away, head lowered, eyes half-closed, shoulders drawn in. Cool, never cold or hostile. Hurt is carried by face, gaze and posture only.

## Do and don't

**Do**

- Test every design change as a solid-black silhouette at about 64px; she must still be recognisable.
- Keep the hair to a few large, smooth, stiff shapes; fewer and bigger beats many thin strands.
- Keep the binary star at the same place above her head in every render, so it works like a logo (and as her profile picture); if the star tie ever returns, the same rule.
- Do expressions with swappable eye and mouth textures.
- Keep the glowing colours (cyan, pale yellow) to the eyes, the hair strip, the stars and the binary star, so they are always the brightest points on her.
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
| Ethan's side-bun reference (the third VRoid sample) | The bun's shape: a small ball of wedge locks pinched to one point | Twin bunches (one bun only) |

## Open

- **Star tie:** off in the base; does it return, and in what form, now that the bun has no neck? (The binary star above her head now carries the star idea, so it may stay off.)
- **Clothes:** built for v1 (2026-11-08): hoodie, denim shorts, sneakers, socks, fitted and in the palette above (midnight-noir from 2026-11-09). The hoodie has no pocket (the slits are drawn), so the 'hand in the hoodie pocket' pose below needs another gesture, or a modelled pocket.
