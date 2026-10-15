/**
 * Every real model call an eval tool makes, written as it happens: purpose, prompt, output or
 * error, one JSON line each, under `evals/results/calls/`. Real runs cost money, so none of them
 * may leave its outputs unread for want of a flag; tools get their real provider only from here.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "@/mind/platform/config";
import { AnthropicProvider } from "@/mind/platform/llm/anthropic";
import {
  type ClassifyRequest,
  type LLMProvider,
  type ReplyRequest,
  type UsageSink,
  systemText,
} from "@/mind/platform/llm/types";

export class CallLog implements LLMProvider {
  constructor(
    private readonly inner: LLMProvider,
    readonly file: string,
  ) {
    mkdirSync(path.dirname(file), { recursive: true });
  }

  async generateReply(req: ReplyRequest): Promise<string> {
    const prompt = { system: systemText(req.system), messages: req.messages };
    return this.logged("reply", prompt, () => this.inner.generateReply(req));
  }

  async classifyJson<T>(req: ClassifyRequest<T>): Promise<T> {
    const prompt = { system: req.system, input: req.input };
    return this.logged(req.purpose, prompt, () => this.inner.classifyJson(req));
  }

  private async logged<T>(purpose: string, prompt: object, call: () => Promise<T>): Promise<T> {
    const at = new Date().toISOString();
    try {
      const output = await call();
      this.write({ at, purpose, ...prompt, output });
      return output;
    } catch (e) {
      this.write({ at, purpose, ...prompt, error: (e as Error).message });
      throw e;
    }
  }

  private write(entry: object): void {
    appendFileSync(this.file, JSON.stringify(entry) + "\n");
  }
}

/** The real provider for an eval tool, logging every call to `evals/results/calls/<tool>-<stamp>.jsonl`. */
export function realProvider(config: Config, tool: string, onUsage?: UsageSink): CallLog {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(process.cwd(), "evals", "results", "calls", `${tool}-${stamp}.jsonl`);
  return new CallLog(new AnthropicProvider(new Anthropic(), config.models, onUsage), file);
}
