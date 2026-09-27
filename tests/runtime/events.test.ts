import { sql } from "drizzle-orm";
import { afterAll, expect, test, vi } from "vitest";
import { emit, RecordingEventBus, type ChatEvent } from "@/core/events";
import { silentLogger } from "@/core/log";
import { EventHub } from "@/runtime/event-hub";
import { PgEventBus } from "@/runtime/pg-event-bus";
import { closeTestDb, getTestDb, testDbUrl } from "../helpers/db";

const hub = new EventHub(testDbUrl, "spica_events_test", silentLogger);
afterAll(async () => { await hub.stop(); await closeTestDb(); });

test("hub only delivers to the addressed user, and payloads never carry text", async () => {
  const a: ChatEvent[] = [];
  const b: ChatEvent[] = [];
  const offA = hub.subscribe("user-a", (e) => a.push(e));
  hub.subscribe("user-b", (e) => b.push(e));
  await hub.ready();
  const bus = new PgEventBus(getTestDb(), "spica_events_test");
  await bus.publish("user-a", { type: "message", turnId: "t1", part: 0 });
  await bus.publish("user-a", { type: "typing", on: true });
  await vi.waitFor(() => expect(a).toHaveLength(2), { timeout: 3000 });
  expect(a).toEqual([{ type: "message", turnId: "t1", part: 0 }, { type: "typing", on: true }]);
  expect(b).toEqual([]);
  offA();
  await bus.publish("user-a", { type: "typing", on: false });
  await new Promise((r) => setTimeout(r, 200));
  expect(a).toHaveLength(2);
});

test("malformed notifications are ignored", async () => {
  const got: ChatEvent[] = [];
  hub.subscribe("user-c", (e) => got.push(e));
  await hub.ready();
  await getTestDb().execute(sql.raw(`SELECT pg_notify('spica_events_test', 'not json')`));
  await getTestDb().execute(sql.raw(`SELECT pg_notify('spica_events_test', '{"userId":"user-c","type":"nope"}')`));
  await new Promise((r) => setTimeout(r, 200));
  expect(got).toEqual([]);
});

test("onReset fires when the LISTEN connection is lost, and the hub reconnects and delivers again", async () => {
  const events: ChatEvent[] = [];
  let resets = 0;
  const off = hub.subscribe("user-reset", (e) => events.push(e), () => { resets += 1; });
  await hub.ready();

  // Simulate the connection being dropped from outside (e.g. a DB failover) by terminating the
  // hub's own LISTEN backend, rather than reaching into the hub's private client.
  await getTestDb().execute(sql.raw(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE query ILIKE 'LISTEN spica_events_test%' AND pid <> pg_backend_pid()`,
  ));
  await vi.waitFor(() => expect(resets).toBeGreaterThanOrEqual(1), { timeout: 5000 });

  // ready() now returns the already-scheduled backoff retry; awaiting it directly confirms
  // subscribe/ready join the pending timer instead of racing a second connect.
  await hub.ready();

  const bus = new PgEventBus(getTestDb(), "spica_events_test");
  await bus.publish("user-reset", { type: "typing", on: true });
  await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 3000 });
  expect(resets).toBe(1);
  off();
}, 20000);

test("emit never rejects when the bus fails", async () => {
  const bus = new RecordingEventBus();
  bus.publish = async () => { throw new Error("down"); };
  await expect(emit({ events: bus, log: silentLogger }, "u", { type: "typing", on: true })).resolves.toBeUndefined();
});
