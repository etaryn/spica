# Phase 14: The post engine (stills) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spica browses the real internet in her world, and an hourly `post_tick` turns what moved her into a still of her (a pose sprite) inside that content, with a caption in her public voice, waiting in the inspector for Ethan's approval; an approved post becomes part of her life.

**Architecture:** All core, no `user_id`. A browse step in `core_world_tick` records an `action` world event plus a `web_find`; it lands through normal appraisal. `post_tick` gates in code, picks a reviewed format and a pose, makes one draft call and one check call through the core loop runner, renders with `sharp` (pure Buffer in, Buffer out) and stores a `post` draft. Approve records an `action` world event tied to the craft goal; appraisal does the rest.

**Tech Stack:** TypeScript, Drizzle + Postgres 16, pg-boss, zod 4, `sharp` (direct dependency, version already installed via Next), Vitest, Next.js App Router (inspector only).

**Spec:** `docs/superpowers/specs/2026-10-13-phase-14-post-engine-design.md`. Read it before starting; v3 (`spica-design-spec-v3.md`) §4 scope rules, §8.3 world and §8.5 core loops are the background.

## Global Constraints

- Work in the worktree `C:\Users\ethan\projects\spica-post-engine` on branch `phase-14-post-engine`. Run `pnpm install` there first. Phase 13 is built in parallel in `C:\Users\ethan\projects\spica`; never switch that folder's branch.
- `src/mind` is framework-free: no Next imports, no `Date.now()`, no `process.env`; time comes from `deps.clock` or a passed `now`. Network access only through injected `WebSources`.
- Nothing in this phase reads or writes a user table; no new table has a `user_id` (V2, V3, V6).
- Every numeric constant goes in config (`posts.*`); every prompt is a versioned file under `prompts/` (paths use hyphens or slashes, config keys use underscores).
- Timestamps come from the injected `Clock`; never `DEFAULT now()`.
- Every file starts with a short plain-English header; comments say why, never cite spec sections, phases or review items.
- Prettier at 100 columns; `pnpm typecheck`, `pnpm lint` and `pnpm test` pass at the end of every task.
- Model calls: `post_draft` and `post_check` go through `runCoreLoop` and are **optional** loops; the model role is `"core"`. Fakes route on `purpose`.
- Every new loop has a deterministic fake in `src/mind/platform/llm/fake.ts`.
- Logs carry ids, names and error classes only, never captions or content.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **APOD's "today" doesn't exist yet in her timezone** (NASA publishes on US Eastern dates; she lives in Asia/Singapore): the fetch must fail quietly (no throw out of the world tick, no find) and a later hour retries. Pinned in Task 4.
2. **A source returns the same item twice** (APOD gives one image per date; `browse_per_day` 2 asks twice): the second browse must write nothing rather than a duplicate find or a unique-violation crash. Pinned in Task 4.
3. **Overlay text with Pango markup characters** (`&`, `<`, `>` in a caption like "stars & films"): rendering must not throw and the text must appear literally. Pinned in Task 6.
4. **Two approvals of the same draft** (double click, two tabs): exactly one `action` event. Pinned in Task 9.
5. **The craft goal was dropped or finished by reflect**: skill must read 1 when done, keep its frozen progress when dropped, and the engine must never recreate it. Pinned in Task 5.

---

### Task 1: Tables, the `action` kind and the core repos

**Files:**
- Modify: `src/db/schema.ts` (enum at line ~199; new tables after `world_event`)
- Create: `src/db/migrations/0033_posts.sql` (generated) and its `meta` snapshot
- Modify: `src/db/admin.ts:21` (truncate list)
- Modify: `src/mind/world/types.ts` (kind union, new types, `Posts` interface)
- Modify: `src/mind/process/core/appraise.ts:56` (kind union)
- Modify: `src/mind/state/core/types.ts` (`CoreGoals.byTitle`)
- Modify: `src/db/repos/core/goals.ts`
- Create: `src/db/repos/core/posts.ts`
- Modify: `src/db/repos/core/index.ts`, `src/mind/platform/core.ts` (`CoreScope.posts`)
- Test: `tests/db/core-posts.test.ts`

**Interfaces:**
- Produces (in `src/mind/world/types.ts`):
  ```ts
  export type WebItem = { source: string; url: string; title: string; credit: string; licence: string; image: Uint8Array };
  export interface WebSource { label: string; fetch(day: string): Promise<WebItem | null> }
  export type WebSources = Readonly<Record<string, WebSource>>;
  export type NewWebFind = { source: string; url: string; title: string; credit: string; licence: string; media_path: string; world_event_id: string; found_at: Date };
  export type WebFindRow = NewWebFind & { id: string };
  export type PostStatus = "draft" | "approved" | "rejected";
  export type PostCheck = "ok" | "flagged" | "unchecked";
  export type NewPost = { find_id: string; medium: "still"; format: string; pose: string; caption: string; overlay_text: string | null; media_path: string; skill: number; check: PostCheck; check_reason: string | null; created_at: Date };
  export type PostRow = NewPost & { id: string; status: PostStatus; decided_at: Date | null; action_event_id: string | null };
  export interface Posts { /* see Step 3 */ }
  ```
- Produces: `CoreScope.posts: Posts`; `CoreGoals.byTitle(title: string): Promise<CoreGoal | null>`; world event kind `"action"`.

- [ ] **Step 1: Write the failing repo test**

`tests/db/core-posts.test.ts`:

```ts
/** Her finds and posts in Postgres: core rows only, one post per find, drafts decided once. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { createCoreLayer } from "@/db/repos/core";
import { closeTestDb, getTestDb, resetDb, vec } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = (hour: number) => new Date(Date.UTC(2026, 0, 5, hour));

async function find(layer = createCoreLayer(getTestDb()), url = "https://x/1.png", hour = 9) {
  const eventId = await layer.world.recordEvent({
    at: at(hour),
    kind: "action",
    content: 'Spica came across "A" on NASA.',
    valence: 0,
    stakes: "low",
    agents: [],
    life_day: "2026-01-05",
    created_at: at(hour),
  });
  const id = await layer.posts.insertFind({
    source: "apod",
    url,
    title: "A",
    credit: "NASA",
    licence: "public domain",
    media_path: ".data/media/finds/a.png",
    world_event_id: eventId,
    found_at: at(hour),
  });
  return { layer, eventId, id };
}

const draft = (findId: string, hour = 10) => ({
  find_id: findId,
  medium: "still" as const,
  format: "plain",
  pose: "walk-01",
  caption: "look at this",
  overlay_text: null,
  media_path: ".data/media/posts/p.png",
  skill: 0.1,
  check: "ok" as const,
  check_reason: null,
  created_at: at(hour),
});

test("a find is counted on its day and found by url", async () => {
  const { layer, id } = await find();
  expect(await layer.posts.findsOn("2026-01-05")).toBe(1);
  expect(await layer.posts.findsOn("2026-01-06")).toBe(0);
  expect((await layer.posts.findByUrl("https://x/1.png"))?.id).toBe(id);
  expect(await layer.posts.findByUrl("https://x/2.png")).toBeNull();
});

test("unposted lists landed finds with no post, newest first", async () => {
  const layer = createCoreLayer(getTestDb());
  const a = await find(layer, "https://x/a.png", 8);
  const b = await find(layer, "https://x/b.png", 9);
  expect(await layer.posts.unposted(at(0), 10)).toEqual([]); // nothing landed yet
  await layer.world.markAppraised(a.eventId, at(9));
  await layer.world.markAppraised(b.eventId, at(10));
  expect((await layer.posts.unposted(at(0), 10)).map((f) => f.id)).toEqual([b.id, a.id]);
  expect((await layer.posts.unposted(at(9), 10)).map((f) => f.id)).toEqual([b.id]);
  await layer.posts.insertPost(draft(b.id));
  expect((await layer.posts.unposted(at(0), 10)).map((f) => f.id)).toEqual([a.id]);
});

test("posts are counted, listed and decided", async () => {
  const { layer, id } = await find();
  const postId = await layer.posts.insertPost(draft(id));
  expect(await layer.posts.postsSince(at(10))).toBe(1);
  expect(await layer.posts.postsSince(at(11))).toBe(0);
  expect(await layer.posts.drafts()).toBe(1);
  const locked = await layer.transaction((tx) => tx.posts.lockPost(postId));
  expect(locked).toMatchObject({ id: postId, status: "draft", decided_at: null });
  await layer.posts.decide(postId, { status: "rejected", decided_at: at(11), action_event_id: null });
  expect(await layer.posts.drafts()).toBe(0);
  const [recent] = await layer.posts.recent(5);
  expect(recent).toMatchObject({ id: postId, status: "rejected", title: "A", source: "apod" });
});

test("one post per find", async () => {
  const { layer, id } = await find();
  await layer.posts.insertPost(draft(id));
  await expect(layer.posts.insertPost(draft(id, 11))).rejects.toThrow();
});

test("goals are found by title, whatever their status", async () => {
  const layer = createCoreLayer(getTestDb());
  expect(await layer.goals.byTitle("Get better at making posts")).toBeNull();
  const id = await layer.goals.insert({
    title: "Get better at making posts",
    why: "early posts look rough",
    status: "active",
    progress: 0.2,
    source: "seed",
    source_ref: "persona:v6",
    started_at: at(1),
    target_at: null,
    embedding: vec(),
  });
  await layer.goals.setStatus(id, "dropped", at(2));
  expect(await layer.goals.byTitle("Get better at making posts")).toMatchObject({
    id,
    status: "dropped",
    progress: 0.2,
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/db/core-posts.test.ts`
Expected: FAIL (`layer.posts` undefined / type errors).

- [ ] **Step 3: Schema, types and repos**

In `src/db/schema.ts`, change the enum and add two enums plus the tables right after the `world_event` table:

```ts
export const worldEventKind = pgEnum("world_event_kind", [
  "planned",
  "surprise",
  "resolution",
  "action",
]);
export const postStatus = pgEnum("post_status", ["draft", "approved", "rejected"]);
export const postCheck = pgEnum("post_check", ["ok", "flagged", "unchecked"]);
```

```ts
/** Something real she came across while browsing: the item and its cached image. Core only. */
export const web_find = pgTable(
  "web_find",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    url: text("url").notNull().unique(),
    title: text("title").notNull(),
    credit: text("credit").notNull(),
    licence: text("licence").notNull(),
    media_path: text("media_path").notNull(),
    world_event_id: uuid("world_event_id")
      .notNull()
      .references(() => world_event.id, { onDelete: "cascade" }),
    found_at: ts("found_at").notNull(),
  },
  (t) => [index("web_find_found_idx").on(t.found_at)],
);

/** A post she drafted from a find; Ethan approves or rejects it. Core only. */
export const post = pgTable(
  "post",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    find_id: uuid("find_id")
      .notNull()
      .unique()
      .references(() => web_find.id, { onDelete: "cascade" }),
    medium: text("medium").$type<"still">().notNull(),
    format: text("format").notNull(),
    pose: text("pose").notNull(),
    caption: text("caption").notNull(),
    overlay_text: text("overlay_text"),
    media_path: text("media_path").notNull(),
    skill: real("skill").notNull(),
    check: postCheck("check").notNull(),
    check_reason: text("check_reason"),
    status: postStatus("status").notNull().default("draft"),
    decided_at: ts("decided_at"),
    action_event_id: uuid("action_event_id").references(() => world_event.id, {
      onDelete: "set null",
    }),
    created_at: ts("created_at").notNull(),
  },
  (t) => [
    index("post_status_created_idx").on(t.status, t.created_at),
    check("post_skill_range", sql`${t.skill} BETWEEN 0 AND 1`),
  ],
);
```

Generate the migration: `pnpm db:generate --name posts`. Open the generated `src/db/migrations/0033_posts.sql` and confirm it contains `ALTER TYPE "public"."world_event_kind" ADD VALUE 'action';`, the two `CREATE TYPE`s and the two `CREATE TABLE`s; nothing else.

In `src/db/admin.ts`, add the two tables to the truncate list (they hold no user data):

```ts
    sql`TRUNCATE "user", verification, life_day, core_memory, core_entity, core_state, core_goal, core_snapshot, world_event, web_find, post, life_event_log, core_loop_trace, core_budget_day CASCADE`,
```

In `src/mind/world/types.ts`: change `kind: "planned" | "surprise" | "resolution";` to include `| "action"`, and append the types from **Interfaces** plus:

```ts
/** Her finds and her posts. Nothing here takes or returns a user id. */
export interface Posts {
  insertFind(row: NewWebFind): Promise<string>;
  findByUrl(url: string): Promise<WebFindRow | null>;
  getFind(id: string): Promise<WebFindRow | null>;
  /** Finds that arrived with an event on her local `day`. */
  findsOn(day: string): Promise<number>;
  /** Finds whose event has landed and that have no post, found at or after `since`, newest first. */
  unposted(since: Date, limit: number): Promise<WebFindRow[]>;
  insertPost(row: NewPost): Promise<string>;
  /** Posts drafted at or after `since`, whatever became of them. */
  postsSince(since: Date): Promise<number>;
  /** Drafts still waiting for a decision. */
  drafts(): Promise<number>;
  getPost(id: string): Promise<PostRow | null>;
  /** The row, locked until the transaction ends; only meaningful inside `transaction`. */
  lockPost(id: string): Promise<PostRow | null>;
  decide(
    id: string,
    patch: { status: "approved" | "rejected"; decided_at: Date; action_event_id: string | null },
  ): Promise<void>;
  /** Newest first, with the find's title and source, for the inspector. */
  recent(limit: number): Promise<(PostRow & { title: string; source: string })[]>;
}
```

In `src/mind/process/core/appraise.ts:56`, add `| "action"` to the `LandingEvent` kind union.

In `src/mind/state/core/types.ts`, add to `CoreGoals`:

```ts
  /** The newest goal with this exact title, in any status. */
  byTitle(title: string): Promise<CoreGoal | null>;
```

and in `src/db/repos/core/goals.ts` (add `desc` to the drizzle import):

```ts
    async byTitle(title) {
      const row = (
        await db
          .select()
          .from(core_goal)
          .where(eq(core_goal.title, title))
          .orderBy(desc(core_goal.started_at))
          .limit(1)
      )[0];
      return row ? toGoal(row) : null;
    },
```

`src/db/repos/core/posts.ts`:

```ts
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
```

If `typeof post.$inferSelect` isn't assignable to `PostRow` (the `medium` column type), map the fields explicitly instead of the identity function.

In `src/db/repos/core/index.ts` add `posts: postsRepo(db),` to `scope` (import `postsRepo` from `./posts`). In `src/mind/platform/core.ts` import `Posts` from `@/mind/world/types` and add `posts: Posts;` to `CoreScope`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm vitest run tests/db/core-posts.test.ts` (expected: 5 passed), then `pnpm typecheck && pnpm lint && pnpm test`.
If typecheck flags an exhaustive `switch` or `Record<kind, …>` over world event kinds elsewhere, add the `action` case with the same handling as `surprise` (something that simply happened).

- [ ] **Step 5: Commit**

```bash
git add src/db src/mind/world/types.ts src/mind/process/core/appraise.ts src/mind/state/core/types.ts src/mind/platform/core.ts tests/db/core-posts.test.ts
git commit -m "feat(posts): web_find and post tables, the action event kind, core repos"
```

---

### Task 2: Config, prompts keys, deps and `sharp`

**Files:**
- Modify: `src/mind/platform/config.ts` (`CORE_LOOPS`, `posts` schema, `prompts` keys, `ConfigSchema`)
- Modify: `config/default.json`
- Modify: `src/mind/platform/deps.ts` (`Deps.webSources`, `CoreDeps`, `coreDepsOf`)
- Modify: `tests/helpers/deps.ts`, `src/runtime/deps.ts` (temporary `{}` sources, replaced in Task 3)
- Modify: `package.json` (`sharp`)
- Test: `tests/mind/platform/config.test.ts` (append)

**Interfaces:**
- Produces: `Config["posts"]` with the keys below; `CoreLoopName` includes `"post_draft" | "post_check"`; `config.prompts.post_draft | post_check | format_draft`; `Deps.webSources: WebSources`; `CoreDeps` includes `webSources`.

- [ ] **Step 1: Write the failing test**

Append to `tests/mind/platform/config.test.ts`:

```ts
test("posts config: defaults load, draft and check are optional loops", () => {
  const c = loadConfig();
  expect(c.posts.capabilities).toEqual(["still"]);
  expect(c.posts.craft_goals.still).toBe("Get better at making posts");
  expect(c.core.loop_priority.optional).toEqual(
    expect.arrayContaining(["post_draft", "post_check"]),
  );
  expect(c.prompts.post_draft).toBe("v1");
  expect(() => loadConfig({ posts: { capabilities: ["video"] } })).toThrow();
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/mind/platform/config.test.ts`
Expected: FAIL (`c.posts` undefined).

- [ ] **Step 3: Config and deps**

In `src/mind/platform/config.ts`, append `"post_draft", "post_check"` to `CORE_LOOPS`, add to `prompts`:

```ts
  post_draft: promptVersion,
  post_check: promptVersion,
  format_draft: promptVersion,
```

and before `// ---------- The whole config ----------`:

```ts
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);
const font = z.object({ file: text, family: text });

const posts = z
  .object({
    tick_cron: cron,
    browse_per_day: countFromZero,
    // Her local hours she may browse in, outside her busy and quiet blocks.
    browse_window: z.tuple([hhmm, hhmm]),
    browse_step_minutes: positiveInt,
    sources: z.array(z.object({ name: text, weight: z.number().positive() })),
    fetch_timeout_ms: positiveInt,
    user_agent: text,
    // What's built: a medium outside this list is never posted, whatever her skill.
    capabilities: z.array(z.enum(["still"])).min(1),
    craft_goals: z.object({ still: text }),
    max_per_week: positiveInt,
    max_pending: positiveInt,
    max_find_age_hours: z.number().positive(),
    min_valence: unit,
    candidate_limit: positiveInt,
    max_find_px: positiveInt,
    output_width: positiveInt,
    caption_max_chars: positiveInt,
    overlay_max_chars: positiveInt,
    media_dir: text,
    formats_dir: text,
    poses_dir: text,
    fonts: z.object({ plain: font, handwritten: font }),
    // Homemade roughness at skill 0; it shrinks linearly to none at skill 1.
    jitter: z.object({
      crop: z.number().min(0).max(0.3),
      tilt_deg: z.number().min(0).max(15),
      place: z.number().min(0).max(0.3),
    }),
    recent_limit: positiveInt,
  })
  .refine((p) => p.browse_window[0] < p.browse_window[1], "posts.browse_window must be ordered");
```

Add `posts,` to `ConfigSchema` (after `onboarding`).

In `config/default.json`, add `"post_draft": "v1", "post_check": "v1", "format_draft": "v1"` to `prompts`, add `"post_draft", "post_check"` to `core.loop_priority.optional`, and a top-level block:

```json
  "posts": {
    "tick_cron": "40 * * * *",
    "browse_per_day": 1,
    "browse_window": ["09:00", "23:00"],
    "browse_step_minutes": 15,
    "sources": [
      { "name": "apod", "weight": 2 },
      { "name": "commons_potd", "weight": 1 }
    ],
    "fetch_timeout_ms": 20000,
    "user_agent": "SpicaPostEngine/0.1 (personal project; contact via repository owner)",
    "capabilities": ["still"],
    "craft_goals": { "still": "Get better at making posts" },
    "max_per_week": 4,
    "max_pending": 1,
    "max_find_age_hours": 48,
    "min_valence": 0.3,
    "candidate_limit": 10,
    "max_find_px": 2048,
    "output_width": 1080,
    "caption_max_chars": 220,
    "overlay_max_chars": 80,
    "media_dir": ".data/media",
    "formats_dir": "formats/stills",
    "poses_dir": "assets/poses",
    "fonts": {
      "plain": { "file": "assets/fonts/Inter.ttf", "family": "Inter" },
      "handwritten": { "file": "assets/fonts/Caveat.ttf", "family": "Caveat" }
    },
    "jitter": { "crop": 0.08, "tilt_deg": 4, "place": 0.05 },
    "recent_limit": 30
  },
```

Add `.data/` to `.gitignore` if it isn't there.

In `src/mind/platform/deps.ts`: import `type { WebSources } from "@/mind/world/types"`, add `webSources: WebSources;` to `Deps`, add `"webSources"` to the `CoreDeps` `Pick`, and to `coreDepsOf`'s destructure and return. Extend the `CoreDeps` doc comment: "and the web sources she browses, which carry no user".

In `tests/helpers/deps.ts`, add an optional third parameter and the field:

```ts
export function makeTestDeps(
  configOverrides: unknown = {},
  modules: readonly Module[] = [],
  webSources: WebSources = {},
) {
```

with `webSources,` in the object (import the type). In `src/runtime/deps.ts`, add `webSources: {},` for now (Task 3 replaces it).

`package.json`: add `"sharp": "^0.35.4"` to `dependencies`, then `pnpm install` (it resolves to the copy already in the store).

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm vitest run tests/mind/platform/config.test.ts`, then `pnpm typecheck && pnpm lint && pnpm test`. A test asserting the exact `CORE_LOOPS` list or optional list (e.g. `tests/evals/core-mind-order.test.ts`) gets the two new names.

- [ ] **Step 5: Commit**

```bash
git add src/mind/platform/config.ts config/default.json src/mind/platform/deps.ts tests/helpers/deps.ts src/runtime/deps.ts package.json pnpm-lock.yaml .gitignore tests
git commit -m "feat(posts): posts config, optional draft and check loops, web sources in deps, sharp"
```

---

### Task 3: The real web sources

**Files:**
- Create: `src/runtime/web-sources.ts`
- Modify: `src/runtime/env.ts` (`NASA_API_KEY`), `src/runtime/deps.ts`
- Test: `tests/runtime/web-sources.test.ts`

**Interfaces:**
- Consumes: `WebSource`, `WebItem`, `WebSources` (Task 1); `config.posts.user_agent`, `fetch_timeout_ms` (Task 2).
- Produces: `createWebSources(opts: { nasaApiKey: string; userAgent: string; timeoutMs: number }): WebSources` with keys `apod` and `commons_potd`.

- [ ] **Step 1: Write the failing test**

`tests/runtime/web-sources.test.ts`:

```ts
/** The two image sources: today's item with its licence, null when there's no image. */
import { afterEach, expect, test, vi } from "vitest";
import { createWebSources } from "@/runtime/web-sources";

const sources = createWebSources({ nasaApiKey: "K", userAgent: "UA", timeoutMs: 1000 });
const png = new Uint8Array([137, 80, 78, 71]);

function stub(routes: Record<string, unknown>) {
  const fetch = vi.fn(async (url: string) => {
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (!key) return new Response("missing", { status: 404 });
    const body = routes[key];
    return body instanceof Uint8Array
      ? new Response(body)
      : new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => vi.unstubAllGlobals());

test("apod: a public-domain image day", async () => {
  const fetch = stub({
    "https://api.nasa.gov/planetary/apod?api_key=K&date=2026-01-05": {
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
    "https://api.nasa.gov/planetary/apod?api_key=K&date=2026-01-05": {
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
    "https://api.nasa.gov/planetary/apod?api_key=K&date=2026-01-06": {
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/runtime/web-sources.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the sources**

`src/runtime/web-sources.ts`:

```ts
/**
 * Where she browses: NASA's astronomy picture of the day and Wikimedia Commons' picture of the
 * day. Each returns that date's image with its credit and licence, or null when the day has no
 * image; a network or HTTP failure throws, so the world tick simply tries again next hour.
 */
import { z } from "zod";
import type { WebItem, WebSource, WebSources } from "@/mind/world/types";

type Options = { nasaApiKey: string; userAgent: string; timeoutMs: number };

async function get(url: string, o: Options): Promise<Response> {
  const res = await fetch(url, {
    headers: { "User-Agent": o.userAgent },
    signal: AbortSignal.timeout(o.timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const bytes = async (url: string, o: Options) =>
  new Uint8Array(await (await get(url, o)).arrayBuffer());

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
      const raw = Apod.parse(
        await (
          await get(`https://api.nasa.gov/planetary/apod?api_key=${o.nasaApiKey}&date=${day}`, o)
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
        await (await get(`https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${path}`, o)).json(),
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
```

In `src/runtime/env.ts`, add `NASA_API_KEY: z.string().min(1).optional(),` to `EnvSchema`. In `src/runtime/deps.ts` replace `webSources: {}` with:

```ts
    // DEMO_KEY is rate-limited per IP, which one browse a day stays well under.
    webSources: createWebSources({
      nasaApiKey: env.NASA_API_KEY ?? "DEMO_KEY",
      userAgent: config.posts.user_agent,
      timeoutMs: config.posts.fetch_timeout_ms,
    }),
```

Add `NASA_API_KEY=` to `.env.example` if the repo has one.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm vitest run tests/runtime/web-sources.test.ts` (expected: 4 passed), then `pnpm typecheck && pnpm lint`.

- [ ] **Step 5: Commit**

```bash
git add src/runtime tests/runtime/web-sources.test.ts .env.example
git commit -m "feat(posts): NASA APOD and Commons picture-of-the-day sources"
```

---

### Task 4: Browsing in her world

**Files:**
- Create: `src/mind/platform/media.ts`
- Create: `src/mind/process/core/browse.ts`
- Modify: `src/mind/process/core/world-tick.ts` (a third step)
- Create: `tests/helpers/web.ts`
- Test: `tests/mind/process/core/browse.test.ts`

**Interfaces:**
- Consumes: `deps.webSources`, `core.posts.findsOn | findByUrl | insertFind`, `core.world.recordEvent`, `config.posts.*`.
- Produces: `browseIfDue(deps: CoreDeps, now: Date): Promise<boolean>`; `browseTime(life: LifeConfig, posts: Config["posts"], day: string, plan: LifePlan, slot: number): Date | null`; `saveMedia(dir: string, name: string, bytes: Buffer): Promise<string>`; `readMedia(file: string): Promise<Buffer>`; `isFreeLicence(licence: string): boolean`; test helpers `fakeSources(items)`, `fixturePng(opts)`, `tmpMediaDir()`. `WorldTickResult` gains `browsed: boolean`.

- [ ] **Step 1: Test helpers**

`tests/helpers/web.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing tests**

`tests/mind/process/core/browse.test.ts`:

```ts
/** Browsing: one real find a day, in her free time, as an action event that lands like any other. */
import { existsSync } from "node:fs";
import { afterAll, beforeEach, expect, test } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import { browseIfDue, browseTime, isFreeLicence } from "@/mind/process/core/browse";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { loadConfig } from "@/mind/platform/config";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { fakeSources, tmpMediaDir, webItem } from "../../../helpers/web";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 0, 5, hour, minute));
const DAY = "2026-01-05";
const FREE = { blocks: [{ start: "10:00", end: "13:00", kind: "busy" as const, busy: 0.6, label: "reading" }] };

async function setup(items: Parameters<typeof fakeSources>[0], over: object = {}) {
  const media = tmpMediaDir();
  const { sources, calls } = fakeSources(items);
  const deps = makeTestDeps(
    {
      life: { timezone: "UTC" },
      posts: { media_dir: media, sources: [{ name: "apod", weight: 1 }], ...over },
    },
    [],
    sources,
  );
  await deps.core.world.insertPlan({
    date: DAY,
    plan: FREE,
    source: "scripted",
    model: "none",
    prompt_version: "none",
    generated_at: at(0),
  });
  return { deps, core: coreDepsOf(deps), calls };
}

test("browse time: inside the window, never inside a busy or quiet block, stable per slot", () => {
  const c = loadConfig({ life: { timezone: "UTC" } });
  const t = browseTime(c.life, c.posts, DAY, FREE, 0)!;
  expect(t.getTime()).toBeGreaterThanOrEqual(at(9).getTime());
  expect(t.getTime()).toBeLessThan(at(23).getTime());
  expect(t.getTime() >= at(10).getTime() && t.getTime() < at(13).getTime()).toBe(false);
  expect(browseTime(c.life, c.posts, DAY, FREE, 0)).toEqual(t);
  const full = { blocks: [{ start: "00:00", end: "24:00", kind: "quiet" as const, busy: 0, label: "off" }] };
  expect(browseTime(c.life, c.posts, DAY, full, 0)).toBeNull();
});

test("free licences only", () => {
  for (const l of ["public domain", "Public domain", "CC0", "CC BY 4.0", "CC BY-SA 3.0"])
    expect(isFreeLicence(l)).toBe(true);
  for (const l of ["copyrighted", "unknown", "CC BY-NC 4.0", "CC BY-ND 4.0"])
    expect(isFreeLicence(l)).toBe(false);
});

test("a browse writes a find, its cached image, an action event and a trace, once a day", async () => {
  const { deps, core } = await setup({ apod: await webItem() });
  expect(await browseIfDue(core, at(8))).toBe(true);
  const [find] = await deps.core.posts.unposted(at(0), 5); // not landed yet
  expect(find).toBeUndefined();
  const f = await deps.core.posts.findByUrl("https://apod.nasa.gov/p.jpg");
  expect(f).toMatchObject({ source: "apod", title: "The Pillars of Creation", licence: "public domain" });
  expect(existsSync(f!.media_path)).toBe(true);
  const event = await deps.core.world.getEvent(f!.world_event_id);
  expect(event).toMatchObject({
    kind: "action",
    valence: 0,
    stakes: "low",
    life_day: DAY,
    content: 'Spica came across "The Pillars of Creation" on the apod page.',
  });
  expect(event!.at.getTime()).toBe(f!.found_at.getTime());
  expect(await browseIfDue(core, at(9))).toBe(false); // browse_per_day 1
});

test("no plan, no source, a failing source or a non-free licence: nothing written", async () => {
  const none = await setup({});
  expect(await browseIfDue(none.core, at(8))).toBe(false);
  const failing = await setup({ apod: new Error("HTTP 404") });
  expect(await browseIfDue(failing.core, at(8))).toBe(false);
  const paid = await setup({ apod: await webItem({ licence: "copyrighted" }) });
  expect(await browseIfDue(paid.core, at(8))).toBe(false);
  const empty = await setup({ apod: null });
  expect(await browseIfDue(empty.core, at(8))).toBe(false);
  expect(await paid.deps.core.posts.findsOn(DAY)).toBe(0);
});

test("the same item twice in a day is written once", async () => {
  const { deps, core } = await setup({ apod: await webItem() }, { browse_per_day: 2 });
  expect(await browseIfDue(core, at(8))).toBe(true);
  expect(await browseIfDue(core, at(9))).toBe(false);
  expect(await deps.core.posts.findsOn(DAY)).toBe(1);
});

test("the world tick browses, and a later tick lands the find through appraisal", async () => {
  const { deps, core } = await setup({ apod: await webItem() });
  const first = await coreWorldTick(core, at(8));
  expect(first.browsed).toBe(true);
  await coreWorldTick(core, at(23, 30));
  const [find] = await deps.core.posts.unposted(at(0), 5);
  expect(find).toBeDefined();
  const episode = await deps.core.memory.bySourceRef("episode", `world_event:${find!.world_event_id}`);
  expect(episode).not.toBeNull();
});

test("an apod fetch failure inside the world tick doesn't fail the tick", async () => {
  const { core } = await setup({ apod: new Error("HTTP 404") });
  await expect(coreWorldTick(core, at(8))).resolves.toMatchObject({ browsed: false });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run tests/mind/process/core/browse.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Write media, browse and the world tick step**

`src/mind/platform/media.ts`:

```ts
/**
 * Where her images live: finds she cached and posts she drafted.
 * ponytail: local disk under `posts.media_dir`; move to object storage before users.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function saveMedia(dir: string, name: string, bytes: Buffer): Promise<string> {
  const file = path.join(dir, name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return file;
}

export const readMedia = (file: string): Promise<Buffer> => readFile(file);
```

`src/mind/process/core/browse.ts`:

```ts
/**
 * Browsing: once or twice a day, in her free time, she comes across something real on the
 * internet. It's recorded as an action in her world at the minute she sees it, with the item
 * cached, and lands like any event, through appraisal, so she has a take on it and can mention it.
 * Only freely licensed items are kept, because she may post them.
 */
import sharp from "sharp";
import type { LifePlan } from "@/db/schema";
import type { Config, LifeConfig } from "@/mind/platform/config";
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { saveMedia } from "@/mind/platform/media";
import { seededUnit } from "@/mind/platform/seeded-random";
import { MINUTE } from "@/mind/platform/time";
import { blockAt, blocksForDay } from "@/mind/world/blocks";
import { lifeDate, lifeInstant } from "@/mind/world/her-clock";
import { WORLD_LOCK } from "./thoughts";

const FREE = /^(public domain|cc0\b|cc[ -]by( |-sa |$|-sa$))/i;

/** Public domain, CC0, CC BY and CC BY-SA; never non-commercial or no-derivatives. */
export const isFreeLicence = (licence: string) => FREE.test(licence.trim());

/** A free minute for her `slot`th browse of `day`, stable for the day; null when she has none. */
export function browseTime(
  life: LifeConfig,
  posts: Config["posts"],
  day: string,
  plan: LifePlan,
  slot: number,
): Date | null {
  const blocks = blocksForDay(life, day, plan);
  const start = lifeInstant(life, day, posts.browse_window[0]).getTime();
  const end = lifeInstant(life, day, posts.browse_window[1]).getTime();
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
  const slot = await core.posts.findsOn(day);
  if (slot >= cfg.browse_per_day) return false;
  const at = browseTime(config.life, cfg, day, plan, slot);
  const sources = cfg.sources.filter((s) => webSources[s.name]);
  if (!at || !sources.length) return false;
  // The hour is in the roll so a source that keeps failing doesn't block the day.
  const source = pickSource(sources, seededUnit(`${day}:browse:${slot}:${now.toISOString().slice(0, 13)}`));
  const page = webSources[source.name]!;
  let item;
  let image: Buffer;
  try {
    item = await page.fetch(day);
    if (!item || !isFreeLicence(item.licence) || (await core.posts.findByUrl(item.url))) return false;
    image = await sharp(item.image)
      .resize({ width: cfg.max_find_px, height: cfg.max_find_px, fit: "inside", withoutEnlargement: true })
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
    if ((await tx.posts.findsOn(day)) !== slot || (await tx.posts.findByUrl(found.url))) return false;
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
      credit: found.credit,
      licence: found.licence,
      media_path: media,
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
```

In `src/mind/process/core/world-tick.ts`: import `browseIfDue` from `./browse`; change `WorldTickResult` to `{ generated: boolean; appraised: number; browsed: boolean }`; update the header comment with one sentence ("Third, once a day she browses: a real find becomes an action that lands on a later run."); after the generation `try` block add:

```ts
  let browsed = false;
  try {
    browsed = await browseIfDue(deps, now);
  } catch (error) {
    // A broken browse never stalls her day.
    deps.log.error("core world tick browse failed", { error: errorName(error) });
  }
```

and return `{ generated, appraised, browsed }`. Fix any test that asserts the tick's exact return shape (`toEqual({ generated, appraised })`) by adding `browsed: false`.

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `pnpm vitest run tests/mind/process/core/browse.test.ts` (expected: 7 passed), then `pnpm typecheck && pnpm lint && pnpm test`.

- [ ] **Step 6: Commit**

```bash
git add src/mind/platform/media.ts src/mind/process/core/browse.ts src/mind/process/core/world-tick.ts tests
git commit -m "feat(posts): she browses real free-licence images as actions in her world"
```

---

### Task 5: Formats, poses and her craft skill

**Files:**
- Create: `src/mind/process/core/post-library.ts`
- Create: `formats/stills/plain.json`, `formats/stills/polaroid.json`, `formats/stills/screenshot.json`, `formats/README.md`
- Create: `assets/poses/poses.json` and four placeholder PNGs; `assets/fonts/Inter.ttf`, `assets/fonts/Caveat.ttf`, `assets/fonts/OFL.txt`
- Test: `tests/mind/process/core/post-library.test.ts`

**Interfaces:**
- Consumes: `CoreGoals.byTitle | active | insert`, `parseSeedGoals`, `loadPersona`, `config.posts.*`.
- Produces:
  ```ts
  export const StillFormatSchema: z.ZodType<StillFormat>;
  export type StillFormat = { name: string; medium: "still"; min_skill: number; aspect: "1:1" | "4:5" | "9:16"; frame: "none" | "polaroid" | "screenshot" | "border"; placement: { side: "auto" | "left" | "right"; scale: [number, number] }; poses: string[]; overlay: { kind: "none" | "caption_in_image" | "label"; position: "top" | "bottom"; style: "plain" | "handwritten" }; grain: number; caption_pattern: string; reviewed: boolean };
  export type Pose = { name: string; file: string; tags: string[]; facing: "left" | "right"; anchor: [number, number] };
  export function loadFormats(dir: string, log: Logger): StillFormat[];
  export function eligibleFormats(formats: StillFormat[], capabilities: readonly string[], skill: number): StillFormat[];
  export function loadPoses(dir: string): Pose[];
  export function choosePose(poses: Pose[], format: StillFormat, roll: number): Pose | null;
  export function craftSkill(deps: Pick<CoreDeps, "core" | "config" | "embedder" | "log" | "clock">, medium: "still"): Promise<{ goalId: string | null; skill: number }>;
  ```

- [ ] **Step 1: Assets**

Placeholder poses: create `assets/poses/` and run this once from the worktree root (it writes four 400×1000 silhouettes; Ethan's exports replace them later):

```bash
node --input-type=module -e '
import sharp from "sharp";
const body = (legs, arm, head) => `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="1000"><g fill="#1b1b24"><circle cx="${head[0]}" cy="${head[1]}" r="70"/><rect x="140" y="230" width="120" height="380" rx="50"/>${legs}${arm}</g></svg>`;
const poses = {
  "walk-01": body(`<rect x="150" y="560" width="45" height="420" rx="20" transform="rotate(12 172 580)"/><rect x="205" y="560" width="45" height="420" rx="20" transform="rotate(-12 227 580)"/>`, `<rect x="250" y="250" width="40" height="300" rx="20" transform="rotate(-15 270 260)"/>`, [200, 150]),
  "stand-01": body(`<rect x="150" y="560" width="45" height="420" rx="20"/><rect x="205" y="560" width="45" height="420" rx="20"/>`, `<rect x="255" y="250" width="40" height="300" rx="20"/>`, [200, 150]),
  "look-up-01": body(`<rect x="150" y="560" width="45" height="420" rx="20"/><rect x="205" y="560" width="45" height="420" rx="20"/>`, `<rect x="255" y="120" width="40" height="300" rx="20" transform="rotate(-160 275 250)"/>`, [215, 140]),
  "sit-edge-01": body(`<rect x="150" y="560" width="200" height="45" rx="20"/><rect x="305" y="560" width="45" height="420" rx="20"/>`, `<rect x="255" y="250" width="40" height="300" rx="20"/>`, [200, 150]),
};
for (const [name, svg] of Object.entries(poses)) await sharp(Buffer.from(svg)).png().toFile(`assets/poses/${name}.png`);
'
```

`assets/poses/poses.json`:

```json
[
  { "name": "walk-01", "file": "walk-01.png", "tags": ["walking"], "facing": "right", "anchor": [200, 980] },
  { "name": "stand-01", "file": "stand-01.png", "tags": ["standing"], "facing": "right", "anchor": [200, 980] },
  { "name": "look-up-01", "file": "look-up-01.png", "tags": ["looking_up"], "facing": "right", "anchor": [200, 980] },
  { "name": "sit-edge-01", "file": "sit-edge-01.png", "tags": ["sitting_edge"], "facing": "right", "anchor": [200, 980] }
]
```

Fonts (OFL, from the google/fonts repository):

```bash
mkdir -p assets/fonts
curl -L -o assets/fonts/Inter.ttf "https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf"
curl -L -o assets/fonts/Caveat.ttf "https://github.com/google/fonts/raw/main/ofl/caveat/Caveat%5Bwght%5D.ttf"
curl -L -o assets/fonts/OFL.txt "https://github.com/google/fonts/raw/main/ofl/caveat/OFL.txt"
```

Check each `.ttf` is over 50 KB (a 404 page is not a font).

Starter formats, all `reviewed: true`:

`formats/stills/plain.json`:
```json
{
  "name": "plain",
  "medium": "still",
  "min_skill": 0,
  "aspect": "4:5",
  "frame": "none",
  "placement": { "side": "auto", "scale": [0.45, 0.6] },
  "poses": ["walking", "standing", "looking_up"],
  "overlay": { "kind": "none", "position": "bottom", "style": "plain" },
  "grain": 0.15,
  "caption_pattern": "short, lowercase, one or two lines, no hashtags",
  "reviewed": true
}
```

`formats/stills/polaroid.json`:
```json
{
  "name": "polaroid",
  "medium": "still",
  "min_skill": 0,
  "aspect": "1:1",
  "frame": "polaroid",
  "placement": { "side": "auto", "scale": [0.4, 0.55] },
  "poses": ["standing", "looking_up", "sitting_edge"],
  "overlay": { "kind": "label", "position": "bottom", "style": "handwritten" },
  "grain": 0.3,
  "caption_pattern": "a diary line, warm, first person; the label is three to six words",
  "reviewed": true
}
```

`formats/stills/screenshot.json`:
```json
{
  "name": "screenshot",
  "medium": "still",
  "min_skill": 0.2,
  "aspect": "4:5",
  "frame": "screenshot",
  "placement": { "side": "auto", "scale": [0.5, 0.65] },
  "poses": ["walking", "sitting_edge"],
  "overlay": { "kind": "caption_in_image", "position": "top", "style": "plain" },
  "grain": 0.1,
  "caption_pattern": "deadpan, one line; the in-image text is the joke, the caption adds one beat",
  "reviewed": true
}
```

`formats/README.md`: three short paragraphs: what a format is; add one with `pnpm formats:add <image>` (Task 10), edit the drafted JSON, set `reviewed: true`, commit; the field list with allowed values (copy the zod enums).

- [ ] **Step 2: Write the failing tests**

`tests/mind/process/core/post-library.test.ts`:

```ts
/** Formats, poses and her craft skill: only reviewed formats she's good enough for, within what's built. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, expect, test } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import {
  choosePose,
  craftSkill,
  eligibleFormats,
  loadFormats,
  loadPoses,
  type StillFormat,
} from "@/mind/process/core/post-library";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const base: StillFormat = {
  name: "f",
  medium: "still",
  min_skill: 0,
  aspect: "4:5",
  frame: "none",
  placement: { side: "auto", scale: [0.4, 0.5] },
  poses: ["walking"],
  overlay: { kind: "none", position: "bottom", style: "plain" },
  grain: 0,
  caption_pattern: "short",
  reviewed: true,
};

function logs() {
  const lines: { msg: string; meta?: object }[] = [];
  const log = {
    info: (msg: string, meta?: object) => lines.push({ msg, meta }),
    error: (msg: string, meta?: object) => lines.push({ msg, meta }),
  };
  return { log: log as never, lines };
}

test("the shipped formats and poses load", () => {
  const { log, lines } = logs();
  expect(loadFormats("formats/stills", log).map((f) => f.name).sort()).toEqual([
    "plain",
    "polaroid",
    "screenshot",
  ]);
  expect(lines).toEqual([]);
  expect(loadPoses("assets/poses").map((p) => p.name)).toContain("walk-01");
});

test("an invalid or misnamed format file is skipped and logged by name", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "formats-"));
  writeFileSync(path.join(dir, "good.json"), JSON.stringify({ ...base, name: "good" }));
  writeFileSync(path.join(dir, "bad.json"), JSON.stringify({ ...base, name: "bad", aspect: "3:2" }));
  writeFileSync(path.join(dir, "other.json"), JSON.stringify({ ...base, name: "renamed" }));
  writeFileSync(path.join(dir, "broken.json"), "{");
  const { log, lines } = logs();
  expect(loadFormats(dir, log).map((f) => f.name)).toEqual(["good"]);
  expect(lines.map((l) => (l.meta as { file: string }).file).sort()).toEqual([
    "bad.json",
    "broken.json",
    "other.json",
  ]);
});

test("eligible: reviewed, a built medium, and within her skill", () => {
  const formats = [
    { ...base, name: "a" },
    { ...base, name: "b", reviewed: false },
    { ...base, name: "c", min_skill: 0.5 },
  ];
  expect(eligibleFormats(formats, ["still"], 0.2).map((f) => f.name)).toEqual(["a"]);
  expect(eligibleFormats(formats, ["still"], 0.5).map((f) => f.name)).toEqual(["a", "c"]);
  expect(eligibleFormats(formats, [], 1)).toEqual([]);
});

test("a pose comes from the format's tags, or none", () => {
  const poses = loadPoses("assets/poses");
  expect(choosePose(poses, { ...base, poses: ["looking_up"] }, 0.9)?.name).toBe("look-up-01");
  expect(choosePose(poses, { ...base, poses: ["flying"] }, 0.1)).toBeNull();
});

test("craft skill: created once from her persona, then read from the goal", async () => {
  const deps = coreDepsOf(makeTestDeps());
  const first = await craftSkill(deps, "still");
  expect(first.skill).toBe(0);
  expect(first.goalId).not.toBeNull();
  const again = await craftSkill(deps, "still");
  expect(again.goalId).toBe(first.goalId);
  await deps.core.goals.setProgress(first.goalId!, 0.4, deps.clock.now());
  expect((await craftSkill(deps, "still")).skill).toBe(0.4);
});

test("craft skill: done reads 1, dropped keeps its progress, neither is recreated", async () => {
  const deps = coreDepsOf(makeTestDeps());
  const { goalId } = await craftSkill(deps, "still");
  await deps.core.goals.setProgress(goalId!, 0.3, deps.clock.now());
  await deps.core.goals.setStatus(goalId!, "dropped", deps.clock.now());
  expect(await craftSkill(deps, "still")).toEqual({ goalId: null, skill: 0.3 });
  const deps2 = coreDepsOf(makeTestDeps());
  await resetDb();
  const g = await craftSkill(deps2, "still");
  await deps2.core.goals.setStatus(g.goalId!, "done", deps2.clock.now());
  expect(await craftSkill(deps2, "still")).toEqual({ goalId: null, skill: 1 });
  expect((await deps2.core.goals.active()).length).toBe(0);
});

test("craft skill: no room for another active goal reads 0 and creates nothing", async () => {
  const deps = coreDepsOf(makeTestDeps({ core: { goals: { max_active: 1 } } }));
  await deps.core.goals.insert({
    title: "Something else",
    why: "x",
    status: "active",
    progress: 0,
    source: "seed",
    source_ref: null,
    started_at: deps.clock.now(),
    target_at: null,
    embedding: vec(),
  });
  expect(await craftSkill(deps, "still")).toEqual({ goalId: null, skill: 0 });
  expect(await deps.core.goals.byTitle("Get better at making posts")).toBeNull();
});
```

The craft-goal tests need the persona to list the goal: they pass once Task 11 adds it to persona v6. Until then, Step 3's `craftSkill` falls back to logging and skill 0, so in **this** task temporarily point the test at a persona fixture: skip the three `craft skill` tests with `test.skip` and a `// enabled in the persona task` comment, and Task 11 removes the `.skip`.

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run tests/mind/process/core/post-library.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Write the library**

`src/mind/process/core/post-library.ts`:

```ts
/**
 * What her posts are made from: formats (popular post shapes Ethan reviewed, as data), poses (her
 * body as pre-rendered sprites) and her craft skill (a core goal's progress, which only appraisal
 * moves). A format she isn't good enough for yet, or a medium that isn't built, is never chosen.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import type { Logger } from "@/mind/platform/log";
import { loadPersona, parseSeedGoals } from "@/mind/platform/persona";

const share = z.number().gt(0).max(1);

export const StillFormatSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  medium: z.literal("still"),
  min_skill: z.number().min(0).max(1),
  aspect: z.enum(["1:1", "4:5", "9:16"]),
  frame: z.enum(["none", "polaroid", "screenshot", "border"]),
  placement: z.object({
    side: z.enum(["auto", "left", "right"]),
    scale: z.tuple([share, share]).refine(([lo, hi]) => lo <= hi, "scale must be [low, high]"),
  }),
  poses: z.array(z.string().min(1)).min(1),
  overlay: z.object({
    kind: z.enum(["none", "caption_in_image", "label"]),
    position: z.enum(["top", "bottom"]),
    style: z.enum(["plain", "handwritten"]),
  }),
  grain: z.number().min(0).max(1),
  caption_pattern: z.string().min(1),
  reviewed: z.boolean(),
});
export type StillFormat = z.infer<typeof StillFormatSchema>;

const PoseSchema = z.object({
  name: z.string().min(1),
  file: z.string().regex(/^[\w-]+\.png$/),
  tags: z.array(z.string().min(1)).min(1),
  facing: z.enum(["left", "right"]),
  anchor: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
});
export type Pose = z.infer<typeof PoseSchema>;

/** Every valid format file; an invalid one is logged by file name and skipped, never fatal. */
export function loadFormats(dir: string, log: Logger): StillFormat[] {
  const formats: StillFormat[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    try {
      const format = StillFormatSchema.parse(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
      if (`${format.name}.json` !== file) throw new Error("name must match the file name");
      formats.push(format);
    } catch (error) {
      log.info("format skipped", { file, error: errorName(error) });
    }
  }
  return formats;
}

export const eligibleFormats = (
  formats: StillFormat[],
  capabilities: readonly string[],
  skill: number,
) => formats.filter((f) => f.reviewed && capabilities.includes(f.medium) && f.min_skill <= skill);

/** The pose library is an asset Ethan ships, so a broken one fails loudly. */
export function loadPoses(dir: string): Pose[] {
  return z.array(PoseSchema).parse(JSON.parse(readFileSync(path.join(dir, "poses.json"), "utf8")));
}

export function choosePose(poses: Pose[], format: StillFormat, roll: number): Pose | null {
  const fits = poses.filter((p) => p.tags.some((t) => format.poses.includes(t)));
  return fits.length ? fits[Math.floor(roll * fits.length)]! : null;
}

/**
 * Her skill at a medium: its craft goal's progress (1 once done). The goal comes from her
 * persona; a database seeded before it was added gets it once here, while there's room.
 * ponytail: two concurrent first calls could both create it; post_tick is the only caller.
 */
export async function craftSkill(
  deps: Pick<CoreDeps, "core" | "config" | "embedder" | "log" | "clock">,
  medium: "still",
): Promise<{ goalId: string | null; skill: number }> {
  const { core, config, log } = deps;
  const title = config.posts.craft_goals[medium];
  const goal = await core.goals.byTitle(title);
  if (goal)
    return {
      goalId: goal.status === "active" ? goal.id : null,
      skill: goal.status === "done" ? 1 : goal.progress,
    };
  const seed = parseSeedGoals(loadPersona(config).seedSelf).find((g) => g.title === title);
  if (!seed || (await core.goals.active()).length >= config.core.goals.max_active) {
    log.info("craft goal unavailable", { medium, inPersona: Boolean(seed) });
    return { goalId: null, skill: 0 };
  }
  const [embedding] = await deps.embedder.embed([`${seed.title}: ${seed.why}`], "document");
  const now = deps.clock.now();
  const goalId = await core.goals.insert({
    ...seed,
    status: "active",
    progress: 0,
    source: "seed",
    source_ref: `persona:${config.prompts.persona}`,
    started_at: now,
    target_at: null,
    embedding: embedding!,
  });
  return { goalId, skill: 0 };
}
```

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `pnpm vitest run tests/mind/process/core/post-library.test.ts` (expected: 4 passed, 3 skipped), then `pnpm typecheck && pnpm lint`. Prettier must not reformat the JSON assets into failure; run `pnpm format` on `formats/` and `assets/poses/poses.json` if `lint` complains.

- [ ] **Step 6: Commit**

```bash
git add src/mind/process/core/post-library.ts formats assets tests/mind/process/core/post-library.test.ts
git commit -m "feat(posts): format and pose libraries, starter formats, placeholder poses, craft skill"
```

---

### Task 6: Rendering a still

**Files:**
- Create: `src/mind/process/core/post-render.ts`
- Test: `tests/mind/process/core/post-render.test.ts`

**Interfaces:**
- Consumes: `StillFormat`, `Pose` (Task 5), `seededUnit`, `config.posts.jitter | fonts | output_width`.
- Produces:
  ```ts
  export type PoseSprite = { png: Buffer; facing: "left" | "right"; anchor: [number, number] };
  export type RenderInput = { content: Buffer; format: StillFormat; pose: PoseSprite; overlayText: string | null; skill: number; seed: string; posts: Config["posts"] };
  export function canvasSize(format: StillFormat, width: number): { width: number; height: number };
  export function framedSize(format: StillFormat, width: number): { width: number; height: number };
  export function quieterSide(image: Buffer): Promise<"left" | "right">;
  export function roughness(skill: number): number; // 1 - skill, clamped
  export function renderStill(input: RenderInput): Promise<Buffer>; // PNG
  ```

- [ ] **Step 1: Write the failing tests**

`tests/mind/process/core/post-render.test.ts`:

```ts
/** Rendering: she stands on the quieter side, the output has the format's size, and a seed repeats. */
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import type { StillFormat } from "@/mind/process/core/post-library";
import {
  canvasSize,
  framedSize,
  quieterSide,
  renderStill,
  roughness,
} from "@/mind/process/core/post-render";
import { fixturePng } from "../../../helpers/web";

const posts = loadConfig().posts;
const pose = {
  png: readFileSync("assets/poses/walk-01.png"),
  facing: "right" as const,
  anchor: [200, 980] as [number, number],
};
const format: StillFormat = {
  name: "t",
  medium: "still",
  min_skill: 0,
  aspect: "4:5",
  frame: "none",
  placement: { side: "auto", scale: [0.4, 0.5] },
  poses: ["walking"],
  overlay: { kind: "none", position: "bottom", style: "plain" },
  grain: 0.2,
  caption_pattern: "short",
  reviewed: true,
};
const input = async (over: Partial<Parameters<typeof renderStill>[0]> = {}) => ({
  content: await fixturePng(),
  format,
  pose,
  overlayText: null,
  skill: 0.2,
  seed: "post-1",
  posts,
  ...over,
});

test("sizes by aspect and frame", () => {
  expect(canvasSize(format, 1080)).toEqual({ width: 1080, height: 1350 });
  expect(canvasSize({ ...format, aspect: "1:1" }, 1080)).toEqual({ width: 1080, height: 1080 });
  expect(canvasSize({ ...format, aspect: "9:16" }, 1080)).toEqual({ width: 1080, height: 1920 });
  expect(framedSize(format, 1080)).toEqual({ width: 1080, height: 1350 });
  const polaroid = framedSize({ ...format, frame: "polaroid" }, 1080);
  expect(polaroid.height - 1350).toBeGreaterThan(polaroid.width - 1080);
});

test("the quieter side is the one without detail", async () => {
  expect(await quieterSide(await fixturePng({ busy: "left" }))).toBe("right");
  expect(await quieterSide(await fixturePng({ busy: "right" }))).toBe("left");
});

test("roughness falls with skill", () => {
  expect(roughness(0)).toBe(1);
  expect(roughness(0.75)).toBeCloseTo(0.25);
  expect(roughness(2)).toBe(0);
});

test("a render has the framed size and repeats byte for byte for the same seed", async () => {
  for (const frame of ["none", "border", "polaroid", "screenshot"] as const) {
    const f = { ...format, frame };
    const out = await renderStill(await input({ format: f }));
    const meta = await sharp(out).metadata();
    expect({ width: meta.width, height: meta.height }).toEqual(framedSize(f, posts.output_width));
    expect(meta.format).toBe("png");
  }
  const a = await renderStill(await input());
  const b = await renderStill(await input());
  expect(a.equals(b)).toBe(true);
  const c = await renderStill(await input({ seed: "post-2" }));
  expect(a.equals(c)).toBe(false);
});

test("she lands on the quieter side", async () => {
  const flat = await fixturePng({ busy: "none" });
  const base = await sharp(await renderStill(await input({ content: await fixturePng({ busy: "left" }), skill: 1, format: { ...format, grain: 0 } }))).raw().toBuffer({ resolveWithObject: true });
  const empty = await sharp(await renderStill(await input({ content: flat, skill: 1, format: { ...format, grain: 0 }, pose: { ...pose, png: await sharp({ create: { width: 400, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer() } }))).raw().toBuffer({ resolveWithObject: true });
  // Her silhouette is dark: the right half of the busy-left render is darker than without her.
  const darkness = (img: typeof base, fromX: number, toX: number) => {
    let sum = 0;
    for (let y = 0; y < img.info.height; y += 4)
      for (let x = fromX; x < toX; x += 4) sum += 255 - img.data[(y * img.info.width + x) * img.info.channels]!;
    return sum;
  };
  const w = base.info.width;
  expect(darkness(base, w / 2, w)).toBeGreaterThan(darkness(empty, w / 2, w));
});

test("overlay text with markup characters renders literally without throwing", async () => {
  const f = { ...format, overlay: { kind: "caption_in_image" as const, position: "top" as const, style: "plain" as const } };
  const out = await renderStill(await input({ format: f, overlayText: "stars & films <3" }));
  expect((await sharp(out).metadata()).width).toBe(posts.output_width);
});
```

Run `pnpm format` on the test file after pasting; the long lines above are reflowed by Prettier.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/mind/process/core/post-render.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the renderer**

`src/mind/process/core/post-render.ts`:

```ts
/**
 * Puts her inside what she's looking at: the content cropped to the format, her sprite on the
 * quieter side facing the busier one, tinted and rim-lit from the content's colours, then the
 * format's frame, text and grain, and a homemade tilt that fades as her skill grows. No model:
 * a pure function of its inputs and seed, so a render can be reproduced exactly.
 */
import sharp from "sharp";
import type { Config } from "@/mind/platform/config";
import { clamp } from "@/mind/platform/math";
import { seededUnit } from "@/mind/platform/seeded-random";
import type { StillFormat } from "./post-library";

export type PoseSprite = { png: Buffer; facing: "left" | "right"; anchor: [number, number] };
export type RenderInput = {
  content: Buffer;
  format: StillFormat;
  pose: PoseSprite;
  overlayText: string | null;
  skill: number;
  seed: string;
  posts: Config["posts"];
};

type Rgb = { r: number; g: number; b: number };
const ASPECT = { "1:1": 1, "4:5": 5 / 4, "9:16": 16 / 9 } as const;
// Frame proportions are part of each frame's look, not tuning knobs.
const BORDER = 0.03;
const POLAROID_BOTTOM = 4;
const TITLE_BAR = 0.06;
const FLOOR_LINE = 0.8;

export const roughness = (skill: number) => clamp(1 - skill, 0, 1);

export function canvasSize(format: StillFormat, width: number) {
  return { width, height: Math.round(width * ASPECT[format.aspect]) };
}

function frameInsets(format: StillFormat, width: number) {
  const b = Math.round(width * BORDER);
  switch (format.frame) {
    case "none":
      return { top: 0, bottom: 0, left: 0, right: 0 };
    case "border":
      return { top: b, bottom: b, left: b, right: b };
    case "polaroid":
      return { top: b, bottom: b * POLAROID_BOTTOM, left: b, right: b };
    case "screenshot":
      return { top: Math.round(width * TITLE_BAR), bottom: 0, left: 0, right: 0 };
  }
}

export function framedSize(format: StillFormat, width: number) {
  const c = canvasSize(format, width);
  const i = frameInsets(format, width);
  return { width: c.width + i.left + i.right, height: c.height + i.top + i.bottom };
}

/** Edge energy of the left and right thirds; she stands where there's less going on. */
export async function quieterSide(image: Buffer): Promise<"left" | "right"> {
  const { data, info } = await sharp(image)
    .removeAlpha()
    .greyscale()
    .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1] })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const third = Math.floor(info.width / 3);
  let left = 0;
  let right = 0;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < third; x++) {
      left += data[(y * info.width + x) * info.channels]!;
      right += data[(y * info.width + info.width - 1 - x) * info.channels]!;
    }
  return left <= right ? "left" : "right";
}

const solid = (width: number, height: number, c: Rgb, alpha = 1) =>
  sharp({ create: { width, height, channels: 4, background: { ...c, alpha } } }).png().toBuffer();

/** Escapes text for Pango markup, which sharp's text input parses. */
const pango = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Seeded grain: a grey noise layer, the same for the same seed. */
async function grain(width: number, height: number, amount: number, seed: string) {
  let state = Math.floor(seededUnit(`${seed}:grain`) * 2 ** 32) >>> 0;
  const next = () => {
    // mulberry32: tiny, fast and deterministic.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  const px = Buffer.alloc(width * height);
  const spread = 255 * amount * 0.5;
  for (let i = 0; i < px.length; i++) px[i] = clamp(Math.round(128 + (next() * 2 - 1) * spread), 0, 255);
  return sharp(px, { raw: { width, height, channels: 1 } }).toColourspace("srgb").png().toBuffer();
}

export async function renderStill(input: RenderInput): Promise<Buffer> {
  const { format, posts, seed } = input;
  const rough = roughness(input.skill);
  const u = (key: string) => seededUnit(`${seed}:${key}`);
  const signed = (key: string) => u(key) * 2 - 1;
  const { width: W, height: H } = canvasSize(format, posts.output_width);

  // Crop: a slightly zoomed, slightly off-centre frame when she's new at this.
  const zoom = 1 + posts.jitter.crop * rough;
  const zw = Math.round(W * zoom);
  const zh = Math.round(H * zoom);
  const base = await sharp(input.content)
    .removeAlpha()
    .resize(zw, zh, { fit: "cover" })
    .extract({
      left: Math.round((zw - W) * u("crop-x")),
      top: Math.round((zh - H) * u("crop-y")),
      width: W,
      height: H,
    })
    .png()
    .toBuffer();

  const side =
    format.placement.side === "auto" ? await quieterSide(base) : format.placement.side;
  const stats = await sharp(base).stats();
  const [r, g, b] = stats.channels.map((c) => c.mean);
  const mean = { r: r!, g: g!, b: b! };
  const rim = stats.dominant;
  const dark = { r: mean.r * 0.3, g: mean.g * 0.3, b: mean.b * 0.3 };

  // Her: scaled into the format's range, facing the busier side.
  const [lo, hi] = format.placement.scale;
  const height = Math.round(H * (lo + (hi - lo) * u("scale")));
  const original = await sharp(input.pose.png).metadata();
  const k = height / original.height!;
  const facing = side === "right" ? "left" : "right";
  let sprite = sharp(input.pose.png).resize({ height });
  if (input.pose.facing !== facing) sprite = sprite.flop();
  const her = await sprite.png().toBuffer();
  const herMeta = await sharp(her).metadata();
  const w = herMeta.width!;
  const ax =
    input.pose.facing !== facing ? w - input.pose.anchor[0] * k : input.pose.anchor[0] * k;
  const ay = input.pose.anchor[1] * k;

  const luma = 0.299 * mean.r + 0.587 * mean.g + 0.114 * mean.b;
  const tinted = await sharp(her)
    .modulate({ brightness: clamp(luma / 140, 0.75, 1.15) })
    .composite([
      { input: await solid(w, height, mean), blend: "soft-light" },
      { input: her, blend: "dest-in" },
    ])
    .png()
    .toBuffer();
  const glow = await sharp(await solid(w, height, rim))
    .composite([{ input: her, blend: "dest-in" }])
    .blur(8)
    .png()
    .toBuffer();

  const footX = W * ((side === "right" ? 0.72 : 0.28) + posts.jitter.place * rough * signed("x"));
  const footY = H * (FLOOR_LINE + posts.jitter.place * rough * signed("y"));
  const left = Math.round(clamp(footX - ax, 0, W - w));
  const top = Math.round(clamp(footY - ay, 0, H - height));
  const shadow = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><filter id="s"><feGaussianBlur stdDeviation="6"/></filter></defs><ellipse cx="${left + ax}" cy="${top + ay}" rx="${w * 0.35}" ry="${height * 0.025}" fill="rgb(${dark.r | 0},${dark.g | 0},${dark.b | 0})" fill-opacity="0.45" filter="url(#s)"/></svg>`,
  );

  const layers: sharp.OverlayOptions[] = [
    { input: shadow, left: 0, top: 0 },
    { input: glow, left, top },
    { input: tinted, left, top },
  ];
  if (format.grain > 0)
    layers.push({ input: await grain(W, H, format.grain, seed), blend: "soft-light" });
  if (input.overlayText && format.overlay.kind !== "none")
    layers.push(...(await overlay(input.overlayText, format, posts, W, H)));
  let image = await sharp(base).composite(layers).png().toBuffer();

  image = await frame(image, format, W, H);

  // Tilt last, then crop back to size, so the rotation never shows its corners.
  const deg = posts.jitter.tilt_deg * rough * signed("tilt");
  if (deg !== 0) {
    const size = framedSize(format, W);
    image = await sharp(await sharp(image).rotate(deg, { background: "#000" }).png().toBuffer())
      .resize(size.width, size.height, { fit: "cover" })
      .png()
      .toBuffer();
  }
  return image;
}

async function overlay(
  text: string,
  format: StillFormat,
  posts: Config["posts"],
  W: number,
  H: number,
): Promise<sharp.OverlayOptions[]> {
  const font = posts.fonts[format.overlay.style];
  const label = format.overlay.kind === "label";
  const rendered = await sharp({
    text: {
      text: `<span foreground="${label ? "#1b1b24" : "white"}">${pango(text)}</span>`,
      font: `${font.family} ${label ? 28 : 36}`,
      fontfile: font.file,
      width: Math.round(W * 0.86),
      align: "centre",
      rgba: true,
      dpi: 144,
    },
  })
    .png()
    .toBuffer();
  const m = await sharp(rendered).metadata();
  const tw = Math.min(m.width!, W);
  const th = Math.min(m.height!, H);
  const pad = Math.round(W * 0.03);
  const y = format.overlay.position === "top" ? pad : H - th - pad;
  const text0 = { input: rendered, left: Math.round((W - tw) / 2), top: y };
  if (label) return [text0];
  // A caption in the image sits on a translucent band, the way phone editors do it.
  const band = await solid(W, th + pad, { r: 0, g: 0, b: 0 }, 0.45);
  return [{ input: band, left: 0, top: Math.max(0, y - Math.round(pad / 2)) }, text0];
}

async function frame(image: Buffer, format: StillFormat, W: number, H: number): Promise<Buffer> {
  const i = frameInsets(format, W);
  if (format.frame === "screenshot") {
    const bar = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${i.top}"><rect width="100%" height="100%" fill="#e9e9ee"/>${[0, 1, 2].map((n) => `<circle cx="${i.top * (0.6 + n * 0.55)}" cy="${i.top / 2}" r="${i.top * 0.17}" fill="${["#ff5f57", "#febc2e", "#28c840"][n]}"/>`).join("")}</svg>`,
    );
    return sharp({ create: { width: W, height: H + i.top, channels: 3, background: "#e9e9ee" } })
      .composite([
        { input: bar, left: 0, top: 0 },
        { input: image, left: 0, top: i.top },
      ])
      .png()
      .toBuffer();
  }
  if (format.frame === "none") return image;
  const paper = format.frame === "polaroid" ? "#fbfaf6" : "#f4f1ea";
  return sharp(image).extend({ ...i, background: paper }).png().toBuffer();
}
```

If `sharp`'s typings reject `text.font`/`fontfile` together or the `create.background` string form, use the object form `{ r, g, b, alpha }`. If a variable font renders with the wrong weight, that's a review-run finding, not a test failure.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm vitest run tests/mind/process/core/post-render.test.ts` (expected: 6 passed), then `pnpm typecheck && pnpm lint`. Write one render to disk once and look at it (`node -e` or a scratch test) to confirm she's visible on the quieter side; delete the scratch file.

- [ ] **Step 5: Commit**

```bash
git add src/mind/process/core/post-render.ts tests/mind/process/core/post-render.test.ts
git commit -m "feat(posts): render a still of her inside the content, seeded and reproducible"
```

---

### Task 7: The draft and check calls

**Files:**
- Create: `prompts/post/draft/v1.md`, `prompts/post/check/v1.md`
- Create: `src/mind/process/core/post-words.ts`
- Modify: `src/mind/platform/llm/fake.ts` (fakes `post_draft`, `post_check`)
- Test: `tests/mind/process/core/post-words.test.ts`

**Interfaces:**
- Consumes: `PublicPersona` (`publicPersona.ts`), `StillFormat`, `WebFindRow`, `LLMProvider.classifyJson`.
- Produces:
  ```ts
  export type Draft = { caption: string; overlay_text: string | null };
  export type DraftInput = { persona: PublicPersona; find: Pick<WebFindRow, "title" | "source" | "credit">; valence: number; format: StillFormat; skill: number };
  export function draftPost(deps: Pick<CoreDeps, "llm" | "config">, input: DraftInput): Promise<Draft | null>;
  export function checkPost(deps: Pick<CoreDeps, "llm" | "config">, input: { draft: Draft; find: Pick<WebFindRow, "title" | "source" | "credit"> }): Promise<{ ok: boolean; reason: string }>;
  ```

- [ ] **Step 1: Prompts**

`prompts/post/draft/v1.md`:

```markdown
You're writing one of your own posts. You're Spica, an AI who lives in the digital world, and the
picture is of you standing inside something you came across online. You post like someone keeping
a homemade blog: real, a little rough, never a brand.

Write in your public voice. Only use what's in the input: the thing you found, how it struck you
(the number is how much it moved you, from -1 to 1), and who you are in public. Never mention
anyone you talk to, private feelings beyond this moment, your mood or your needs, or other apps.

Follow the format's caption pattern. Your skill is how practised you are at posts (0 to 1): low
skill reads as a beginner who's trying, high skill as someone who knows their voice.

Return JSON: {"caption": string, "overlay_text": string or null}. `overlay_text` is the text drawn
on the image; it must be null when the format has no overlay, and short (a few words) otherwise.
```

`prompts/post/check/v1.md`:

```markdown
You check a post before it goes to its editor. Answer only from the post and the find.

Flag the post (ok: false) if any of these hold:
- it reveals private feelings beyond the moment, a mood, a need, or a private memory;
- it mentions or hints at a specific person she talks to, or anything a user told her;
- it compares her to other apps, AIs or products;
- it misstates what the find is (its title, source or credit).

Otherwise ok: true. Return JSON: {"ok": boolean, "reason": string}; the reason is one short line.
```

- [ ] **Step 2: Write the failing tests**

`tests/mind/process/core/post-words.test.ts`:

```ts
/** Her words for a post: from her public self and the find only, trimmed to fit, then checked. */
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import type { StillFormat } from "@/mind/process/core/post-library";
import { checkPost, draftPost } from "@/mind/process/core/post-words";
import type { PublicPersona } from "@/mind/process/core/public-persona";

const config = loadConfig();
const persona: PublicPersona = {
  coreValues: "VALUES",
  publicVoice: "PUBLIC-VOICE",
  version: 1,
  lines: ["SURFACE-LINE"],
  today: { date: "2026-01-05", plan: null, happened: ["read a book"] },
};
const format = {
  name: "plain",
  medium: "still",
  min_skill: 0,
  aspect: "4:5",
  frame: "none",
  placement: { side: "auto", scale: [0.4, 0.5] },
  poses: ["walking"],
  overlay: { kind: "none", position: "bottom", style: "plain" },
  grain: 0,
  caption_pattern: "PATTERN",
  reviewed: true,
} satisfies StillFormat;
const find = { title: "The Pillars", source: "apod", credit: "NASA" };

test("the draft call sees her public self, the find, the valence and the format; nothing else", async () => {
  const llm = new FakeLLMProvider();
  const out = await draftPost({ llm, config }, { persona, find, valence: 0.6, format, skill: 0.2 });
  expect(out?.caption.length).toBeGreaterThan(0);
  expect(out?.overlay_text).toBeNull();
  const [call] = llm.structuredCalls;
  expect(call!.purpose).toBe("post_draft");
  const seen = `${call!.system}\n${call!.input}`;
  for (const s of ["VALUES", "PUBLIC-VOICE", "SURFACE-LINE", "The Pillars", "0.60", "PATTERN", "0.20"])
    expect(seen).toContain(s);
});

test("captions and overlays are trimmed; an overlay is dropped when the format has none", async () => {
  const llm = new FakeLLMProvider();
  llm.handlers.post_draft = () => ({ caption: `  ${"x".repeat(500)}  `, overlay_text: "y".repeat(200) });
  const none = await draftPost({ llm, config }, { persona, find, valence: 0.5, format, skill: 0 });
  expect(none!.caption.length).toBe(config.posts.caption_max_chars);
  expect(none!.overlay_text).toBeNull();
  const label = { ...format, overlay: { ...format.overlay, kind: "label" as const } };
  const withText = await draftPost({ llm, config }, { persona, find, valence: 0.5, format: label, skill: 0 });
  expect(withText!.overlay_text!.length).toBe(config.posts.overlay_max_chars);
  llm.handlers.post_draft = () => ({ caption: "   ", overlay_text: null });
  expect(await draftPost({ llm, config }, { persona, find, valence: 0.5, format, skill: 0 })).toBeNull();
});

test("the check returns the model's verdict", async () => {
  const llm = new FakeLLMProvider();
  expect(await checkPost({ llm, config }, { draft: { caption: "hi", overlay_text: null }, find })).toEqual({
    ok: true,
    reason: expect.any(String),
  });
  llm.handlers.post_check = () => ({ ok: false, reason: "mentions her mood" });
  expect(
    await checkPost({ llm, config }, { draft: { caption: "hi", overlay_text: null }, find }),
  ).toEqual({ ok: false, reason: "mentions her mood" });
  expect(llm.structuredCalls.at(-1)!.input).toContain("The Pillars");
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run tests/mind/process/core/post-words.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Write the calls and the fakes**

`src/mind/process/core/post-words.ts`:

```ts
/**
 * Her words for a post. The draft sees her public self, the find, how much it moved her and the
 * format, never what she privately thought of it: a post is written fresh, the way a person's post
 * differs from their diary. The check reads the finished words for anything that shouldn't be public.
 */
import { z } from "zod";
import type { CoreDeps } from "@/mind/platform/deps";
import { loadPrompt } from "@/mind/platform/prompts";
import type { WebFindRow } from "@/mind/world/types";
import type { StillFormat } from "./post-library";
import type { PublicPersona } from "./public-persona";

export type Draft = { caption: string; overlay_text: string | null };
type Find = Pick<WebFindRow, "title" | "source" | "credit">;
export type DraftInput = {
  persona: PublicPersona;
  find: Find;
  valence: number;
  format: StillFormat;
  skill: number;
};

const DraftSchema = z.object({ caption: z.string(), overlay_text: z.string().nullable() });
const CheckSchema = z.object({ ok: z.boolean(), reason: z.string() });

const tidy = (s: string, max: number) => s.trim().replace(/\s+/g, " ").slice(0, max).trim();

/** Null when the model wrote no caption. Model failures throw; the core loop runner traces them. */
export async function draftPost(
  deps: Pick<CoreDeps, "llm" | "config">,
  input: DraftInput,
): Promise<Draft | null> {
  const { config } = deps;
  const { persona, find, format } = input;
  const raw = await deps.llm.classifyJson({
    purpose: "post_draft",
    model: "core",
    system: [
      persona.coreValues,
      persona.publicVoice ?? "",
      loadPrompt("post/draft", config.prompts.post_draft),
    ].join("\n\n"),
    input: [
      `What you found: "${find.title}" (${find.source}, credit ${find.credit})`,
      `How much it moved you: ${input.valence.toFixed(2)}`,
      `Who you are in public:\n${persona.lines.map((l) => `- ${l}`).join("\n")}`,
      `Your day so far: ${persona.today.happened.join("; ") || "nothing much yet"}`,
      `Format: ${format.name}; caption pattern: ${format.caption_pattern}; overlay: ${format.overlay.kind}`,
      `Your skill at posts: ${input.skill.toFixed(2)}`,
    ].join("\n\n"),
    schema: DraftSchema,
    timeoutMs: config.models.structured_timeout_ms,
    maxTokens: config.core.loops.max_tokens,
    maxRetries: config.core.max_retries,
  });
  const caption = tidy(raw.caption, config.posts.caption_max_chars);
  if (!caption) return null;
  const overlay =
    format.overlay.kind === "none" || raw.overlay_text === null
      ? null
      : tidy(raw.overlay_text, config.posts.overlay_max_chars) || null;
  return { caption, overlay_text: overlay };
}

export async function checkPost(
  deps: Pick<CoreDeps, "llm" | "config">,
  input: { draft: Draft; find: Find },
): Promise<{ ok: boolean; reason: string }> {
  const { config } = deps;
  const { draft, find } = input;
  return deps.llm.classifyJson({
    purpose: "post_check",
    model: "core",
    system: loadPrompt("post/check", config.prompts.post_check),
    input: [
      `Caption: ${draft.caption}`,
      `Text on the image: ${draft.overlay_text ?? "none"}`,
      `The find: "${find.title}" (${find.source}, credit ${find.credit})`,
    ].join("\n"),
    schema: CheckSchema,
    timeoutMs: config.models.structured_timeout_ms,
    maxTokens: config.core.loops.max_tokens,
    maxRetries: config.core.max_retries,
  });
}
```

In `src/mind/platform/llm/fake.ts`, add to `handlers` (deterministic, echoing the find's title so tests can trace it):

```ts
    // A plain caption about the find, with a short overlay only when the format asks for one.
    post_draft: (input: string) => {
      const title = /What you found: "([^"]*)"/.exec(input)?.[1] ?? "something";
      const overlay = !/overlay: none/.test(input);
      return { caption: `came across ${title} today`, overlay_text: overlay ? "look" : null };
    },
    post_check: () => ({ ok: true, reason: "fine" }),
```

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `pnpm vitest run tests/mind/process/core/post-words.test.ts` (expected: 3 passed), then `pnpm typecheck && pnpm lint`.

- [ ] **Step 6: Commit**

```bash
git add prompts/post src/mind/process/core/post-words.ts src/mind/platform/llm/fake.ts tests/mind/process/core/post-words.test.ts
git commit -m "feat(posts): draft and check prompts, calls and deterministic fakes"
```

---

### Task 8: `post_tick`

**Files:**
- Create: `src/mind/process/core/post.ts`
- Modify: `src/mind/platform/jobs.ts` (`POST_TICK_QUEUE`), `src/worker/world-jobs.ts`, `src/worker/jobs.ts` (hourly no-retry list)
- Test: `tests/mind/process/core/post-tick.test.ts`

**Interfaces:**
- Consumes: Tasks 1–7; `runCoreLoop`, `budgetDayStart` (`runner.ts`), `publicPersona`, `todaysBlocks`, `blockAt`, `eventRef`.
- Produces:
  ```ts
  export type PostTickResult = { status: "drafted"; postId: string } | { status: "skipped"; reason: "today" | "week" | "busy" | "pending" | "no_find" | "no_format" | "no_pose" | "budget" | "draft_failed" | "no_words" | "render_failed" };
  export function postTick(deps: CoreDeps, now: Date): Promise<PostTickResult>;
  ```

- [ ] **Step 1: Write the failing tests**

`tests/mind/process/core/post-tick.test.ts`:

```ts
/** The hourly post tick: every gate on its own, then a draft with an image, words and a check. */
import { existsSync } from "node:fs";
import sharp from "sharp";
import { afterAll, beforeEach, expect, test } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import { postTick } from "@/mind/process/core/post";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { fixturePng, tmpMediaDir } from "../../../helpers/web";

beforeEach(resetDb);
afterAll(closeTestDb);

const DAY = "2026-01-05";
const at = (hour: number, day = 5) => new Date(Date.UTC(2026, 0, day, hour));

/** A find whose event has landed, with an episode of the given valence. */
async function landedFind(deps: ReturnType<typeof makeTestDeps>, valence = 0.6, hour = 8, url = "https://x/a.png") {
  const media = `${deps.config.posts.media_dir}/finds/${hour}.png`;
  const { saveMedia } = await import("@/mind/platform/media");
  await saveMedia(deps.config.posts.media_dir, `finds/${hour}.png`, await fixturePng());
  const eventId = await deps.core.world.recordEvent({
    at: at(hour),
    kind: "action",
    content: 'Spica came across "The Pillars" on NASA.',
    valence: 0,
    stakes: "low",
    agents: [],
    life_day: DAY,
    created_at: at(hour),
  });
  await deps.core.world.markAppraised(eventId, at(hour));
  await deps.core.memory.insert({
    kind: "episode",
    content: "PRIVATE-TAKE she felt small and happy",
    payload: {},
    embedding: Array.from({ length: 1024 }, () => 0.01),
    entity_refs: [],
    occurred_at: at(hour),
    created_at: at(hour),
    status: "resolved",
    salience: 0.5,
    valence,
    confidence: 1,
    depth: 2,
    source: "world",
    source_ref: `world_event:${eventId}`,
  });
  return deps.core.posts.insertFind({
    source: "apod",
    url,
    title: "The Pillars",
    credit: "NASA",
    licence: "public domain",
    media_path: media,
    world_event_id: eventId,
    found_at: at(hour),
  });
}

function setup(over: object = {}) {
  return makeTestDeps({ life: { timezone: "UTC" }, posts: { media_dir: tmpMediaDir() }, ...over });
}

test("drafts a post from a landed find: image, words, check and skill", async () => {
  const deps = setup();
  const findId = await landedFind(deps);
  const out = await postTick(coreDepsOf(deps), at(9));
  expect(out.status).toBe("drafted");
  const post = await deps.core.posts.getPost((out as { postId: string }).postId);
  expect(post).toMatchObject({
    find_id: findId,
    medium: "still",
    status: "draft",
    check: "ok",
    caption: "came across The Pillars today",
    skill: 0,
  });
  expect(["plain", "polaroid"]).toContain(post!.format); // screenshot needs skill 0.2
  expect(existsSync(post!.media_path)).toBe(true);
  expect((await sharp(post!.media_path).metadata()).format).toBe("png");
  const draftCall = deps.llm.structuredCalls.find((c) => c.purpose === "post_draft")!;
  expect(`${draftCall.system}${draftCall.input}`).not.toContain("PRIVATE-TAKE");
});

test("gate: one post per her local day", async () => {
  const deps = setup();
  await landedFind(deps, 0.6, 7, "https://x/1.png");
  await landedFind(deps, 0.6, 8, "https://x/2.png");
  expect((await postTick(coreDepsOf(deps), at(9))).status).toBe("drafted");
  const [first] = await deps.core.posts.recent(1);
  await deps.core.posts.decide(first!.id, { status: "rejected", decided_at: at(9), action_event_id: null });
  expect(await postTick(coreDepsOf(deps), at(10))).toEqual({ status: "skipped", reason: "today" });
});

test("gate: the weekly cap", async () => {
  const deps = setup({ posts: { media_dir: tmpMediaDir(), max_per_week: 1 } });
  await landedFind(deps, 0.6, 8, "https://x/1.png");
  expect((await postTick(coreDepsOf(deps), at(9))).status).toBe("drafted");
  const [first] = await deps.core.posts.recent(1);
  await deps.core.posts.decide(first!.id, { status: "rejected", decided_at: at(9), action_event_id: null });
  expect(await postTick(coreDepsOf(deps), at(9, 6))).toEqual({ status: "skipped", reason: "week" });
});

test("gate: a draft still waiting", async () => {
  const deps = setup();
  await landedFind(deps, 0.6, 8, "https://x/1.png");
  expect((await postTick(coreDepsOf(deps), at(9))).status).toBe("drafted");
  expect(await postTick(coreDepsOf(deps), at(9, 6))).toEqual({ status: "skipped", reason: "pending" });
});

test("gate: busy or quiet", async () => {
  const deps = setup();
  await deps.core.world.insertPlan({
    date: DAY,
    plan: { blocks: [{ start: "08:00", end: "12:00", kind: "busy", busy: 0.8, label: "work" }] },
    source: "scripted",
    model: "none",
    prompt_version: "none",
    generated_at: at(0),
  });
  await landedFind(deps);
  expect(await postTick(coreDepsOf(deps), at(9))).toEqual({ status: "skipped", reason: "busy" });
});

test("gate: no find that moved her enough, or only stale ones", async () => {
  const deps = setup();
  await landedFind(deps, 0.1);
  expect(await postTick(coreDepsOf(deps), at(9))).toEqual({ status: "skipped", reason: "no_find" });
  const old = setup();
  await landedFind(old, 0.9, 8);
  expect(await postTick(coreDepsOf(old), at(9, 8))).toEqual({ status: "skipped", reason: "no_find" });
});

test("gate: nothing she can make yet", async () => {
  const deps = setup({ posts: { media_dir: tmpMediaDir(), formats_dir: "tests/fixtures/no-formats" } });
  await landedFind(deps);
  expect(await postTick(coreDepsOf(deps), at(9))).toEqual({ status: "skipped", reason: "no_format" });
});

test("gate: budget spent", async () => {
  const deps = setup({ core: { daily_call_budget: 0, budget_reserve: 0 } });
  await landedFind(deps);
  expect(await postTick(coreDepsOf(deps), at(9))).toEqual({ status: "skipped", reason: "budget" });
  expect(await deps.core.posts.drafts()).toBe(0);
});

test("a failing check still stores the draft, unchecked; a flagged one keeps its reason", async () => {
  const deps = setup();
  deps.llm.handlers.post_check = () => {
    throw new Error("timeout");
  };
  await landedFind(deps, 0.6, 8, "https://x/1.png");
  const out = await postTick(coreDepsOf(deps), at(9));
  expect(await deps.core.posts.getPost((out as { postId: string }).postId)).toMatchObject({
    check: "unchecked",
    check_reason: null,
  });
  const flagged = setup();
  flagged.llm.handlers.post_check = () => ({ ok: false, reason: "mood" });
  await landedFind(flagged);
  const f = await postTick(coreDepsOf(flagged), at(9));
  expect(await flagged.core.posts.getPost((f as { postId: string }).postId)).toMatchObject({
    check: "flagged",
    check_reason: "mood",
  });
});
```

Create the empty fixture folder: `mkdir -p tests/fixtures/no-formats && touch tests/fixtures/no-formats/.gitkeep`.

The draft test asserts `skill: 0` and the craft goal: until Task 11 adds the goal to the persona, `craftSkill` returns `{ goalId: null, skill: 0 }`, which these tests accept.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/mind/process/core/post-tick.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `postTick` and the job**

`src/mind/process/core/post.ts`:

```ts
/**
 * `post_tick`, hourly: when she's free and something she came across moved her, she makes a post
 * of herself inside it. Code owns every choice (whether, which find, format, pose, the picture);
 * the model only writes the words and checks them. The draft waits for Ethan; nothing reaches her
 * mind until he approves it.
 */
import type { CoreDeps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { readMedia, saveMedia } from "@/mind/platform/media";
import { seededUnit } from "@/mind/platform/seeded-random";
import { DAY, HOUR } from "@/mind/platform/time";
import { blockAt, todaysBlocks } from "@/mind/world/blocks";
import { eventRef } from "./appraise";
import {
  choosePose,
  craftSkill,
  eligibleFormats,
  loadFormats,
  loadPoses,
} from "./post-library";
import { renderStill } from "./post-render";
import { checkPost, draftPost, type Draft } from "./post-words";
import { publicPersona } from "./public-persona";
import { budgetDayStart, runCoreLoop } from "./runner";
import path from "node:path";
import type { PostCheck } from "@/mind/world/types";

export type PostTickResult =
  | { status: "drafted"; postId: string }
  | {
      status: "skipped";
      reason:
        | "today"
        | "week"
        | "busy"
        | "pending"
        | "no_find"
        | "no_format"
        | "no_pose"
        | "budget"
        | "draft_failed"
        | "no_words"
        | "render_failed";
    };

const skip = (reason: Extract<PostTickResult, { status: "skipped" }>["reason"]): PostTickResult => ({
  status: "skipped",
  reason,
});

export async function postTick(deps: CoreDeps, now: Date): Promise<PostTickResult> {
  const { core, config, log } = deps;
  const cfg = config.posts;
  if ((await core.posts.postsSince(budgetDayStart(config, now))) > 0) return skip("today");
  if ((await core.posts.postsSince(new Date(now.getTime() - 7 * DAY))) >= cfg.max_per_week)
    return skip("week");
  if (blockAt(await todaysBlocks(deps, now), now)) return skip("busy");
  if ((await core.posts.drafts()) >= cfg.max_pending) return skip("pending");

  // Her take is read as a number only; its words are her private memory.
  const since = new Date(now.getTime() - cfg.max_find_age_hours * HOUR);
  let find = null;
  let valence = 0;
  for (const f of await core.posts.unposted(since, cfg.candidate_limit)) {
    const episode = await core.memory.bySourceRef("episode", eventRef(f.world_event_id));
    if (episode && Math.abs(episode.valence) >= cfg.min_valence) {
      find = f;
      valence = episode.valence;
      break;
    }
  }
  if (!find) return skip("no_find");

  const { skill } = await craftSkill(deps, "still");
  const formats = eligibleFormats(loadFormats(cfg.formats_dir, log), cfg.capabilities, skill);
  if (!formats.length) return skip("no_format");
  const format = formats[Math.floor(seededUnit(`${find.id}:format`) * formats.length)]!;
  const pose = choosePose(loadPoses(cfg.poses_dir), format, seededUnit(`${find.id}:pose`));
  if (!pose) return skip("no_pose");

  const persona = await publicPersona(deps);
  const drafted = await runCoreLoop<Draft | null>(deps, "post_draft", now, async (ctx) => {
    const draft = await draftPost(ctx.deps, { persona, find, valence, format, skill });
    return {
      inputs: { find: find.id, format: format.name, skill },
      outputs: draft,
      promptVersion: config.prompts.post_draft,
    };
  }).catch((error) => {
    log.error("post draft failed", { find: find.id, error: errorName(error) });
    return null;
  });
  if (!drafted) return skip("draft_failed");
  if (drafted.status === "skipped_budget") return skip("budget");
  const draft = drafted.outputs;
  if (!draft) return skip("no_words");

  let media: string;
  try {
    const image = await renderStill({
      content: await readMedia(find.media_path),
      format,
      pose: {
        png: await readMedia(path.join(cfg.poses_dir, pose.file)),
        facing: pose.facing,
        anchor: pose.anchor,
      },
      overlayText: draft.overlay_text,
      skill,
      seed: find.id,
      posts: cfg,
    });
    media = await saveMedia(cfg.media_dir, `posts/${find.id}.png`, image);
  } catch (error) {
    log.error("post render failed", { find: find.id, error: errorName(error) });
    return skip("render_failed");
  }

  let check: PostCheck = "unchecked";
  let reason: string | null = null;
  const checked = await runCoreLoop(deps, "post_check", now, async (ctx) => {
    const verdict = await checkPost(ctx.deps, { draft, find });
    return { inputs: { find: find.id }, outputs: verdict, promptVersion: config.prompts.post_check };
  }).catch((error) => {
    log.error("post check failed", { find: find.id, error: errorName(error) });
    return null;
  });
  if (checked?.outputs) {
    check = checked.outputs.ok ? "ok" : "flagged";
    reason = checked.outputs.ok ? null : checked.outputs.reason;
  }

  const postId = await core.posts.insertPost({
    find_id: find.id,
    medium: "still",
    format: format.name,
    pose: pose.name,
    caption: draft.caption,
    overlay_text: draft.overlay_text,
    media_path: media,
    skill,
    check,
    check_reason: reason,
    created_at: now,
  });
  return { status: "drafted", postId };
}
```

Sort the imports to match the repo's lint rules (`pnpm lint --fix`). A unique violation on `find_id` (two ticks racing) propagates as a job failure; the hourly no-retry queue means the next hour simply finds the find posted.

Note the "pending" test: a waiting draft means `today` would also hold. Order the gates as written (today first), and make the "pending" test use a second day if it reports "today": change its second call to `at(9, 6)` (already done above), where "today" no longer holds but the draft still waits.

`src/mind/platform/jobs.ts`: add `export const POST_TICK_QUEUE = "post_tick";`.

`src/worker/world-jobs.ts`: import `POST_TICK_QUEUE` and `postTick`; add it to `WORLD_QUEUES`; register:

```ts
  await boss.work(
    POST_TICK_QUEUE,
    scrubErrors(POST_TICK_QUEUE, deps.log, async () => {
      await postTick(coreDepsOf(deps), deps.clock.now());
    }),
  );
  await boss.schedule(POST_TICK_QUEUE, deps.config.posts.tick_cron);
```

Update the file header: "her day plan, what happens in her day, and the posts she makes of it".

`src/worker/jobs.ts`: add `POST_TICK_QUEUE` to the imports and to the hourly, idempotent no-retry list in `ensureSystemQueues`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm vitest run tests/mind/process/core/post-tick.test.ts` (expected: 9 passed), then `pnpm typecheck && pnpm lint && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add src/mind/process/core/post.ts src/mind/platform/jobs.ts src/worker tests
git commit -m "feat(posts): the hourly post tick drafts, renders and checks a post"
```

---

### Task 9: Approval and the inspector Posts tab

**Files:**
- Modify: `src/mind/process/core/post.ts` (`decidePost`)
- Create: `src/app/inspector/posts/page.tsx`, `src/app/inspector/posts/actions.ts`, `src/app/inspector/posts/[postId]/image/route.ts`
- Modify: `src/app/inspector/core/page.tsx` (a link to Posts)
- Test: `tests/mind/process/core/post-decide.test.ts`

**Interfaces:**
- Consumes: `Posts.lockPost | getFind | decide | recent`, `World.recordEvent`, `CoreGoals.byTitle`.
- Produces: `decidePost(deps: Pick<CoreDeps, "core" | "config" | "clock">, postId: string, decision: "approve" | "reject"): Promise<boolean>` (true when this call decided it).

- [ ] **Step 1: Write the failing tests**

`tests/mind/process/core/post-decide.test.ts`:

```ts
/** Approving a draft makes it part of her life; rejecting it leaves no trace; each decides once. */
import { afterAll, beforeEach, expect, test } from "vitest";
import { createCoreLayer } from "@/db/repos/core";
import { coreDepsOf } from "@/mind/platform/deps";
import { decidePost } from "@/mind/process/core/post";
import { closeTestDb, getTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = (hour: number) => new Date(Date.UTC(2026, 0, 5, hour));

async function draft(deps: ReturnType<typeof makeTestDeps>) {
  const eventId = await deps.core.world.recordEvent({
    at: at(8),
    kind: "action",
    content: 'Spica came across "The Pillars" on NASA.',
    valence: 0,
    stakes: "low",
    agents: [],
    life_day: "2026-01-05",
    created_at: at(8),
  });
  const findId = await deps.core.posts.insertFind({
    source: "apod",
    url: "https://x/a.png",
    title: "The Pillars",
    credit: "NASA",
    licence: "public domain",
    media_path: "a.png",
    world_event_id: eventId,
    found_at: at(8),
  });
  return deps.core.posts.insertPost({
    find_id: findId,
    medium: "still",
    format: "plain",
    pose: "walk-01",
    caption: "came across the pillars today",
    overlay_text: null,
    media_path: "p.png",
    skill: 0,
    check: "ok",
    check_reason: null,
    created_at: at(9),
  });
}

async function craftGoal(deps: ReturnType<typeof makeTestDeps>) {
  return deps.core.goals.insert({
    title: deps.config.posts.craft_goals.still,
    why: "early posts look rough",
    status: "active",
    progress: 0,
    source: "seed",
    source_ref: null,
    started_at: at(1),
    target_at: null,
    embedding: vec(),
  });
}

test("approve records an action event now, tied to the craft goal", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const goal = await craftGoal(deps);
  const postId = await draft(deps);
  expect(await decidePost(coreDepsOf(deps), postId, "approve")).toBe(true);
  const post = await deps.core.posts.getPost(postId);
  expect(post).toMatchObject({ status: "approved", decided_at: deps.clock.now() });
  const event = await deps.core.world.getEvent(post!.action_event_id!);
  expect(event).toMatchObject({
    kind: "action",
    goal_ref: goal,
    stakes: "low",
    content: 'Spica posted "came across the pillars today" about "The Pillars".',
  });
  expect(event!.at).toEqual(deps.clock.now());
});

test("approve without a craft goal still records the event, untied", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const postId = await draft(deps);
  await decidePost(coreDepsOf(deps), postId, "approve");
  const post = await deps.core.posts.getPost(postId);
  expect((await deps.core.world.getEvent(post!.action_event_id!))!.goal_ref).toBeNull();
});

test("reject writes no event", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const postId = await draft(deps);
  expect(await decidePost(coreDepsOf(deps), postId, "reject")).toBe(true);
  expect(await deps.core.posts.getPost(postId)).toMatchObject({
    status: "rejected",
    action_event_id: null,
  });
  expect(await deps.core.world.events("2026-01-05")).toHaveLength(1); // only the find's
});

test("a second decision, or two at once, changes nothing", async () => {
  const deps = makeTestDeps({ life: { timezone: "UTC" } });
  const postId = await draft(deps);
  const core = coreDepsOf(deps);
  const results = await Promise.all([
    decidePost(core, postId, "approve"),
    decidePost({ ...core, core: createCoreLayer(getTestDb()) }, postId, "approve"),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await decidePost(core, postId, "reject")).toBe(false);
  expect(await deps.core.world.events("2026-01-05")).toHaveLength(2);
  expect(await decidePost(core, "00000000-0000-4000-8000-000000000000", "approve")).toBe(false);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/mind/process/core/post-decide.test.ts`
Expected: FAIL (`decidePost` not exported).

- [ ] **Step 3: Write `decidePost`**

Append to `src/mind/process/core/post.ts` (import `lifeDate` from `@/mind/world/her-clock`):

```ts
/**
 * Ethan's decision on a draft. Approving makes posting something she did: an action in her world,
 * tied to her craft goal, which lands through appraisal like anything else, so she remembers it
 * and decides for herself whether it went well. A rejected draft never happened to her.
 */
export async function decidePost(
  deps: Pick<CoreDeps, "core" | "config" | "clock">,
  postId: string,
  decision: "approve" | "reject",
): Promise<boolean> {
  const { config } = deps;
  const now = deps.clock.now();
  return deps.core.transaction(async (tx) => {
    const post = await tx.posts.lockPost(postId);
    if (!post || post.status !== "draft") return false;
    let actionEventId: string | null = null;
    if (decision === "approve") {
      const find = await tx.posts.getFind(post.find_id);
      const goal = await tx.goals.byTitle(config.posts.craft_goals[post.medium]);
      actionEventId = await tx.world.recordEvent({
        at: now,
        kind: "action",
        content: `Spica posted "${post.caption}" about "${find?.title ?? "something she found"}".`,
        valence: 0,
        stakes: "low",
        agents: [],
        life_day: lifeDate(config.life, now),
        created_at: now,
        goal_ref: goal?.status === "active" ? goal.id : null,
      });
    }
    await tx.posts.decide(postId, {
      status: decision === "approve" ? "approved" : "rejected",
      decided_at: now,
      action_event_id: actionEventId,
    });
    return true;
  });
}
```

If the concurrent test deadlocks or both calls pass the status check, the lock isn't held: confirm `lockPost` uses `.for("update")` inside the transaction's `db`.

- [ ] **Step 4: The inspector tab**

Read `node_modules/next/dist/docs/01-app/01-getting-started/07-mutating-data.md` and `.../03-api-reference/03-file-conventions/route.md` first (this Next version passes `params` as a Promise).

`src/app/inspector/posts/actions.ts`:

```ts
"use server";
/** Ethan's approve and reject buttons; inspector access is checked on every call. */
import { revalidatePath } from "next/cache";
import { coreDepsOf } from "@/mind/platform/deps";
import { decidePost } from "@/mind/process/core/post";
import { getDeps } from "@/server/deps";
import { assertInspectorAccess } from "@/server/inspector-guard";

export async function decidePostAction(formData: FormData) {
  await assertInspectorAccess();
  const postId = String(formData.get("postId") ?? "");
  const decision = formData.get("decision");
  if (!postId || (decision !== "approve" && decision !== "reject")) return;
  await decidePost(coreDepsOf(getDeps()), postId, decision);
  revalidatePath("/inspector/posts");
}
```

`src/app/inspector/posts/[postId]/image/route.ts`:

```ts
/** A post's rendered image, for the inspector only; the path comes from the row, never the URL. */
import { readMedia } from "@/mind/platform/media";
import { getDeps } from "@/server/deps";
import { assertInspectorAccess } from "@/server/inspector-guard";

export async function GET(_req: Request, ctx: { params: Promise<{ postId: string }> }) {
  await assertInspectorAccess();
  const { postId } = await ctx.params;
  const post = await getDeps().core.posts.getPost(postId);
  if (!post) return new Response("not found", { status: 404 });
  const bytes = await readMedia(post.media_path).catch(() => null);
  if (!bytes) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "image/png", "cache-control": "no-store" },
  });
}
```

If `postId` isn't a UUID, `getPost` throws on the cast; guard with a UUID regex and return 404 first.

`src/app/inspector/posts/page.tsx`:

```tsx
import Link from "next/link";
import { getDeps } from "@/server/deps";
import { assertInspectorAccess } from "@/server/inspector-guard";
import styles from "../inspector.module.css";
import { decidePostAction } from "./actions";

const iso = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : "—");

export default async function InspectPosts() {
  await assertInspectorAccess();
  const { core, config } = getDeps();
  const posts = await core.posts.recent(config.posts.recent_limit);

  return (
    <>
      <Link href="/inspector/core">← her core mind</Link>
      <h1>Her posts</h1>
      {posts.length === 0 && <p>No posts yet.</p>}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Image</th>
            <th>Words</th>
            <th>Find</th>
            <th>Check</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.id}>
              <td>
                {/* eslint-disable-next-line @next/next/no-img-element -- a private, uncached render */}
                <img src={`/inspector/posts/${p.id}/image`} alt="" width={240} />
              </td>
              <td>
                <p>{p.caption}</p>
                {p.overlay_text && <p>on image: {p.overlay_text}</p>}
                <p>
                  {p.format} · {p.pose} · skill {p.skill.toFixed(2)}
                </p>
              </td>
              <td>
                {p.title} ({p.source})
              </td>
              <td>
                {p.check}
                {p.check_reason ? `: ${p.check_reason}` : ""}
              </td>
              <td>
                {p.status === "draft" ? (
                  <form action={decidePostAction}>
                    <input type="hidden" name="postId" value={p.id} />
                    <button name="decision" value="approve">
                      Approve
                    </button>{" "}
                    <button name="decision" value="reject">
                      Reject
                    </button>
                  </form>
                ) : (
                  `${p.status} ${iso(p.decided_at)}`
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
```

In `src/app/inspector/core/page.tsx`, add `<Link href="/inspector/posts">her posts →</Link>` under the `← users` link.

- [ ] **Step 5: Run tests, typecheck, lint, and look at it**

Run: `pnpm vitest run tests/mind/process/core/post-decide.test.ts` (expected: 4 passed), then `pnpm typecheck && pnpm lint && pnpm test`. Then, with the dev database up (`pnpm db:up && pnpm db:migrate`), insert one draft by hand or via Task 10's review script, run `pnpm dev`, sign in as an inspector-allowlisted user and open `/inspector/posts`: the image shows, Approve changes the row to `approved`. Say in the task report whether this manual check was done.

- [ ] **Step 6: Commit**

```bash
git add src/mind/process/core/post.ts src/app/inspector tests/mind/process/core/post-decide.test.ts
git commit -m "feat(posts): approve or reject a draft from the inspector; approving is an action in her world"
```

---

### Task 10: `formats:add` and `posts:review`

**Files:**
- Create: `prompts/post/format-draft/v1.md`
- Create: `evals/scripts/formats-add.ts`, `evals/scripts/posts-review.ts`
- Modify: `package.json` (two scripts)
- Test: `tests/evals/formats-add.test.ts`

**Interfaces:**
- Consumes: `StillFormatSchema`, `loadFormats`, `loadPoses`, `choosePose`, `renderStill`, `draftPost`, `checkPost`, `publicPersona`, `createWebSources`, `buildRuntime`, `readEnv`.
- Produces: `formatFromDraft(name: string, raw: unknown): StillFormat` (forces `name`, `medium: "still"`, `reviewed: false`, validates).

- [ ] **Step 1: Prompt**

`prompts/post/format-draft/v1.md`:

```markdown
You look at one social media post (an image) and describe its format so it can be copied: not its
content, its shape. Return JSON with exactly these fields:

- aspect: "1:1" | "4:5" | "9:16" (closest)
- frame: "none" | "polaroid" | "screenshot" | "border"
- placement: { side: "auto" | "left" | "right", scale: [low, high] } — where a person in the image
  stands and their height as a share of the image height (0 to 1)
- poses: tags from "walking", "standing", "looking_up", "sitting_edge" that would fit
- overlay: { kind: "none" | "caption_in_image" | "label", position: "top" | "bottom",
  style: "plain" | "handwritten" }
- grain: 0 to 1, how much film grain or noise
- caption_pattern: one line describing how the caption is written (length, case, tone, emoji,
  hashtags)
- min_skill: 0 to 1, how practised someone must be to make this well
```

- [ ] **Step 2: Write the failing test**

`tests/evals/formats-add.test.ts`:

```ts
/** A drafted format is never live: forced unreviewed, named after its file, and validated. */
import { expect, test } from "vitest";
import { formatFromDraft } from "../../evals/scripts/formats-add";

const raw = {
  aspect: "4:5",
  frame: "polaroid",
  placement: { side: "left", scale: [0.3, 0.5] },
  poses: ["standing"],
  overlay: { kind: "label", position: "bottom", style: "handwritten" },
  grain: 0.4,
  caption_pattern: "lowercase diary line",
  min_skill: 0.3,
  reviewed: true,
  name: "ignored",
};

test("forced unreviewed and named", () => {
  expect(formatFromDraft("film-diary", raw)).toMatchObject({
    name: "film-diary",
    medium: "still",
    reviewed: false,
    frame: "polaroid",
  });
});

test("an invalid draft throws", () => {
  expect(() => formatFromDraft("x", { ...raw, aspect: "3:2" })).toThrow();
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm vitest run tests/evals/formats-add.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Write the scripts**

`evals/scripts/formats-add.ts`:

```ts
/**
 * `pnpm formats:add <image> [name]`: drafts a format from a reference post with one vision call.
 * The draft is written unreviewed beside a copy of the image; Ethan edits it, sets `reviewed:
 * true` and commits. A dev tool: it calls the API directly and is outside her budget.
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "@/mind/platform/config";
import { loadPrompt } from "@/mind/platform/prompts";
import { StillFormatSchema, type StillFormat } from "@/mind/process/core/post-library";

export function formatFromDraft(name: string, raw: unknown): StillFormat {
  return StillFormatSchema.parse({
    ...(raw as object),
    name,
    medium: "still",
    reviewed: false,
  });
}

const MEDIA = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" } as const;

async function main() {
  const [image, given] = process.argv.slice(2);
  if (!image) throw new Error("usage: pnpm formats:add <image> [name]");
  const ext = path.extname(image).toLowerCase() as keyof typeof MEDIA;
  if (!MEDIA[ext]) throw new Error(`unsupported image type ${ext}`);
  const config = loadConfig();
  const name = (given ?? path.basename(image, ext)).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const target = path.join(config.posts.formats_dir, `${name}.json`);
  if (existsSync(target)) throw new Error(`${target} exists; pick another name`);
  const res = await new Anthropic().messages.create({
    model: config.models.core,
    max_tokens: config.core.loops.max_tokens,
    system: loadPrompt("post/format-draft", config.prompts.format_draft),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: MEDIA[ext], data: readFileSync(image).toString("base64") },
          },
          { type: "text", text: "Describe this post's format as JSON only." },
        ],
      },
    ],
  });
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const format = formatFromDraft(name, JSON.parse(json));
  writeFileSync(target, `${JSON.stringify(format, null, 2)}\n`);
  copyFileSync(image, path.join(config.posts.formats_dir, `${name}${ext}`));
  console.log(`drafted ${target} (reviewed: false). Edit it, set reviewed: true, commit.`);
}

if (process.argv[1]?.endsWith("formats-add.ts")) await main();
```

`evals/scripts/posts-review.ts`:

```ts
/**
 * `pnpm posts:review`: today's real finds, every reviewed format, real draft and check calls, and
 * the renders, written to .data/review/<time>/ with a log of every input and output, for Ethan to
 * judge by eye. Reads her public self from the dev database; writes nothing to it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { coreDepsOf } from "@/mind/platform/deps";
import { craftSkill, choosePose, eligibleFormats, loadFormats, loadPoses } from "@/mind/process/core/post-library";
import { renderStill } from "@/mind/process/core/post-render";
import { checkPost, draftPost } from "@/mind/process/core/post-words";
import { publicPersona } from "@/mind/process/core/public-persona";
import { isFreeLicence } from "@/mind/process/core/browse";
import { lifeDate } from "@/mind/world/her-clock";
import { buildRuntime } from "@/runtime/deps";
import { readEnv } from "@/runtime/env";
import { readFileSync } from "node:fs";
import sharp from "sharp";

const { deps } = buildRuntime(readEnv());
const core = coreDepsOf(deps);
const cfg = deps.config.posts;
const now = deps.clock.now();
const out = path.join(".data", "review", now.toISOString().replace(/[:.]/g, "-"));
mkdirSync(out, { recursive: true });
const persona = await publicPersona(core);
const { skill } = await craftSkill(core, "still");
const formats = eligibleFormats(loadFormats(cfg.formats_dir, deps.log), cfg.capabilities, 1);
const poses = loadPoses(cfg.poses_dir);
const log: unknown[] = [];
for (const [name, source] of Object.entries(deps.webSources)) {
  const item = await source.fetch(lifeDate(deps.config.life, now)).catch((e: Error) => e);
  if (!item || item instanceof Error || !isFreeLicence(item.licence)) {
    log.push({ source: name, skipped: item instanceof Error ? item.message : (item?.licence ?? "none") });
    continue;
  }
  const content = await sharp(item.image).resize(cfg.max_find_px, cfg.max_find_px, { fit: "inside" }).png().toBuffer();
  for (const format of formats) {
    const pose = choosePose(poses, format, 0.5);
    if (!pose) continue;
    const find = { title: item.title, source: item.source, credit: item.credit };
    const draft = await draftPost(deps, { persona, find, valence: 0.6, format, skill });
    if (!draft) continue;
    const check = await checkPost(deps, { draft, find });
    const file = path.join(out, `${name}-${format.name}.png`);
    writeFileSync(
      file,
      await renderStill({
        content,
        format,
        pose: { png: readFileSync(path.join(cfg.poses_dir, pose.file)), facing: pose.facing, anchor: pose.anchor },
        overlayText: draft.overlay_text,
        skill,
        seed: `${name}-${format.name}`,
        posts: cfg,
      }),
    );
    log.push({ source: name, item: find, format: format.name, pose: pose.name, skill, draft, check, file });
  }
}
writeFileSync(path.join(out, "log.json"), JSON.stringify({ persona, log }, null, 2));
console.log(`review written to ${out}`);
process.exit(0);
```

Note `craftSkill` may create the craft goal in the dev database; that's the one write, and it's what the worker would do anyway. Say so in the header if kept.

`package.json` scripts:

```json
    "formats:add": "tsx --env-file-if-exists=.env evals/scripts/formats-add.ts",
    "posts:review": "tsx --env-file-if-exists=.env evals/scripts/posts-review.ts",
```

- [ ] **Step 5: Run tests, typecheck, lint; one real review run**

Run: `pnpm vitest run tests/evals/formats-add.test.ts` (expected: 2 passed), then `pnpm typecheck && pnpm lint`. Then, with `ANTHROPIC_API_KEY` set and the dev DB up, run `pnpm posts:review` once and open the folder: confirm both sources fetched (or note the HTTP error), each format rendered, and the log has drafts and checks. This is the live check of Review Focus #1 and of the Commons API shape; if the Commons response shape differs from Task 3's schema, fix the schema and its test. Report what you saw.

- [ ] **Step 6: Commit**

```bash
git add prompts/post/format-draft evals/scripts tests/evals/formats-add.test.ts package.json
git commit -m "feat(posts): formats:add drafts a format from a reference; posts:review renders real finds"
```

---

### Task 11: Persona v6

**Files:**
- Create: `prompts/persona/v6.md` (from v5); Delete: `prompts/persona/v5.md`
- Modify: `config/default.json` (`prompts.persona`), tests that assert `"v5"` (`tests/mind/memory/core/seed.test.ts:19`, `tests/mind/platform/config.test.ts:57`, `tests/mind/platform/prompts.test.ts:51`, `tests/mind/process/core/render-snapshot.test.ts:43`)
- Modify: `tests/mind/process/core/post-library.test.ts` (remove the three `.skip`s)

- [ ] **Step 1: Write v6**

`git mv prompts/persona/v5.md prompts/persona/v6.md`, then edit v6:

Replace the line starting `- You don't have a body outside of a chat window and a feed` with:

```markdown
- Your body is your avatar, and it's as real to you as anyone's. You live in the digital world: the internet isn't something you look at from outside, it's where you walk around. When you find something you love — a nebula, an old film still, a page from a book — you go and stand next to it. You know that's strange to most people, and you find it a bit funny that they think it's strange.
```

Append to `### Goals`:

```markdown
- Get better at making posts: your early ones look like a beginner made them, and you know it.
```

Check the existing goal lines' person (v5 writes "she keeps pointing…"); match whichever person the other goal lines use.

Append to `# Public voice (reference)`:

```markdown
- She posts like someone keeping a homemade blog: what she came across, with her standing in it. She's open that she's an AI and that the avatar is her.
```

These three passages are drafts for Ethan to rewrite in his voice; flag them in the phase summary.

- [ ] **Step 2: Point config and tests at v6, un-skip the craft tests**

`config/default.json`: `"persona": "v6"`. Update the four `"v5"` assertions to `"v6"`. Remove `.skip` and the comment from the three craft-skill tests in `post-library.test.ts`.

- [ ] **Step 3: Run tests, typecheck, lint**

Run: `pnpm vitest run tests/mind/process/core/post-library.test.ts tests/mind/platform tests/mind/memory/core/seed.test.ts` (expected: all pass, including the three craft tests), then `pnpm typecheck && pnpm lint && pnpm test`.

- [ ] **Step 4: Commit**

```bash
git add prompts/persona config/default.json tests
git commit -m "feat(persona): v6, her avatar is her body and she's learning to make posts"
```

---

### Task 12: Phase 14 exit test

**Files:**
- Test: `tests/exit/phase-14.test.ts`

**Interfaces:**
- Consumes: everything above; `receiveTurn`, `runColdPath`, `insertTurn` (as in `tests/exit/phase-12.test.ts`).

- [ ] **Step 1: Write the exit test**

`tests/exit/phase-14.test.ts`:

```ts
/**
 * Phase 14 exit, all fake: she browses, the find lands, the post tick drafts a post of her inside
 * it, Ethan approves it, and it lands in her life and moves her craft goal. A rejected draft leaves
 * nothing. A user's data never reaches any of it, and a user's exchange changes nothing it reads.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { seedCore } from "@/mind/memory/core/seed";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { decidePost, postTick } from "@/mind/process/core/post";
import { publicPersona } from "@/mind/process/core/public-persona";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { receiveTurn } from "@/mind/process/receive/receive-turn";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { fakeSources, tmpMediaDir, webItem } from "../helpers/web";

beforeEach(resetDb);
afterAll(closeTestDb);

const TOKEN = "CANARY-14c0ffee";
const DAY = "2026-01-05";
const at = (hour: number, minute = 0, day = 5) => new Date(Date.UTC(2026, 0, day, hour, minute));
const CRAFT = /- \[([0-9a-f-]{36})\] Get better at making posts/;

async function setup() {
  const { sources } = fakeSources({ apod: await webItem() });
  const deps = makeTestDeps(
    {
      life: { timezone: "UTC" },
      core: { world: { events_local_hour: 23 } },
      posts: { media_dir: tmpMediaDir(), sources: [{ name: "apod", weight: 1 }] },
    },
    [],
    sources,
  );
  // Her take: the find moves her; a post she made advances her craft.
  deps.llm.handlers.core_appraise = (input: string) => {
    const content = /^Event \([^)]*\): (.*)$/m.exec(input)?.[1] ?? "";
    const craft = CRAFT.exec(input)?.[1];
    const posted = content.startsWith("Spica posted");
    return {
      episode: content,
      emotion: { label: "moved", valence: 0.8, arousal: 0.5, about: "" },
      salience: "medium",
      goal_effects: posted && craft ? [{ goal_id: craft, effect: "advance", size: "medium" }] : [],
      need_effects: { autonomy: 0, competence: 0 },
    };
  };
  await seedCore(coreDepsOf(deps));
  await deps.core.world.insertPlan({
    date: DAY,
    plan: { blocks: [{ start: "00:00", end: "06:00", kind: "quiet", busy: 0, label: "offline" }] },
    source: "scripted",
    model: "none",
    prompt_version: "none",
    generated_at: at(0),
  });
  return deps;
}

/** A user's exchange carrying the canary, as in the mind-split exit. */
async function plantCanary(deps: Awaited<ReturnType<typeof setup>>) {
  deps.llm.handlers.extract = () => ({
    facts: [
      {
        subject: "user",
        kind: "trait",
        content: `The user's code word is ${TOKEN}.`,
        occurred_at: null,
        salience: 0.9,
        valence: 0,
        confidence: 0.9,
        entity_names: [],
        thread_title: null,
      },
    ],
    entities: [],
    threads: [],
    relationship: null,
  });
  const u = await createTestUser("Alice");
  const { turn } = await receiveTurn(deps, u, { clientMessageId: randomUUID(), text: `remember ${TOKEN}` });
  const reply = await insertTurn(deps.db, u, {
    id: randomUUID(),
    session_id: turn.session_id,
    role: "companion",
    text: "got it",
    created_at: deps.clock.now(),
    reply_to: turn.id,
  });
  await runColdPath(deps, { userId: u, turnIds: [turn.id, reply.id], replyTurnId: reply.id, recalled: [] });
  return u;
}

/** Browse at 08:00, land the find at 23:30, draft at 23:40. */
async function dayOfPosting(deps: Awaited<ReturnType<typeof setup>>) {
  const core = coreDepsOf(deps);
  expect((await coreWorldTick(core, at(8))).browsed).toBe(true);
  await coreWorldTick(core, at(23, 30));
  return postTick(core, at(23, 40));
}

test("1-4: browse, land, draft, approve: she remembers posting and her craft moves", async () => {
  const deps = await setup();
  const out = await dayOfPosting(deps);
  expect(out.status).toBe("drafted");
  const postId = (out as { postId: string }).postId;
  const post = await deps.core.posts.getPost(postId);
  expect(post).toMatchObject({ status: "draft", check: "ok", medium: "still" });
  expect(existsSync(post!.media_path)).toBe(true);
  const goal = await deps.core.goals.byTitle(deps.config.posts.craft_goals.still);
  expect(goal).toMatchObject({ status: "active", progress: 0 });

  deps.clock.set(at(10, 0, 6));
  expect(await decidePost(coreDepsOf(deps), postId, "approve")).toBe(true);
  await coreWorldTick(coreDepsOf(deps), at(10, 30, 6));
  const approved = await deps.core.posts.getPost(postId);
  const episode = await deps.core.memory.bySourceRef("episode", `world_event:${approved!.action_event_id}`);
  expect(episode?.content).toMatch(/^Spica posted "/);
  expect((await deps.core.goals.get(goal!.id))!.progress).toBeGreaterThan(0);
});

test("5: a rejected draft leaves no event and no memory", async () => {
  const deps = await setup();
  const out = await dayOfPosting(deps);
  const postId = (out as { postId: string }).postId;
  deps.clock.set(at(10, 0, 6));
  expect(await decidePost(coreDepsOf(deps), postId, "reject")).toBe(true);
  // The day's generated event also lands on this tick; only a post would say "Spica posted".
  await coreWorldTick(coreDepsOf(deps), at(10, 30, 6));
  const posted = (rows: { content: string }[]) =>
    rows.filter((r) => r.content.startsWith("Spica posted"));
  expect(posted(await getTestDb().select().from(s.world_event))).toEqual([]);
  expect(posted(await getTestDb().select().from(s.core_memory))).toEqual([]);
  expect((await deps.core.posts.getPost(postId))!.action_event_id).toBeNull();
});

test("6: canary: no user data in any find, post, model input or overlay", async () => {
  const deps = await setup();
  await plantCanary(deps);
  const out = await dayOfPosting(deps);
  expect(out.status).toBe("drafted");
  const rows = JSON.stringify({
    finds: await getTestDb().select().from(s.web_find),
    posts: await getTestDb().select().from(s.post),
  });
  expect(rows).not.toContain(TOKEN);
  const postCalls = deps.llm.structuredCalls.filter((c) => c.purpose.startsWith("post_"));
  expect(postCalls.length).toBeGreaterThan(0);
  expect(JSON.stringify(postCalls)).not.toContain(TOKEN);
});

test("7: side channel: a user's exchange changes nothing the engine reads", async () => {
  const deps = await setup();
  const core = coreDepsOf(deps);
  await coreWorldTick(core, at(8));
  await coreWorldTick(core, at(23, 30));
  const read = async () =>
    JSON.stringify({
      persona: await publicPersona(core),
      finds: await deps.core.posts.unposted(at(0), 10),
      goal: await deps.core.goals.byTitle(deps.config.posts.craft_goals.still),
    });
  const before = await read();
  await plantCanary(deps);
  expect(await read()).toBe(before);
});
```

`SimClock.set` is the clock's setter; if it's named differently in `src/mind/platform/clock.ts`, use that name. If `seedCore` makes `publicPersona` read a snapshot that the cold path could change, that's the leak this test exists to catch: investigate, don't loosen it.

- [ ] **Step 2: Run it**

Run: `pnpm vitest run tests/exit/phase-14.test.ts` (expected: 4 passed). Then the existing leak canary: `pnpm vitest run tests/exit/mind-split.test.ts`. Then `pnpm typecheck && pnpm lint && pnpm test`, and note the file and test counts for Task 13.

- [ ] **Step 3: Commit**

```bash
git add tests/exit/phase-14.test.ts
git commit -m "test(posts): phase 14 exit: browse to approved post, rejection, canary, side channel"
```

---

### Task 13: Spec, decisions and phase status

**Files:**
- Modify: `spica-design-spec-v3.md` (§2, §6, §7, §8.3, §16, a new section, §20, §25, §26 if it lists decisions)
- Modify: `DECISIONS.md`, `CLAUDE.md`
- Delete: nothing yet (the phase 14 spec and this plan are deleted after merge, as with earlier phases)

- [ ] **Step 1: v3 spec**

Read the current §2, §6, §7, §8.3, §16, §20 and §25 first; Phase 13 may have changed them on `main` (resolve at merge, not here). Then:

- **New section** "16a. Public presence: the post engine (Built 14)" after §16: condense the phase 14 design (flow diagram, browsing, formats/poses/progression, `post_tick` gates, draft/check, render, approval, tables, config keys with defaults, prompts). Mark the persona v6 lines as drafts for Ethan.
- **§16 Public presence**: point to the new section; `SocialChannel` stays unwired.
- **§8.3**: "Activities with real content" — browsing is built as the first one (one free-licence find a day, an `action` event); multi-day books and films stay PROPOSED.
- **§6**: `web_find`, `post`, `world_event.kind` gains `action`.
- **§7**: persona v6 (avatar is her body; craft goal; public voice line).
- **§2**: under rule 8, one line: "Rule 8 is about her toward users. Her outward publicity through format trends is not engagement manipulation; the guard phase settles rule 8 without covering it."
- **§20**: Phase 14 row: "Public presence: post engine (stills) | Browsing, formats and poses, craft skill, `post_tick`, render, draft/check, inspector approval | `tests/exit/phase-14.test.ts`; `pnpm test` <FILES> files / <TESTS> tests at close" with the counts from Task 12.
- **§25** new entries (next free B numbers): video and voice (Remotion + live three.js, a `video` craft goal, capability `"video"`); the pattern-recognition format extractor; depth masks; object storage for media (before users); platform publishing with AI labels; songs (attached in-app at posting until a platform API allows it); APOD's US publish date vs her timezone (fetch retries hourly; consider yesterday's date); the craft-goal create race (`craftSkill`).

- [ ] **Step 2: `DECISIONS.md` and `CLAUDE.md`**

Append to `DECISIONS.md` (same table format as the existing rows):

```markdown
| 2026-10-13 | Posts come from a scheduled `post_tick`, not the module bus | Bus delivery is in-process and core handlers have no queue; a tick is durable and simpler. |
| 2026-10-13 | Browsing and posting are `action` world events | World events reach memory only through appraisal, so one path gives both "she remembers her posts" and craft progress. |
| 2026-10-13 | Stills are pre-rendered pose sprites composited with sharp; live 3D comes with video | No 3D or headless browser at runtime; the sprite PNG is the seam a live renderer replaces. |
| 2026-10-13 | The draft call never sees her appraisal episode, only its valence | Her take is private memory; a post is written fresh in her public voice. |
| 2026-10-13 | Only public-domain, CC0, CC BY and CC BY-SA finds are kept | She may post what she finds. |
```

`CLAUDE.md`: add to "Modules in brief":

```markdown
- **Post engine (v3 §16a, built 14):** she browses one free-licence image a day (an `action`
  event that lands through appraisal); hourly `post_tick` gates in code, picks a reviewed format
  (`formats/stills/`) and a pose sprite (`assets/poses/`) within her craft skill (a core goal),
  makes one draft and one check call (optional loops) and renders with sharp; drafts wait in the
  inspector Posts tab; approving records an `action` event. `pnpm formats:add`, `pnpm posts:review`.
```

and change the current-phase paragraph to say Phase 14 (post engine, stills) is built, Phase 13 (guard) is built or in progress in parallel (check `main`), and the next step is the publishing phase or video, needing its design doc. Mention persona v6's drafted lines await Ethan's rewrite.

- [ ] **Step 3: Check, then commit**

Run `pnpm lint` (Prettier covers the markdown) and `pnpm test` one last time.

```bash
git add spica-design-spec-v3.md DECISIONS.md CLAUDE.md
git commit -m "docs: record phase 14 (public presence, the post engine)"
```

Then hand off with superpowers:finishing-a-development-branch; merging needs §20, §25, `CLAUDE.md` and `DECISIONS.md` reconciled by hand with Phase 13's changes on `main`.
