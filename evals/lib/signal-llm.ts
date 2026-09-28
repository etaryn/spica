import type { Signals } from "@/core/relationship/signals";
import type { ClassifyRequest, LLMProvider, ReplyRequest } from "@/core/llm/types";

const NONE: Signals = { warmth: 0, trust: 0, tension: 0, hurt: null, apology: false, make_up: false, ends_relationship: false, retracts_ending: false, wants_repair: false };
const MARKER = "New exchange (extract from this):";

/**
 * Fake-mode relationship signals (design §8.3): the extraction's `relationship` block comes from the script's
 * `signals` for the newest scripted user turn in the new exchange. Turn texts with signals must be unique per script.
 */
export class SignalLLM implements LLMProvider {
  constructor(private readonly inner: LLMProvider, private readonly byText: Map<string, Partial<Signals>>) {}
  generateReply(req: ReplyRequest): Promise<string> { return this.inner.generateReply(req); }
  async classifyJson<T>(req: ClassifyRequest<T>): Promise<T> {
    const out = await this.inner.classifyJson(req);
    if (req.purpose !== "extract") return out;
    const exchange = req.input.split(MARKER)[1] ?? "";
    let hit: Partial<Signals> | undefined;
    let at = -1;
    for (const [text, s] of this.byText) {
      const i = exchange.lastIndexOf(`User: ${text}`);
      if (i > at) { at = i; hit = s; }
    }
    return hit ? ({ ...(out as object), relationship: { ...NONE, ...hit } } as T) : out;
  }
}
