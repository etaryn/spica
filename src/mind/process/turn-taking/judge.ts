/**
 * The turn judge: one cheap model call asks "has the user finished what they're saying?" It
 * returns whether the buffer looks complete, which questions are still open, and optionally a
 * tiny backchannel ("wait what"). It points at the user's words by piece id and never rewrites
 * them. It never fails: an outage falls back to the keyword cue check.
 */
import { z } from "zod";
import { insertJudgeLogs } from "@/db/repos/user/judge-log";
import { coordinate, numberPieces, type Piece } from "@/mind/memory/user/pieces";
import type { TurnConfig } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { errorName } from "@/mind/platform/errors";
import { loadPrompt } from "@/mind/platform/prompts";
import { withTimeout } from "@/mind/platform/timeout";
import { cueVerdict } from "./cues";
import { sharesWords, type QuestionVerdict, type ShownQuestion } from "./questions";

export type JudgeInput = {
  context: { role: "user" | "companion"; text: string; at: Date }[];
  buffer: { id: string; text: string; at: Date }[];
  openQuestions: ShownQuestion[];
};

export type TurnVerdict = {
  complete: boolean;
  questions: QuestionVerdict;
  /** The words of the questions it holds open, for the log. */
  openWords: string[];
  backchannel: string | null;
  reasoning: string | null;
  source: "model" | "keyword_fallback";
  latencyMs: number;
  error: string | null;
  promptVersion: string;
};

/** `reasoning` comes first, so the model says what the user is doing before it labels it. */
const TurnVerdictSchema = z.object({
  reasoning: z.string(),
  complete: z.boolean(),
  still_open: z.array(z.string()),
  asked: z.array(z.array(z.string())),
  backchannel: z.string().nullable(),
});
type Picks = { still_open: string[]; asked: string[][] };

const BUFFER_MARKER = "NEW MESSAGES (not yet replied to), oldest first, as [message.piece]:\n";
const OPEN_MARKER = "OPEN QUESTIONS (asked, not yet answered by Spica):\n";

const SECONDS_SHOWN_AS_SECONDS = 90;
const SECONDS_SHOWN_AS_MINUTES = 5400;

function ago(at: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (seconds < SECONDS_SHOWN_AS_SECONDS) return `${seconds}s ago`;
  if (seconds < SECONDS_SHOWN_AS_MINUTES) return `${Math.round(seconds / 60)} min ago`;
  return `${Math.round(seconds / 3600)} h ago`;
}

/** The buffer as numbered pieces, the same numbering the labels use. */
function bufferPieces(buffer: JudgeInput["buffer"]): Piece[] {
  return numberPieces(
    buffer.map((m) => ({ ...m, speaker: "user" as const })),
    0,
  );
}

export function renderJudgeInput(input: JudgeInput, now: Date): string {
  const context = input.context
    .map((t) => `${t.role === "user" ? "User" : "Spica"}: ${t.text} (${ago(t.at, now)})`)
    .join("\n");

  const open = input.openQuestions.length
    ? input.openQuestions.map((q, i) => `- q${i + 1}: ${q.text}`).join("\n")
    : "- (none)";

  // A message's first piece carries the seconds since the message before it.
  const buffer = bufferPieces(input.buffer)
    .map((p, i, all) => {
      if (all[i - 1]?.message.id === p.message.id) return `[${p.id}] ${p.text}`;
      const k = input.buffer.findIndex((m) => m.id === p.message.id);
      const previous = input.buffer[k - 1];
      const gap = previous
        ? Math.round((input.buffer[k]!.at.getTime() - previous.at.getTime()) / 1000)
        : 0;
      return `[${p.id}] (+${gap}s) ${p.text}`;
    })
    .join("\n");

  return [
    `EARLIER CONVERSATION (already replied to):\n${context || "(nothing yet)"}`,
    `${OPEN_MARKER}${open}`,
    `${BUFFER_MARKER}${buffer}`,
  ].join("\n\n");
}

/**
 * The judge's picks as questions: the q-ids it keeps, and the pieces of each new question in
 * message order. An unknown id drops only itself; a new question sharing words with one already
 * held is skipped.
 */
export function askedFrom(
  out: Picks,
  shown: ShownQuestion[],
  pieces: Piece[],
): { questions: QuestionVerdict; openWords: string[] } {
  const byId = new Map(shown.map((q, i) => [`q${i + 1}`, q]));
  const kept = [...new Set(out.still_open)].flatMap((id) => byId.get(id) ?? []);
  const known = new Set(pieces.map((p) => p.id));
  const asked: ShownQuestion[] = [];
  for (const ids of out.asked) {
    if (ids.length === 0 || ids.some((id) => !known.has(id))) continue;
    const cited = pieces.filter((p) => ids.includes(p.id));
    const question = { coords: cited.map(coordinate) };
    if ([...kept, ...asked].some((h) => sharesWords(h.question, question))) continue;
    asked.push({ question, text: cited.map((p) => p.text).join(" / ") });
  }
  return {
    questions: {
      shown: shown.map((q) => q.question),
      kept: kept.map((q) => q.question),
      asked: asked.map((q) => q.question),
    },
    openWords: [...kept, ...asked].map((q) => q.text),
  };
}

/** Without a model: every open question stays, and each new piece ending in "?" is asked. */
function markedPicks(shown: number, pieces: Pick<Piece, "id" | "text">[]): Picks {
  return {
    still_open: Array.from({ length: shown }, (_, i) => `q${i + 1}`),
    asked: pieces.filter((p) => p.text.endsWith("?")).map((p) => [p.id]),
  };
}

const PIECE_LINE = /^\[(\d+\.\d+)\] (?:\(\+\d+s\) )?(.*)$/;

/** The fake model's "turn_judge" handler: the cue check and the "?" marks over the rendered input. */
export function fakeTurnJudge(cues: string[]) {
  return (input: string) => {
    const lines = input.split("\n");
    const shown = lines.filter((l) => /^- q\d+: /.test(l)).length;
    const pieces = lines.flatMap((l) => {
      const m = PIECE_LINE.exec(l);
      return m ? [{ id: m[1]!, text: m[2]! }] : [];
    });
    // One text per message, so the cue check reads the last message whole.
    const messages = new Map<string, string>();
    for (const p of pieces) {
      const n = p.id.split(".")[0]!;
      const before = messages.get(n);
      messages.set(n, before ? `${before} ${p.text}` : p.text);
    }
    return {
      reasoning: "fake cue check",
      complete: cueVerdict([...messages.values()], cues).complete,
      ...markedPicks(shown, pieces),
      backchannel: null,
    };
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
  const pieces = bufferPieces(input.buffer);
  const texts = input.buffer.map((m) => m.text);

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

    // Uncapped here: the cap applies under the state lock, against what is open then.
    return {
      complete: verdict.complete,
      ...askedFrom(verdict, input.openQuestions, pieces),
      backchannel: usableBackchannel(verdict, texts, config.turn),
      reasoning: verdict.reasoning,
      source: "model",
      latencyMs: elapsed(),
      error: null,
      promptVersion,
    };
  } catch (e) {
    return {
      complete: cueVerdict(texts, config.turn.incomplete_cues).complete,
      ...askedFrom(markedPicks(input.openQuestions.length, pieces), input.openQuestions, pieces),
      backchannel: null,
      reasoning: null,
      source: "keyword_fallback",
      latencyMs: elapsed(),
      error: errorName(e),
      promptVersion,
    };
  }
}

/**
 * A backchannel is a tiny "I'm listening" mid-story: never once they've finished, never on a
 * greeting with nothing yet to react to, and never their own words handed back.
 */
export function usableBackchannel(
  verdict: { complete: boolean; backchannel: string | null },
  buffer: string[],
  turn: Pick<TurnConfig, "backchannel_max_words" | "greeting_words">,
): string | null {
  const text = verdict.backchannel?.trim() ?? "";
  if (verdict.complete || !text) return null;
  if (text.split(/\s+/).length > turn.backchannel_max_words) return null;

  const greetings = new Set(turn.greeting_words.flatMap(plainWords));
  const theirs = buffer.flatMap(plainWords);
  if (theirs.every((w) => greetings.has(w))) return null;

  const said = new Set(theirs);
  const mine = plainWords(text);
  return mine.length && mine.every((w) => said.has(w)) ? null : text;
}

/** Lowercase letters and digits only, with stretched letters folded ("hiii" is "hi"). */
function plainWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/(.)\1+/g, "$1"));
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
          open_questions: verdict.openWords,
          backchannel: verdict.backchannel,
          wait_ms: decision.waitMs,
        }
      : {
          error: verdict.error,
          complete: verdict.complete,
          open_questions: verdict.openWords,
          wait_ms: decision.waitMs,
        };

  const row = {
    kind: "turn" as const,
    turn_id: decision.turnId,
    attempt: 1,
    input: {
      buffer_turn_ids: decision.bufferTurnIds,
      open_questions: [...verdict.questions.kept, ...verdict.questions.asked],
    },
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
