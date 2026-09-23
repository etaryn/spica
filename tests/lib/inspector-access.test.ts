import { expect, test } from "vitest";
import { canAccessInspector, parseUserIdParam, readInspectorEnv } from "@/lib/inspector-access";

test("disabled by default in production, enabled by default elsewhere", () => {
  expect(readInspectorEnv({ NODE_ENV: "production" }).enabled).toBe(false);
  expect(readInspectorEnv({ NODE_ENV: "development" }).enabled).toBe(true);
  expect(readInspectorEnv({ NODE_ENV: "production", INSPECTOR_ENABLED: "true" }).enabled).toBe(true);
  expect(readInspectorEnv({ NODE_ENV: "development", INSPECTOR_ENABLED: "false" }).enabled).toBe(false);
});

test("requires the flag and an allowlisted email (case-insensitive)", () => {
  const env = readInspectorEnv({ NODE_ENV: "development", INSPECTOR_ADMIN_EMAILS: " Admin@X.com , b@y.com" });
  expect(canAccessInspector("admin@x.com", env)).toBe(true);
  expect(canAccessInspector("other@x.com", env)).toBe(false);
  expect(canAccessInspector(null, env)).toBe(false);
  expect(canAccessInspector("admin@x.com", { ...env, enabled: false })).toBe(false);
});

test("parseUserIdParam rejects non-uuids instead of letting Postgres 500", () => {
  expect(parseUserIdParam("not-a-uuid")).toBeNull();
  expect(parseUserIdParam("'; drop table user;--")).toBeNull();
  expect(parseUserIdParam("2f1c6f2e-8a51-4c1e-9d2b-6f0a1e2b3c4d")).toBe("2f1c6f2e-8a51-4c1e-9d2b-6f0a1e2b3c4d");
});
