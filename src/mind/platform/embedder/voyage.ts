/**
 * The real embedder: Voyage embeddings, used by memory retrieval, reconcile and the day's event
 * checks.
 */
import type { Embedder } from "./types";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";

type VoyageResponse = { data: { index: number; embedding: number[] }[] };

type VoyageOptions = {
  apiKey: string | undefined;
  model: string;
  dimensions: number;
  fetchImpl?: typeof fetch;
};

export class VoyageEmbedder implements Embedder {
  readonly dimensions: number;
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VoyageOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async embed(texts: string[], inputType: "query" | "document"): Promise<number[][]> {
    if (!this.apiKey) throw new Error("VOYAGE_API_KEY is not set");

    const response = await this.fetchImpl(VOYAGE_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        input: texts,
        model: this.model,
        input_type: inputType,
        output_dimension: this.dimensions,
      }),
    });
    if (!response.ok) throw new Error(`Voyage embeddings failed with HTTP ${response.status}`);

    const body = (await response.json()) as VoyageResponse;
    const inInputOrder = [...body.data].sort((a, b) => a.index - b.index);
    return inInputOrder.map((item) => item.embedding);
  }
}
