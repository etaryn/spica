import type { Embedder } from "./types";

type VoyageResponse = { data: { index: number; embedding: number[] }[] };

/** Wired in Phase 0, first used by Phase 1 retrieval and extraction. */
export class VoyageEmbedder implements Embedder {
  readonly dimensions: number;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: { apiKey: string | undefined; model: string; dimensions: number; fetchImpl?: typeof fetch }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.dimensions = opts.dimensions;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async embed(texts: string[], inputType: "query" | "document"): Promise<number[][]> {
    if (!this.apiKey) throw new Error("VOYAGE_API_KEY is not set");
    const res = await this.fetchImpl("https://api.voyageai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ input: texts, model: this.model, input_type: inputType, output_dimension: this.dimensions }),
    });
    if (!res.ok) throw new Error(`Voyage embeddings failed with HTTP ${res.status}`);
    const body = (await res.json()) as VoyageResponse;
    return [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
