/**
 * Where she browses: Wikimedia Commons' picture of the day, ESO's picture of the week and
 * NOIRLab's image of the week. Each returns an image with its credit and licence, or null when
 * there's nothing for her day; a network or HTTP failure throws, so the world tick simply tries
 * again next hour.
 */
import { z } from "zod";
import type { WebItem, WebSource, WebSources } from "@/mind/world/types";

type Options = {
  userAgent: string;
  timeoutMs: number;
  maxDownloadBytes: number;
  weeklyMaxAgeDays: number;
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

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

/**
 * A weekly picture from an observatory's RSS feed: the newest item with an image, if it was
 * published in the last `weeklyMaxAgeDays` before her `day`; null otherwise. Both feeds are
 * CC BY 4.0 with the institution as credit.
 */
function rssPictureOfWeek(
  o: Options,
  spec: { feed: string; label: string; source: string; credit: string },
): WebSource {
  return {
    label: spec.label,
    async fetch(day): Promise<WebItem | null> {
      const xml = await (await get(spec.feed, o)).text();
      const first = /<item>([\s\S]*?)<\/item>/.exec(xml)?.[1];
      if (!first) return null;
      const title = /<title>([\s\S]*?)<\/title>/.exec(first)?.[1]?.trim();
      const date = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(first)?.[1];
      const url = /<enclosure[^>]*url="([^"]+)"/.exec(first)?.[1];
      if (!title || !date || !url) return null;
      const ageDays = (Date.parse(`${day}T23:59:59Z`) - Date.parse(date)) / 864e5;
      if (!(ageDays >= 0 && ageDays <= o.weeklyMaxAgeDays)) return null;
      return {
        source: spec.source,
        url,
        title: decodeEntities(title),
        credit: spec.credit,
        licence: "CC BY 4.0",
        image: await bytes(url, o),
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
  return {
    commons_potd: commons(o),
    eso_potw: rssPictureOfWeek(o, {
      feed: "https://www.eso.org/public/images/potw/feed/",
      label: "ESO's picture of the week",
      source: "eso_potw",
      credit: "ESO",
    }),
    noirlab_iotw: rssPictureOfWeek(o, {
      feed: "https://noirlab.edu/public/images/iotw/feed/",
      label: "NOIRLab's image of the week",
      source: "noirlab_iotw",
      credit: "NOIRLab",
    }),
  };
}
