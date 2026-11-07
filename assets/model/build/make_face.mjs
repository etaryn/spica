// Draws her face textures (eyes, brows, nose, mouth) as flat art on a transparent canvas, one
// PNG per expression. The canvas maps 20 cm of the head front: x -10..+10 cm, height -12..+8 cm
// from the head centre, so 1 cm is 51.2 px. Run: node assets/model/build/make_face.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const NAVY = "#1E2340";
const WHITE = "#F2EFE8";
const IRIS = "#7D90AD";
const IRIS_TOP = "#566987";
const AMBER = "#FFB23F";
const SKIN_SHADE = "#D9B9A8";
const SIZE = 1024;

// side -1 is her right eye (left of the image): the outer corner points away from the nose.
function eye(cx, cy, side, e) {
  const S = 1.3; // eye scale: big anime eyes
  const rx = 108 * S;
  const ry = 124 * S;
  const lid = e.lid; // px cut off the top of the eye opening
  const clip = `eye${side > 0 ? "L" : "R"}`;
  const top = cy - ry + lid;
  const outer = cx + side * rx;
  const lash = `M ${cx - side * (rx - 6)} ${top + 6} Q ${cx} ${top - 14} ${outer} ${top + 10}
    L ${outer + side * 26} ${top - 20}`;
  return `
  <clipPath id="${clip}"><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/></clipPath>
  <clipPath id="${clip}lid"><rect x="${cx - rx}" y="${top}" width="${rx * 2}" height="${ry * 2}"/></clipPath>
  <g clip-path="url(#${clip})"><g clip-path="url(#${clip}lid)">
    <rect x="${cx - rx}" y="${top}" width="${rx * 2}" height="${ry * 2}" fill="${WHITE}"/>
    <ellipse cx="${cx + side * e.look}" cy="${cy + 6}" rx="${82 * S}" ry="${104 * S}" fill="${IRIS}"/>
    <ellipse cx="${cx + side * e.look}" cy="${top + 30}" rx="${82 * S}" ry="${40 * S}" fill="${IRIS_TOP}"/>
    <ellipse cx="${cx + side * e.look}" cy="${cy + 10}" rx="${38 * S}" ry="${52 * S}" fill="${NAVY}"/>
    <circle cx="${cx + side * e.look - 30}" cy="${cy - 28}" r="${21 * S}" fill="${AMBER}"/>
  </g></g>
  <path d="${lash}" fill="none" stroke="${NAVY}" stroke-width="17" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function brow(cx, cy, side, tilt) {
  const x0 = cx - side * 70;
  const x1 = cx + side * 80;
  return `<path d="M ${x0} ${cy + tilt} Q ${cx} ${cy - 12} ${x1} ${cy - tilt}" fill="none" stroke="${NAVY}" stroke-width="9" stroke-linecap="round" opacity="0.8"/>`;
}

const EXPRESSIONS = {
  // Half-lidded, flat mouth: observant, not sleepy.
  neutral: {
    lid: 64,
    look: 0,
    brow: 6,
    mouth: `<path d="M 482 850 Q 512 862 542 850" fill="none" stroke="${NAVY}" stroke-width="8" stroke-linecap="round"/>`,
  },
};

mkdirSync(new URL("../tex/", import.meta.url), { recursive: true });
for (const [name, e] of Object.entries(EXPRESSIONS)) {
  const cy = 520;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  ${eye(262, cy, -1, e)}
  ${eye(762, cy, 1, e)}
  ${brow(262, 300, -1, e.brow)}
  ${brow(762, 300, 1, e.brow)}
  <path d="M 505 740 L 519 742" stroke="${SKIN_SHADE}" stroke-width="7" stroke-linecap="round"/>
  ${e.mouth}
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(new URL(`../tex/face-${name}.png`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
  console.log("wrote face-" + name);
}
