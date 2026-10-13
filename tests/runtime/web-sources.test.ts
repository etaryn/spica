/** The two image sources: today's item with its licence, null when there's no image. */
import { afterEach, expect, test, vi } from "vitest";
import { createWebSources } from "@/runtime/web-sources";

const sources = createWebSources({
  nasaApiKey: "K",
  userAgent: "UA",
  timeoutMs: 1000,
  maxDownloadBytes: 1000,
});
const png = new Uint8Array([137, 80, 78, 71]);

function stub(routes: Record<string, unknown>) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response("missing", { status: 404 });
    const body = routes[key];
    return body instanceof Uint8Array
      ? new Response(body as BodyInit)
      : new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

test("apod: a public-domain image day", async () => {
  const fetch = stub({
    "https://api.nasa.gov/planetary/apod?api_key=K&date=2026-01-04": {
      media_type: "image",
      title: "The Pillars",
      url: "https://apod.nasa.gov/p.jpg",
    },
    "https://apod.nasa.gov/p.jpg": png,
  });
  const item = await sources.apod!.fetch("2026-01-05");
  expect(item).toMatchObject({
    source: "apod",
    url: "https://apod.nasa.gov/p.jpg",
    title: "The Pillars",
    credit: "NASA",
    licence: "public domain",
  });
  expect(item!.image).toEqual(png);
  expect(fetch.mock.calls[0]![1]).toMatchObject({ headers: { "User-Agent": "UA" } });
});

test("apod: a copyrighted image is labelled so; a video day is null", async () => {
  stub({
    "https://api.nasa.gov/planetary/apod?api_key=K&date=2026-01-04": {
      media_type: "image",
      title: "T",
      url: "https://apod.nasa.gov/c.jpg",
      copyright: " Jane Doe ",
    },
    "https://apod.nasa.gov/c.jpg": png,
  });
  expect(await sources.apod!.fetch("2026-01-05")).toMatchObject({
    credit: "Jane Doe",
    licence: "copyrighted",
  });
  stub({
    "https://api.nasa.gov/planetary/apod?api_key=K&date=2026-01-05": {
      media_type: "video",
      title: "T",
      url: "https://youtube.com/x",
    },
  });
  expect(await sources.apod!.fetch("2026-01-06")).toBeNull();
});

test("apod: a date NASA hasn't published yet throws, so the tick retries later", async () => {
  stub({});
  await expect(sources.apod!.fetch("2026-01-07")).rejects.toThrow(/404/);
});

test("commons: the picture of the day with its licence and artist", async () => {
  stub({
    "https://api.wikimedia.org/feed/v1/wikipedia/en/featured/2026/01/05": {
      image: {
        title: "File:Fox.jpg",
        image: { source: "https://upload.wikimedia.org/fox.jpg" },
        license: { type: "CC BY-SA 4.0" },
        artist: { text: "A. Photographer" },
        description: { text: "A red fox in snow" },
      },
    },
    "https://upload.wikimedia.org/fox.jpg": png,
  });
  expect(await sources.commons_potd!.fetch("2026-01-05")).toMatchObject({
    source: "commons_potd",
    url: "https://upload.wikimedia.org/fox.jpg",
    title: "A red fox in snow",
    credit: "A. Photographer",
    licence: "CC BY-SA 4.0",
  });
  stub({ "https://api.wikimedia.org/feed/v1/wikipedia/en/featured/2026/01/06": {} });
  expect(await sources.commons_potd!.fetch("2026-01-06")).toBeNull();
});

test("apod: asks for the previous day, across a month boundary too", async () => {
  const fetch = stub({
    "https://api.nasa.gov/planetary/apod": { media_type: "video", title: "T", url: "u" },
  });
  await sources.apod!.fetch("2026-03-01");
  expect(fetch.mock.calls[0]![0]).toContain("date=2026-02-28");
});

test("an image over the download cap throws", async () => {
  stub({
    "https://api.nasa.gov/planetary/apod?api_key=K&date=2026-01-04": {
      media_type: "image",
      title: "T",
      url: "https://apod.nasa.gov/big.jpg",
    },
    "https://apod.nasa.gov/big.jpg": new Uint8Array(2000),
  });
  await expect(sources.apod!.fetch("2026-01-05")).rejects.toThrow("too large");
});
