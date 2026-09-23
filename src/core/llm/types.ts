import type { z } from "zod";

/** Provider-neutral on purpose: the provider may change (see DECISIONS.md). */
export type ChatMessage = { role: "user" | "assistant"; content: string };

export interface ReplyRequest {
  system: string;
  messages: ChatMessage[];
}

export interface ClassifyRequest<T> {
  system: string;
  input: string;
  schema: z.ZodType<T>;
  timeoutMs: number;
  maxTokens: number;
}

export interface LLMProvider {
  /** Reply model. Throws on failure, refusal or empty output. */
  generateReply(req: ReplyRequest): Promise<string>;
  /** Cheap model with strict JSON output validated against `schema`. */
  classifyJson<T>(req: ClassifyRequest<T>): Promise<T>;
}
