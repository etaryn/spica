import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { user } from "@/db/schema";
import { createAuth } from "@/server/auth-factory";
import { closeTestDb, getTestDb, resetDb } from "../helpers/db";

beforeEach(resetDb);
afterAll(closeTestDb);

const auth = createAuth(getTestDb(), loadConfig(), {
  secret: "test-secret-test-secret-test-secret-123",
  baseURL: "http://localhost:3000",
});

const body = (dateOfBirth: string, email = `p${Math.random()}@test.local`) => ({
  email,
  password: "correct-horse-battery",
  name: "Pat",
  dateOfBirth,
  gender: "woman",
});

test("adult sign-up creates a uuid user with the date of birth", async () => {
  const b = body("1995-04-02");
  await auth.api.signUpEmail({ body: b });
  const [row] = await getTestDb().select().from(user).where(eq(user.email, b.email));
  expect(row?.dateOfBirth).toBe("1995-04-02");
  expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
});

test("under-18 sign-up is rejected and nothing is stored", async () => {
  const b = body("2015-01-01");
  await expect(auth.api.signUpEmail({ body: b })).rejects.toThrow(/18/);
  expect(await getTestDb().select().from(user).where(eq(user.email, b.email))).toEqual([]);
});

test("missing or malformed date of birth is rejected", async () => {
  await expect(auth.api.signUpEmail({ body: body("not-a-date") })).rejects.toThrow();
});

test("the name is stored trimmed", async () => {
  const b = { ...body("1995-04-02"), name: "  Pat  " };
  await auth.api.signUpEmail({ body: b });
  const [row] = await getTestDb().select().from(user).where(eq(user.email, b.email));
  expect(row?.name).toBe("Pat");
});

test("sign-up needs a gender from the list", async () => {
  await expect(
    auth.api.signUpEmail({ body: { ...body("1995-04-02"), gender: "" } }),
  ).rejects.toThrow();
  await expect(
    auth.api.signUpEmail({ body: { ...body("1995-04-02"), gender: "robot" } }),
  ).rejects.toThrow(/gender/i);
  const b = { ...body("1995-04-02"), gender: "non-binary" };
  await auth.api.signUpEmail({ body: b });
  const [row] = await getTestDb().select().from(user).where(eq(user.email, b.email));
  expect(row?.gender).toBe("non-binary");
});
