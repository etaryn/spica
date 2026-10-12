/**
 * Her finds and posts in Postgres: the web_find and post tables. No query here takes or returns
 * a user id.
 */
import { and, count, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { post, web_find, world_event } from "@/db/schema";
import type { PostRow, Posts, WebFindRow } from "@/mind/world/types";
import { one } from "../util";

const toPost = (r: typeof post.$inferSelect): PostRow => r;
const toFind = (r: typeof web_find.$inferSelect): WebFindRow => r;

export function postsRepo(db: Db): Posts {
  return {
    async insertFind(row) {
      return one(await db.insert(web_find).values(row).returning({ id: web_find.id })).id;
    },
    async findByUrl(url) {
      const row = (await db.select().from(web_find).where(eq(web_find.url, url)))[0];
      return row ? toFind(row) : null;
    },
    async getFind(id) {
      const row = (await db.select().from(web_find).where(eq(web_find.id, id)))[0];
      return row ? toFind(row) : null;
    },
    async findsOn(day) {
      return one(
        await db
          .select({ n: count() })
          .from(web_find)
          .innerJoin(world_event, eq(world_event.id, web_find.world_event_id))
          .where(eq(world_event.life_day, day)),
      ).n;
    },
    async unposted(since, limit) {
      const rows = await db
        .select({ f: web_find })
        .from(web_find)
        .innerJoin(world_event, eq(world_event.id, web_find.world_event_id))
        .leftJoin(post, eq(post.find_id, web_find.id))
        .where(
          and(isNotNull(world_event.appraised_at), isNull(post.id), gte(web_find.found_at, since)),
        )
        .orderBy(desc(web_find.found_at), desc(web_find.id))
        .limit(limit);
      return rows.map((r) => toFind(r.f));
    },
    async insertPost(row) {
      return one(await db.insert(post).values(row).returning({ id: post.id })).id;
    },
    async postsSince(since) {
      return one(await db.select({ n: count() }).from(post).where(gte(post.created_at, since))).n;
    },
    async drafts() {
      return one(await db.select({ n: count() }).from(post).where(eq(post.status, "draft"))).n;
    },
    async getPost(id) {
      const row = (await db.select().from(post).where(eq(post.id, id)))[0];
      return row ? toPost(row) : null;
    },
    async lockPost(id) {
      const row = (await db.select().from(post).where(eq(post.id, id)).for("update"))[0];
      return row ? toPost(row) : null;
    },
    async decide(id, patch) {
      await db.update(post).set(patch).where(eq(post.id, id));
    },
    async recent(limit) {
      const rows = await db
        .select({ p: post, title: web_find.title, source: web_find.source })
        .from(post)
        .innerJoin(web_find, eq(web_find.id, post.find_id))
        .orderBy(desc(post.created_at), desc(post.id))
        .limit(limit);
      return rows.map((r) => ({ ...toPost(r.p), title: r.title, source: r.source }));
    },
  };
}
