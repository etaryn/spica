import { expect, test } from "vitest";
import { readEnv } from "@/runtime/env";

test("readEnv requires DATABASE_URL and parses optional values", () => {
  expect(() => readEnv({})).toThrow(/DATABASE_URL/);
  const e = readEnv({ DATABASE_URL: "postgres://x/y", SPICA_CONFIG: '{"chat":{"max_parts":2}}' });
  expect(e.DATABASE_URL).toBe("postgres://x/y");
  expect(e.configOverrides).toEqual({ chat: { max_parts: 2 } });
  expect(e.VOYAGE_API_KEY).toBeUndefined();
});

test("blank values from .env (KEY=) count as unset", () => {
  const e = readEnv({ DATABASE_URL: "postgres://x/y", VOYAGE_API_KEY: "", SPICA_CONFIG: "" });
  expect(e.VOYAGE_API_KEY).toBeUndefined();
  expect(e.configOverrides).toEqual({});
  expect(() => readEnv({ DATABASE_URL: "" })).toThrow(/DATABASE_URL/);
});
