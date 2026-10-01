import { z } from "zod";
import { insertJudgeLogs } from "@/db/repos/judge-log";
import type { Deps } from "../deps";
import { errorName } from "../errors";
import { loadPrompt } from "../prompts";
import { withTimeout } from "../timeout";
import { cueVerdict } from "./cues";

export type JudgeInput = {
  context: { role: "user" | "companion"; text: string; at: Date }[];
  buffer: { text: string; at: Date }[];
  openQuestions: string[];
};
export type TurnVerdict = {
  complete: boolean; open_questions: string[]; backchannel: string | null; reasoning: string | null;
  source: "model" | "keyword_fallback"; latencyMs: number; error: string | null; promptVersion: string;
};

/** `reasoning` first, as with the guard: the model states what the user is doing before it labels. */
export const TurnVerdictSchema = z.object({
  reasoning: z.string(),
  complete: z.boolean(),
  open_questions: z.array(z.string()),
  backchannel: z.string().nullable(),
});

export const BUFFER_MARKER = "NEW MESSAGES (not yet replied to), oldest first:\n";
const OPEN_MARKER = "OPEN QUESTIONS (asked, not yet answered by Spica):\n";

function ago(at: Date, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export function renderJudgeInput(input: JudgeInput, now: Date): string {
  const context = input.context.map((t) => `${t.role === "user" ? "User" : "Spica"}: ${t.text} (${ago(t.at, now)})`).join("\n");
  const open = input.openQuestions.length ? input.openQuestions.map((q) => `- ${q}`).join("\n") : "- (none)";
  const buffer = input.buffer.map((m, i) => {
    const gap = i === 0 ? 0 : Math.round((m.at.getTime() - input.buffer[i - 1]!.at.getTime()) / 1000);
    return `- (+${gap}s) ${m.text}`;
  }).join("\n");
  return [`EARLIER CONVERSATION (already replied to):\n${context || "(nothing yet)"}`, `${OPEN_MARKER}${open}`, `${BUFFER_MARKER}${buffer}`].join("\n\n");
}

/** Parses a rendered input back into buffer texts and open questions (fake judge only). */
function parseRendered(input: string): { buffer: string[]; open: string[] } {
  const section = (marker: string) => {
    const i = input.indexOf(marker);
    if (i === -1) return [];
    const body = input.slice(i + marker.length).split("\n\n")[0] ?? "";
    return body.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  };
  return {
    buffer: section(BUFFER_MARKER).map((l) => l.replace(/^\(\+\d+s\) /, "")),
    open: section(OPEN_MARKER).filter((q) => q !== "(none)"),
  };
}

/** `FakeLLMProvider` handler for purpose "turn_judge": the cue check over the rendered buffer. */
export function fakeTurnJudge(cues: string[]) {
  return (input: string) => {
    const { buffer, open } = parseRendered(input);
    return { reasoning: "fake cue check", ...cueVerdict(buffer, open, cues) };
  };
}

/** The cheap `context_complete?` judge. Never rejects: an outage falls back to the cue check. */
export async function judgeTurn(deps: Pick<Deps, "llm" | "config" | "clock">, input: JudgeInput): Promise<TurnVerdict> {
  const { llm, config, clock } = deps;
  const promptVersion = `turn-judge@${config.prompts.turn_judge}`;
  const start = clock.now().getTime();
  const elapsed = () => clock.now().getTime() - start;
  try {
    const r = await withTimeout(llm.classifyJson({
      purpose: "turn_judge", model: "turn_judge", system: loadPrompt("turn-judge", config.prompts.turn_judge),
      input: renderJudgeInput(input, clock.now()), schema: TurnVerdictSchema,
      timeoutMs: config.turn.judge_timeout_ms, maxTokens: config.models.turn_judge_max_tokens,
    }), config.turn.judge_timeout_ms);
    const bc = r.backchannel?.trim() ?? "";
    const backchannel = !r.complete && bc && bc.split(/\s+/).length <= config.turn.backchannel_max_words ? bc : null;
    return {
      complete: r.complete, open_questions: r.open_questions.slice(0, config.turn.max_open_questions), backchannel,
      reasoning: r.reasoning, source: "model", latencyMs: elapsed(), error: null, promptVersion,
    };
  } catch (e) {
    const v = cueVerdict(input.buffer.map((m) => m.text), input.openQuestions, config.turn.incomplete_cues);
    return { ...v, open_questions: v.open_questions.slice(0, config.turn.max_open_questions), reasoning: null, source: "keyword_fallback", latencyMs: elapsed(), error: errorName(e), promptVersion };
  }
}

/** One judge_log row per decision. Ids and question text only; bounded; never rejects. */
export async function logTurnDecision(
  deps: Pick<Deps, "db" | "config" | "clock" | "log">, userId: string,
  a: { turnId: string; bufferTurnIds: string[]; verdict: TurnVerdict; waitMs: number },
): Promise<void> {
  const v = a.verdict;
  const output = v.source === "model"
    ? { reasoning: v.reasoning, complete: v.complete, open_questions: v.open_questions, backchannel: v.backchannel, wait_ms: a.waitMs }
    : { error: v.error, complete: v.complete, open_questions: v.open_questions, wait_ms: a.waitMs };
  try {
    await withTimeout(Promise.resolve().then(() => insertJudgeLogs(deps.db, userId, [{
      kind: "turn", turn_id: a.turnId, attempt: 1, input: { buffer_turn_ids: a.bufferTurnIds, open_questions: v.open_questions },
      output, outcome: null, source: v.source, latency_ms: v.latencyMs, model: deps.config.models.turn_judge,
      prompt_version: v.promptVersion, created_at: deps.clock.now(),
    }])), deps.config.guard.log_timeout_ms);
  } catch (e) {
    deps.log.error("judge_log write failed", { userId, turnId: a.turnId, kind: "turn", error: errorName(e) });
  }
}
