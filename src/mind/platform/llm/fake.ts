import defaults from "../../../../config/default.json";
import { fakeTurnJudge } from "@/mind/process/turn-taking/judge";
import type { ClassifyRequest, LLMProvider, ReplyRequest } from "./types";

export { keywordClassifier } from "@/mind/process/crisis/keywords";

type Handler = (input: string) => unknown | Promise<unknown>;

/** Deterministic provider for tests and `pnpm eval --llm=fake`. */
export class FakeLLMProvider implements LLMProvider {
  replies: string[] = [];
  calls: ReplyRequest[] = [];
  structuredCalls: { purpose: string; input: string }[] = [];
  failReplies = 0;
  replyDelayMs = 0;
  /** Test seam: runs inside generateReply, to simulate things happening while a reply is being written. */
  replyHook: (() => Promise<void>) | undefined = undefined;
  classify: Handler = () => ({ flag: false, category: "none" });
  /** Structured-call handlers by purpose. Defaults keep the cold path a no-op in fake mode. */
  handlers: Record<string, Handler> = {
    extract: () => ({ facts: [], entities: [], threads: [], relationship: null }),
    reconcile: () => ({ relation: "new", target_fact_id: null }),
    // The guard passes everything by default so fake-mode scripts exercise the mechanics, not the rubric.
    guard: () => ({ reasoning: "ok", violations: [] }),
    guard_crisis: () => ({ reasoning: "ok", violations: [] }),
    // The deterministic cue check stands in for the turn judge in tests and --llm=fake evals.
    turn_judge: fakeTurnJudge(defaults.turn.incomplete_cues),
    // A valid shared day and one small personal event, so fake-mode life scripts run the mechanics.
    life_plan: () => ({
      blocks: [
        { start: "00:00", end: "08:00", kind: "quiet", busy: 0, label: "offline, winding down" },
        { start: "10:00", end: "13:00", kind: "busy", busy: 0.6, label: "reading" },
        { start: "23:00", end: "24:00", kind: "quiet", busy: 0, label: "offline, winding down" },
      ],
    }),
    life_event: () => ({
      content: "Spica found an old film she'd forgotten she loved.",
      at: "15:00",
      valence: 0.3,
      stakes: "low",
      entity_names: [],
    }),
  };

  constructor(opts: { classify?: Handler } = {}) {
    if (opts.classify) this.classify = opts.classify;
  }

  async generateReply(req: ReplyRequest): Promise<string> {
    if (this.replyHook) await this.replyHook();
    this.calls.push(req);
    if (this.replyDelayMs > 0) await new Promise((r) => setTimeout(r, this.replyDelayMs));
    if (this.failReplies > 0) {
      this.failReplies -= 1;
      throw new Error("fake reply failure");
    }
    const last = [...req.messages].reverse().find((m) => m.role === "user");
    return this.replies.shift() ?? `(fake reply to: ${last?.content ?? ""})`;
  }

  async classifyJson<T>({ purpose, input, schema }: ClassifyRequest<T>): Promise<T> {
    this.structuredCalls.push({ purpose, input });
    const handler = this.handlers[purpose] ?? (purpose === "crisis" ? this.classify : undefined);
    if (!handler) throw new Error(`FakeLLMProvider: no handler for purpose "${purpose}"`);
    return schema.parse(await handler(input));
  }
}
