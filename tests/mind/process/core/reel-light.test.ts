/** How she's lit: the quieter side, the content's light on her, and grain that repeats by seed. */
import sharp from "sharp";
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { grain, lightHer, lightOf, quieterSide } from "@/mind/process/core/reel-light";
import { fixturePng } from "../../../helpers/web";

const rd = loadConfig().posts.render;

test("the quieter side is the one without detail", async () => {
  expect(await quieterSide(await fixturePng({ busy: "left" }))).toBe("right");
  expect(await quieterSide(await fixturePng({ busy: "right" }))).toBe("left");
});

test("she's tinted toward the content's colour, and her glow keeps her outline", async () => {
  const red = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#c02020" } })
    .png()
    .toBuffer();
  const light = await lightOf(red);
  expect(light.mean.r).toBeGreaterThan(light.mean.b);
  const her = await sharp({
    create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: { create: { width: 10, height: 20, channels: 4, background: "#808080" } },
        left: 15,
        top: 10,
      },
    ])
    .png()
    .toBuffer();
  const { tinted, glow } = await lightHer(her, light, rd);
  const px = async (img: Buffer, x: number, y: number) => {
    const { data, info } = await sharp(img)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * 4;
    return [0, 1, 2, 3].map((k) => data[i + k]!);
  };
  const [r, , b, a] = await px(tinted, 20, 20);
  expect(r!).toBeGreaterThan(b!);
  expect(a).toBe(255);
  expect((await px(tinted, 2, 2))[3]).toBe(0);
  expect((await px(glow, 20, 20))[3]!).toBeGreaterThan(0);
});

test("grain repeats for the same seed", async () => {
  expect(await grain(16, 16, 0.2, "a")).toEqual(await grain(16, 16, 0.2, "a"));
  expect(await grain(16, 16, 0.2, "a")).not.toEqual(await grain(16, 16, 0.2, "b"));
});
