/**
 * The same provider, with every call booked to one user. Wrapped once where a user's work begins,
 * so no call site has to pass the id along. Core code never wraps: its calls belong to nobody.
 */
import type { LLMProvider } from "./types";

export function forUser(llm: LLMProvider, userId: string): LLMProvider {
  return {
    generateReply: (request) => llm.generateReply({ userId, ...request }),
    classifyJson: (request) => llm.classifyJson({ userId, ...request }),
  };
}
