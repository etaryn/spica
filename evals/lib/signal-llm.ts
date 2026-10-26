import type { Signals } from "@/mind/state/user/relationship/signals";
import { newMessages } from "@/mind/platform/llm/fake-labels";
import type { ClassifyRequest, LLMProvider, ReplyRequest } from "@/mind/platform/llm/types";

const NONE: Omit<Signals, "hurt"> = {
  warmth: 0,
  trust: 0,
  tension: 0,
  apology: false,
  make_up: false,
  ends_relationship: false,
  retracts_ending: false,
  wants_repair: false,
};
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Fake-mode relationship signals: the labelling's `relationship` block comes from the script's
 * `signals` for the newest scripted user message among the new messages. Turn texts with signals
 * must be unique per script (enforced by the runner). A message matches only whole (spacing
 * aside), so a scripted text that's a prefix of a longer, unscripted message never collides with
 * it; while SignalLLM is active, a `relationship: null` override on a no-hit exchange keeps
 * mechanics scripts deterministic even under a real labeller. The hurt's words come from code,
 * so a scripted hurt names no moves.
 */
export class SignalLLM implements LLMProvider {
  constructor(
    private readonly inner: LLMProvider,
    private readonly byText: Map<string, Partial<Signals>>,
  ) {}
  generateReply(req: ReplyRequest): Promise<string> {
    return this.inner.generateReply(req);
  }
  async classifyJson<T>(req: ClassifyRequest<T>): Promise<T> {
    const out = await this.inner.classifyJson(req);
    if (req.purpose !== "labels_signals") return out;
    let hit: Partial<Signals> | undefined;
    for (const m of newMessages(req.input)) {
      if (m.speaker !== "user") continue;
      for (const [text, s] of this.byText) if (collapse(m.text) === collapse(text)) hit = s;
    }
    const relationship = hit
      ? {
          ...NONE,
          ...hit,
          hurt: hit.hurt ? { amount: hit.hurt.amount, moves: [] } : null,
          moves: [],
        }
      : null;
    return { ...(out as object), relationship } as T;
  }
}
