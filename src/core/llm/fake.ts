import type { ClassifyRequest, LLMProvider, ReplyRequest } from "./types";

export { keywordClassifier } from "../safety/keywords";

type Handler = (input: string) => unknown | Promise<unknown>;

/** Deterministic provider for tests and `pnpm eval --llm=fake`. */
export class FakeLLMProvider implements LLMProvider {
  replies: string[] = [];
  calls: ReplyRequest[] = [];
  structuredCalls: { purpose: string; input: string }[] = [];
  failReplies = 0;
  replyDelayMs = 0;
  classify: Handler = () => ({ flag: false, category: "none" });
  /** Structured-call handlers by purpose. Defaults keep the cold path a no-op in fake mode. */
  handlers: Record<string, Handler> = {
    extract: () => ({ facts: [], entities: [], threads: [] }),
    reconcile: () => ({ relation: "new", target_fact_id: null }),
  };

  constructor(opts: { classify?: Handler } = {}) {
    if (opts.classify) this.classify = opts.classify;
  }

  async generateReply(req: ReplyRequest): Promise<string> {
    this.calls.push(req);
    if (this.replyDelayMs > 0) await new Promise((r) => setTimeout(r, this.replyDelayMs));
    if (this.failReplies > 0) {
      this.failReplies -= 1;
      throw new Error("fake reply failure");
    }
    const last = [...req.messages].reverse().find((m) => m.role === "user");
    return this.replies.shift() ?? `(fake reply to: ${last?.content ?? ""})`;
  }

  async classifyJson<T>({ purpose, input, schema }: ClassifyRequest<T>): Promise<T> {
    this.structuredCalls.push({ purpose, input });
    const handler = this.handlers[purpose] ?? (purpose === "crisis" ? this.classify : undefined);
    if (!handler) throw new Error(`FakeLLMProvider: no handler for purpose "${purpose}"`);
    return schema.parse(await handler(input));
  }
}
