/** The image sources: today's item with its licence, null when there's no image. */
import { afterEach, expect, test, vi } from "vitest";
import { createWebSources } from "@/runtime/web-sources";

const sources = createWebSources({
  userAgent: "UA",
  timeoutMs: 1000,
  maxDownloadBytes: 1000,
  weeklyMaxAgeDays: 7,
  descriptionMaxChars: 40,
});
const png = new Uint8Array([137, 80, 78, 71]);

function stub(routes: Record<string, unknown>) {
  const fetch = vi.fn(async (url: string, _init?: RequestInit) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response("missing", { status: 404 });
    const body = routes[key];
    if (body instanceof Uint8Array) return new Response(body as BodyInit);
    if (typeof body === "string")
      return new Response(body, { headers: { "content-type": "application/rss+xml" } });
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

const rss = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items}</channel></rss>`;
const item = (title: string, date: string, url: string) =>
  `<item><title>${title}</title><pubDate>${date}</pubDate><enclosure url="${url}" type="image/jpeg" length="1"/></item>`;
const ESO = "https://www.eso.org/public/images/potw/feed/";
const NOIRLAB = "https://noirlab.edu/public/images/iotw/feed/";

test("eso: the newest picture within a week, CC BY 4.0, credit ESO", async () => {
  const fetch = stub({
    [ESO]: rss(
      item(
        "Massive antenna &amp; silent mirror",
        "Mon, 12 Oct 2026 06:00:00 +0200",
        "https://cdn.eso.org/images/screen/potw2641a.jpg",
      ) + item("Older", "Mon, 05 Oct 2026 06:00:00 +0200", "https://cdn.eso.org/old.jpg"),
    ),
    "https://cdn.eso.org/images/screen/potw2641a.jpg": png,
  });
  const found = await sources.eso_potw!.fetch("2026-10-14");
  expect(found).toMatchObject({
    source: "eso_potw",
    url: "https://cdn.eso.org/images/screen/potw2641a.jpg",
    title: "Massive antenna & silent mirror",
    credit: "ESO",
    licence: "CC BY 4.0",
  });
  expect(found!.image).toEqual(png);
  expect(fetch.mock.calls[0]![1]).toMatchObject({ headers: { "User-Agent": "UA" } });
});

test("an rss item's description comes with it, tags stripped and cut at a word; none is null", async () => {
  const desc =
    "<description>&lt;p&gt;A telescope dome under the Milky Way, &lt;b&gt;high&lt;/b&gt; in the Chilean desert.&lt;/p&gt;</description>";
  stub({
    [ESO]: rss(
      item(
        "Observing the unpredictable",
        "Mon, 12 Oct 2026 06:00:00 +0200",
        "https://cdn.eso.org/a.jpg",
      ).replace("</item>", desc + "</item>"),
    ),
    "https://cdn.eso.org/a.jpg": png,
  });
  expect((await sources.eso_potw!.fetch("2026-10-14"))!.description).toBe(
    "A telescope dome under the Milky Way",
  );
  stub({
    [ESO]: rss(item("Plain", "Mon, 12 Oct 2026 06:00:00 +0200", "https://cdn.eso.org/b.jpg")),
    "https://cdn.eso.org/b.jpg": png,
  });
  expect((await sources.eso_potw!.fetch("2026-10-14"))!.description).toBeNull();
});

test("noirlab: an enclosure with its url last still reads", async () => {
  stub({
    [NOIRLAB]: rss(
      `<item><title>All-Nighter on Kitt Peak</title><pubDate>Wed, 14 Oct 2026 12:00:00 -0700</pubDate><enclosure length="1" type="image/jpeg" url="https://storage.noirlab.edu/i.jpg"></enclosure></item>`,
    ),
    "https://storage.noirlab.edu/i.jpg": png,
  });
  expect(await sources.noirlab_iotw!.fetch("2026-10-15")).toMatchObject({
    source: "noirlab_iotw",
    credit: "NOIRLab",
    url: "https://storage.noirlab.edu/i.jpg",
  });
});

test("a weekly picture older than a week, an empty feed, or no enclosure is null", async () => {
  stub({
    [ESO]: rss(item("Old", "Mon, 28 Sep 2026 06:00:00 +0200", "https://cdn.eso.org/x.jpg")),
  });
  expect(await sources.eso_potw!.fetch("2026-10-14")).toBeNull();
  stub({ [NOIRLAB]: rss("") });
  expect(await sources.noirlab_iotw!.fetch("2026-10-14")).toBeNull();
  stub({
    [NOIRLAB]: rss(
      "<item><title>X</title><pubDate>Wed, 14 Oct 2026 12:00:00 -0700</pubDate></item>",
    ),
  });
  expect(await sources.noirlab_iotw!.fetch("2026-10-14")).toBeNull();
});

test("a feed that fails throws, so the tick retries later", async () => {
  stub({});
  await expect(sources.eso_potw!.fetch("2026-10-14")).rejects.toThrow(/404/);
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

test("an image over the download cap throws", async () => {
  stub({
    [ESO]: rss(item("T", "Mon, 12 Oct 2026 06:00:00 +0200", "https://cdn.eso.org/big.jpg")),
    "https://cdn.eso.org/big.jpg": new Uint8Array(2000),
  });
  await expect(sources.eso_potw!.fetch("2026-10-14")).rejects.toThrow("too large");
});

test("an observatory picture downloads at publication size, falling back to the screen size", async () => {
  const big = new Uint8Array([137, 80, 78, 71, 1]);
  const base = "https://storage.noirlab.edu/media/archives/images";
  const screen = `${base}/screen/iotw2641a.jpg`;
  const publication = `${base}/publicationjpg/iotw2641a.jpg`;
  const feed = rss(item("All-Nighter", "Wed, 14 Oct 2026 12:00:00 -0700", screen));
  stub({ [NOIRLAB]: feed, [publication]: big, [screen]: png });
  const found = await sources.noirlab_iotw!.fetch("2026-10-14");
  expect(found!.image).toEqual(big);
  expect(found!.url).toBe(screen);
  stub({ [NOIRLAB]: feed, [screen]: png }); // publication size missing → 404
  expect((await sources.noirlab_iotw!.fetch("2026-10-14"))!.image).toEqual(png);
});

test("a CDATA description reads too, numeric entities decoded", async () => {
  stub({
    [ESO]: rss(
      item("Dome", "Mon, 12 Oct 2026 06:00:00 +0200", "https://cdn.eso.org/c.jpg").replace(
        "</item>",
        "<description><![CDATA[<p>Paranal&#8217;s dome</p>]]></description></item>",
      ),
    ),
    "https://cdn.eso.org/c.jpg": png,
  });
  expect((await sources.eso_potw!.fetch("2026-10-14"))!.description).toBe("Paranal’s dome");
});
