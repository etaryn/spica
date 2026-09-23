import type { ClassifyRequest, LLMProvider, ReplyRequest } from "./types";

export { keywordClassifier } from "../safety/keywords";

/** Deterministic provider for tests and `pnpm eval --llm=fake`. */
export class FakeLLMProvider implements LLMProvider {
  replies: string[] = [];
  calls: ReplyRequest[] = [];
  failReplies = 0;
  replyDelayMs = 0;
  classify: (input: string) => unknown | Promise<unknown> = () => ({ flag: false, category: "none" });

  constructor(opts: { classify?: (input: string) => unknown | Promise<unknown> } = {}) {
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

  async classifyJson<T>({ input, schema }: ClassifyRequest<T>): Promise<T> {
    return schema.parse(await this.classify(input));
  }
}
