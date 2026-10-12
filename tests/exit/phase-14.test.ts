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
  const { turn } = await receiveTurn(deps, u, {
    clientMessageId: randomUUID(),
    text: `remember ${TOKEN}`,
  });
  const reply = await insertTurn(deps.db, u, {
    id: randomUUID(),
    session_id: turn.session_id,
    role: "companion",
    text: "got it",
    created_at: deps.clock.now(),
    reply_to: turn.id,
  });
  await runColdPath(deps, {
    userId: u,
    turnIds: [turn.id, reply.id],
    replyTurnId: reply.id,
    recalled: [],
  });
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
  const episode = await deps.core.memory.bySourceRef(
    "episode",
    `world_event:${approved!.action_event_id}`,
  );
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
