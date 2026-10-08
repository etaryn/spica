import type { ClassifyRequest, LLMProvider, ReplyRequest } from "@/mind/platform/llm/types";

/** One core-loop model call: the prompt input and the parsed output. */
export type CoreCall = { purpose: string; input: string; output: unknown };

/**
 * Records every reply prompt (system + user messages) so evals can check what each user's model saw.
 * Spica's own earlier replies are left out: a leak shows up in memories or user turns, and her own
 * word choices (suggesting "biscuit" as a cat name) aren't another user's data. Her core loops'
 * calls are kept whole (input and output) for the review file.
 */
export class RecordingLLM implements LLMProvider {
  prompts: string[] = [];
  coreCalls: CoreCall[] = [];
  constructor(private readonly inner: LLMProvider) {}
  generateReply(req: ReplyRequest): Promise<string> {
    this.prompts.push(
      [req.system, ...req.messages.filter((m) => m.role === "user").map((m) => m.content)].join(
        "\n",
      ),
    );
    return this.inner.generateReply(req);
  }
  async classifyJson<T>(req: ClassifyRequest<T>): Promise<T> {
    const out = await this.inner.classifyJson(req);
    if (req.purpose.startsWith("core_"))
      this.coreCalls.push({ purpose: req.purpose, input: req.input, output: out });
    return out;
  }
}
