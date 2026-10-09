/**
 * The deterministic model used by tests and `pnpm eval --llm=fake`. Replies echo the last user
 * message unless scripted; structured calls go to a handler per purpose, whose defaults make
 * every background process a harmless no-op.
 */
import defaults from "../../../../config/default.json";
import { fakeTurnJudge } from "@/mind/process/turn-taking/judge";
import type { ClassifyRequest, LLMProvider, ReplyRequest } from "./types";

export { keywordClassifier } from "@/mind/process/crisis/keywords";

type Handler = (input: string) => unknown | Promise<unknown>;

const FAKE_DAY_PLAN = {
  blocks: [
    { start: "00:00", end: "08:00", kind: "quiet", busy: 0, label: "offline, winding down" },
    { start: "10:00", end: "13:00", kind: "busy", busy: 0.6, label: "reading" },
    { start: "23:00", end: "24:00", kind: "quiet", busy: 0, label: "offline, winding down" },
  ],
};

const FAKE_DAY_EVENT = {
  content: "Spica found an old film she'd forgotten she loved.",
  at: "15:00",
  valence: 0.3,
  stakes: "low",
  entity_names: [],
  kind: "spontaneous",
  thought: null,
};

export class FakeLLMProvider implements LLMProvider {
  replies: string[] = [];
  calls: ReplyRequest[] = [];
  structuredCalls: { purpose: string; system: string; input: string }[] = [];
  failReplies = 0;
  replyDelayMs = 0;
  /** Test seam: runs inside generateReply, to simulate things happening while she writes. */
  replyHook: (() => Promise<void>) | undefined = undefined;
  classify: Handler = () => ({ flag: false, category: "none" });

  handlers: Record<string, Handler> = {
    extract: () => ({ facts: [], entities: [], threads: [], relationship: null }),
    reconcile: () => ({ relation: "new", target_fact_id: null }),
    // Passing everything lets fake-mode scripts exercise the guard's mechanics, not its rubric.
    guard: () => ({ reasoning: "ok", violations: [] }),
    guard_crisis: () => ({ reasoning: "ok", violations: [] }),
    // The keyword cue check stands in for the turn judge.
    turn_judge: fakeTurnJudge(defaults.turn.incomplete_cues),
    life_plan: () => structuredClone(FAKE_DAY_PLAN),
    // Goal identity comes from code; fake content stays stable across fresh goal row IDs.
    life_event: () => ({ ...structuredClone(FAKE_DAY_EVENT), goal_ref: "model-id-ignored" }),
    // Reflects its input so the leak canary can see what reached the prompt.
    user_summarise: (input: string) => {
      const ctx = JSON.parse(input) as {
        new_memories: { content: string }[];
        what_happened: string[];
      };
      return {
        where_things_stand: `Things moved: ${ctx.what_happened.join("; ") || "nothing new"}.`,
        whats_live:
          ctx.new_memories
            .map((m) => m.content)
            .join(" ")
            .slice(0, 280) || "Nothing open.",
        how_i_feel: "I feel the same about them.",
      };
    },
    // Deterministic: a reflection on the first new memory, none without one.
    user_reflect: (input: string) => {
      const ctx = JSON.parse(input) as { new_memories: { content: string }[] };
      const first = ctx.new_memories[0]?.content;
      return {
        reflection: first ? `What stays with me: ${first}`.slice(0, 280) : null,
        subject: "user",
      };
    },
    // Deterministic: an idea about the first new memory, none without one.
    user_ideate: (input: string) => {
      const ctx = JSON.parse(input) as { new_memories: { content: string }[] };
      const first = ctx.new_memories[0]?.content;
      return { idea: first ? `Ask about: ${first}`.slice(0, 190) : null };
    },
    // Deterministic: the week's memories in one line, so a canary in a source carries through.
    user_consolidate: (input: string) => {
      const ctx = JSON.parse(input) as { sources: { content: string }[] };
      return { gist: `That week: ${ctx.sources.map((s) => s.content).join(" ")}`.slice(0, 280) };
    },
    // Deterministic: a read built from the first new memory, and one belief about it that
    // replaces the first belief it was shown, so supersede runs too.
    user_model: (input: string) => {
      const ctx = JSON.parse(input) as {
        new_memories: { content: string }[];
        beliefs: { id: string }[];
      };
      const first = ctx.new_memories[0]?.content;
      return {
        how_they_are: `Lately: ${first ?? "nothing new"}`.slice(0, 280),
        what_they_want: "To be heard.",
        what_lands: "Plain warmth.",
        beliefs: first
          ? [
              {
                text: `This matters to them: ${first}`.slice(0, 280),
                replaces: ctx.beliefs[0]?.id ?? null,
              },
            ]
          : [],
      };
    },
    core_resolve: (input: string) => ({
      content: `Instead, ${/^Planned event \([^)]*\): (.*)$/m.exec(input)?.[1] ?? "Spica changed her plans."}`,
      valence: 0,
      stakes: "low",
    }),
    core_anticipate: (input: string) => {
      const event = /^Upcoming plan: (.*)$/m.exec(input)?.[1] ?? "her plan";
      const prefix = "She wonders how ";
      const suffix = " will go.";
      const available = defaults.core.loops.max_chars - prefix.length - suffix.length;
      return {
        thought: {
          kind: "thought",
          content: `${prefix}${event.slice(0, available)}${suffix}`,
          salience: "low",
        },
        emotion: { label: "curious", valence: 0.2, arousal: 0.5, about: "the plan ahead" },
      };
    },
    core_ruminate: (input: string) => {
      const episode = /^Landed episode: (.*)$/m.exec(input)?.[1] ?? "an episode";
      const prefix = "She keeps thinking about ";
      const available = defaults.core.loops.max_chars - prefix.length - 1;
      return {
        thought: {
          kind: "thought",
          content: `${prefix}${episode.slice(0, available)}.`,
          salience: "low",
        },
      };
    },
    core_wander: (input: string) => {
      const seed = /^Seed memory: (.*)$/m.exec(input)?.[1] ?? "her own day";
      const prefix = "She finds herself thinking again about ";
      const available = defaults.core.loops.max_chars - prefix.length - 1;
      return {
        items: [
          { kind: "thought", content: `${prefix}${seed.slice(0, available)}.`, salience: "low" },
        ],
      };
    },
    core_render_snapshot: (input: string) => {
      const context = JSON.parse(input);
      const habits =
        /### Habits of speech\s*\n([\s\S]*?)(?=\n### |$)/.exec(context.previous)?.[1] ?? "";
      return {
        Lately: ["She is exploring her own interests."],
        Opinions: [],
        Interests: [],
        Goals: [],
        People: [],
        "Habits of speech": habits
          .split("\n")
          .filter((line) => line.startsWith("- "))
          .map((line) => line.slice(2)),
      };
    },
    core_reflect: () => ({
      insights: [],
      opinions: [],
      interests: [],
      goals: { add: [], drop: [] },
      narrative: null,
    }),
    core_drift_watch: () => ({ findings: [] }),
    core_consolidate: (input: string) => ({
      gist: `She remembers ${JSON.parse(input)
        .sources.map((source: { content: string }) => source.content)
        .join("; ")}.`,
    }),
    // Echoes the event, so fake-mode episodes keep the generator's words and valence.
    core_appraise: (input: string) => {
      const content = /^Event \([^)]*\): (.*)$/m.exec(input)?.[1] ?? "Spica had an ordinary day.";
      const valence = Number(/valence (-?\d+(?:\.\d+)?)/.exec(input)?.[1] ?? 0);
      return {
        episode: content,
        emotion: {
          label: valence < 0 ? "upset" : "pleased",
          valence,
          arousal: Math.abs(valence),
          about: "",
        },
        salience: "medium",
        goal_effects: [],
        need_effects: { autonomy: 0, competence: 0 },
      };
    },
  };

  constructor(options: { classify?: Handler } = {}) {
    if (options.classify) this.classify = options.classify;
  }

  async generateReply(request: ReplyRequest): Promise<string> {
    if (this.replyHook) await this.replyHook();
    this.calls.push(request);

    if (this.replyDelayMs > 0)
      await new Promise((resolve) => setTimeout(resolve, this.replyDelayMs));

    if (this.failReplies > 0) {
      this.failReplies -= 1;
      throw new Error("fake reply failure");
    }

    const lastUserMessage = [...request.messages].reverse().find((m) => m.role === "user");
    return this.replies.shift() ?? `(fake reply to: ${lastUserMessage?.content ?? ""})`;
  }

  async classifyJson<T>({
    purpose,
    system,
    input,
    schema,
    onUsage,
  }: ClassifyRequest<T>): Promise<T> {
    this.structuredCalls.push({ purpose, system, input });

    const handler = this.handlers[purpose] ?? (purpose === "crisis" ? this.classify : undefined);
    if (!handler) throw new Error(`FakeLLMProvider: no handler for purpose "${purpose}"`);

    const out = schema.parse(await handler(input));
    onUsage?.({
      purpose,
      model: "fake",
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
    return out;
  }
}
