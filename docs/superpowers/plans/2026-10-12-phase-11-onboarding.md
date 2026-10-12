# Phase 11: Onboarding (profile card swap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A required, one-time quiz where the user and Spica swap profile cards, ending in a
compatibility page, with both cards written into her user-scoped memory as light first impressions.

**Architecture:** The quiz content (dimensions, questions, her fixed answers, lines) lives in a
versioned YAML file validated by zod. Scoring, topic matching and card-fact wording are pure
functions in `src/mind/process/onboarding/`. One POST validates the answers, embeds, and writes an
`onboarding` row plus the card facts in one transaction. `/chat` redirects to `/onboarding` until
the row exists. The reply prompt marks card facts as a first impression. No model calls.

**Tech Stack:** TypeScript, Next.js App Router (read `node_modules/next/dist/docs/` before
touching pages or routes; this Next has breaking changes), Drizzle + Postgres, zod, `yaml`, Vitest,
pnpm.

**Spec:** `docs/superpowers/specs/2026-10-12-phase-11-onboarding-design.md`

## Global Constraints

- `src/mind` is framework-free: no Next imports, no `Date.now()`, no `process.env`; time from the
  injected `Clock` (`deps.clock.now()`), never `DEFAULT now()`.
- Every numeric constant goes in `config/default.json` under `onboarding`, validated in
  `src/mind/platform/config.ts`.
- Every file starts with a short plain-English header. Comments say why, never cite spec sections,
  phases or review items.
- Prettier at 100 columns; `pnpm lint` must pass.
- User data is `user_id`-scoped; nothing in this phase reads or writes core (V2, V4, V7).
- Facts written: `source: "onboarding"`, `source_ref: "onboarding:<quiz_version>"`, `status: "open"`,
  `valence: 0`, `confidence: onboarding.confidence` (0.4), `salience: onboarding.salience` (0.5),
  except the name fact at salience 1.0.
- Open answers: at most `max_words` (2) words and `onboarding.max_answer_chars` (40) characters,
  for the user and for her.
- Choice questions show only her pick; open questions show her one-or-two-word answer.
- Card mark in the reply prompt: `from their profile card, a first impression`.
- Reply prompt v16 replaces v15; v15 is deleted.
- Definition of done: `pnpm typecheck`, `pnpm lint`, `pnpm test` pass, the exit test passes
  (including the leak canary), and the spec is updated.

## Review Focus

1. **Double submit** (two tabs, a double click): the second POST returns `409 already_done`, never
   a `500`, and leaves exactly one row and one set of facts. Pinned in Task 4.
2. **The embedder fails at submit:** the POST returns `503 try_again`, nothing is written, and a
   retry succeeds. Pinned in Task 4.
3. **The quiz version changed between page load and submit** (a deploy mid-quiz): `409
   stale_quiz`, nothing written; the client reloads. Pinned in Task 4 (server) and Task 6 (client).
4. **Messy open answers** (`"  Old   Films "`, whitespace only, three words, 41 characters): the
   whitespace is collapsed before counting and storing; blank, too many words or too long is
   `400`. Pinned in Task 4.
5. **Topic matching ignores case and spacing** (`"Old Films "` against her `"old films"`) and
   never matches unrelated words just because the embedder is a fake. Pinned in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `prompts/onboarding/quiz/v1.yaml` (create) | Quiz content: intro, dimensions, questions, her answers, lines, fact templates |
| `src/mind/process/onboarding/quiz.ts` (create) | Load and validate a quiz file; `Quiz` types; answer validation schema |
| `src/mind/process/onboarding/score.ts` (create) | Positions, gaps, lines, common topics, the results view |
| `src/mind/process/onboarding/card-facts.ts` (create) | Wording of both cards as facts |
| `src/mind/process/onboarding/submit.ts` (create) | Validate, embed, write in one transaction |
| `src/mind/platform/math.ts` (modify) | Add `cosine` (moved from drift watch) |
| `src/mind/process/core/drift-watch.ts` (modify) | Use `cosine` |
| `src/mind/platform/config.ts`, `config/default.json` (modify) | `onboarding` section |
| `src/db/schema.ts` (modify), `src/db/migrations/0032_onboarding.sql` (generated) | `onboarding` table |
| `src/db/repos/user/onboarding.ts` (create) | `getOnboarding`, `insertOnboarding` |
| `src/app/api/onboarding/handler.ts`, `route.ts` (create) | POST endpoint |
| `src/app/onboarding/page.tsx`, `quiz-client.tsx`, `onboarding.module.css` (create) | The quiz |
| `src/app/onboarding/results/page.tsx` (create) | The compatibility page |
| `src/app/chat/page.tsx`, `src/app/settings/page.tsx` (modify) | Gate; "your card" link |
| `src/mind/process/hot-path/assemble.ts` (modify) | Card mark |
| `prompts/reply/v16.md` (create), `prompts/reply/v15.md` (delete) | Card sentence |
| `tests/exit/phase-11.test.ts` (create) | Exit test |

---

### Task 1: Quiz file, loader and config

**Files:**
- Create: `prompts/onboarding/quiz/v1.yaml`
- Create: `src/mind/process/onboarding/quiz.ts`
- Modify: `src/mind/platform/config.ts` (add `onboarding` section and add it to `ConfigSchema`)
- Modify: `config/default.json` (add `onboarding` block)
- Test: `tests/mind/process/onboarding/quiz.test.ts`

**Interfaces:**
- Produces:
  - `loadQuiz(version: string, root?: string): Quiz`
  - `parseQuiz(raw: unknown): Quiz` (throws on invalid)
  - `answersSchema(quiz: Quiz, maxChars: number): z.ZodType<Answers>`
  - types `Quiz`, `Dimension`, `Question`, `ChoiceQuestion`, `OpenQuestion`,
    `Answers = Record<string, number | string>`
  - `normalizeAnswer(s: string): string` (trim and collapse whitespace)
  - `config.onboarding: { quiz_version: string; confidence: number; salience: number;
    neutral_band: number; click_gap: number; clash_gap: number; topic_similarity: number;
    max_answer_chars: number }`

- [ ] **Step 1: Add the config section**

In `src/mind/platform/config.ts`, before `// ---------- The whole config ----------`:

```ts
const onboarding = z.object({
  quiz_version: promptVersion,
  confidence: unit,
  salience: unit,
  // Points either side of 50 that read as "somewhere between".
  neutral_band: z.number().min(0).max(50),
  click_gap: z.number().min(0).max(100),
  clash_gap: z.number().min(0).max(100),
  topic_similarity: unit,
  max_answer_chars: positiveInt,
});
```

Add `onboarding,` to `ConfigSchema` after `user_mind: userMind,`. In `config/default.json`, add a
top-level block after `"user_mind"`:

```json
"onboarding": {
  "quiz_version": "v1",
  "confidence": 0.4,
  "salience": 0.5,
  "neutral_band": 15,
  "click_gap": 20,
  "clash_gap": 50,
  "topic_similarity": 0.6,
  "max_answer_chars": 40
},
```

- [ ] **Step 2: Write the quiz file**

`prompts/onboarding/quiz/v1.yaml` (a first draft, open to tweaks; weights run -1 for fully left to
+1 for fully right; her picks are 0-based option indexes):

```yaml
# How Spica meets people: you swap profile cards. You answer, then you see hers.
# Choice questions show only her pick; open questions show her one or two words.
intro: "This is how Spica meets people: you swap profile cards. Answer, then see hers."
no_common: "nothing in common. good, honestly."

dimensions:
  - id: social_energy
    left: Homebody
    right: Out-and-about
    her: 30
    basis: "Extraversion (Big Five)"
    click: "we'd both pick the quiet night in."
    clash: "you'll drag me out. i'll drag you back."
    fact_left: "On their profile card they came across as more of a homebody."
    fact_right: "On their profile card they came across as out-and-about, someone who likes going out."
    fact_middle: "On their profile card they came across as somewhere between a homebody and out-and-about."
  - id: structure
    left: Planner
    right: Spontaneous
    her: 60
    basis: "Conscientiousness (Big Five)"
    click: "neither of us needs an itinerary."
    clash: "you'll want a plan. i'll want to see what happens."
    fact_left: "On their profile card they came across as a planner."
    fact_right: "On their profile card they came across as spontaneous."
    fact_middle: "On their profile card they came across as somewhere between a planner and spontaneous."
  - id: novelty
    left: Comfort picks
    right: New things
    her: 60
    basis: "Openness to experience (Big Five)"
    click: "we'll both say yes to the weird one."
    clash: "you'll rewatch. i'll make you watch something new."
    fact_left: "On their profile card they came across as someone who sticks with comfort picks."
    fact_right: "On their profile card they came across as someone who goes for new things."
    fact_middle: "On their profile card they came across as somewhere between comfort picks and new things."
  - id: directness
    left: Keep the peace
    right: Say it straight
    her: 90
    basis: "Directness and conflict style (Gottman; agreeableness)"
    click: "neither of us will make the other guess."
    clash: "i'll say the thing. you'll wish i hadn't. then you'll be glad."
    fact_left: "On their profile card they came across as someone who keeps the peace."
    fact_right: "On their profile card they came across as someone who says things straight."
    fact_middle: "On their profile card they came across as somewhere between keeping the peace and saying it straight."
  - id: talk
    left: Easy banter
    right: Deep talk
    her: 75
    basis: "Substantive vs small talk (Mehl et al. 2010)"
    click: "we'll skip the small talk."
    clash: "you'll keep it light. i'll ask the 3am question anyway."
    fact_left: "On their profile card they came across as someone who likes easy banter."
    fact_right: "On their profile card they came across as someone who likes deep talk."
    fact_middle: "On their profile card they came across as somewhere between easy banter and deep talk."
  - id: contact
    left: Check in now and then
    right: Always texting
    her: 50
    basis: "Friendship maintenance (Oswald; Hall)"
    click: "we'll text about the same amount. rare."
    clash: "one of us will be waiting on a reply. we'll live."
    fact_left: "On their profile card they came across as someone who checks in now and then."
    fact_right: "On their profile card they came across as someone who's always texting."
    fact_middle: "On their profile card they came across as somewhere between checking in now and then and always texting."

questions:
  - kind: choice
    id: friday
    prompt: "Friday night, nothing planned. You…"
    options:
      - { label: "stay in, finally", weights: { social_energy: -1 } }
      - { label: "text a couple of people, see what happens", weights: { social_energy: 0, structure: 0.5 } }
      - { label: "go out, obviously", weights: { social_energy: 1 } }
    her: 0
    her_fact: "On your profile card you picked staying in on a free Friday night."
  - kind: choice
    id: after_weekend
    prompt: "After a big social weekend you feel…"
    options:
      - { label: "drained, need a quiet day", weights: { social_energy: -1 } }
      - { label: "fine either way", weights: { social_energy: 0 } }
      - { label: "buzzing, want more", weights: { social_energy: 1 } }
    her: 0
  - kind: choice
    id: trip
    prompt: "A trip with friends. You'd rather…"
    options:
      - { label: "have the days planned", weights: { structure: -1 } }
      - { label: "book the place, wing the rest", weights: { structure: 0.3 } }
      - { label: "turn up and see", weights: { structure: 1 } }
    her: 1
  - kind: choice
    id: cancelled
    prompt: "Plans get cancelled last minute. You're…"
    options:
      - { label: "annoyed, i'd sorted my day around it", weights: { structure: -1 } }
      - { label: "a little relieved, honestly", weights: { social_energy: -0.5, structure: 0.3 } }
      - { label: "fine, something else will turn up", weights: { structure: 1 } }
    her: 1
  - kind: choice
    id: watch
    prompt: "Picking something to watch."
    options:
      - { label: "an old favourite", weights: { novelty: -1 } }
      - { label: "something a friend recommended", weights: { novelty: 0 } }
      - { label: "something i've never heard of", weights: { novelty: 1 } }
    her: 2
    her_fact: "On your profile card you said you'd rather watch something you've never heard of."
  - kind: choice
    id: new_hobby
    prompt: "A friend wants you to try a hobby you've never done."
    options:
      - { label: "probably pass", weights: { novelty: -1 } }
      - { label: "sure, once", weights: { novelty: 0.3 } }
      - { label: "yes, when?", weights: { novelty: 1 } }
    her: 1
  - kind: choice
    id: haircut
    prompt: "A friend's new haircut doesn't suit them, and they ask what you think."
    options:
      - { label: "say it looks great", weights: { directness: -1 } }
      - { label: "find something nice to say", weights: { directness: -0.4 } }
      - { label: "tell them, kindly", weights: { directness: 1 } }
    her: 2
    her_fact: "On your profile card you said you'd tell a friend the truth about a bad haircut, kindly."
  - kind: choice
    id: bothered
    prompt: "Something a friend did bothered you."
    options:
      - { label: "let it go", weights: { directness: -1 } }
      - { label: "drop a hint", weights: { directness: -0.3 } }
      - { label: "tell them straight", weights: { directness: 1 } }
    her: 2
  - kind: choice
    id: best_talk
    prompt: "Best kind of conversation?"
    options:
      - { label: "jokes and nonsense", weights: { talk: -1 } }
      - { label: "a bit of both", weights: { talk: 0 } }
      - { label: "the 3am kind", weights: { talk: 1 } }
    her: 2
    her_fact: "On your profile card you picked the 3am kind of conversation as the best kind."
  - kind: choice
    id: how_are_you
    prompt: "Someone you just met asks how you are."
    options:
      - { label: "fine, you?", weights: { talk: -1 } }
      - { label: "depends who's asking", weights: { talk: 0 } }
      - { label: "actually tell them", weights: { talk: 1 } }
    her: 1
  - kind: choice
    id: texting
    prompt: "With a close friend, you'd text…"
    options:
      - { label: "every day, all day", weights: { contact: 1 } }
      - { label: "a few times a week", weights: { contact: 0 } }
      - { label: "when there's something to say", weights: { contact: -1 } }
    her: 1
  - kind: choice
    id: no_reply
    prompt: "A friend hasn't replied in two days. You…"
    options:
      - { label: "assume they're busy", weights: { contact: -1 } }
      - { label: "send something funny", weights: { contact: 0.3 } }
      - { label: "check they're ok", weights: { contact: 1 } }
    her: 1
  - kind: open
    id: hours_topic
    prompt: "Something you could talk about for hours (one or two words)"
    max_words: 2
    her: "stargazing"
    fact: "On their profile card they said they could talk about {answer} for hours."
    her_fact: "On your profile card you said you could talk about stargazing for hours."
  - kind: open
    id: lately
    prompt: "Something you're into lately (one or two words)"
    max_words: 2
    her: "slow films"
    fact: "On their profile card they said they're into {answer} lately."
    her_fact: "On your profile card you said you're into slow films lately."
  - kind: open
    id: comfort
    prompt: "Your comfort thing (one or two words)"
    max_words: 2
    her: "rereading"
    fact: "On their profile card they said their comfort thing is {answer}."
    her_fact: "On your profile card you said your comfort thing is rereading."
```

- [ ] **Step 3: Write the failing tests**

`tests/mind/process/onboarding/quiz.test.ts`:

```ts
import path from "node:path";
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  answersSchema,
  loadQuiz,
  normalizeAnswer,
  parseQuiz,
  type Quiz,
} from "@/mind/process/onboarding/quiz";

const ROOT = path.join(process.cwd(), "prompts");

function small(): Quiz {
  return parseQuiz({
    intro: "hi",
    no_common: "none",
    dimensions: [
      {
        id: "d",
        left: "L",
        right: "R",
        her: 70,
        basis: "b",
        click: "c",
        clash: "x",
        fact_left: "fl",
        fact_right: "fr",
        fact_middle: "fm",
      },
    ],
    questions: [
      {
        kind: "choice",
        id: "q1",
        prompt: "p",
        options: [
          { label: "a", weights: { d: -1 } },
          { label: "b", weights: { d: 1 } },
        ],
        her: 1,
      },
      {
        kind: "choice",
        id: "q2",
        prompt: "p",
        options: [
          { label: "a", weights: { d: -1 } },
          { label: "b", weights: { d: 1 } },
        ],
        her: 0,
      },
      {
        kind: "open",
        id: "o1",
        prompt: "p",
        max_words: 2,
        her: "old films",
        fact: "They like {answer}.",
        her_fact: "You like old films.",
      },
    ],
  });
}

test("the shipped v1 quiz loads and every config number validates", () => {
  const quiz = loadQuiz(loadConfig().onboarding.quiz_version, ROOT);
  expect(quiz.dimensions).toHaveLength(6);
  expect(quiz.questions.length).toBeGreaterThanOrEqual(10);
  expect(quiz.questions.length).toBeLessThanOrEqual(15);
});

test("rejects a dimension weighted by fewer than two questions", () => {
  const raw = structuredClone(small()) as unknown as { questions: { kind: string }[] };
  raw.questions = raw.questions.filter((q, i) => i !== 1);
  expect(() => parseQuiz(raw)).toThrow(/two questions/);
});

test("rejects her pick out of range, an unknown dimension and her open answer over the word limit", () => {
  const base = small();
  const pick = structuredClone(base);
  (pick.questions[0] as { her: number }).her = 5;
  expect(() => parseQuiz(pick)).toThrow(/her pick/);

  const unknown = structuredClone(base);
  (unknown.questions[0] as { options: { weights: Record<string, number> }[] }).options[0]!.weights =
    { nope: 1 };
  expect(() => parseQuiz(unknown)).toThrow(/unknown dimension/);

  const wordy = structuredClone(base);
  (wordy.questions[2] as { her: string }).her = "really old films";
  expect(() => parseQuiz(wordy)).toThrow(/words/);
});

test("answers: every question once, choice in range, open answers short and normalized", () => {
  const schema = answersSchema(small(), 40);
  expect(schema.parse({ q1: 0, q2: 1, o1: "  Old   Films " })).toEqual({
    q1: 0,
    q2: 1,
    o1: "Old Films",
  });
  expect(schema.safeParse({ q1: 0, q2: 1 }).success).toBe(false); // missing
  expect(schema.safeParse({ q1: 0, q2: 1, o1: "x", extra: 1 }).success).toBe(false);
  expect(schema.safeParse({ q1: 2, q2: 1, o1: "x" }).success).toBe(false); // out of range
  expect(schema.safeParse({ q1: 0, q2: 1, o1: "   " }).success).toBe(false); // blank
  expect(schema.safeParse({ q1: 0, q2: 1, o1: "one two three" }).success).toBe(false);
  expect(schema.safeParse({ q1: 0, q2: 1, o1: "a".repeat(41) }).success).toBe(false);
  expect(schema.safeParse({ q1: "0", q2: 1, o1: "x" }).success).toBe(false); // wrong type
});

test("normalizeAnswer trims and collapses whitespace", () => {
  expect(normalizeAnswer("  a \t b\n")).toBe("a b");
});
```

- [ ] **Step 4: Run to confirm it fails**

Run: `pnpm vitest run tests/mind/process/onboarding/quiz.test.ts`
Expected: FAIL, cannot resolve `@/mind/process/onboarding/quiz`.

- [ ] **Step 5: Implement the loader**

`src/mind/process/onboarding/quiz.ts`:

```ts
/**
 * The profile card quiz: how Spica meets people. Its content (the friend dimensions, the
 * questions, her fixed answers and lines) is a versioned file under prompts/, validated here so a
 * broken quiz fails at load instead of mid-signup.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const id = z.string().regex(/^[a-z_]+$/);
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

export const normalizeAnswer = (s: string) => s.trim().replace(/\s+/g, " ");
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
        if (wordCount(normalizeAnswer(q.her)) > q.max_words) fail(`${q.id}: her answer has too many words`);
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
        ? z.number().int().min(0).max(q.options.length - 1)
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
```

Note: the "two questions" test message must match `/two questions/`: the issue text
`needs at least two questions` does. Zod puts custom messages in the thrown error text.

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run tests/mind/process/onboarding/quiz.test.ts tests/mind/platform`
Expected: PASS (the platform tests confirm the config still loads).

- [ ] **Step 7: Commit**

```bash
git add prompts/onboarding src/mind/process/onboarding/quiz.ts src/mind/platform/config.ts config/default.json tests/mind/process/onboarding/quiz.test.ts
git commit -m "feat(onboarding): the profile card quiz file and its loader"
```

---

### Task 2: Scoring, common topics and the results view

**Files:**
- Modify: `src/mind/platform/math.ts` (add `cosine`)
- Modify: `src/mind/process/core/drift-watch.ts` (use it)
- Create: `src/mind/process/onboarding/score.ts`
- Test: `tests/mind/process/onboarding/score.test.ts`

**Interfaces:**
- Consumes: `Quiz`, `Answers`, `normalizeAnswer` from Task 1; `Embedder` from
  `@/mind/platform/embedder/types`.
- Produces:
  - `cosine(a: number[], b: number[]): number`
  - `positionOf(quiz: Quiz, answers: Answers, dimensionId: string): number` (0–100, rounded)
  - `type DimensionScore = { id: string; left: string; right: string; basis: string; her: number;
    you: number; gap: number; line: string | null }`
  - `scoreCard(quiz: Quiz, answers: Answers, cfg: { click_gap: number; clash_gap: number }):
    DimensionScore[]`
  - `type Topic = { yours: string; hers: string }`
  - `commonTopics(quiz: Quiz, answers: Answers, embedder: Embedder, threshold: number):
    Promise<Topic[]>`
  - `type CardView = { dimensions: DimensionScore[]; topics: Topic[]; noCommon: string | null;
    hers: { prompt: string; answer: string }[]; yours: { prompt: string; answer: string }[] }`
  - `cardView(quiz: Quiz, answers: Answers, topics: Topic[], cfg: { click_gap: number;
    clash_gap: number }): CardView`

- [ ] **Step 1: Move cosine**

Append to `src/mind/platform/math.ts`:

```ts
/** Cosine similarity of two vectors of the same length. */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    aa += a[i]! * a[i]!;
    bb += b[i]! * b[i]!;
  }
  return dot / Math.sqrt(aa * bb);
}
```

In `src/mind/process/core/drift-watch.ts`, delete the local `cosineDistance` function, import
`cosine` from `@/mind/platform/math`, and replace each `cosineDistance(a, b)` call with
`1 - cosine(a, b)`.

- [ ] **Step 2: Write the failing tests**

`tests/mind/process/onboarding/score.test.ts`:

```ts
import { expect, test } from "vitest";
import { ScriptedEmbedder } from "@/mind/platform/embedder/scripted";
import { parseQuiz, type Quiz } from "@/mind/process/onboarding/quiz";
import {
  cardView,
  commonTopics,
  positionOf,
  scoreCard,
} from "@/mind/process/onboarding/score";

const dim = (id: string, her: number) => ({
  id,
  left: `${id}-L`,
  right: `${id}-R`,
  her,
  basis: "b",
  click: `${id} click`,
  clash: `${id} clash`,
  fact_left: "fl",
  fact_right: "fr",
  fact_middle: "fm",
});
const choice = (id: string, weights: Record<string, number>[]) => ({
  kind: "choice",
  id,
  prompt: id,
  options: weights.map((w, i) => ({ label: `o${i}`, weights: w })),
  her: 0,
});
const open = (id: string, her: string) => ({
  kind: "open",
  id,
  prompt: `${id}?`,
  max_words: 2,
  her,
  fact: "{answer}",
  her_fact: her,
});

const quiz: Quiz = parseQuiz({
  intro: "i",
  no_common: "nothing in common. good, honestly.",
  dimensions: [dim("a", 90), dim("b", 50), dim("c", 10)],
  questions: [
    choice("q1", [{ a: -1 }, { a: 1 }, { a: 0, b: 1 }]),
    choice("q2", [{ a: -1 }, { a: 1 }]),
    choice("q3", [{ b: -1 }, { b: 1 }]),
    choice("q4", [{ c: -1 }, { c: 1 }]),
    choice("q5", [{ c: -1 }, { c: 1 }]),
    open("o1", "old films"),
    open("o2", "stargazing"),
  ],
});
const cfg = { click_gap: 20, clash_gap: 50 };

test("a position is the mean weight of the picks over the questions that weigh it", () => {
  const answers = { q1: 1, q2: 1, q3: 0, q4: 0, q5: 1, o1: "x", o2: "y" };
  expect(positionOf(quiz, answers, "a")).toBe(100);
  // q1 option 1 has no weight for b, so it counts as 0: mean(0, -1) = -0.5 -> 25
  expect(positionOf(quiz, answers, "b")).toBe(25);
  expect(positionOf(quiz, answers, "c")).toBe(50);
});

test("lines: click under click_gap, clash over clash_gap, nothing between", () => {
  const answers = { q1: 1, q2: 1, q3: 0, q4: 0, q5: 1, o1: "x", o2: "y" };
  const byId = Object.fromEntries(scoreCard(quiz, answers, cfg).map((d) => [d.id, d]));
  expect(byId.a).toMatchObject({ her: 90, you: 100, gap: 10, line: "a click" });
  expect(byId.b).toMatchObject({ you: 25, gap: 25, line: null });
  expect(byId.c).toMatchObject({ you: 50, gap: 40, line: null });
  const far = scoreCard(quiz, { ...answers, q4: 1, q5: 1 }, cfg).find((d) => d.id === "c")!;
  expect(far).toMatchObject({ you: 100, gap: 90, line: "c clash" });
});

test("topics: exact match ignores case and spacing; unrelated words never match", async () => {
  const embedder = new ScriptedEmbedder(1024); // unregistered texts are near-orthogonal
  const topics = await commonTopics(
    quiz,
    { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, o1: "Old  Films ", o2: "knitting" },
    embedder,
    0.6,
  );
  expect(topics).toEqual([{ yours: "Old  Films ", hers: "old films" }]);
});

test("topics: similar words count at or above the threshold", async () => {
  const embedder = new ScriptedEmbedder(1024)
    .set("astronomy", ScriptedEmbedder.near(1024, 3, 4, 0.7))
    .set("stargazing", ScriptedEmbedder.axis(1024, 3))
    .set("knitting", ScriptedEmbedder.near(1024, 3, 5, 0.5));
  const answers = { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, o1: "astronomy", o2: "knitting" };
  expect(await commonTopics(quiz, answers, embedder, 0.6)).toEqual([
    { yours: "astronomy", hers: "stargazing" },
  ]);
});

test("the results view shows both cards, and the no-common line only when nothing matched", () => {
  const answers = { q1: 0, q2: 0, q3: 0, q4: 0, q5: 0, o1: "knitting", o2: "chess" };
  const none = cardView(quiz, answers, [], cfg);
  expect(none.noCommon).toBe("nothing in common. good, honestly.");
  expect(none.hers).toEqual([
    { prompt: "o1?", answer: "old films" },
    { prompt: "o2?", answer: "stargazing" },
  ]);
  expect(none.yours).toEqual([
    { prompt: "o1?", answer: "knitting" },
    { prompt: "o2?", answer: "chess" },
  ]);
  const some = cardView(quiz, answers, [{ yours: "chess", hers: "stargazing" }], cfg);
  expect(some.noCommon).toBeNull();
  expect(some.dimensions).toHaveLength(3);
});
```

- [ ] **Step 3: Run to confirm it fails**

Run: `pnpm vitest run tests/mind/process/onboarding/score.test.ts`
Expected: FAIL, cannot resolve `@/mind/process/onboarding/score`.

- [ ] **Step 4: Implement**

`src/mind/process/onboarding/score.ts`:

```ts
/**
 * How the user and Spica compare on their profile cards: where each sits on the friend
 * dimensions, which lines the gaps earn, and what they have in common. All code, no model call,
 * so the page is free and the same answers always give the same card.
 */
import type { Embedder } from "@/mind/platform/embedder/types";
import { cosine } from "@/mind/platform/math";
import { normalizeAnswer, type Answers, type Quiz } from "./quiz";

export type DimensionScore = {
  id: string;
  left: string;
  right: string;
  basis: string;
  her: number;
  you: number;
  gap: number;
  line: string | null;
};
export type Topic = { yours: string; hers: string };
export type CardView = {
  dimensions: DimensionScore[];
  topics: Topic[];
  noCommon: string | null;
  hers: { prompt: string; answer: string }[];
  yours: { prompt: string; answer: string }[];
};
type Gaps = { click_gap: number; clash_gap: number };

/** 0 fully left, 100 fully right; a pick with no weight for the dimension counts as the middle. */
export function positionOf(quiz: Quiz, answers: Answers, dimensionId: string): number {
  const weights: number[] = [];
  for (const q of quiz.questions) {
    if (q.kind !== "choice") continue;
    if (!q.options.some((o) => dimensionId in o.weights)) continue;
    const picked = q.options[answers[q.id] as number];
    weights.push(picked?.weights[dimensionId] ?? 0);
  }
  if (weights.length === 0) return 50;
  const mean = weights.reduce((a, b) => a + b, 0) / weights.length;
  return Math.round(50 + 50 * mean);
}

export function scoreCard(quiz: Quiz, answers: Answers, cfg: Gaps): DimensionScore[] {
  return quiz.dimensions.map((d) => {
    const you = positionOf(quiz, answers, d.id);
    const gap = Math.abs(you - d.her);
    const line = gap < cfg.click_gap ? d.click : gap > cfg.clash_gap ? d.clash : null;
    return { id: d.id, left: d.left, right: d.right, basis: d.basis, her: d.her, you, gap, line };
  });
}

const key = (s: string) => normalizeAnswer(s).toLowerCase();

/** Each of their open answers against each of hers: an exact match, or close enough in meaning. */
export async function commonTopics(
  quiz: Quiz,
  answers: Answers,
  embedder: Embedder,
  threshold: number,
): Promise<Topic[]> {
  const opens = quiz.questions.filter((q) => q.kind === "open");
  const yours = opens.map((q) => String(answers[q.id] ?? "")).filter((s) => s !== "");
  const hers = opens.map((q) => q.her);
  if (yours.length === 0) return [];
  const vectors = await embedder.embed([...yours, ...hers], "document");
  const topics: Topic[] = [];
  for (const [i, mine] of yours.entries()) {
    let best: Topic | null = null;
    let bestSim = threshold;
    for (const [j, theirs] of hers.entries()) {
      const sim = key(mine) === key(theirs) ? 1 : cosine(vectors[i]!, vectors[yours.length + j]!);
      if (sim >= bestSim) {
        best = { yours: mine, hers: theirs };
        bestSim = sim;
      }
    }
    if (best) topics.push(best);
  }
  return topics;
}

export function cardView(quiz: Quiz, answers: Answers, topics: Topic[], cfg: Gaps): CardView {
  const opens = quiz.questions.filter((q) => q.kind === "open");
  return {
    dimensions: scoreCard(quiz, answers, cfg),
    topics,
    noCommon: topics.length === 0 ? quiz.no_common : null,
    hers: opens.map((q) => ({ prompt: q.prompt, answer: q.her })),
    yours: opens.map((q) => ({ prompt: q.prompt, answer: String(answers[q.id] ?? "") })),
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/mind/process/onboarding/score.test.ts tests/mind/process/core`
Expected: PASS (core tests confirm drift watch still works).

- [ ] **Step 6: Commit**

```bash
git add src/mind/platform/math.ts src/mind/process/core/drift-watch.ts src/mind/process/onboarding/score.ts tests/mind/process/onboarding/score.test.ts
git commit -m "feat(onboarding): score the cards and find common topics"
```

---

### Task 3: Card facts

**Files:**
- Create: `src/mind/process/onboarding/card-facts.ts`
- Test: `tests/mind/process/onboarding/card-facts.test.ts`

**Interfaces:**
- Consumes: `Quiz`, `Answers` (Task 1), `positionOf` (Task 2).
- Produces:
  - `type CardFact = { subject: "user" | "self"; kind: "trait" | "preference"; content: string;
    salience: number }`
  - `cardFacts(quiz: Quiz, answers: Answers, name: string, cfg: { neutral_band: number; salience:
    number }): CardFact[]`

- [ ] **Step 1: Write the failing test**

`tests/mind/process/onboarding/card-facts.test.ts`:

```ts
import path from "node:path";
import { expect, test } from "vitest";
import { cardFacts } from "@/mind/process/onboarding/card-facts";
import { loadQuiz } from "@/mind/process/onboarding/quiz";

const quiz = loadQuiz("v1", path.join(process.cwd(), "prompts"));
const cfg = { neutral_band: 15, salience: 0.5 };

/** Picks option `i` for every choice question and the given words for every open one. */
function answers(i: number, words: string[]) {
  let w = 0;
  return Object.fromEntries(
    quiz.questions.map((q) => [q.id, q.kind === "choice" ? Math.min(i, q.options.length - 1) : words[w++]!]),
  );
}

test("their card: name at full salience, one impression per dimension, one per open answer", () => {
  const facts = cardFacts(quiz, answers(0, ["chess", "jazz", "tea"]), "Sam", cfg);
  const theirs = facts.filter((f) => f.subject === "user");
  expect(theirs[0]).toEqual({
    subject: "user",
    kind: "trait",
    content: "Their name is Sam.",
    salience: 1,
  });
  const traits = theirs.filter((f) => f.kind === "trait").slice(1);
  expect(traits).toHaveLength(quiz.dimensions.length);
  expect(traits.every((f) => f.salience === 0.5)).toBe(true);
  expect(traits.map((f) => f.content)).toContain(
    "On their profile card they came across as more of a homebody.",
  );
  expect(theirs.filter((f) => f.kind === "preference").map((f) => f.content)).toEqual([
    "On their profile card they said they could talk about chess for hours.",
    "On their profile card they said they're into jazz lately.",
    "On their profile card they said their comfort thing is tea.",
  ]);
});

test("a middle score reads as somewhere between", () => {
  // Option 1 is the middle pick for most dimensions in v1.
  const facts = cardFacts(quiz, answers(1, ["a", "b", "c"]), "Sam", cfg);
  expect(facts.map((f) => f.content)).toContain(
    "On their profile card they came across as somewhere between easy banter and deep talk.",
  );
});

test("her card: one self fact per open question and per choice question that has one", () => {
  const facts = cardFacts(quiz, answers(0, ["a", "b", "c"]), "Sam", cfg);
  const hers = facts.filter((f) => f.subject === "self");
  const expected = quiz.questions.filter((q) => q.her_fact).map((q) => q.her_fact);
  expect(hers.map((f) => f.content)).toEqual(expected);
  expect(hers.every((f) => f.salience === 0.5)).toBe(true);
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `pnpm vitest run tests/mind/process/onboarding/card-facts.test.ts`
Expected: FAIL, cannot resolve `card-facts`.

- [ ] **Step 3: Implement**

`src/mind/process/onboarding/card-facts.ts`:

```ts
/**
 * Both profile cards as memories: their card as impressions of them, hers as what she has told
 * them about herself. First impressions only, so later conversation can override them; only their
 * name is kept at full weight so it never fades.
 */
import type { Answers, Quiz } from "./quiz";
import { positionOf } from "./score";

export type CardFact = {
  subject: "user" | "self";
  kind: "trait" | "preference";
  content: string;
  salience: number;
};

export function cardFacts(
  quiz: Quiz,
  answers: Answers,
  name: string,
  cfg: { neutral_band: number; salience: number },
): CardFact[] {
  const theirs = (kind: CardFact["kind"], content: string): CardFact => ({
    subject: "user",
    kind,
    content,
    salience: cfg.salience,
  });
  const facts: CardFact[] = [
    { subject: "user", kind: "trait", content: `Their name is ${name}.`, salience: 1 },
  ];
  for (const d of quiz.dimensions) {
    const you = positionOf(quiz, answers, d.id);
    const content =
      Math.abs(you - 50) <= cfg.neutral_band ? d.fact_middle : you < 50 ? d.fact_left : d.fact_right;
    facts.push(theirs("trait", content));
  }
  for (const q of quiz.questions) {
    if (q.kind === "open") facts.push(theirs("preference", q.fact.replace("{answer}", String(answers[q.id]))));
  }
  for (const q of quiz.questions) {
    if (q.her_fact)
      facts.push({ subject: "self", kind: "preference", content: q.her_fact, salience: cfg.salience });
  }
  return facts;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/mind/process/onboarding/card-facts.test.ts`
Expected: PASS. If the "somewhere between" assertion fails because option 1 isn't a middle pick
for `talk` in v1, check the quiz file: `best_talk` option 1 has weight 0 and `how_are_you`
option 1 has weight 0, so `talk` is 50, inside the band.

- [ ] **Step 5: Commit**

```bash
git add src/mind/process/onboarding/card-facts.ts tests/mind/process/onboarding/card-facts.test.ts
git commit -m "feat(onboarding): both profile cards as first-impression memories"
```

---

### Task 4: Storage, submit and the endpoint

**Files:**
- Modify: `src/db/schema.ts` (add `onboarding` table after `fact`)
- Create (generated): `src/db/migrations/0032_onboarding.sql` and its meta snapshot
- Create: `src/db/repos/user/onboarding.ts`
- Create: `src/mind/process/onboarding/submit.ts`
- Create: `src/app/api/onboarding/handler.ts`, `src/app/api/onboarding/route.ts`
- Test: `tests/app/onboarding-handler.test.ts`

**Interfaces:**
- Consumes: `loadQuiz`, `answersSchema`, `Answers` (Task 1); `commonTopics`, `Topic` (Task 2);
  `cardFacts` (Task 3); `insertFact` from `@/db/repos/user/facts`.
- Produces:
  - table `onboarding` (`user_id` pk, `quiz_version`, `answers` jsonb, `topics` jsonb,
    `completed_at`)
  - `type OnboardingRow = typeof onboarding.$inferSelect`
  - `getOnboarding(db: Db, userId: string): Promise<OnboardingRow | null>`
  - `insertOnboarding(db: Db, userId: string, row: { quiz_version: string; answers: Answers;
    topics: Topic[]; completed_at: Date }): Promise<boolean>` (false when a row already exists)
  - `type SubmitResult = { status: 201 } | { status: 400 | 409; error: string }`
  - `submitCard(deps: Pick<Deps, "db" | "config" | "embedder" | "clock">, user: { id: string;
    name: string }, body: unknown): Promise<SubmitResult>`
  - `createOnboardingHandler(opts: { getUser(req: Request): Promise<{ id: string; name: string }
    | null>; getDeps(): Deps }): (req: Request) => Promise<Response>`

- [ ] **Step 1: Add the table and generate the migration**

In `src/db/schema.ts`, after the `fact` table:

```ts
/** The profile card they filled in when they met her. One per user; the quiz is taken once. */
export const onboarding = pgTable("onboarding", {
  user_id: uuid("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  quiz_version: text("quiz_version").notNull(),
  answers: jsonb("answers").$type<Record<string, number | string>>().notNull(),
  // Worked out at submit, when both sides' answers are embedded, so the page makes no calls.
  topics: jsonb("topics").$type<{ yours: string; hers: string }[]>().notNull(),
  completed_at: ts("completed_at").notNull(),
});
```

Run: `pnpm db:generate --name onboarding`
Expected: `src/db/migrations/0032_onboarding.sql` containing `CREATE TABLE "onboarding"` and the
foreign key with `ON DELETE cascade`. Read the file; it must contain nothing else.

- [ ] **Step 2: Write the repo**

`src/db/repos/user/onboarding.ts`:

```ts
/**
 * One user's profile card answers: whether they've met her yet, and what they put on the card.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { onboarding } from "@/db/schema";
import type { Answers } from "@/mind/process/onboarding/quiz";
import type { Topic } from "@/mind/process/onboarding/score";

export type OnboardingRow = typeof onboarding.$inferSelect;

export async function getOnboarding(db: Db, userId: string): Promise<OnboardingRow | null> {
  const rows = await db.select().from(onboarding).where(eq(onboarding.user_id, userId)).limit(1);
  return rows[0] ?? null;
}

/** False when they already have a card: the quiz is taken once, even from two tabs at once. */
export async function insertOnboarding(
  db: Db,
  userId: string,
  row: { quiz_version: string; answers: Answers; topics: Topic[]; completed_at: Date },
): Promise<boolean> {
  const inserted = await db
    .insert(onboarding)
    .values({ ...row, user_id: userId })
    .onConflictDoNothing()
    .returning({ user_id: onboarding.user_id });
  return inserted.length === 1;
}
```

If ESLint rejects `@/db/repos/user/*` importing from `@/mind/process/*`, replace the two type
imports with local types: `type Answers = Record<string, number | string>` and
`type Topic = { yours: string; hers: string }`.

- [ ] **Step 3: Write the failing handler tests**

`tests/app/onboarding-handler.test.ts`:

```ts
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { createOnboardingHandler } from "@/app/api/onboarding/handler";
import { getOnboarding } from "@/db/repos/user/onboarding";
import { fact } from "@/db/schema";
import { ScriptedEmbedder } from "@/mind/platform/embedder/scripted";
import { loadQuiz } from "@/mind/process/onboarding/quiz";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const quiz = loadQuiz("v1", path.join(process.cwd(), "prompts"));

/** A complete, valid set of answers: option 0 everywhere, the given words for open questions. */
function fullAnswers(words = ["chess", "jazz", "tea"]) {
  let w = 0;
  return Object.fromEntries(
    quiz.questions.map((q) => [q.id, q.kind === "choice" ? 0 : words[w++]!]),
  );
}

const post = (body: unknown) =>
  new Request("http://x/api/onboarding", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

function setup() {
  const deps = { ...makeTestDeps(), embedder: new ScriptedEmbedder(1024) };
  return deps;
}
const handlerFor = (deps: ReturnType<typeof setup>, user: { id: string; name: string } | null) =>
  createOnboardingHandler({ getUser: async () => user, getDeps: () => deps });
const factCount = async (u: string) =>
  (await getTestDb().select().from(fact).where(eq(fact.user_id, u))).length;

test("401 without a session; 400 on bad JSON or bad answers", async () => {
  const deps = setup();
  expect((await handlerFor(deps, null)(post({}))).status).toBe(401);
  const u = { id: await createTestUser(), name: "Sam" };
  const h = handlerFor(deps, u);
  expect((await h(post("{not json"))).status).toBe(400);
  expect((await h(post({ quiz_version: "v1", answers: {} }))).status).toBe(400);
  for (const bad of ["   ", "one two three", "a".repeat(41)]) {
    const answers = { ...fullAnswers(), hours_topic: bad };
    expect((await h(post({ quiz_version: "v1", answers }))).status).toBe(400);
  }
  expect(await getOnboarding(deps.db, u.id)).toBeNull();
  expect(await factCount(u.id)).toBe(0);
});

test("201 stores the card with normalized answers and the card facts", async () => {
  const deps = setup();
  const u = { id: await createTestUser(), name: "Sam" };
  const answers = { ...fullAnswers(), hours_topic: "  Star   Gazing " };
  const res = await handlerFor(deps, u)(post({ quiz_version: "v1", answers }));
  expect(res.status).toBe(201);
  const row = await getOnboarding(deps.db, u.id);
  expect(row?.answers.hours_topic).toBe("Star Gazing");
  expect(row?.completed_at).toEqual(deps.clock.now());
  expect(await factCount(u.id)).toBeGreaterThan(quiz.dimensions.length);
});

test("review focus 1: a second submit is 409 and writes nothing more", async () => {
  const deps = setup();
  const u = { id: await createTestUser(), name: "Sam" };
  const h = handlerFor(deps, u);
  const body = { quiz_version: "v1", answers: fullAnswers() };
  const [a, b] = await Promise.all([h(post(body)), h(post(body))]);
  expect([a.status, b.status].sort()).toEqual([201, 409]);
  const n = await factCount(u.id);
  expect((await h(post(body))).status).toBe(409);
  expect(await factCount(u.id)).toBe(n);
});

test("review focus 2: an embedder failure is 503, writes nothing, and a retry succeeds", async () => {
  const deps = setup();
  deps.embedder.failNext = true;
  const u = { id: await createTestUser(), name: "Sam" };
  const h = handlerFor(deps, u);
  const body = { quiz_version: "v1", answers: fullAnswers() };
  expect((await h(post(body))).status).toBe(503);
  expect(await getOnboarding(deps.db, u.id)).toBeNull();
  expect(await factCount(u.id)).toBe(0);
  expect((await h(post(body))).status).toBe(201);
});

test("review focus 3: a stale quiz version is 409 stale_quiz and writes nothing", async () => {
  const deps = setup();
  const u = { id: await createTestUser(), name: "Sam" };
  const res = await handlerFor(deps, u)(post({ quiz_version: "v0", answers: fullAnswers() }));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "stale_quiz" });
  expect(await getOnboarding(deps.db, u.id)).toBeNull();
});
```

- [ ] **Step 4: Run to confirm it fails**

Run: `pnpm vitest run tests/app/onboarding-handler.test.ts`
Expected: FAIL, cannot resolve `@/app/api/onboarding/handler`.

- [ ] **Step 5: Implement submit**

`src/mind/process/onboarding/submit.ts`:

```ts
/**
 * Saving the profile card swap: check the answers against the quiz, work out what they have in
 * common, and write the card and both sides' memories together, so a card never exists without
 * its memories or the other way round.
 */
import { z } from "zod";
import { insertFact } from "@/db/repos/user/facts";
import { insertOnboarding } from "@/db/repos/user/onboarding";
import type { Deps } from "@/mind/platform/deps";
import { cardFacts } from "./card-facts";
import { answersSchema, loadQuiz } from "./quiz";
import { commonTopics } from "./score";

export type SubmitResult = { status: 201 } | { status: 400 | 409; error: string };

const Body = z.object({ quiz_version: z.string(), answers: z.unknown() });

class AlreadyDone extends Error {}

export async function submitCard(
  deps: Pick<Deps, "db" | "config" | "embedder" | "clock">,
  user: { id: string; name: string },
  body: unknown,
): Promise<SubmitResult> {
  const cfg = deps.config.onboarding;
  const parsed = Body.safeParse(body);
  if (!parsed.success) return { status: 400, error: "invalid_body" };
  if (parsed.data.quiz_version !== cfg.quiz_version) return { status: 409, error: "stale_quiz" };
  const quiz = loadQuiz(cfg.quiz_version);
  const answers = answersSchema(quiz, cfg.max_answer_chars).safeParse(parsed.data.answers);
  if (!answers.success) return { status: 400, error: "invalid_answers" };

  // Embedding happens before the transaction so a slow embedder never holds it open.
  const facts = cardFacts(quiz, answers.data, user.name, cfg);
  const topics = await commonTopics(quiz, answers.data, deps.embedder, cfg.topic_similarity);
  const vectors = await deps.embedder.embed(
    facts.map((f) => f.content),
    "document",
  );
  const now = deps.clock.now();

  try {
    await deps.db.transaction(async (tx) => {
      const fresh = await insertOnboarding(tx, user.id, {
        quiz_version: cfg.quiz_version,
        answers: answers.data,
        topics,
        completed_at: now,
      });
      if (!fresh) throw new AlreadyDone();
      for (const [i, f] of facts.entries()) {
        await insertFact(tx, user.id, {
          subject: f.subject,
          kind: f.kind,
          content: f.content,
          embedding: vectors[i]!,
          entity_refs: [],
          created_at: now,
          status: "open",
          salience: f.salience,
          valence: 0,
          confidence: cfg.confidence,
          source: "onboarding",
          source_ref: `onboarding:${cfg.quiz_version}`,
        });
      }
    });
  } catch (e) {
    if (e instanceof AlreadyDone) return { status: 409, error: "already_done" };
    throw e;
  }
  return { status: 201 };
}
```

The concurrent-submit test relies on the primary key: the second transaction's insert waits for
the first to commit, then `ON CONFLICT DO NOTHING` returns no row and it rolls back with
`already_done`.

- [ ] **Step 6: Implement the handler and route**

`src/app/api/onboarding/handler.ts`:

```ts
/**
 * POST /api/onboarding: the finished profile card. 201 saved, 400 bad answers, 409 already met her
 * or the quiz changed under them, 503 when saving failed and a retry may work.
 */
import type { Deps } from "@/mind/platform/deps";
import { submitCard } from "@/mind/process/onboarding/submit";

export function createOnboardingHandler(opts: {
  getUser(req: Request): Promise<{ id: string; name: string } | null>;
  getDeps(): Deps;
}) {
  return async function POST(req: Request): Promise<Response> {
    const user = await opts.getUser(req);
    if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    const deps = opts.getDeps();
    try {
      const r = await submitCard(deps, user, body);
      return r.status === 201
        ? new Response(null, { status: 201 })
        : Response.json({ error: r.error }, { status: r.status });
    } catch (e) {
      deps.log.error("onboarding submit failed", { error: e instanceof Error ? e.name : "unknown" });
      return Response.json({ error: "try_again" }, { status: 503 });
    }
  };
}
```

`src/app/api/onboarding/route.ts`:

```ts
import { auth } from "@/server/auth";
import { getDeps } from "@/server/deps";
import { createOnboardingHandler } from "./handler";

export const POST = createOnboardingHandler({
  getUser: async (req) => {
    const s = await auth.api.getSession({ headers: req.headers });
    return s ? { id: s.user.id, name: s.user.name } : null;
  },
  getDeps,
});
```

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run tests/app/onboarding-handler.test.ts && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts src/db/migrations src/db/repos/user/onboarding.ts src/mind/process/onboarding/submit.ts src/app/api/onboarding tests/app/onboarding-handler.test.ts
git commit -m "feat(onboarding): save the profile card and both sides' memories in one go"
```

---

### Task 5: The card mark and reply prompt v16

**Files:**
- Modify: `src/mind/process/hot-path/assemble.ts:139-142` (`ORIGIN.onboarding`)
- Modify: `src/mind/memory/shared/types.ts:26` (comment)
- Create: `prompts/reply/v16.md` (copy of v15 with one sentence changed); delete `prompts/reply/v15.md`
- Modify: `config/default.json` (`prompts.reply` → `"v16"`)
- Modify tests: `tests/mind/platform/prompts.test.ts:59`,
  `tests/mind/process/hot-path/assemble.test.ts:507`, `tests/exit/phase-10b.test.ts:314`

**Interfaces:**
- Produces: the mark text `from their profile card, a first impression`, used by Task 7.

- [ ] **Step 1: Update the tests first**

- `tests/mind/platform/prompts.test.ts:59`: `expect(c.prompts.reply).toBe("v16");`
- `tests/mind/process/hot-path/assemble.test.ts:507`:
  `expect(system).toContain("- They hate mornings. (today) (from their profile card, a first impression)");`
- `tests/exit/phase-10b.test.ts:314`:
  `expect(line(r.system, "They hate mornings.")).toContain("(from their profile card, a first impression)");`

Run: `pnpm vitest run tests/mind/platform/prompts.test.ts tests/mind/process/hot-path/assemble.test.ts tests/exit/phase-10b.test.ts`
Expected: FAIL on the three changed assertions.

- [ ] **Step 2: Change the mark and the prompt**

In `assemble.ts`:

```ts
const ORIGIN = {
  onboarding: "from their profile card, a first impression",
  guess: "your own guess, they never said this",
};
```

In `src/mind/memory/shared/types.ts:26`, change the comment to
`/** Theirs only: from the profile cards you swapped when you met, or her own guess rather than something they said. */`.

Create the new prompt and delete the old one:

```bash
git mv prompts/reply/v15.md prompts/reply/v16.md
```

In `prompts/reply/v16.md`, replace the sentence
`One marked "from when you first met" is from the questions they answered when you met.`
with:

```
One marked "from their profile card" is from the profile cards you swapped when you met: a first impression, nothing more. Hold it loosely, let what they actually tell you override it, and never treat it as something either of you said in conversation.
```

In `config/default.json`, set `"reply": "v16"` under `prompts`.

Then check nothing else names v15: `git grep -n "reply/v15\|\"v15\"" -- src tests evals config`
Expected: no output. Fix any hit.

- [ ] **Step 3: Run the tests**

Run: `pnpm vitest run tests/mind/platform tests/mind/process/hot-path tests/exit/phase-10b.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A prompts/reply config/default.json src/mind/process/hot-path/assemble.ts src/mind/memory/shared/types.ts tests
git commit -m "feat(reply): card facts read as a first impression; reply v16"
```

---

### Task 6: The quiz and results pages, the gate, the settings link

**Files:**
- Create: `src/app/onboarding/page.tsx`, `src/app/onboarding/quiz-client.tsx`,
  `src/app/onboarding/onboarding.module.css`, `src/app/onboarding/results/page.tsx`
- Modify: `src/app/chat/page.tsx` (gate), `src/app/settings/page.tsx` (link)

**Interfaces:**
- Consumes: `loadQuiz` (Task 1), `cardView` (Task 2), `getOnboarding` (Task 4), POST
  `/api/onboarding` (Task 4).

Before writing, read `node_modules/next/dist/docs/` for server components, `redirect` from
`next/navigation`, and client components in this Next version. Follow `src/app/chat/page.tsx` and
`src/app/(auth)/signup/page.tsx` for the patterns already in use.

- [ ] **Step 1: Gate `/chat`**

In `src/app/chat/page.tsx`, add imports `import { redirect } from "next/navigation";` and
`import { getOnboarding } from "@/db/repos/user/onboarding";`, and after
`const { db, config } = getDeps();`:

```ts
  // Nobody meets her without swapping profile cards first.
  if (!(await getOnboarding(db, user.id))) redirect("/onboarding");
```

- [ ] **Step 2: The quiz page (server)**

`src/app/onboarding/page.tsx`:

```tsx
/**
 * The profile card swap: how Spica meets people. Taken once, before the first chat.
 */
import { redirect } from "next/navigation";
import { getOnboarding } from "@/db/repos/user/onboarding";
import { loadQuiz } from "@/mind/process/onboarding/quiz";
import { getDeps } from "@/server/deps";
import { requireUser } from "@/server/session";
import { QuizClient, type ClientQuestion } from "./quiz-client";

export default async function OnboardingPage() {
  const user = await requireUser();
  const { db, config } = getDeps();
  if (await getOnboarding(db, user.id)) redirect("/chat");
  const quiz = loadQuiz(config.onboarding.quiz_version);
  // Only what the screen shows: the weights and fact wording stay on the server.
  const questions: ClientQuestion[] = quiz.questions.map((q) =>
    q.kind === "choice"
      ? { kind: "choice", id: q.id, prompt: q.prompt, options: q.options.map((o) => o.label), her: q.her }
      : { kind: "open", id: q.id, prompt: q.prompt, maxWords: q.max_words, her: q.her },
  );
  return (
    <QuizClient
      intro={quiz.intro}
      version={config.onboarding.quiz_version}
      maxChars={config.onboarding.max_answer_chars}
      questions={questions}
    />
  );
}
```

- [ ] **Step 3: The quiz client**

`src/app/onboarding/quiz-client.tsx`:

```tsx
"use client";
/**
 * One question at a time: they answer, then her answer shows. Answers stay in the browser until
 * the last question, then go up in one request.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./onboarding.module.css";

export type ClientQuestion =
  | { kind: "choice"; id: string; prompt: string; options: string[]; her: number }
  | { kind: "open"; id: string; prompt: string; maxWords: number; her: string };

const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

export function QuizClient(props: {
  intro: string;
  version: string;
  maxChars: number;
  questions: ClientQuestion[];
}) {
  const router = useRouter();
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number | string>>({});
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const q = props.questions[index]!;
  const answered = q.id in answers;
  const last = index === props.questions.length - 1;

  function answerOpen() {
    if (q.kind !== "open") return;
    const words = tidy(draft);
    if (!words) return setError("Type a word or two.");
    if (words.split(" ").length > q.maxWords || words.length > props.maxChars)
      return setError(`One or two words, ${props.maxChars} characters at most.`);
    setError(null);
    setAnswers({ ...answers, [q.id]: words });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/onboarding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ quiz_version: props.version, answers }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) return router.push("/onboarding/results");
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.status === 409 && body.error === "already_done") return router.push("/onboarding/results");
    if (res?.status === 409 && body.error === "stale_quiz") return window.location.reload();
    setError("Couldn't save your card. Try again.");
  }

  function next() {
    setDraft("");
    if (last) void submit();
    else setIndex(index + 1);
  }

  if (!started)
    return (
      <main className={styles.wrap}>
        <h1>Meet Spica</h1>
        <p className={styles.lede}>{props.intro}</p>
        <button className={styles.primary} onClick={() => setStarted(true)}>
          Start
        </button>
      </main>
    );

  return (
    <main className={styles.wrap}>
      <p className={styles.progress}>
        {index + 1} / {props.questions.length}
      </p>
      <h2 className={styles.prompt}>{q.prompt}</h2>
      {q.kind === "choice" ? (
        <ul className={styles.options}>
          {q.options.map((label, i) => (
            <li key={label}>
              <button
                className={styles.option}
                disabled={answered}
                data-yours={answers[q.id] === i || undefined}
                data-hers={(answered && q.her === i) || undefined}
                onClick={() => setAnswers({ ...answers, [q.id]: i })}
              >
                {label}
                {answered && answers[q.id] === i && <span className={styles.tag}>you</span>}
                {answered && q.her === i && <span className={styles.tag}>Spica</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : answered ? (
        <dl className={styles.pair}>
          <dt>you</dt>
          <dd>{answers[q.id]}</dd>
          <dt>Spica</dt>
          <dd>{q.her}</dd>
        </dl>
      ) : (
        <form
          className={styles.open}
          onSubmit={(e) => {
            e.preventDefault();
            answerOpen();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={props.maxChars}
            aria-label={q.prompt}
            autoFocus
          />
          <button className={styles.primary} type="submit">
            Answer
          </button>
        </form>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {answered && (
        <button className={styles.primary} onClick={next} disabled={busy}>
          {last ? (busy ? "Saving…" : "See your match") : "Next"}
        </button>
      )}
    </main>
  );
}
```

- [ ] **Step 4: The results page**

`src/app/onboarding/results/page.tsx`:

```tsx
/**
 * The compatibility page: both profile cards, where they sit on each friend dimension against
 * her, and what they have in common. Made to read well as a screenshot.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getOnboarding } from "@/db/repos/user/onboarding";
import { loadQuiz } from "@/mind/process/onboarding/quiz";
import { cardView } from "@/mind/process/onboarding/score";
import { getDeps } from "@/server/deps";
import { requireUser } from "@/server/session";
import styles from "../onboarding.module.css";

export default async function ResultsPage() {
  const user = await requireUser();
  const { db, config } = getDeps();
  const row = await getOnboarding(db, user.id);
  if (!row) redirect("/onboarding");
  // A card keeps the quiz it was taken with, even after the quiz file moves on.
  const view = cardView(loadQuiz(row.quiz_version), row.answers, row.topics, config.onboarding);
  return (
    <main className={styles.wrap}>
      <h1>You and Spica</h1>
      <div className={styles.cards}>
        <section className={styles.card}>
          <h2>Spica</h2>
          <ul>
            {view.hers.map((a) => (
              <li key={a.prompt}>{a.answer}</li>
            ))}
          </ul>
        </section>
        <section className={styles.card}>
          <h2>{user.name}</h2>
          <ul>
            {view.yours.map((a) => (
              <li key={a.prompt}>{a.answer}</li>
            ))}
          </ul>
        </section>
      </div>
      <section className={styles.bars}>
        {view.dimensions.map((d) => (
          <div key={d.id} className={styles.bar}>
            <div className={styles.ends}>
              <span>{d.left}</span>
              <span>{d.right}</span>
            </div>
            <div className={styles.track} role="img" aria-label={`${d.left} to ${d.right}: you ${d.you}, Spica ${d.her}`}>
              <span className={styles.her} style={{ left: `${d.her}%` }} />
              <span className={styles.you} style={{ left: `${d.you}%` }} />
            </div>
            <p className={styles.basis}>{d.basis}</p>
            {d.line && <p className={styles.line}>“{d.line}”</p>}
          </div>
        ))}
      </section>
      <section>
        <h2>In common</h2>
        {view.noCommon ? (
          <p className={styles.line}>“{view.noCommon}”</p>
        ) : (
          <ul>
            {view.topics.map((t) => (
              <li key={t.yours}>
                {t.yours} · {t.hers}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link href="/chat" className={styles.primary}>
        Meet her
      </Link>
    </main>
  );
}
```

- [ ] **Step 5: Styles**

`src/app/onboarding/onboarding.module.css` (uses the CSS variables already defined in
`src/app/globals.css`; check its names and swap any that don't exist):

```css
.wrap { max-width: 520px; margin: 6vh auto; padding: 0 16px; display: grid; gap: 20px; }
.lede, .progress, .basis { color: var(--muted, #888); }
.basis { font-size: 12px; margin: 4px 0 0; }
.prompt { font-size: 22px; margin: 0; }
.options { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
.option { width: 100%; text-align: left; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border, #ccc); background: none; color: inherit; font: inherit; display: flex; gap: 8px; align-items: center; }
.option[data-yours] { border-color: var(--accent, #6b8cff); }
.option[data-hers] { background: color-mix(in srgb, var(--accent, #6b8cff) 12%, transparent); }
.tag { margin-left: auto; font-size: 12px; opacity: 0.8; }
.open { display: flex; gap: 8px; }
.open input { flex: 1; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--border, #ccc); font: inherit; }
.pair { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; }
.pair dt { color: var(--muted, #888); }
.pair dd { margin: 0; font-size: 18px; }
.primary { justify-self: start; padding: 10px 18px; border-radius: 10px; border: none; background: var(--accent, #6b8cff); color: white; font: inherit; text-decoration: none; }
.error { color: var(--danger, #c33); margin: 0; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card { border: 1px solid var(--border, #ccc); border-radius: 12px; padding: 12px 14px; }
.card h2 { font-size: 16px; margin: 0 0 6px; }
.card ul { margin: 0; padding-left: 18px; }
.bars { display: grid; gap: 18px; }
.ends { display: flex; justify-content: space-between; font-size: 14px; }
.track { position: relative; height: 8px; border-radius: 4px; background: var(--border, #ddd); margin-top: 6px; }
.her, .you { position: absolute; top: 50%; width: 16px; height: 16px; border-radius: 50%; transform: translate(-50%, -50%); }
.her { background: var(--muted, #888); }
.you { background: var(--accent, #6b8cff); border: 2px solid var(--bg, white); }
.line { font-style: italic; margin: 6px 0 0; }
```

Then run `pnpm format` so Prettier lays it out.

- [ ] **Step 6: Settings link**

In `src/app/settings/page.tsx`, after the first `<section>` (sign out):

```tsx
      <section>
        <h2 style={{ fontSize: 18 }}>Your card</h2>
        <Link href="/onboarding/results">See the profile cards you and Spica swapped</Link>
      </section>
```

- [ ] **Step 7: Check it in the app**

Run: `pnpm typecheck && pnpm lint`, then `pnpm db:migrate` and `pnpm dev`. Sign up a new account:
`/chat` should redirect to `/onboarding`; answer every question (her pick shows after each choice,
her words after each open answer); submit lands on `/onboarding/results` with six bars, both cards
and common topics or the no-common line; "Meet her" opens `/chat`; visiting `/onboarding` again
redirects to `/chat`; settings links to the results. Use the `run` skill to drive and screenshot
it if available. Also check phone width (375px): no horizontal scroll.

- [ ] **Step 8: Commit**

```bash
git add src/app/onboarding src/app/chat/page.tsx src/app/settings/page.tsx
git commit -m "feat(onboarding): the quiz, the compatibility page and the chat gate"
```

---

### Task 7: Exit test

**Files:**
- Create: `tests/exit/phase-11.test.ts`

**Interfaces:**
- Consumes: `submitCard` (Task 4), `getOnboarding` (Task 4), `cardView` (Task 2), `loadQuiz`
  (Task 1), the card mark (Task 5), `composeReply`, `runColdPath`, `insertTurn`,
  `ensureRelationship`, `adminDecayFacts`, `CANARY`.

- [ ] **Step 1: Write the exit test**

`tests/exit/phase-11.test.ts`:

```ts
/**
 * Phase 11 exit, all fake: the profile card swap writes both sides' cards as light memories,
 * they reach her reply marked as a first impression, conversation overrides them, their name
 * never fades, the compatibility page comes out of the answers, and nothing reaches core or
 * another user.
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { adminDecayFacts } from "@/db/repos/admin/decay";
import { getOnboarding } from "@/db/repos/user/onboarding";
import { ensureRelationship } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import { ScriptedEmbedder } from "@/mind/platform/embedder/scripted";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { composeReply } from "@/mind/process/hot-path/compose";
import { loadQuiz } from "@/mind/process/onboarding/quiz";
import { cardView } from "@/mind/process/onboarding/score";
import { submitCard } from "@/mind/process/onboarding/submit";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const DIM = 1024;
const quiz = loadQuiz("v1", path.join(process.cwd(), "prompts"));
const MARK = "(from their profile card, a first impression)";
const HOMEBODY = "On their profile card they came across as more of a homebody.";

function setup() {
  return { ...makeTestDeps(), embedder: new ScriptedEmbedder(DIM) };
}
type D = ReturnType<typeof setup>;

function answers(pick: number, words: string[]) {
  let w = 0;
  return Object.fromEntries(
    quiz.questions.map((q) => [q.id, q.kind === "choice" ? Math.min(pick, q.options.length - 1) : words[w++]!]),
  );
}

async function meet(d: D, name: string, words = ["chess", "jazz", "tea"]) {
  const id = await createTestUser(name);
  await ensureRelationship(d.db, id, d.clock.now(), d.config.relationship);
  const r = await submitCard(d, { id, name }, { quiz_version: "v1", answers: answers(0, words) });
  expect(r.status).toBe(201);
  return id;
}

const cardFactsOf = (u: string) =>
  getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), eq(s.fact.source, "onboarding")));

async function talk(d: D, u: string, text: string) {
  d.clock.advance(60_000);
  const session = randomUUID();
  const ut = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: session,
    role: "user",
    text,
    created_at: d.clock.now(),
    safety_flag: null,
  });
  const r = await composeReply(d, u, { turns: [ut], openQuestions: [], flag: null });
  const ct = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: session,
    role: "companion",
    text: r.text,
    created_at: d.clock.now(),
    reply_to: ut.id,
  });
  return { system: d.llm.calls.at(-1)!.system, ut, ct };
}

const CORE_TABLES = [
  "core_memory",
  "core_entity",
  "core_state",
  "core_goal",
  "core_snapshot",
  "world_event",
  "life_event_log",
  "core_loop_trace",
  "core_budget_day",
  "life_day",
  "drift_log",
  "core_self_line",
];
async function coreDump(): Promise<string> {
  const parts: string[] = [];
  for (const t of CORE_TABLES) {
    const res = await getTestDb().execute(sql.raw(`SELECT row_to_json(x)::text AS j FROM "${t}" x`));
    parts.push(...res.rows.map((r) => String(r.j)).sort());
  }
  return parts.join("\n");
}

test("1: a finished quiz writes exactly the expected cards for both sides", async () => {
  const d = setup();
  const u = await meet(d, "Sam");
  const facts = await cardFactsOf(u);
  const theirs = facts.filter((f) => f.subject === "user");
  const hers = facts.filter((f) => f.subject === "self");
  // name + one per dimension + one per open question
  const opens = quiz.questions.filter((q) => q.kind === "open").length;
  expect(theirs).toHaveLength(1 + quiz.dimensions.length + opens);
  expect(hers.map((f) => f.content).sort()).toEqual(
    quiz.questions.flatMap((q) => (q.her_fact ? [q.her_fact] : [])).sort(),
  );
  for (const f of facts) {
    expect(f).toMatchObject({ source: "onboarding", source_ref: "onboarding:v1", confidence: 0.4 });
  }
  expect(theirs.find((f) => f.content === "Their name is Sam.")?.salience).toBe(1);
  expect(theirs.filter((f) => f.salience !== 1).every((f) => f.salience === 0.5)).toBe(true);
});

test("2: card facts reach the reply prompt with the card mark", async () => {
  const d = setup();
  const u = await meet(d, "Sam");
  // Put the homebody impression right next to the message so retrieval picks it.
  d.embedder.set(HOMEBODY, ScriptedEmbedder.axis(DIM, 7)).set("staying in tonight", ScriptedEmbedder.axis(DIM, 7));
  await getTestDb()
    .update(s.fact)
    .set({ embedding: ScriptedEmbedder.axis(DIM, 7) })
    .where(and(eq(s.fact.user_id, u), eq(s.fact.content, HOMEBODY)));
  const { system } = await talk(d, u, "staying in tonight");
  const line = system.split("\n").find((l) => l.includes(HOMEBODY));
  expect(line).toContain(MARK);
});

test("3: a later conversation fact supersedes a card fact", async () => {
  const d = setup();
  const u = await meet(d, "Sam");
  const [card] = (await cardFactsOf(u)).filter((f) => f.content === HOMEBODY);
  const SAID = "The user goes out most nights.";
  d.embedder.set(SAID, card!.embedding);
  d.llm.handlers.extract = (input: string) => ({
    facts: input.includes("New exchange")
      ? [
          {
            subject: "user",
            kind: "trait",
            content: SAID,
            occurred_at: null,
            salience: 0.6,
            valence: 0,
            confidence: 0.9,
            entity_names: [],
            thread_title: null,
            claim_kind: null,
          },
        ]
      : [],
    entities: [],
    threads: [],
    relationship: null,
    bid_response: null,
  });
  d.llm.handlers.reconcile = () => ({ relation: "contradicts", target_fact_id: card!.id });
  const ex = await talk(d, u, "honestly i go out most nights");
  await runColdPath(d, {
    userId: u,
    turnIds: [ex.ut.id, ex.ct.id],
    replyTurnId: ex.ct.id,
    recalled: [],
  });
  const [after] = await getTestDb().select().from(s.fact).where(eq(s.fact.id, card!.id));
  expect(after?.status).toBe("superseded");
});

test("4: the gate opens only once the card exists", async () => {
  const d = setup();
  const u = await createTestUser("Sam");
  expect(await getOnboarding(d.db, u)).toBeNull(); // /chat redirects to /onboarding
  await submitCard(d, { id: u, name: "Sam" }, { quiz_version: "v1", answers: answers(0, ["a", "b", "c"]) });
  expect(await getOnboarding(d.db, u)).not.toBeNull(); // /chat opens; /onboarding redirects back
});

test("5: the compatibility page comes out of the stored answers", async () => {
  const d = setup();
  const u = await meet(d, "Sam", ["Stargazing", "knitting", "tea"]);
  const row = (await getOnboarding(d.db, u))!;
  expect(row.topics).toEqual([{ yours: "Stargazing", hers: "stargazing" }]);
  const view = cardView(quiz, row.answers, row.topics, d.config.onboarding);
  expect(view.dimensions.map((x) => x.id)).toEqual(quiz.dimensions.map((x) => x.id));
  // Option 0 everywhere: friday -1, after_weekend -1, cancelled 0 -> mean -2/3 -> 17; she sits at 30.
  expect(view.dimensions.find((x) => x.id === "social_energy")).toMatchObject({ you: 17, her: 30 });
  expect(view.noCommon).toBeNull();
  expect(view.yours.map((a) => a.answer)).toEqual(["Stargazing", "knitting", "tea"]);
});

test("6: their name never fades; the rest of the card can go stale", async () => {
  const d = setup();
  const u = await meet(d, "Sam");
  const day = 86_400_000;
  for (let i = 1; i <= 120; i++) {
    await adminDecayFacts(getTestDb(), new Date(d.clock.now().getTime() + i * day), d.config.decay);
  }
  const facts = await cardFactsOf(u);
  expect(facts.find((f) => f.content === "Their name is Sam.")?.status).toBe("open");
  expect(facts.filter((f) => f.content !== "Their name is Sam.").every((f) => f.status === "stale")).toBe(true);
});

test("7: leak canary and side channel: A's card never reaches core or B's reply", async () => {
  const d = setup();
  const before = await coreDump();
  const token = `CANARY-${randomUUID().slice(0, 8)}`;
  await meet(d, "Ann", [token, "jazz", "tea"]);
  expect(await coreDump()).toBe(before); // A's submit leaves core unchanged
  const b = await meet(d, "Ben");
  const { system } = await talk(d, b, "what do you like?");
  expect(system).not.toContain(token);
  expect(await coreDump()).not.toContain(token);
});
```

Notes for the implementer:
- If extraction's zod schema in `src/mind/process/cold-path/` requires fields not listed in test 3,
  copy the missing ones from `idiolectFact` in `tests/exit/phase-10c.test.ts:70-85` (omit the
  idiolect-only fields if they're optional).
- If test 2 doesn't find the line, print `system` and check retrieval's top-k and the
  `## What you remember` section; the homebody fact must be in it, since its vector equals the
  query's.
- `adminDecayFacts` expects the config shape `{ grace_days, rate, stale_floor,
  dormant_after_days }`; `d.config.decay` has all four.

- [ ] **Step 2: Run the exit test**

Run: `pnpm vitest run tests/exit/phase-11.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Run everything**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all pass; note the file and test counts for the docs.

- [ ] **Step 4: Commit**

```bash
git add tests/exit/phase-11.test.ts
git commit -m "test: phase 11 exit; the card swap, its mark, its floor and the canary"
```

---

### Task 8: Spec, decisions and project notes

**Files:**
- Modify: `spica-design-spec-v3.md` (§14, the facts schema line near 319, §20 Phase 11 row and the
  built table, §25 B6 and new backlog items, §21 #8 note)
- Modify: `DECISIONS.md`
- Modify: `CLAUDE.md` (Onboarding bullet, current phase line)
- Modify: `docs/superpowers/specs/2026-10-12-phase-11-onboarding-design.md` (two amendments)

- [ ] **Step 1: Amend the design doc to what was built**

- §2 Storage and §3: topics are computed at submit and stored in their own `topics` column, not
  embeddings in `answers`; the results page and her cached embeddings go away.
- §4 Evals: the eval profiles are left unchanged (their wording doesn't affect the card mark).

- [ ] **Step 2: Rewrite §14 of the v3 spec**

Replace §14 with:

```markdown
## 14. Onboarding (Built Phase 11)

How Spica meets people: before the first chat, the user and Spica swap profile cards, the way
people meet on social media with an impression first. It's dating apps, but for friends. Required
once, after signup; taking it before signup (as a hook) is a later decision.
- A short quiz (`prompts/onboarding/quiz/v<N>.yaml`, `onboarding.quiz_version`): 12 choice and 3
  open questions. You answer, then see hers: only her pick on a choice question, one or two words
  on an open one, so she gives away about as much as you do.
- Six friend dimensions, loosely backed by research (draft, open to tweaks): homebody ↔
  out-and-about, planner ↔ spontaneous, comfort picks ↔ new things, keep the peace ↔ say it
  straight, easy banter ↔ deep talk, check in now and then ↔ always texting. No MBTI or Big Five
  labels: a short quiz can't type anyone honestly.
- The compatibility page: both cards, a bar per dimension with your position over her fixed
  marker, a click line under `onboarding.click_gap` and a clash line over `onboarding.clash_gap`,
  and common topics (exact or embedding similarity ≥ `onboarding.topic_similarity`, worked out at
  submit), or her `no_common` line. All code, no model call. Shared by screenshot for now.
- Both cards become user-scoped memories with `source = onboarding`, `source_ref =
  onboarding:<version>`, confidence `onboarding.confidence` (0.4), salience `onboarding.salience`
  (0.5): one impression per dimension and one per open answer about them, and her answers as `self`
  facts (what she told this user). Their name is a fact at salience 1.0, which decay never lowers.
- **Reveal pacing dropped:** she saw their card, so she knows it from day one, lightly. Replies
  mark card facts *(from their profile card, a first impression)*; conversation overrides them.
- Whether the quiz measures attachment style (§11.3) is OPEN (§21 #8); the quiz file can take
  attachment questions with no schema change.
```

- [ ] **Step 3: Update §20, §25, the facts line and §21**

- §20 built table: add a row after 10d:
  `| 11. Onboarding | The profile card swap: quiz file v1 (six friend dimensions), `onboarding` table (migration 0032), `submitCard` writing both cards as light memories and the name floor, the compatibility page, the `/chat` gate, the card mark (reply v16); exit `tests/exit/phase-11.test.ts` (the canary). `pnpm test` <files> files / <tests> tests at close |`
  (fill in the counts from Task 7 Step 3).
- §20 next-phases table: change the Phase 11 exit test cell to: "The card swap writes both cards
  as light memories; card facts reach the reply marked; conversation supersedes them; the name
  never fades; the compatibility page comes from the answers; the leak canary".
- Facts schema (line ~319): note `source_ref` is `onboarding:<quiz_version>` for card facts.
- §25 B6: replace with "**B6.** Name floor done (salience 1.0). Cap onboarding facts in the guard
  input: *guard phase*. The `minimal` / `basic` / `rich` profile experiment: *tuning*."
- §25 new items: "**B<next>.** A public share link for the compatibility page (needs auth and
  abuse work). *Before users.*" and "**B<next+1>.** The quiz before signup, as a hook; answers are
  already held client-side until submit. *Later.*" Use the next free B numbers.
- §21 #8: append "(the quiz file can take attachment questions with no schema change)".

- [ ] **Step 4: DECISIONS.md and CLAUDE.md**

Append to the `DECISIONS.md` table:

```markdown
| 2026-10-12 | Reveal pacing dropped: card facts are known from day one, lightly | She saw their profile card, the way you'd know a profile; the card mark and low confidence keep it a first impression. |
| 2026-10-12 | The compatibility page is shared by screenshot only | A public link needs auth and abuse work; backlog, before users. |
| 2026-10-12 | Her card answers are `self` facts, not disclosure rows | The disclosure ledger tracks core memories and self lines; her quiz answers are neither. |
| 2026-10-12 | Common topics are stored on the card at submit | Both sides are embedded then, so the results page makes no calls. |
```

In `CLAUDE.md`, replace the Onboarding bullet under "Modules in brief" with:
`- **Onboarding (v3 §14):** the profile card swap: a required one-time quiz, both cards as light user-scoped memories (name at salience 1.0), the compatibility page on six friend dimensions; reveal pacing dropped.`
and update the current-phase paragraph to say Phase 11 (onboarding) is built and next per §20 is
Phase 12 (extension stubs), which needs its design doc.

- [ ] **Step 5: Format, check and commit**

Run: `pnpm format && pnpm lint`
Expected: PASS.

```bash
git add spica-design-spec-v3.md DECISIONS.md CLAUDE.md docs/superpowers/specs/2026-10-12-phase-11-onboarding-design.md
git commit -m "docs: record phase 11 (onboarding, the profile card swap)"
```
