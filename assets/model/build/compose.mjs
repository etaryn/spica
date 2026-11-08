// Review sheets from the render passes: shaded views side by side on grey, and the 64 px silhouette
// test (front, three-quarter, side, back) at native size next to a 3x enlargement.
// Run: node assets/model/build/compose.mjs [renders-dir]
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../renders");
const views = ["front", "threeq", "side", "back"];
const heads = ["head", "head3q", "head3qr", "headback"];
const BG = { r: 170, g: 179, b: 197, alpha: 1 };
const { width: W, height: H } = await sharp(path.join(dir, "view-front.png")).metadata();

const sheet = sharp({ create: { width: W * 4, height: H, channels: 4, background: BG } });
await sheet
  .composite(views.map((v, i) => ({ input: path.join(dir, `view-${v}.png`), left: i * W, top: 0 })))
  .png()
  .toFile(path.join(dir, "sheet.png"));

await sharp({ create: { width: W * 4, height: H, channels: 4, background: BG } })
  .composite(heads.map((v, i) => ({ input: path.join(dir, `view-${v}.png`), left: i * W, top: 0 })))
  .png()
  .toFile(path.join(dir, "heads.png"));

const chests = ["chest", "chest3q", "chest3qr", "chestside"];
await sharp({ create: { width: W * 4, height: H, channels: 4, background: BG } })
  .composite(chests.map((v, i) => ({ input: path.join(dir, `view-${v}.png`), left: i * W, top: 0 })))
  .png()
  .toFile(path.join(dir, "chests.png"));

const backs = ["chestback", "chestback3q", "chestbackside", "chestside"];
await sharp({ create: { width: W * 4, height: H, channels: 4, background: BG } })
  .composite(backs.map((v, i) => ({ input: path.join(dir, `view-${v}.png`), left: i * W, top: 0 })))
  .png()
  .toFile(path.join(dir, "backs.png"));

const tufts = ["tuftfront", "tuftside", "tuft3q", "tuftback"];
await sharp({ create: { width: W * 4, height: H, channels: 4, background: BG } })
  .composite(tufts.map((v, i) => ({ input: path.join(dir, `view-${v}.png`), left: i * W, top: 0 })))
  .png()
  .toFile(path.join(dir, "tufts.png"));

const small = [];
for (const v of views) {
  small.push(
    await sharp(path.join(dir, `sil-${v}.png`))
      .flatten({ background: "#ffffff" })
      .resize({ height: 160, fit: "contain", background: "#ffffff" })
      .png()
      .toBuffer(),
  );
}
const sw = (await sharp(small[0]).metadata()).width;
const strip = await sharp({ create: { width: sw * 4, height: 160, channels: 3, background: "#fff" } })
  .composite(small.map((b, i) => ({ input: b, left: i * sw, top: 0 })))
  .png()
  .toBuffer();
await sharp(strip).resize({ width: sw * 4 * 3, kernel: "nearest" }).toFile(path.join(dir, "silhouettes.png"));
console.log("sheets written");
