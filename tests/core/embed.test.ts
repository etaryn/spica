import { describe, expect, test, vi } from "vitest";
import { assertEmbedderMatchesSchema } from "@/core/embed/types";
import { FakeEmbedder } from "@/core/embed/fake";
import { VoyageEmbedder } from "@/core/embed/voyage";

describe("VoyageEmbedder", () => {
  test("posts model, input_type and output_dimension; returns vectors in input order", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 1, embedding: [2] },
            { index: 0, embedding: [1] },
          ],
        }),
        { status: 200 },
      ),
    );
    const e = new VoyageEmbedder({ apiKey: "k", model: "voyage-3.5", dimensions: 1024, fetchImpl });
    expect(await e.embed(["a", "b"], "document")).toEqual([[1], [2]]);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.voyageai.com/v1/embeddings");
    expect(JSON.parse(init.body)).toEqual({
      input: ["a", "b"],
      model: "voyage-3.5",
      input_type: "document",
      output_dimension: 1024,
    });
    expect(init.headers.authorization).toBe("Bearer k");
  });

  test("throws on HTTP error and on missing key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(
      new VoyageEmbedder({ apiKey: "k", model: "m", dimensions: 1024, fetchImpl }).embed(
        ["a"],
        "query",
      ),
    ).rejects.toThrow(/500/);
    await expect(
      new VoyageEmbedder({ apiKey: undefined, model: "m", dimensions: 1024, fetchImpl }).embed(
        ["a"],
        "query",
      ),
    ).rejects.toThrow(/VOYAGE_API_KEY/);
  });
});

test("FakeEmbedder is deterministic and sized", async () => {
  const e = new FakeEmbedder(1024);
  const [a] = await e.embed(["hello"], "query");
  const [b] = await e.embed(["hello"], "document");
  expect(a).toHaveLength(1024);
  expect(a).toEqual(b);
});

test("assertEmbedderMatchesSchema", () => {
  expect(() => assertEmbedderMatchesSchema(new FakeEmbedder(1024), 1024)).not.toThrow();
  expect(() => assertEmbedderMatchesSchema(new FakeEmbedder(1536), 1024)).toThrow(/1536/);
});

import { ScriptedEmbedder } from "@/core/embed/scripted";

const cos = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

test("ScriptedEmbedder: registered vectors, orthogonal defaults, near() similarity, failNext", async () => {
  const e = new ScriptedEmbedder(1024);
  e.set("a", ScriptedEmbedder.axis(1024, 1));
  e.set("b", ScriptedEmbedder.near(1024, 1, 2, 0.9));
  const [a, b, x, y] = await e.embed(["a", "b", "unregistered-x", "unregistered-y"], "document");
  expect(cos(a!, b!)).toBeCloseTo(0.9, 5);
  expect(cos(a!, a!)).toBeCloseTo(1, 5);
  expect(Math.abs(cos(x!, y!))).toBeLessThan(0.2);
  e.failNext = true;
  await expect(e.embed(["a"], "query")).rejects.toThrow();
  expect(e.calls).toBe(2);
});
