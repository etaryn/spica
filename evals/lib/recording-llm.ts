import type { ClassifyRequest, LLMProvider, ReplyRequest } from "@/mind/platform/llm/types";

/**
 * Records every reply prompt (system + user messages) so evals can check what each user's model saw.
 * Spica's own earlier replies are left out: a leak shows up in memories or user turns, and her own
 * word choices (suggesting "biscuit" as a cat name) aren't another user's data.
 */
export class RecordingLLM implements LLMProvider {
  prompts: string[] = [];
  constructor(private readonly inner: LLMProvider) {}
  generateReply(req: ReplyRequest): Promise<string> {
    this.prompts.push(
      [req.system, ...req.messages.filter((m) => m.role === "user").map((m) => m.content)].join(
        "\n",
      ),
    );
    return this.inner.generateReply(req);
  }
  classifyJson<T>(req: ClassifyRequest<T>): Promise<T> {
    return this.inner.classifyJson(req);
  }
}
