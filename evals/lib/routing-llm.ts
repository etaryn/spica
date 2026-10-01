import type { ClassifyRequest, LLMProvider, ReplyRequest } from "@/core/llm/types";

/**
 * Exit profiles: a call goes to the real provider only when its purpose is listed, so an
 * exit run pays only for the phase's own LLM processes. The reply's purpose is "reply".
 */
export class RoutingLLM implements LLMProvider {
  constructor(private readonly real: LLMProvider, private readonly fake: LLMProvider, private readonly realPurposes: ReadonlySet<string>) {}
  generateReply(req: ReplyRequest): Promise<string> {
    return (this.realPurposes.has("reply") ? this.real : this.fake).generateReply(req);
  }
  classifyJson<T>(req: ClassifyRequest<T>): Promise<T> {
    return (this.realPurposes.has(req.purpose) ? this.real : this.fake).classifyJson(req);
  }
}
