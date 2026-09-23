import { expect, test } from "vitest";
import { canAccessInspector, parseUserIdParam, readInspectorEnv } from "@/lib/inspector-access";

const ADMIN = "2f1c6f2e-8a51-4c1e-9d2b-6f0a1e2b3c4d";

test("disabled by default in production, enabled by default elsewhere", () => {
  expect(readInspectorEnv({ NODE_ENV: "production" }).enabled).toBe(false);
  expect(readInspectorEnv({ NODE_ENV: "development" }).enabled).toBe(true);
  expect(readInspectorEnv({ NODE_ENV: "production", INSPECTOR_ENABLED: "true" }).enabled).toBe(true);
  expect(readInspectorEnv({ NODE_ENV: "development", INSPECTOR_ENABLED: "false" }).enabled).toBe(false);
});

test("review I2: access is by allowlisted user id, never by (unverified) email", () => {
  const env = readInspectorEnv({ NODE_ENV: "development", INSPECTOR_ADMIN_USER_IDS: ` ${ADMIN.toUpperCase()} , not-a-uuid` });
  expect(env.admins).toEqual([ADMIN]);
  expect(canAccessInspector(ADMIN, env)).toBe(true);
  expect(canAccessInspector("11111111-1111-4111-8111-111111111111", env)).toBe(false);
  expect(canAccessInspector(null, env)).toBe(false);
  expect(canAccessInspector(ADMIN, { ...env, enabled: false })).toBe(false);
  // The old email allowlist grants nothing.
  expect(readInspectorEnv({ NODE_ENV: "development", INSPECTOR_ADMIN_EMAILS: "admin@x.com" }).admins).toEqual([]);
});

test("parseUserIdParam rejects non-uuids instead of letting Postgres 500", () => {
  expect(parseUserIdParam("not-a-uuid")).toBeNull();
  expect(parseUserIdParam("'; drop table user;--")).toBeNull();
  expect(parseUserIdParam(ADMIN)).toBe(ADMIN);
});
