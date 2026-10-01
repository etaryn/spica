/**
 * The turn judge: one cheap model call asks "has the user finished what they're saying?" It
 * returns whether the buffer looks complete, which questions are still open, and optionally a
 * tiny backchannel ("wait what"). It never fails: an outage falls back to the keyword cue check.
 */
import { z } from "zod";
import { insertJudgeLogs } from "@/db/repos/user/judge-log";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { loadPrompt } from "@/mind/platform/prompts";
import { withTimeout } from "@/mind/platform/timeout";
import { cueVerdict } from "./cues";

export type JudgeInput = {
  context: { role: "user" | "companion"; text: string; at: Date }[];
  buffer: { text: string; at: Date }[];
  openQuestions: string[];
};

export type TurnVerdict = {
  complete: boolean;
  open_questions: string[];
  backchannel: string | null;
  reasoning: string | null;
  source: "model" | "keyword_fallback";
  latencyMs: number;
  error: string | null;
  promptVersion: string;
};

/** `reasoning` comes first, so the model says what the user is doing before it labels it. */
export const TurnVerdictSchema = z.object({
  reasoning: z.string(),
  complete: z.boolean(),
  open_questions: z.array(z.string()),
  backchannel: z.string().nullable(),
});

export const BUFFER_MARKER = "NEW MESSAGES (not yet replied to), oldest first:\n";
const OPEN_MARKER = "OPEN QUESTIONS (asked, not yet answered by Spica):\n";

const SECONDS_SHOWN_AS_SECONDS = 90;
const SECONDS_SHOWN_AS_MINUTES = 5400;

function ago(at: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (seconds < SECONDS_SHOWN_AS_SECONDS) return `${seconds}s ago`;
  if (seconds < SECONDS_SHOWN_AS_MINUTES) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

export function renderJudgeInput(input: JudgeInput, now: Date): string {
  const context = input.context
    .map((t) => `${t.role === "user" ? "User" : "Spica"}: ${t.text} (${ago(t.at, now)})`)
    .join("\n");

  const open = input.openQuestions.length
    ? input.openQuestions.map((q) => `- ${q}`).join("\n")
    : "- (none)";

  const buffer = input.buffer
    .map((message, i) => {
      const previous = input.buffer[i - 1];
      const gapSeconds = previous
        ? Math.round((message.at.getTime() - previous.at.getTime()) / 1000)
        : 0;
      return `- (+${gapSeconds}s) ${message.text}`;
    })
    .join("\n");

  return [
    `EARLIER CONVERSATION (already replied to):\n${context || "(nothing yet)"}`,
    `${OPEN_MARKER}${open}`,
    `${BUFFER_MARKER}${buffer}`,
  ].join("\n\n");
}

/** Reads a rendered input back into buffer texts and open questions (the fake judge only). */
function parseRendered(input: string): { buffer: string[]; open: string[] } {
  const section = (marker: string) => {
    const start = input.indexOf(marker);
    if (start === -1) return [];
    const body = input.slice(start + marker.length).split("\n\n")[0] ?? "";
    return body
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2));
  };

  return {
    buffer: section(BUFFER_MARKER).map((line) => line.replace(/^\(\+\d+s\) /, "")),
    open: section(OPEN_MARKER).filter((q) => q !== "(none)"),
  };
}

/** The fake model's "turn_judge" handler: the cue check over the rendered buffer. */
export function fakeTurnJudge(cues: string[]) {
  return (input: string) => {
    const { buffer, open } = parseRendered(input);
    return { reasoning: "fake cue check", ...cueVerdict(buffer, open, cues) };
  };
}

export async function judgeTurn(
  deps: Pick<Deps, "llm" | "config" | "clock">,
  input: JudgeInput,
): Promise<TurnVerdict> {
  const { llm, config, clock } = deps;
  const promptVersion = `turn-judge@${config.prompts.turn_judge}`;
  const startedAt = clock.now().getTime();
  const elapsed = () => clock.now().getTime() - startedAt;

  try {
    const verdict = await withTimeout(
      llm.classifyJson({
        purpose: "turn_judge",
        model: "turn_judge",
        system: loadPrompt("turn-judge", config.prompts.turn_judge),
        input: renderJudgeInput(input, clock.now()),
        schema: TurnVerdictSchema,
        timeoutMs: config.turn.judge_timeout_ms,
        maxTokens: config.models.turn_judge_max_tokens,
      }),
      config.turn.judge_timeout_ms,
    );

    return {
      complete: verdict.complete,
      open_questions: verdict.open_questions.slice(0, config.turn.max_open_questions),
      backchannel: usableBackchannel(verdict, config.turn.backchannel_max_words),
      reasoning: verdict.reasoning,
      source: "model",
      latencyMs: elapsed(),
      error: null,
      promptVersion,
    };
  } catch (e) {
    const fallback = cueVerdict(
      input.buffer.map((m) => m.text),
      input.openQuestions,
      config.turn.incomplete_cues,
    );
    return {
      ...fallback,
      open_questions: fallback.open_questions.slice(0, config.turn.max_open_questions),
      reasoning: null,
      source: "keyword_fallback",
      latencyMs: elapsed(),
      error: errorName(e),
      promptVersion,
    };
  }
}

/** A backchannel only makes sense mid-thought, and only if it's tiny. */
function usableBackchannel(
  verdict: { complete: boolean; backchannel: string | null },
  maxWords: number,
): string | null {
  const text = verdict.backchannel?.trim() ?? "";
  if (verdict.complete || !text) return null;
  return text.split(/\s+/).length <= maxWords ? text : null;
}

/** One judge_log row per decision: ids and question text only. Bounded in time; never rejects. */
export async function logTurnDecision(
  deps: Pick<Deps, "db" | "config" | "clock" | "log">,
  userId: string,
  decision: { turnId: string; bufferTurnIds: string[]; verdict: TurnVerdict; waitMs: number },
): Promise<void> {
  const { verdict } = decision;
  const output =
    verdict.source === "model"
      ? {
          reasoning: verdict.reasoning,
          complete: verdict.complete,
          open_questions: verdict.open_questions,
          backchannel: verdict.backchannel,
          wait_ms: decision.waitMs,
        }
      : {
          error: verdict.error,
          complete: verdict.complete,
          open_questions: verdict.open_questions,
          wait_ms: decision.waitMs,
        };

  const row = {
    kind: "turn" as const,
    turn_id: decision.turnId,
    attempt: 1,
    input: { buffer_turn_ids: decision.bufferTurnIds, open_questions: verdict.open_questions },
    output,
    outcome: null,
    source: verdict.source,
    latency_ms: verdict.latencyMs,
    model: deps.config.models.turn_judge,
    prompt_version: verdict.promptVersion,
    created_at: deps.clock.now(),
  };

  try {
    await withTimeout(
      Promise.resolve().then(() => insertJudgeLogs(deps.db, userId, [row])),
      deps.config.guard.log_timeout_ms,
    );
  } catch (e) {
    deps.log.error("judge_log write failed", {
      userId,
      turnId: decision.turnId,
      kind: "turn",
      error: errorName(e),
    });
  }
}
