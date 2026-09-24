import { PgBoss } from "pg-boss";
import { afterAll, expect, test } from "vitest";
import { COLD_PATH_QUEUE } from "@/core/queue";
import { PgBossQueue } from "@/queue/pg-boss-queue";
import { testDbUrl } from "../helpers/db";

const boss = new PgBoss(testDbUrl);
const queue = new PgBossQueue(boss, { retryLimit: 3, retryDelaySeconds: 30 });

afterAll(async () => { await queue.stop(); });

test("enqueue lazily starts pg-boss and stores a cold_path job", async () => {
  await queue.enqueue(COLD_PATH_QUEUE, { userId: "u1", turnIds: ["t1", "t2"] });
  const jobs = await boss.fetch(COLD_PATH_QUEUE);
  expect(jobs.map((j) => j.data)).toContainEqual({ userId: "u1", turnIds: ["t1", "t2"] });
});

test("cold_path queue is created with the retry policy", async () => {
  await queue.start();
  const q = await boss.getQueue(COLD_PATH_QUEUE);
  expect(q).toMatchObject({ retryLimit: 3, retryDelay: 30, retryBackoff: true });
});
