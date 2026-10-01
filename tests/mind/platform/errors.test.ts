import { expect, test } from "vitest";
import { errorName } from "@/mind/platform/errors";

class DatabaseError extends Error {
  detail = "Failing row contains (secret fact text)";
}

test("errorName reports the innermost cause's class, not the wrapper's", () => {
  class DrizzleQueryError extends Error {}
  expect(
    errorName(
      new DrizzleQueryError("Failed query: params: secret", { cause: new DatabaseError("x") }),
    ),
  ).toBe("DatabaseError");
});

test("errorName falls back to UnknownError for a non-Error throw", () => {
  expect(errorName("a string")).toBe("UnknownError");
});

test("errorName returns the error's own class when it has no cause", () => {
  expect(errorName(new TypeError("boom"))).toBe("TypeError");
});

test("errorName terminates on a cyclic cause chain", () => {
  class AErr extends Error {}
  class BErr extends Error {}
  const a = new AErr("a");
  const b = new BErr("b");
  a.cause = b;
  b.cause = a;
  expect(errorName(a)).toBe("BErr");
});
