import type { LlmUsage } from "@/core/llm/types";

export type UsageRow = {
  purpose: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

/** Sums token usage per (purpose, model) across a whole eval run, to see which call site drives spend. */
export class UsageTally {
  private readonly rows = new Map<string, UsageRow>();

  readonly record = (u: LlmUsage): void => {
    const key = `${u.purpose}\u0000${u.model}`;
    const row = this.rows.get(key)
      ?? { purpose: u.purpose, model: u.model, calls: 0, input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
    row.calls += 1;
    row.input_tokens += u.input_tokens;
    row.output_tokens += u.output_tokens;
    row.cache_read_input_tokens += u.cache_read_input_tokens;
    row.cache_creation_input_tokens += u.cache_creation_input_tokens;
    this.rows.set(key, row);
  };

  /** Rows sorted by total tokens, largest first. */
  summary(): UsageRow[] {
    const total = (r: UsageRow) => r.input_tokens + r.output_tokens + r.cache_read_input_tokens + r.cache_creation_input_tokens;
    return [...this.rows.values()].sort((a, b) => total(b) - total(a));
  }

  format(): string[] {
    const rows = this.summary();
    if (rows.length === 0) return [];
    return [
      "token usage (purpose / model: calls, input, output, cache read, cache write):",
      ...rows.map((r) => `  ${`${r.purpose} / ${r.model}`.padEnd(44)} ${String(r.calls).padStart(5)}  ${String(r.input_tokens).padStart(9)}  ${String(r.output_tokens).padStart(9)}  ${String(r.cache_read_input_tokens).padStart(9)}  ${String(r.cache_creation_input_tokens).padStart(9)}`),
    ];
  }
}
