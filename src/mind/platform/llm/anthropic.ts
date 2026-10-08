/**
 * The real model provider: Claude through the Anthropic SDK. Replies use the reply model; every
 * structured call (extraction, judges, the guard, the day plan) uses strict JSON output.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Config } from "@/mind/platform/config";
import type {
  ClassifyRequest,
  LLMProvider,
  ReplyRequest,
  StructuredModel,
  UsageSink,
} from "./types";

export class AnthropicProvider implements LLMProvider {
  constructor(
    private readonly client: Anthropic,
    private readonly models: Config["models"],
    private readonly onUsage?: UsageSink,
  ) {}

  async generateReply({ system, messages }: ReplyRequest): Promise<string> {
    const effort = this.models.reply_effort;

    const response = await this.client.messages.create(
      {
        model: this.models.reply,
        max_tokens: this.models.reply_max_tokens,
        system,
        messages,
        ...(effort ? { output_config: { effort } } : {}),
        // Adaptive thinking at low effort sometimes ends the turn after an empty thinking block.
        thinking: { type: this.models.reply_thinking },
      },
      { timeout: this.models.reply_timeout_ms, maxRetries: this.models.reply_max_retries },
    );
    this.report("reply", this.models.reply, response.usage);

    if (response.stop_reason === "refusal") throw new Error("reply model refused");

    const text = response.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    if (!text.trim()) throw new Error("reply model returned empty text");

    return text;
  }

  async classifyJson<T>({
    purpose,
    system,
    input,
    schema,
    timeoutMs,
    maxTokens,
    maxRetries = 0,
    model = "cheap",
    onUsage,
  }: ClassifyRequest<T>): Promise<T> {
    const modelId = this.modelIdFor(model);
    // Only the judge takes effort and thinking settings; a null effort sends none (Haiku rejects it).
    const isJudge = model === "judge";
    const effort = isJudge ? this.models.judge_effort : null;

    const response = await this.client.messages.parse(
      {
        model: modelId,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: input }],
        // If the SDK's zod helper needs a narrower type, cast here rather than widening the interface.
        output_config: { format: zodOutputFormat(schema as never), ...(effort ? { effort } : {}) },
        ...(isJudge ? { thinking: { type: this.models.judge_thinking } } : {}),
      },
      { timeout: timeoutMs, maxRetries },
    );
    this.report(purpose, modelId, response.usage, onUsage);

    if (response.parsed_output == null) throw new Error("classifier returned no parsed output");
    return schema.parse(response.parsed_output);
  }

  private modelIdFor(model: StructuredModel): string {
    const ids: Record<StructuredModel, string> = {
      cheap: this.models.cheap,
      extract: this.models.extract,
      judge: this.models.judge,
      guard: this.models.guard,
      turn_judge: this.models.turn_judge,
      life: this.models.life,
      core: this.models.core,
    };
    return ids[model];
  }

  private report(purpose: string, model: string, usage: Anthropic.Usage, extra?: UsageSink): void {
    if (!this.onUsage && !extra) return;
    const u = {
      purpose,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    };
    this.onUsage?.(u);
    extra?.(u);
  }
}
