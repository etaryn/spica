import type Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { Config } from "../config";
import type { ClassifyRequest, LLMProvider, ReplyRequest, StructuredModel, UsageSink } from "./types";

export class AnthropicProvider implements LLMProvider {
  constructor(
    private readonly client: Anthropic,
    private readonly models: Config["models"],
    private readonly onUsage?: UsageSink,
  ) {}

  async generateReply({ system, messages }: ReplyRequest): Promise<string> {
    const res = await this.client.messages.create(
      {
        model: this.models.reply,
        max_tokens: this.models.reply_max_tokens,
        system,
        messages,
        ...(this.models.reply_effort ? { output_config: { effort: this.models.reply_effort } } : {}),
        // Adaptive thinking at low effort sometimes ends the turn after an empty thinking block with no text.
        thinking: { type: this.models.reply_thinking },
      },
      { timeout: this.models.reply_timeout_ms, maxRetries: this.models.reply_max_retries },
    );
    this.report("reply", this.models.reply, res.usage);
    if (res.stop_reason === "refusal") throw new Error("reply model refused");
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    if (!text.trim()) throw new Error("reply model returned empty text");
    return text;
  }

  async classifyJson<T>({ purpose, system, input, schema, timeoutMs, maxTokens, model = "cheap" }: ClassifyRequest<T>): Promise<T> {
    const ids: Record<StructuredModel, string> = {
      cheap: this.models.cheap, extract: this.models.extract, judge: this.models.judge, guard: this.models.guard,
    };
    const modelId = ids[model];
    // Only the judge takes effort/thinking settings; a null effort sends none (Haiku rejects it).
    const judge = model === "judge";
    const effort = judge ? this.models.judge_effort : null;
    const res = await this.client.messages.parse(
      {
        model: modelId,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: input }],
        // If the SDK's zod helper needs a narrower type, cast here rather than widening the interface.
        output_config: { format: zodOutputFormat(schema as never), ...(effort ? { effort } : {}) },
        ...(judge ? { thinking: { type: this.models.judge_thinking } } : {}),
      },
      { timeout: timeoutMs, maxRetries: 0 },
    );
    this.report(purpose, modelId, res.usage);
    if (res.parsed_output == null) throw new Error("classifier returned no parsed output");
    return schema.parse(res.parsed_output);
  }

  private report(purpose: string, model: string, usage: Anthropic.Usage) {
    this.onUsage?.({
      purpose,
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    });
  }
}
