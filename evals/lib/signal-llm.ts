import type { Signals } from "@/core/relationship/signals";
import type { ClassifyRequest, LLMProvider, ReplyRequest } from "@/core/llm/types";

const NONE: Signals = { warmth: 0, trust: 0, tension: 0, hurt: null, apology: false, make_up: false, ends_relationship: false, retracts_ending: false, wants_repair: false };
const MARKER = "New exchange (extract from this):";

/**
 * Fake-mode relationship signals: the extraction's `relationship` block comes from the script's
 * `signals` for the newest scripted user turn in the new exchange. Turn texts with signals must be unique per
 * script (enforced by the runner). Lines are matched whole (not by substring) so a scripted text that's a
 * prefix of a longer, unscripted line never collides with it; while SignalLLM is active, a `relationship:
 * null` override on a no-hit exchange keeps mechanics scripts deterministic even under a real extractor.
 */
export class SignalLLM implements LLMProvider {
  constructor(private readonly inner: LLMProvider, private readonly byText: Map<string, Partial<Signals>>) {}
  generateReply(req: ReplyRequest): Promise<string> { return this.inner.generateReply(req); }
  async classifyJson<T>(req: ClassifyRequest<T>): Promise<T> {
    const out = await this.inner.classifyJson(req);
    if (req.purpose !== "extract") return out;
    const exchange = req.input.split(MARKER)[1] ?? "";
    let hit: Partial<Signals> | undefined;
    // A line is a hit only when it ends with exactly "User: <text>" (allowing trailing whitespace): the whole
    // `[ts] User: <text>` line, not a substring of a longer message. The last matching line wins.
    for (const line of exchange.split("\n")) {
      const trimmed = line.trimEnd();
      for (const [text, s] of this.byText) if (trimmed.endsWith(`User: ${text}`)) hit = s;
    }
    return { ...(out as object), relationship: hit ? { ...NONE, ...hit } : null } as T;
  }
}
