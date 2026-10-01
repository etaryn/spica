import { Client } from "pg";
import { afterAll, beforeAll, expect, test } from "vitest";

const url = process.env.TEST_DATABASE_URL ?? "postgres://spica:spica@localhost:5432/spica_test";
const client = new Client({ connectionString: url });

beforeAll(async () => {
  await client.connect();
});
afterAll(async () => {
  await client.end();
});

test("test database is reachable", async () => {
  const res = await client.query("SELECT 1 AS ok");
  expect(res.rows[0].ok).toBe(1);
});

test("pgvector extension is available", async () => {
  const res = await client.query("SELECT name FROM pg_available_extensions WHERE name = 'vector'");
  expect(res.rowCount).toBe(1);
});
