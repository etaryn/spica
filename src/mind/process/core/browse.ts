/**
 * Browsing: once or twice a day, in her free time, she comes across something real on the
 * internet. It's recorded as an action in her world at the minute she sees it, with the item
 * cached, and lands like any event, through appraisal, so she has a take on it and can mention it.
 * Only freely licensed items are kept, because she may post them.
 */
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { LifePlan } from "@/db/schema";
import type { Config, LifeConfig } from "@/mind/platform/config";
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { saveMedia } from "@/mind/platform/media";
import { seededUnit } from "@/mind/platform/seeded-random";
import { MINUTE } from "@/mind/platform/time";
import { blockAt, blocksForDay, todaysBlocks } from "@/mind/world/blocks";
import { lifeDate, lifeInstant } from "@/mind/world/her-clock";
import { WORLD_LOCK } from "./thoughts";

const FREE = /^(public domain|cc0\b|cc[ -]by( |-sa |$|-sa$))/i;

/** Public domain, CC0, CC BY and CC BY-SA; never non-commercial or no-derivatives. */
export const isFreeLicence = (licence: string) =>
  FREE.test(licence.trim()) && !/\b(nc|nd)\b/i.test(licence);

/** A free minute for her `slot`th browse of `day`, stable for the day; null when she has none. */
export function browseTime(
  life: LifeConfig,
  posts: Config["posts"],
  day: string,
  plan: LifePlan,
  slot: number,
): Date | null {
  const blocks = blocksForDay(life, day, plan);
  // She has no night, so any free minute of her day will do.
  const start = lifeInstant(life, day, "00:00").getTime();
  const end = lifeInstant(life, day, "24:00").getTime();
  const free: number[] = [];
  for (let t = start; t < end; t += posts.browse_step_minutes * MINUTE)
    if (!blockAt(blocks, new Date(t))) free.push(t);
  if (!free.length) return null;
  return new Date(free[Math.floor(seededUnit(`${day}:browse-time:${slot}`) * free.length)]!);
}

function pickSource(sources: { name: string; weight: number }[], roll: number) {
  const total = sources.reduce((sum, s) => sum + s.weight, 0);
  let position = roll * total;
  for (const s of sources) {
    position -= s.weight;
    if (position < 0) return s;
  }
  return sources.at(-1)!;
}

/** True when a find was written. Failures write nothing and are retried on a later tick. */
export async function browseIfDue(deps: CoreDeps, now: Date): Promise<boolean> {
  const { core, config, webSources, log } = deps;
  const cfg = config.posts;
  const day = lifeDate(config.life, now);
  const plan = await core.world.plan(day);
  if (!plan) return false;
  // Busy or logged off right now: try again next tick.
  if (blockAt(await todaysBlocks(deps, now), now)) return false;
  const slot = await core.posts.findsOn(day);
  if (slot >= cfg.browse_per_day) return false;
  const at = browseTime(config.life, cfg, day, plan, slot);
  const sources = cfg.sources.filter((s) => webSources[s.name]);
  if (!at || !sources.length) return false;
  // The hour is in the roll so a source that keeps failing doesn't block the day.
  const source = pickSource(
    sources,
    seededUnit(`${day}:browse:${slot}:${now.toISOString().slice(0, 13)}`),
  );
  const page = webSources[source.name]!;
  let item;
  let image: Buffer;
  let hash: string;
  try {
    item = await page.fetch(day);
    if (!item || !isFreeLicence(item.licence) || (await core.posts.findByUrl(item.url)))
      return false;
    hash = createHash("sha256").update(item.image).digest("hex");
    if (await core.posts.findByHash(hash)) return false;
    image = await sharp(item.image)
      .resize({
        width: cfg.max_find_px,
        height: cfg.max_find_px,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch (error) {
    log.info("browse skipped", { source: source.name, error: errorName(error) });
    return false;
  }
  const found = item;
  const media = await saveMedia(cfg.media_dir, `finds/${day}-${slot}-${source.name}.png`, image);
  return core.transaction(async (tx) => {
    await tx.lock(WORLD_LOCK);
    if (
      (await tx.posts.findsOn(day)) !== slot ||
      (await tx.posts.findByUrl(found.url)) ||
      (await tx.posts.findByHash(hash))
    )
      return false;
    const eventId = await tx.world.recordEvent({
      at,
      kind: "action",
      content: `Spica came across "${found.title}" on ${page.label}.`,
      // Appraisal gives her take; the find itself is neutral until she sees it.
      valence: 0,
      stakes: "low",
      agents: [],
      life_day: day,
      created_at: now,
    });
    const findId = await tx.posts.insertFind({
      source: found.source,
      url: found.url,
      title: found.title,
      description: found.description ?? null,
      credit: found.credit,
      licence: found.licence,
      media_path: media,
      image_sha256: hash,
      world_event_id: eventId,
      found_at: at,
    });
    await tx.traces.insert({
      loop: "core_browse",
      inputs: { day, source: source.name },
      outputs: { find: findId, world_event: eventId },
      model: null,
      prompt_version: null,
      tokens_in: null,
      tokens_out: null,
      cost: null,
      calls: 0,
      status: "done",
      error: null,
      created_at: now,
    });
    return true;
  });
}
