/**
 * Test embedder with hand-picked vectors: exact vectors for registered texts, and near-orthogonal
 * hashed axes for everything else, so tests can control which memories count as similar.
 */
import type { Embedder } from "./types";

/** Axes below this index are left free for tests to place registered vectors on. */
const FIRST_HASHED_AXIS = 100;
const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

export class ScriptedEmbedder implements Embedder {
  private readonly vectors = new Map<string, number[]>();
  calls = 0;
  failNext = false;

  constructor(readonly dimensions: number) {}

  /** A unit vector along axis `i`. */
  static axis(dim: number, i: number): number[] {
    const vector = new Array<number>(dim).fill(0);
    vector[i % dim] = 1;
    return vector;
  }

  /** A unit vector with cosine similarity `sim` to axis(i), built from axes i and j. */
  static near(dim: number, i: number, j: number, sim: number): number[] {
    const vector = new Array<number>(dim).fill(0);
    vector[i % dim] = sim;
    vector[j % dim] = Math.sqrt(1 - sim * sim);
    return vector;
  }

  set(text: string, vector: number[]): this {
    this.vectors.set(text, vector);
    return this;
  }

  async embed(texts: string[], _inputType: "query" | "document"): Promise<number[][]> {
    this.calls += 1;

    if (this.failNext) {
      this.failNext = false;
      throw new Error("scripted embedder failure");
    }

    return texts.map((text) => this.vectors.get(text) ?? this.hashedAxis(text));
  }

  private hashedAxis(text: string): number[] {
    const axis = FIRST_HASHED_AXIS + (hash(text) % (this.dimensions - FIRST_HASHED_AXIS));
    return ScriptedEmbedder.axis(this.dimensions, axis);
  }
}

function hash(text: string): number {
  let h = FNV_OFFSET;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), FNV_PRIME);
  return h >>> 0;
}
