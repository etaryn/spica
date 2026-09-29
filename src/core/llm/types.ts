import type { z } from "zod";

/** Provider-neutral on purpose: the provider may change (see DECISIONS.md). */
export type ChatMessage = { role: "user" | "assistant"; content: string };

export interface ReplyRequest {
  system: string;
  messages: ChatMessage[];
}

/** Which configured model a structured call uses (config `models.<role>`). */
export type StructuredModel = "cheap" | "extract" | "judge" | "guard" | "turn_judge" | "life";

export interface ClassifyRequest<T> {
  /** What the call is for ("crisis", "extract", "reconcile", "judge_recall", …); fakes route on it. */
  purpose: string;
  model?: StructuredModel;
  system: string;
  input: string;
  schema: z.ZodType<T>;
  timeoutMs: number;
  maxTokens: number;
}

/** Token counts for one model call; `purpose` is "reply" for `generateReply`, else the request's purpose. */
export interface LlmUsage {
  purpose: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/** Optional callback a provider reports every completed call's usage to (evals tally spend with it). */
export type UsageSink = (usage: LlmUsage) => void;

export interface LLMProvider {
  /** Reply model. Throws on failure, refusal or empty output. */
  generateReply(req: ReplyRequest): Promise<string>;
  /** Cheap model with strict JSON output validated against `schema`. */
  classifyJson<T>(req: ClassifyRequest<T>): Promise<T>;
}
