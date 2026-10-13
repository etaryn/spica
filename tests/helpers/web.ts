/** Fake web sources and fixture images, so browsing and rendering run without the network. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { WebItem, WebSources } from "@/mind/world/types";

/** Each source returns its item (or null, or throws its Error) and counts its calls. */
export function fakeSources(items: Record<string, WebItem | null | Error>) {
  const calls: Record<string, number> = {};
  const sources: WebSources = Object.fromEntries(
    Object.entries(items).map(([name, item]) => [
      name,
      {
        label: `the ${name} page`,
        async fetch() {
          calls[name] = (calls[name] ?? 0) + 1;
          if (item instanceof Error) throw item;
          return item;
        },
      },
    ]),
  );
  return { sources, calls };
}

/** A PNG with stripes over its left third (busy) and flat grey elsewhere, or all flat. */
export async function fixturePng(
  opts: { width?: number; height?: number; busy?: "left" | "right" | "none" } = {},
): Promise<Buffer> {
  const { width = 800, height = 1000, busy = "left" } = opts;
  const third = Math.floor(width / 3);
  const x0 = busy === "right" ? width - third : 0;
  const stripes =
    busy === "none"
      ? ""
      : Array.from(
          { length: Math.floor(third / 8) },
          (_, i) => `<rect x="${x0 + i * 8}" y="0" width="4" height="${height}" fill="#fff"/>`,
        ).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#405060"/>${stripes}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function webItem(over: Partial<WebItem> = {}): Promise<WebItem> {
  return {
    source: "apod",
    url: "https://apod.nasa.gov/p.jpg",
    title: "The Pillars of Creation",
    credit: "NASA",
    licence: "public domain",
    image: new Uint8Array(await fixturePng()),
    ...over,
  };
}

export const tmpMediaDir = () => mkdtempSync(path.join(tmpdir(), "spica-media-"));
