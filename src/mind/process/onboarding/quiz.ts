/**
 * The profile card quiz: how Spica meets people. Its content (the friend dimensions, the
 * questions, her fixed answers and lines) is a versioned file under prompts/, validated here so a
 * broken quiz fails at load instead of mid-signup. A card keeps the version it was taken with, so
 * an old quiz file stays as long as any card still names it.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const id = z.string().regex(/^[a-z][a-z0-9_]*$/);
const line = z.string().min(1);

const DimensionSchema = z.object({
  id,
  left: line,
  right: line,
  her: z.number().min(0).max(100),
  basis: line,
  click: line,
  clash: line,
  fact_left: line,
  fact_right: line,
  fact_middle: line,
});

const ChoiceSchema = z.object({
  kind: z.literal("choice"),
  id,
  prompt: line,
  options: z
    .array(
      z.object({
        label: line,
        weights: z.record(z.string(), z.number().min(-1).max(1)).default({}),
      }),
    )
    .min(2)
    .max(4),
  her: z.number().int().min(0),
  her_fact: line.optional(),
});

const OpenSchema = z.object({
  kind: z.literal("open"),
  id,
  prompt: line,
  max_words: z.number().int().min(1).max(2),
  her: line,
  fact: z.string().includes("{answer}"),
  her_fact: line,
});

// Zero-width characters are dropped so an invisible answer counts as blank.
export const normalizeAnswer = (s: string) =>
  s
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, "")
    .trim()
    .replace(/\s+/g, " ");
const wordCount = (s: string) => (s === "" ? 0 : s.split(" ").length);

const QuizSchema = z
  .object({
    intro: line,
    no_common: line,
    dimensions: z.array(DimensionSchema).min(1),
    questions: z.array(z.discriminatedUnion("kind", [ChoiceSchema, OpenSchema])).min(1),
  })
  .superRefine((quiz, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const dims = new Set(quiz.dimensions.map((d) => d.id));
    const ids = quiz.questions.map((q) => q.id);
    if (new Set(ids).size !== ids.length) fail("question ids must be unique");
    const uses = new Map<string, number>();
    for (const q of quiz.questions) {
      if (q.kind === "open") {
        if (wordCount(normalizeAnswer(q.her)) > q.max_words)
          fail(`${q.id}: her answer has too many words`);
        continue;
      }
      if (q.her >= q.options.length) fail(`${q.id}: her pick is out of range`);
      const weighted = new Set(q.options.flatMap((o) => Object.keys(o.weights)));
      for (const d of weighted) {
        if (!dims.has(d)) fail(`${q.id}: unknown dimension ${d}`);
        uses.set(d, (uses.get(d) ?? 0) + 1);
      }
    }
    for (const d of dims) if ((uses.get(d) ?? 0) < 2) fail(`${d}: needs at least two questions`);
  });

export type Quiz = z.infer<typeof QuizSchema>;
export type Dimension = Quiz["dimensions"][number];
export type Question = Quiz["questions"][number];
export type ChoiceQuestion = Extract<Question, { kind: "choice" }>;
export type OpenQuestion = Extract<Question, { kind: "open" }>;
/** Question id to the option index picked (choice) or the normalized words typed (open). */
export type Answers = Record<string, number | string>;

export function parseQuiz(raw: unknown): Quiz {
  return QuizSchema.parse(raw);
}

const cache = new Map<string, Quiz>();

export function loadQuiz(version: string, root = path.join(process.cwd(), "prompts")): Quiz {
  if (!/^v\d+$/.test(version)) throw new Error(`invalid quiz version ${version}`);
  const file = path.join(root, "onboarding", "quiz", `${version}.yaml`);
  const cached = cache.get(file);
  if (cached) return cached;
  const quiz = parseQuiz(parse(readFileSync(file, "utf8")));
  cache.set(file, quiz);
  return quiz;
}

/** What a submitted set of answers must look like for this quiz: every question exactly once. */
export function answersSchema(quiz: Quiz, maxChars: number): z.ZodType<Answers> {
  const shape: Record<string, z.ZodType<number | string>> = {};
  for (const q of quiz.questions) {
    shape[q.id] =
      q.kind === "choice"
        ? z
            .number()
            .int()
            .min(0)
            .max(q.options.length - 1)
        : z
            .string()
            .max(maxChars * 4) // bounds the work before normalizing
            .transform(normalizeAnswer)
            .pipe(
              z
                .string()
                .min(1)
                .max(maxChars)
                .refine((s) => wordCount(s) <= q.max_words, "too many words"),
            );
  }
  return z.strictObject(shape) as unknown as z.ZodType<Answers>;
}
