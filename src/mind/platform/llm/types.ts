/**
 * The language-model interface the mind talks to. Provider-neutral on purpose, so the provider
 * can change without touching the mind.
 */
import type { z } from "zod";

export type ChatMessage = { role: "user" | "assistant"; content: string };

/** One piece of the system prompt; `cache` marks the end of a prefix the provider may cache. */
export type SystemBlock = { text: string; cache?: boolean };

export interface ReplyRequest {
  /** Ordered; joined with blank lines, the blocks are the whole system prompt. */
  system: SystemBlock[];
  messages: ChatMessage[];
}

/** The system prompt as one string, the way a fake or a log reads it. */
export function systemText(blocks: SystemBlock[]): string {
  return blocks
    .map((b) => b.text)
    .filter(Boolean)
    .join("\n\n");
}

/** Which configured model a structured call uses (config `models.<role>`). */
export type StructuredModel =
  "cheap" | "extract" | "judge" | "guard" | "turn_judge" | "life" | "core" | "user_mind";

/** Receives every completed call's usage; the evals tally spend with it. */
export type UsageSink = (usage: LlmUsage) => void;

export interface ClassifyRequest<T> {
  /** What the call is for ("crisis", "extract", "reconcile", "judge_recall", …); fakes route on it. */
  purpose: string;
  model?: StructuredModel;
  system: string;
  input: string;
  schema: z.ZodType<T>;
  timeoutMs: number;
  maxTokens: number;
  /**
   * SDK retries on timeouts, connection errors and overload; 0 by default, since hot-path callers
   * have their own timeouts and fallbacks. Background loops ask for a few.
   */
  maxRetries?: number;
  /** Receives this call's usage once it completes; the core runner meters with it. */
  onUsage?: UsageSink;
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

export interface LLMProvider {
  /** The reply model. Throws on failure, refusal or empty output. */
  generateReply(request: ReplyRequest): Promise<string>;
  /** A cheap model with strict JSON output, validated against `schema`. */
  classifyJson<T>(request: ClassifyRequest<T>): Promise<T>;
}
