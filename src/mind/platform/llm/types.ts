/**
 * The language-model interface the mind talks to. Provider-neutral on purpose, so the provider
 * can change without touching the mind.
 */
import type { z } from "zod";

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

/** Token counts for one model call. `purpose` is "reply" for a reply, else the request's purpose. */
export interface LlmUsage {
  purpose: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

/** Receives every completed call's usage; the evals tally spend with it. */
export type UsageSink = (usage: LlmUsage) => void;

export interface LLMProvider {
  /** The reply model. Throws on failure, refusal or empty output. */
  generateReply(request: ReplyRequest): Promise<string>;
  /** A cheap model with strict JSON output, validated against `schema`. */
  classifyJson<T>(request: ClassifyRequest<T>): Promise<T>;
}
