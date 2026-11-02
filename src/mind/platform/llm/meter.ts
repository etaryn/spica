/**
 * Metering a background loop's model calls: counts, usage for cost, and an optional reservation
 * before each call. Shared by her core loops and her user loops.
 */
import type { Config } from "@/mind/platform/config";
import type { LLMProvider, LlmUsage } from "@/mind/platform/llm/types";

export function meterLlm(
  llm: LLMProvider,
  opts: {
    reserve?: () => Promise<boolean>;
    onRefused?: (purpose: string) => Error;
    maxRetries?: number;
  },
) {
  const usage: LlmUsage[] = [];
  let calls = 0;
  const metered: LLMProvider = {
    async generateReply() {
      throw new Error("background loops never call the reply model");
    },
    async classifyJson(request) {
      if (opts.reserve && !(await opts.reserve()))
        throw opts.onRefused?.(request.purpose) ?? new Error(`${request.purpose}: refused`);
      calls += 1;
      return llm.classifyJson({
        ...(opts.maxRetries === undefined ? {} : { maxRetries: opts.maxRetries }),
        ...request,
        onUsage: (u) => {
          request.onUsage?.(u);
          usage.push(u);
        },
      });
    },
  };
  return { llm: metered, usage, calls: () => calls };
}

/**
 * What the calls cost: every token kind at its own rate. One call to a model with no price makes
 * the whole cost unknown rather than a sum that quietly leaves it out.
 */
export function spend(usage: LlmUsage[], prices: Config["prices"]) {
  if (!usage.length) return { model: null, tokens_in: null, tokens_out: null, cost: null };
  const tokensIn = usage.reduce((sum, u) => sum + u.input_tokens, 0);
  const tokensOut = usage.reduce((sum, u) => sum + u.output_tokens, 0);
  let cost: number | null = 0;
  for (const u of usage) {
    const price = prices[u.model];
    if (!price || cost === null) {
      cost = null;
      continue;
    }
    cost += callCost(u, price);
  }
  return { model: usage.at(-1)!.model, tokens_in: tokensIn, tokens_out: tokensOut, cost };
}

/** One call's dollars; a price is dollars per million tokens. */
export function callCost(u: LlmUsage, price: Config["prices"][string]): number {
  const written1h = u.cache_creation_1h_input_tokens;
  return (
    (u.input_tokens * price.input +
      u.output_tokens * price.output +
      u.cache_read_input_tokens * price.cache_read +
      (u.cache_creation_input_tokens - written1h) * price.cache_write_5m +
      written1h * price.cache_write_1h) /
    1_000_000
  );
}
