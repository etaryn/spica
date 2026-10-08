import { expect, test } from "vitest";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { fitChars, fitList, fitText } from "@/mind/platform/llm/fit";

test("fitChars cuts at the limit with an ellipsis and never splits a surrogate pair", () => {
  expect(fitChars("short", 10)).toBe("short");
  expect(fitChars("abcdefghij", 5)).toBe("abcd…");
  expect(fitChars("ab😀cd", 4)).toBe("ab…");
  expect(fitChars("ab😀cd", 5)).toBe("ab😀…");
});

test("fitted schemas trim what the model overfills instead of rejecting it", () => {
  const Output = z.object({ lines: fitList(fitText(10), 2), gist: fitText(10) });
  const parsed = Output.parse({
    lines: ["one", "a line\nthat runs long", "three"],
    gist: "  spaced   out  ",
  });
  expect(parsed).toEqual({ lines: ["one", "a line th…"], gist: "spaced out" });
  expect(() => Output.parse({ lines: [""], gist: "x" })).toThrow();
});

test("fitted schemas still convert for strict structured output, which parses through them", () => {
  const format = zodOutputFormat(z.object({ lines: fitList(fitText(5), 1) }) as never);
  expect(format.parse!(JSON.stringify({ lines: ["toolong", "extra"] }))).toEqual({
    lines: ["tool…"],
  });
});
