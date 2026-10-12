/**
 * Where she browses: NASA's astronomy picture of the day and Wikimedia Commons' picture of the
 * day. Each returns that date's image with its credit and licence, or null when the day has no
 * image; a network or HTTP failure throws, so the world tick simply tries again next hour.
 */
import { z } from "zod";
import type { WebItem, WebSource, WebSources } from "@/mind/world/types";

type Options = {
  nasaApiKey: string;
  userAgent: string;
  timeoutMs: number;
  maxDownloadBytes: number;
};

async function get(url: string, o: Options): Promise<Response> {
  const res = await fetch(url, {
    headers: { "User-Agent": o.userAgent },
    signal: AbortSignal.timeout(o.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

// ponytail: the whole download sits in memory; stream it or ask for a sized thumbnail if the cap
// ever has to grow.
async function bytes(url: string, o: Options): Promise<Uint8Array> {
  const res = await get(url, o);
  if (Number(res.headers.get("content-length")) > o.maxDownloadBytes) throw new Error("too large");
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength > o.maxDownloadBytes) throw new Error("too large");
  return body;
}

const Apod = z.object({
  media_type: z.string(),
  title: z.string(),
  url: z.string(),
  copyright: z.string().optional(),
});

function apod(o: Options): WebSource {
  return {
    label: "NASA's astronomy picture of the day",
    async fetch(day): Promise<WebItem | null> {
      // NASA rejects dates past its own US day, which her Singapore date often is; yesterday always exists.
      const apodDay = new Date(Date.parse(`${day}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
      const raw = Apod.parse(
        await (
          await get(
            `https://api.nasa.gov/planetary/apod?api_key=${o.nasaApiKey}&date=${apodDay}`,
            o,
          )
        ).json(),
      );
      if (raw.media_type !== "image") return null;
      const owner = raw.copyright?.trim();
      return {
        source: "apod",
        url: raw.url,
        title: raw.title.trim(),
        credit: owner || "NASA",
        // NASA's own images are public domain; a credited photographer keeps their copyright.
        licence: owner ? "copyrighted" : "public domain",
        image: await bytes(raw.url, o),
      };
    },
  };
}

const Featured = z.object({
  image: z
    .object({
      title: z.string(),
      image: z.object({ source: z.string() }),
      license: z.object({ type: z.string() }).optional(),
      artist: z.object({ text: z.string() }).optional(),
      description: z.object({ text: z.string() }).optional(),
    })
    .optional(),
});

function commons(o: Options): WebSource {
  return {
    label: "Wikimedia Commons' picture of the day",
    async fetch(day): Promise<WebItem | null> {
      const path = day.replaceAll("-", "/");
      const raw = Featured.parse(
        await (
          await get(`https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${path}`, o)
        ).json(),
      );
      if (!raw.image) return null;
      const i = raw.image;
      return {
        source: "commons_potd",
        url: i.image.source,
        title: (i.description?.text ?? i.title.replace(/^File:/, "").replace(/\.\w+$/, "")).trim(),
        credit: i.artist?.text.trim() || "Wikimedia Commons",
        licence: i.license?.type ?? "unknown",
        image: await bytes(i.image.source, o),
      };
    },
  };
}

export function createWebSources(o: Options): WebSources {
  return { apod: apod(o), commons_potd: commons(o) };
}
