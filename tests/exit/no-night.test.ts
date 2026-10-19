/**
 * No night, all fake: her energy is a battery her busy blocks drain; when it runs out she logs off
 * at whatever hour that is and her offline time holds replies like busy does; she comes back when
 * it recovers; plans hold no night; reach-outs never land in their own night. A's data never
 * reaches B's reach-out, and a reach-out leaves core unchanged.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import { insertThread } from "@/db/repos/user/threads";
import { insertLifeDay } from "@/db/repos/world/life-day";
import { reach_out_log, user } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { REACH_OUT_SEND_QUEUE } from "@/mind/platform/jobs";
import { deferWhileBusy } from "@/mind/process/availability/deferral";
import { loadYourDayLine } from "@/mind/process/hot-path/your-day-line";
import { runReachOutSend } from "@/mind/process/outreach/send";
import { outreachTickUser } from "@/mind/process/outreach/tick";
import { coreStateTick } from "@/mind/state/core/tick";
import { blocksForDay } from "@/mind/world/blocks";
import { validatePlan } from "@/mind/world/day-plan";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const H = 3_600_000;
const hour = (h: number) => new Date(Date.UTC(2026, 0, 5) + h * H);

async function busyAllDay(deps: ReturnType<typeof makeTestDeps>, date: string) {
  await insertLifeDay(deps.db, {
    date,
    plan: { blocks: [{ start: "00:00", end: "24:00", kind: "busy", busy: 1, label: "reading" }] },
    source: "scripted",
    model: "none",
    prompt_version: "scripted",
    generated_at: hour(0),
  });
}

test("1: a busy stretch drains her, she logs off at any hour, and offline holds a reply like busy", async () => {
  const d = makeTestDeps({ core: { state: { noise: 0 } }, life: { timezone: "UTC" } });
  await busyAllDay(d, "2026-01-05");
  const core = coreDepsOf(d);
  let off: Date | null = null;
  for (let h = 1; h <= 23 && !off; h++) {
    await coreStateTick(core, hour(h));
    off = (await d.core.state.get())!.offline_since;
  }
  expect(off).not.toBeNull();
  const u = await createTestUser();
  await ensureRelationship(d.db, u, hour(0), d.config.relationship);
  const msgAt = new Date(off!.getTime() + 5 * 60_000);
  const a = await deferWhileBusy(d, u, msgAt, "seed");
  expect(a.delayMs).toBeGreaterThan(0);
  expect(a.blockKey).toMatch(/^offline#/);
  expect(a.blockKind).toBe("offline");
  expect(await loadYourDayLine(d, msgAt, null)).toContain(d.config.core.state.offline.label);
});

test("2: she comes back when her battery reaches exit; her plan doesn't drain her while offline", async () => {
  const d = makeTestDeps({ core: { state: { noise: 0 } }, life: { timezone: "UTC" } });
  await busyAllDay(d, "2026-01-05");
  await busyAllDay(d, "2026-01-06");
  const core = coreDepsOf(d);
  let h = 1;
  while (!(await d.core.state.get())?.offline_since && h < 24) await coreStateTick(core, hour(h++));
  const low = (await d.core.state.get())!.energy;
  await coreStateTick(core, hour(h++));
  expect((await d.core.state.get())!.energy).toBeGreaterThan(low); // busy plan, yet recovering
  while ((await d.core.state.get())!.offline_since && h < 48) await coreStateTick(core, hour(h++));
  expect((await d.core.state.get())!.offline_since).toBeNull();
  expect((await d.core.state.get())!.energy).toBeGreaterThanOrEqual(
    d.config.core.state.offline.exit,
  );
});

async function dueThreadUser(
  d: ReturnType<typeof makeTestDeps>,
  name: string,
  at: Date,
  text: string,
) {
  const u = await createTestUser(name);
  await ensureRelationship(d.db, u, at, d.config.relationship);
  const t = await insertThread(
    d.db,
    u,
    {
      title: "interview",
      subject: "user",
      stakes: "high",
      next_checkpoint: new Date(at.getTime() - H),
    },
    new Date(at.getTime() - 24 * H),
  );
  await insertFact(d.db, u, {
    subject: "user",
    kind: "event",
    content: text,
    embedding: vec(),
    created_at: new Date(at.getTime() - H),
    occurred_at: new Date(at.getTime() - 2 * H),
    status: "open",
    salience: 0.7,
    valence: 0,
    confidence: 1,
    source: "turn",
    thread_id: t.id,
  });
  await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "talk later",
    created_at: new Date(at.getTime() - 26 * H),
  });
  return u;
}

test("3: a reach-out never goes out in their night", async () => {
  const night = new Date("2026-01-10T07:20:00Z"); // 02:20 in New York
  const day = new Date("2026-01-10T15:20:00Z"); // 10:20 in New York
  const d = makeTestDeps({ life: { timezone: "UTC" }, core: { world: { events_per_day_max: 0 } } });
  const u = await dueThreadUser(d, "nyc", night, "The user has an interview at Canva.");
  await d.db.update(user).set({ timezone: "America/New_York" }).where(eq(user.id, u));
  expect(await outreachTickUser(d, u, night)).toBe("blocked");
  const rule = async () => {
    const rows = await d.db.select().from(reach_out_log).where(eq(reach_out_log.user_id, u));
    const g = rows.at(-1)!.gate_results as { rule: string; pass: boolean }[];
    return g.find((r) => r.rule === "their_night")!.pass;
  };
  expect(await rule()).toBe(false);
  await outreachTickUser(d, u, day);
  expect(await rule()).toBe(true);
});

test("4: no plan holds a night; an old stored quiet block reads as free", () => {
  const d = makeTestDeps({ life: { timezone: "UTC" } });
  const quiet = {
    start: "00:00",
    end: "08:00",
    kind: "quiet" as never,
    busy: 0.9,
    label: "offline",
  };
  const busy = { start: "10:00", end: "12:00", kind: "busy" as const, busy: 0.6, label: "reading" };
  expect(validatePlan({ blocks: [quiet, busy] }, d.config.life, null).ok).toBe(false);
  expect(blocksForDay(d.config.life, "2026-01-05", { blocks: [quiet] })).toEqual([]);
});

const TOKEN = "CANARY-nonight-4f1a";
const CORE_TABLES = ["core_memory", "core_state", "core_goal", "core_snapshot", "world_event"];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(
      sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x ORDER BY 1`),
    );
    parts.push(...res.rows.map((r) => String(r.j)));
  }
  return parts.join("\n");
}

test("5: leak canary and side channel: A's data never reaches B's reach-out; reach-outs leave core (energy and offline included) unchanged", async () => {
  const at = new Date("2026-01-05T15:25:00Z");
  const d = makeTestDeps({ life: { timezone: "UTC" }, core: { world: { events_per_day_max: 0 } } });
  d.clock.set(at);
  await d.core.state.ensure(d.config.core.state.baseline, { autonomy: 0.6, competence: 0.6 });
  const a = await dueThreadUser(d, "alice", at, `The user's interview code is ${TOKEN}.`);
  const b = await dueThreadUser(d, "bob", at, "The user has an interview at Canva.");
  const before = await coreDump();
  const send = async (u: string) => {
    const [replies, structured] = [d.llm.calls.length, d.llm.structuredCalls.length];
    expect(await outreachTickUser(d, u, at)).toBe("scheduled");
    for (const job of d.queue.drain((j) => j.name === REACH_OUT_SEND_QUEUE))
      if (job.name === REACH_OUT_SEND_QUEUE)
        expect(await runReachOutSend(d, job.data)).toBe("sent");
    return [...d.llm.calls.slice(replies), ...d.llm.structuredCalls.slice(structured)];
  };
  const bCalls = await send(b);
  expect(bCalls.length).toBeGreaterThan(0);
  for (const c of bCalls) expect(JSON.stringify(c)).not.toContain(TOKEN);
  expect((await send(a)).some((c) => JSON.stringify(c).includes(TOKEN))).toBe(true);
  expect(await coreDump()).toBe(before);
});
