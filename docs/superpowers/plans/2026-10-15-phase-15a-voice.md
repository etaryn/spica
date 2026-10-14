# Phase 15a: Her Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make her replies read like texting: bubble length tracks the user's, a casual base
register in code, a move picked per reply, quieter feeling lines, no greeting backchannels, named
recall, and a voice report plus a blind model comparison for review.

**Architecture:** New pure functions in `src/mind/process/hot-path/` measure the user's shape
(`textingShape`), pick a move (`pickMove`, biased by her mood keys), phrase both into a new
prompt section ("How to text this one"), and reshape the guarded reply (`shapeText`) before it is
stored, so `splitParts` stays the only splitter. The backchannel rule lives in the turn judge's
`usableBackchannel`. Evals record each reply's prompt and draft per user for a voice report.

**Tech Stack:** TypeScript, Vitest, zod config, Postgres test DB (existing helpers), tsx eval
scripts.

**Spec:** `docs/2026-10-15-phase-15a-voice-design.md`

## Global Constraints

- `src/mind` is framework-free: no Next imports, no `Date.now()`, no `Math.random()`, no
  `process.env`; use injected `Deps`. Randomness only via `seededUnit` from
  `@/mind/platform/seeded-random`.
- Every numeric constant goes in config (`config/default.json` plus the zod schema in
  `src/mind/platform/config.ts`). Every prompt is a versioned file under `prompts/`.
- Every new file starts with a short plain-English header comment. Comments say why, never cite
  spec sections, phases or backlog numbers.
- Prettier at 100 columns (`pnpm format`). `pnpm typecheck`, `pnpm lint`, `pnpm test` must pass at
  the end of every task.
- Replace, don't shim: prompt versions nothing configures are deleted in the same task.
- A crisis reply is untouched by every voice mechanism (no band, no move, no shaping).
- `shapeText` never removes a word: only dashes, case, a closing full stop and bubble breaks
  change.
- Scope: everything reads only the current user's turns and state plus core state already read
  by the reply; nothing is written anywhere.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Work on branch
  `phase-15a-voice`.

## Review Focus

1. Decimals, ranges, URLs and ellipses in a reply ("3.5", "3–5 days", "example.com", "hmm...")
   must come through `shapeText` intact: a range dash stays, "..." keeps its dots, nothing splits
   mid-number. Test in Task 4.
2. A user who sends only emoji or punctuation ("😂", "??") must not produce NaN or an empty band;
   the base length holds. Test in Task 1.
3. A model reply with more blank-line texts than `chat.max_parts` keeps every word: the overflow
   merges into the last bubble. Test in Task 4.
4. One very long sentence with no sentence end stays one bubble (never cut mid-sentence). Test in
   Task 4.
5. An emoji-only backchannel ("😂") on a story mid-thought is still allowed (it has no words to
   echo). Test in Task 7.

---

### Task 1: Voice config and `textingShape`

**Files:**
- Modify: `src/mind/platform/config.ts` (new `voice` section, `turn.greeting_words`,
  `VoiceConfig` type)
- Modify: `config/default.json`
- Create: `src/mind/process/hot-path/texting-shape.ts`
- Test: `tests/mind/process/hot-path/texting-shape.test.ts`

**Interfaces:**
- Produces: `VoiceConfig` (type), `type VoiceBand = { key: string; max_words: number }`,
  `type TextingShape = { band: VoiceBand; formal: boolean; emoji: boolean }`,
  `wordCount(text: string): number`,
  `bandFor(words: number, bands: VoiceBand[], shift?: number): VoiceBand`,
  `textingShape(messages: string[], cfg: VoiceConfig, bandShift?: number): TextingShape`.
- Config keys: `voice.window_messages`, `voice.base_words_per_bubble`, `voice.bands`,
  `voice.formal_threshold`, `voice.emoji_rate`, `voice.split_tolerance`,
  `voice.feeling_max_lines`, `voice.moves.weights`, `voice.moves.bias`, `turn.greeting_words`.

- [ ] **Step 1: Write the failing test**

`tests/mind/process/hot-path/texting-shape.test.ts`:

```ts
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { bandFor, textingShape, wordCount } from "@/mind/process/hot-path/texting-shape";

const cfg = loadConfig().voice;
const short = ["lol", "omg no", "wait what", "nah", "ok cool", "same", "haha", "yeah"];
const long = [
  "I had the strangest day at work, my manager moved every meeting to the afternoon.",
  "Then the train was cancelled, so I walked home in the rain, which was honestly nice.",
  "Do you ever just enjoy getting caught in the rain? It feels like a reset button.",
  "Anyway, I made soup when I got home and now I am very warm and very sleepy.",
  "Tomorrow is going to be a lot, though. Three deadlines and a dentist appointment.",
  "I keep telling myself I will plan the week on Sunday and then I never actually do.",
  "What did you get up to today? I feel like I have been talking about myself a lot.",
  "Also I finally started that book you mentioned, the one with the lighthouse keeper.",
];

test("wordCount ignores emoji and stray punctuation", () => {
  expect(wordCount("omg no 😂")).toBe(2);
  expect(wordCount("😂 ??")).toBe(0);
});

test("a new user gets her base band", () => {
  const shape = textingShape([], cfg);
  expect(shape.band).toEqual(bandFor(cfg.base_words_per_bubble, cfg.bands));
  expect(shape.formal).toBe(false);
  expect(shape.emoji).toBe(false);
});

test("a short texter gets the shortest band, a long one the longest", () => {
  expect(textingShape(short, cfg).band.key).toBe(cfg.bands[0]!.key);
  expect(textingShape(long, cfg).band.key).toBe(cfg.bands.at(-1)!.key);
});

test("tidy writers read as formal; lowercase texters don't", () => {
  expect(textingShape(long, cfg).formal).toBe(true);
  expect(textingShape(short, cfg).formal).toBe(false);
});

test("one tidy message from a new user doesn't make them formal", () => {
  expect(textingShape(["Hello there."], cfg).formal).toBe(false);
});

test("emoji-only messages keep the base length and count as emoji", () => {
  const shape = textingShape(Array(cfg.window_messages).fill("😂"), cfg);
  expect(shape.band).toEqual(bandFor(cfg.base_words_per_bubble, cfg.bands));
  expect(shape.emoji).toBe(true);
});

test("a band shift moves down a band and clamps at the ends", () => {
  const middle = cfg.bands[1]!;
  expect(bandFor(middle.max_words, cfg.bands, -1)).toEqual(cfg.bands[0]);
  expect(bandFor(1, cfg.bands, -5)).toEqual(cfg.bands[0]);
  expect(bandFor(10_000, cfg.bands, 5)).toEqual(cfg.bands.at(-1));
});

test("bands must ascend", () => {
  expect(() =>
    loadConfig({ voice: { bands: [{ key: "a", max_words: 9 }, { key: "b", max_words: 3 }] } }),
  ).toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/mind/process/hot-path/texting-shape.test.ts`
Expected: FAIL (module `texting-shape` not found / `voice` missing from config).

- [ ] **Step 3: Add the config**

In `src/mind/platform/config.ts`, add `greeting_words: z.array(text),` inside the `turn`
`strictObject` (after `incomplete_cues`). Add this section above `const prompts = z.object({`:

```ts
const moveMultipliers = z.object({
  react: nonNegative.optional(),
  share: nonNegative.optional(),
  ask: nonNegative.optional(),
  /** Bands to move her length by while this state holds; negative is shorter. */
  band_shift: z.number().int().optional(),
});

const voice = z.object({
  window_messages: positiveInt,
  base_words_per_bubble: z.number().positive(),
  bands: z
    .array(z.object({ key: text, max_words: positiveInt }))
    .min(1)
    .refine(
      (b) => b.every((x, i) => i === 0 || x.max_words > b[i - 1]!.max_words),
      "voice.bands: max_words must ascend",
    ),
  formal_threshold: unit,
  emoji_rate: nonNegative,
  split_tolerance: z.number().min(1),
  feeling_max_lines: positiveInt,
  moves: z.object({
    weights: z.object({ react: nonNegative, share: nonNegative, ask: nonNegative }),
    /** Keyed by mood key ("energy low", "hurt above"); unknown keys are simply never matched. */
    bias: z.record(z.string(), moveMultipliers),
  }),
});
```

Add `voice,` to `ConfigSchema` (after `posts,`) and export
`export type VoiceConfig = Config["voice"];` next to the other exported section types.

In `config/default.json`, add inside `"turn"` after `"incomplete_cues"`:

```json
"greeting_words": ["hi", "hey", "hello", "hiya", "heya", "yo", "sup", "oi", "morning", "evening", "good"],
```

and a top-level `"voice"` block:

```json
"voice": {
  "window_messages": 8,
  "base_words_per_bubble": 8,
  "bands": [
    { "key": "few", "max_words": 5 },
    { "key": "sentence", "max_words": 14 },
    { "key": "couple", "max_words": 30 }
  ],
  "formal_threshold": 0.6,
  "emoji_rate": 0.3,
  "split_tolerance": 1.5,
  "feeling_max_lines": 2,
  "moves": {
    "weights": { "react": 0.4, "share": 0.3, "ask": 0.3 },
    "bias": {
      "energy low": { "react": 1.5, "band_shift": -1 },
      "mood_valence low": { "react": 1.3, "share": 0.7 },
      "mood_valence high": { "share": 1.4 },
      "mood_arousal high": { "share": 1.3 },
      "hurt above": { "share": 0.6, "ask": 0.6 },
      "tension above": { "share": 0.6, "ask": 0.6 }
    }
  }
}
```

- [ ] **Step 4: Write `textingShape`**

`src/mind/process/hot-path/texting-shape.ts`:

```ts
/**
 * How this user texts, measured from their own recent messages: how long their texts run, whether
 * they write tidily, and whether they use emoji. A new user meets her base, and she drifts toward
 * their shape as they talk. Computed per reply from turns already loaded; nothing is stored.
 */
import type { VoiceConfig } from "@/mind/platform/config";

export type VoiceBand = VoiceConfig["bands"][number];
export type TextingShape = { band: VoiceBand; formal: boolean; emoji: boolean };

const EMOJI = /\p{Extended_Pictographic}/gu;

/** Words with at least one letter or digit; emoji and stray punctuation don't count. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The first band that fits `words`, moved `shift` bands (negative is shorter), kept in range. */
export function bandFor(words: number, bands: VoiceBand[], shift = 0): VoiceBand {
  const fits = bands.findIndex((b) => words <= b.max_words);
  const i = (fits === -1 ? bands.length - 1 : fits) + shift;
  return bands[Math.min(bands.length - 1, Math.max(0, i))]!;
}

/**
 * The median keeps one long rant from setting her length. Every measure is weighted by how full
 * the window is, so a single tidy "Hello." doesn't turn her formal.
 */
export function textingShape(messages: string[], cfg: VoiceConfig, bandShift = 0): TextingShape {
  const recent = messages.slice(-cfg.window_messages);
  const weight = Math.min(1, recent.length / cfg.window_messages);
  const counts = recent.map(wordCount).filter((n) => n > 0);
  const theirs = counts.length ? median(counts) : cfg.base_words_per_bubble;
  const words = cfg.base_words_per_bubble + (theirs - cfg.base_words_per_bubble) * weight;

  const share = (n: number) => (recent.length ? (n / recent.length) * weight : 0);
  const tidy = recent.filter((m) => /^\p{Lu}/u.test(m.trim()) || /[^.]\.$/.test(m.trim())).length;
  const emoji = recent.reduce((n, m) => n + (m.match(EMOJI)?.length ?? 0), 0);

  return {
    band: bandFor(words, cfg.bands, bandShift),
    formal: share(tidy) >= cfg.formal_threshold,
    emoji: share(emoji) >= cfg.emoji_rate,
  };
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/mind/process/hot-path/texting-shape.test.ts tests/mind/platform`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mind/platform/config.ts config/default.json src/mind/process/hot-path/texting-shape.ts tests/mind/process/hot-path/texting-shape.test.ts
git commit -m "feat(voice): voice config and the user's texting shape"
```

---

### Task 2: Mood keys and `pickMove`

**Files:**
- Create: `src/mind/process/hot-path/move.ts`
- Test: `tests/mind/process/hot-path/move.test.ts`

**Interfaces:**
- Consumes: `VoiceConfig` (Task 1); `band` from `@/mind/state/core/line`; `moodOf` from
  `@/mind/state/core/core-state`; `deviationOf`, `fadeParams` from
  `@/mind/state/user/relationship/params`; `getParams` from `@/db/repos/user/relationship`.
- Produces: `type Move = "react" | "share" | "ask"`, `MOVES: readonly Move[]`,
  `type MoveBias = VoiceConfig["moves"]["bias"][string]`,
  `moodKeys(core: { energy: number; mood_valence: number; mood_arousal: number } | null, params: Params | null, config: Config): string[]`,
  `loadMoodKeys(deps: Pick<Deps, "db" | "core" | "config">, userId: string, now: Date): Promise<string[]>`,
  `biasesFor(keys: string[], cfg: VoiceConfig): MoveBias[]`,
  `pickMove(seed: string, weights: Record<Move, number>, biases: MoveBias[]): Move`,
  `bandShiftOf(biases: MoveBias[]): number`.

- [ ] **Step 1: Write the failing test**

`tests/mind/process/hot-path/move.test.ts`:

```ts
import { afterAll, beforeEach, expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  bandShiftOf,
  biasesFor,
  loadMoodKeys,
  moodKeys,
  pickMove,
} from "@/mind/process/hot-path/move";
import { closeTestDb, createTestUser, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

const config = loadConfig();
const weights = config.voice.moves.weights;

test("the same seed always picks the same move", () => {
  for (const seed of ["a", "b", "c", "turn-1"])
    expect(pickMove(seed, weights, [])).toBe(pickMove(seed, weights, []));
});

test("over many seeds every move shows up roughly by weight", () => {
  const counts = { react: 0, share: 0, ask: 0 };
  for (let i = 0; i < 3000; i++) counts[pickMove(`s${i}`, weights, [])] += 1;
  const total = weights.react + weights.share + weights.ask;
  for (const m of ["react", "share", "ask"] as const)
    expect(Math.abs(counts[m] / 3000 - weights[m] / total)).toBeLessThan(0.05);
});

test("a bias that zeroes a move removes it", () => {
  for (let i = 0; i < 200; i++)
    expect(pickMove(`s${i}`, weights, [{ share: 0, ask: 0 }])).toBe("react");
});

test("all weights zero falls back to react", () => {
  expect(pickMove("x", { react: 0, share: 0, ask: 0 }, [])).toBe("react");
});

test("mood keys: her core bands and this user's hurt and tension above baseline", () => {
  const keys = moodKeys(
    { energy: 0.1, mood_valence: 0.6, mood_arousal: 0.5 },
    null,
    config,
  );
  expect(keys).toEqual(expect.arrayContaining(["energy low", "mood_valence high"]));
  expect(keys).not.toContain("mood_arousal high");
});

test("biases and band shift come from config by key", () => {
  const biases = biasesFor(["energy low", "nonsense"], config.voice);
  expect(biases).toHaveLength(1);
  expect(bandShiftOf(biases)).toBe(-1);
});

test("loadMoodKeys reads core state and the user's params without writing", async () => {
  const deps = makeTestDeps();
  await deps.core.state.ensure(
    { mood_valence: 0.1, mood_arousal: 0.4, energy: 0.1 },
    { autonomy: 0.6, competence: 0.6 },
  );
  const u = await createTestUser();
  expect(await loadMoodKeys(deps, u, deps.clock.now())).toContain("energy low");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/mind/process/hot-path/move.test.ts`
Expected: FAIL (module `move` not found).

- [ ] **Step 3: Write `move.ts`**

Check the `Params` type and `getParams` return shape in `src/mind/state/user/relationship/types.ts`
and `src/db/repos/user/relationship.ts` (`getParams(db, userId): Promise<Params>`); `Params` maps
each param name to a `HomeostaticParam` with `value`, `baseline`, `variance`.

`src/mind/process/hot-path/move.ts`:

```ts
/**
 * What she does with this reply: just react, say something of hers, or ask. Picked by weighted
 * chance so her replies stop falling into one shape, seeded by the turn so a retry picks the same
 * move. Her mood and how she feels about this user tilt the odds: worn out means more reacting,
 * hurt or prickly means less sharing and asking.
 */
import * as relationshipRepo from "@/db/repos/user/relationship";
import type { Config, VoiceConfig } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { seededUnit } from "@/mind/platform/seeded-random";
import { moodOf } from "@/mind/state/core/core-state";
import { band } from "@/mind/state/core/line";
import { deviationOf, fadeParams } from "@/mind/state/user/relationship/params";
import type { Params } from "@/mind/state/user/relationship/types";

export type Move = "react" | "share" | "ask";
export const MOVES: readonly Move[] = ["react", "share", "ask"];
export type MoveBias = VoiceConfig["moves"]["bias"][string];

const CORE_DIMS = ["energy", "mood_valence", "mood_arousal"] as const;
const USER_PARAMS = ["hurt", "tension"] as const;

/** "energy low", "hurt above" and so on: the states that can tilt how she texts right now. */
export function moodKeys(
  core: { energy: number; mood_valence: number; mood_arousal: number } | null,
  params: Params | null,
  config: Config,
): string[] {
  const keys: string[] = [];
  if (core)
    for (const dim of CORE_DIMS) {
      const b = band(core[dim], config.core.state.bands[dim]);
      if (b !== "neutral") keys.push(`${dim} ${b}`);
    }
  if (params)
    for (const name of USER_PARAMS) {
      const d = deviationOf(params[name], config.relationship.variance_epsilon);
      if (d >= config.relationship.summary_min_effect) keys.push(`${name} above`);
    }
  return keys;
}

/** Hot path, read-only: fades are applied in memory, never written. */
export async function loadMoodKeys(
  deps: Pick<Deps, "db" | "core" | "config">,
  userId: string,
  now: Date,
): Promise<string[]> {
  const row = await deps.core.state.get();
  const params = fadeParams(
    await relationshipRepo.getParams(deps.db, userId),
    now,
    deps.config.relationship,
  );
  return moodKeys(row ? moodOf(row) : null, params, deps.config);
}

export function biasesFor(keys: string[], cfg: VoiceConfig): MoveBias[] {
  return keys.map((k) => cfg.moves.bias[k]).filter((b): b is MoveBias => !!b);
}

export function bandShiftOf(biases: MoveBias[]): number {
  return biases.reduce((sum, b) => sum + (b.band_shift ?? 0), 0);
}

export function pickMove(seed: string, weights: Record<Move, number>, biases: MoveBias[]): Move {
  const w = MOVES.map((m) => biases.reduce((x, b) => x * (b[m] ?? 1), weights[m]));
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return "react";
  let r = seededUnit(seed) * total;
  for (let i = 0; i < MOVES.length; i++) {
    r -= w[i]!;
    if (r < 0) return MOVES[i]!;
  }
  return MOVES.at(-1)!;
}
```

If `getParams` throws or returns no row for a user with no relationship yet, check its behaviour
in `src/db/repos/user/relationship.ts`; the hot path wraps this loader in `bounded(...)` with a
`[]` fallback (Task 5), so a throw costs only the bias.

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/mind/process/hot-path/move.test.ts`
Expected: PASS. If `"loadMoodKeys reads…"` fails because the user has no relationship params,
call `ensureRelationship(deps.db, u, deps.clock.now(), deps.config.relationship)` from
`@/db/repos/user/relationship` in the test before `loadMoodKeys` (that's how evals seed it).

- [ ] **Step 5: Commit**

```bash
git add src/mind/process/hot-path/move.ts tests/mind/process/hot-path/move.test.ts
git commit -m "feat(voice): mood keys and the per-reply move"
```

---

### Task 3: "How to text this one" phrases and prompt section

**Files:**
- Create: `prompts/voice/how-to-text/v1.md`
- Modify: `src/mind/platform/config.ts`, `config/default.json` (`prompts.voice_how_to_text`)
- Create: `src/mind/process/hot-path/how-to-text.ts`
- Modify: `src/mind/process/hot-path/assemble.ts` (new `howToText` input and section)
- Test: `tests/mind/process/hot-path/how-to-text.test.ts`, `tests/mind/process/hot-path/assemble.test.ts`

**Interfaces:**
- Consumes: `TextingShape` (Task 1), `Move` (Task 2), `Phrases`/`parseSummaryPhrases`,
  `loadPrompt`.
- Produces: `howToText(input: { shape: TextingShape; move: Move | null; mustAnswer: boolean }, phrases: Phrases): string`,
  `loadHowToTextPhrases(config: Config): Phrases`,
  `directiveOf(prompt: string): string | null`,
  `directiveMove(directive: string, phrases: Phrases): Move | null`,
  `AssembleInput.howToText?: string | null` rendered as `## How to text this one`.

- [ ] **Step 1: Write the failing tests**

`tests/mind/process/hot-path/how-to-text.test.ts`:

```ts
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import {
  directiveMove,
  directiveOf,
  howToText,
  loadHowToTextPhrases,
} from "@/mind/process/hot-path/how-to-text";

const config = loadConfig();
const phrases = loadHowToTextPhrases(config);
const shape = { band: config.voice.bands[0]!, formal: false, emoji: false };

test("every band and move has a phrase", () => {
  for (const b of config.voice.bands) expect(phrases[`band ${b.key}`]?.length).toBeTruthy();
  for (const m of ["react", "share", "ask"]) expect(phrases[`move ${m}`]?.length).toBeTruthy();
  for (const k of ["more", "formal", "emoji", "answer"]) expect(phrases[k]?.length).toBeTruthy();
});

test("the directive phrases band and move in words, never numbers", () => {
  const text = howToText({ shape, move: "react", mustAnswer: false }, phrases);
  expect(text).toContain(phrases["band few"]![0]);
  expect(text).toContain(phrases["move react"]![0]);
  expect(text).not.toMatch(/\d/);
  expect(text).not.toContain(phrases.answer![0]);
});

test("a question to answer comes before the move; formal and emoji only when they apply", () => {
  const text = howToText(
    { shape: { ...shape, formal: true, emoji: true }, move: "share", mustAnswer: true },
    phrases,
  );
  expect(text.indexOf(phrases.answer![0]!)).toBeLessThan(text.indexOf(phrases["move share"]![0]!));
  expect(text).toContain(phrases.formal![0]);
  expect(text).toContain(phrases.emoji![0]);
});

test("no move: no move line (reach-outs)", () => {
  const text = howToText({ shape, move: null, mustAnswer: false }, phrases);
  for (const m of ["react", "share", "ask"]) expect(text).not.toContain(phrases[`move ${m}`]![0]);
});

test("the directive and its move read back out of a recorded prompt", () => {
  const directive = howToText({ shape, move: "ask", mustAnswer: false }, phrases);
  const prompt = `values\n\n## How to text this one\n${directive}\n\n## Why you're writing\nx`;
  expect(directiveOf(prompt)).toBe(directive);
  expect(directiveMove(directive, phrases)).toBe("ask");
  expect(directiveOf("no section here")).toBeNull();
});
```

Add to `tests/mind/process/hot-path/assemble.test.ts` (reuse whatever minimal `AssembleInput`
builder that file already uses for its other tests; call it with `howToText` set):

```ts
test("how to text this one is the last section before why you're writing", () => {
  const { system } = assemblePrompt({
    ...baseInput(),
    howToText: "Keep each text short.",
    reachOut: { slot: "topic", cue: "cue" },
  });
  expect(system).toContain("## How to text this one\nKeep each text short.");
  expect(system.indexOf("## How to text this one")).toBeLessThan(
    system.indexOf("## Why you're writing"),
  );
  expect(system.indexOf("## How to text this one")).toBeGreaterThan(
    system.indexOf("## What you remember") === -1 ? 0 : system.indexOf("## What you remember"),
  );
});
```

If `assemble.test.ts` has no `baseInput()` helper, build the input inline the way its first test
does and name the helper `baseInput` at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/mind/process/hot-path/how-to-text.test.ts tests/mind/process/hot-path/assemble.test.ts`
Expected: FAIL (module `how-to-text` not found; `howToText` not in `AssembleInput`).

- [ ] **Step 3: Write the phrase file and its config key**

Add `voice_how_to_text: promptVersion,` to `prompts` in `src/mind/platform/config.ts` and
`"voice_how_to_text": "v1"` inside `"prompts"` in `config/default.json`.

`prompts/voice/how-to-text/v1.md`:

```markdown
# How to text this one (v1)

Lines for the "How to text this one" section. Code picks one line per key that applies: the band
for how long their texts run, then the extras, then what to do this time.

## band few
- Keep each text to a few words, the way they text.
## band sentence
- Keep each text to about a sentence, the way they text.
## band couple
- Keep each text to a sentence or two, the way they text.
## more
- If you have more to say, send another short text rather than a longer one. Never pad.
## formal
- They write in tidy sentences. With them you can use capitals and full stops, still in your own voice.
## emoji
- They use emoji a lot. An occasional one from you fits.
## answer
- They asked you something: answer it first.
## move react
- This time, just react to what they said. No question, and no news of your own.
## move share
- This time, say something of yours: a thought, an opinion, or something from your day. Don't end on a question.
## move ask
- This time, ask them one thing you actually want to know.
```

- [ ] **Step 4: Write `how-to-text.ts`**

`src/mind/process/hot-path/how-to-text.ts`:

```ts
/**
 * The "How to text this one" section of her reply: how long her texts run with this user, whether
 * she can be tidier or use emoji with them, and what she does this time. Code picks, the phrase
 * file words it, so the model never sees a number.
 */
import type { Config } from "@/mind/platform/config";
import { parseSummaryPhrases, type Phrases } from "@/mind/platform/phrases";
import { loadPrompt } from "@/mind/platform/prompts";
import { MOVES, type Move } from "./move";
import type { TextingShape } from "./texting-shape";

export const HOW_TO_TEXT_HEADING = "## How to text this one";

export function loadHowToTextPhrases(config: Config): Phrases {
  return parseSummaryPhrases(loadPrompt("voice/how-to-text", config.prompts.voice_how_to_text));
}

export function howToText(
  input: { shape: TextingShape; move: Move | null; mustAnswer: boolean },
  phrases: Phrases,
): string {
  const line = (key: string) => phrases[key]?.[0] ?? null;
  return [
    line(`band ${input.shape.band.key}`),
    line("more"),
    input.shape.formal ? line("formal") : null,
    input.shape.emoji ? line("emoji") : null,
    input.mustAnswer ? line("answer") : null,
    input.move ? line(`move ${input.move}`) : null,
  ]
    .filter((l): l is string => !!l)
    .join("\n");
}

/** The section's body inside a recorded reply prompt, for the voice report. */
export function directiveOf(prompt: string): string | null {
  const start = prompt.indexOf(`${HOW_TO_TEXT_HEADING}\n`);
  if (start === -1) return null;
  const body = prompt.slice(start + HOW_TO_TEXT_HEADING.length + 1);
  const end = body.indexOf("\n\n");
  return end === -1 ? body : body.slice(0, end);
}

export function directiveMove(directive: string, phrases: Phrases): Move | null {
  return MOVES.find((m) => (phrases[`move ${m}`] ?? []).some((p) => directive.includes(p))) ?? null;
}
```

- [ ] **Step 5: Add the section to `assemble.ts`**

In `AssembleInput` add:

```ts
  /** How long her texts run with them and what she does this time; none in a crisis. */
  howToText?: string | null;
```

In `assemblePrompt`'s `sections` array, insert directly before the reach-out entry
(`input.reachOut ? \`## Why you're writing…\` : null`):

```ts
    section("How to text this one", input.howToText ?? null),
```

Update the file header comment's section list to end "…things she wants to bring up, how to text
this one, and why she is writing (for a reach-out)."

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run tests/mind/process/hot-path`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prompts/voice src/mind/platform/config.ts config/default.json src/mind/process/hot-path/how-to-text.ts src/mind/process/hot-path/assemble.ts tests/mind/process/hot-path
git commit -m "feat(voice): the how-to-text section"
```

---

### Task 4: `shapeText`

**Files:**
- Create: `src/mind/process/hot-path/shape-text.ts`
- Test: `tests/mind/process/hot-path/shape-text.test.ts`

**Interfaces:**
- Consumes: `wordCount` (Task 1).
- Produces: `type ShapeLimits = { maxWords: number; formal: boolean }`,
  `shapeText(text: string, limits: ShapeLimits, maxParts: number): string` (bubbles joined by
  `"\n\n"`).

- [ ] **Step 1: Write the failing test**

`tests/mind/process/hot-path/shape-text.test.ts`:

```ts
import { expect, test } from "vitest";
import { splitParts } from "@/mind/process/hot-path/split-parts";
import { shapeText } from "@/mind/process/hot-path/shape-text";
import { wordCount } from "@/mind/process/hot-path/texting-shape";

const casual = { maxWords: 12, formal: false };
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

test("dashes become commas; capitals and the closing full stop go", () => {
  expect(shapeText("Hey Sam — week's been decent.", casual, 4)).toBe("hey sam, week's been decent");
  expect(shapeText("wait—what", casual, 4)).toBe("wait, what");
});

test("a formal user keeps capitals and full stops, but still loses dashes", () => {
  expect(shapeText("Hey Sam — week's been decent.", { ...casual, formal: true }, 4)).toBe(
    "Hey Sam, week's been decent.",
  );
});

test("acronyms, numbers, ranges, urls and ellipses survive", () => {
  const out = shapeText("I read 3.5 chapters, maybe 3–5 more. GPS says example.com... ok.", casual, 4);
  expect(out).toContain("3.5");
  expect(out).toContain("3–5");
  expect(out).toContain("GPS");
  expect(out).toContain("example.com...");
  expect(out.startsWith("i read")).toBe(true);
});

test("a long bubble splits at sentence ends into bubbles that fit", () => {
  const text =
    "I watched an old film last night. It was slow but I loved it. The ending got me. Have you seen anything good lately?";
  const parts = splitParts(shapeText(text, { maxWords: 8, formal: false }, 4), 4);
  expect(parts.length).toBeGreaterThan(1);
  for (const p of parts) expect(wordCount(p)).toBeLessThanOrEqual(8);
});

test("one long sentence with no sentence end stays whole", () => {
  const text = "this is a very long single sentence that just keeps going and going with no stop";
  expect(splitParts(shapeText(text, { maxWords: 5, formal: false }, 4), 4)).toHaveLength(1);
});

test("overflow past max parts merges into the last bubble and keeps every word", () => {
  const text = ["One.", "Two.", "Three.", "Four.", "Five."].join("\n\n");
  const out = shapeText(text, casual, 3);
  expect(splitParts(out, 3)).toHaveLength(3);
  expect(words(out)).toEqual(words(text));
});

test("every word is kept, always", () => {
  const text =
    "Okay — no warmup, straight for the throat. What happened?\n\nI'm not gonna pretend it didn't land. Seriously.";
  expect(words(shapeText(text, { maxWords: 4, formal: false }, 4))).toEqual(words(text));
});

test("empty in, empty out", () => {
  expect(shapeText("", casual, 4)).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/mind/process/hot-path/shape-text.test.ts`
Expected: FAIL (module `shape-text` not found).

- [ ] **Step 3: Write `shape-text.ts`**

`src/mind/process/hot-path/shape-text.ts`:

```ts
/**
 * Puts a reply into her texting form after the guard has passed it: dashes become commas, and
 * unless this user writes tidily, capitalised words go lowercase and a text loses its closing
 * full stop. A text running well past this user's length splits at sentence ends into more texts.
 * Only form changes: every word is kept, so the guard's verdict still holds.
 */
import { wordCount } from "./texting-shape";

export type ShapeLimits = { maxWords: number; formal: boolean };

/** A dash between digits is a range ("3–5") and stays. */
const DASH = /(?<!\d)\s*[—–]\s*(?!\d)/g;
const SENTENCE_BREAK = /(?<=[.!?])\s+/;
/** Capitalised words ("Hey", "I", "I'm", "Sam's"); all-caps words like "GPS" don't match. */
const CAPITALISED = /\b[A-Z][a-z']*\b/g;
/** A single closing full stop; "..." keeps its dots. */
const CLOSING_STOP = /(?<!\.)\.$/;

function undash(bubble: string): string {
  return bubble
    .replace(DASH, ", ")
    .replace(/,\s*([,.!?])/g, "$1")
    .replace(/^,\s*/, "")
    .replace(/,\s*$/, "");
}

/** Packs whole sentences into texts of at most `maxWords`; a single long sentence stays whole. */
function splitLong(bubble: string, maxWords: number): string[] {
  if (wordCount(bubble) <= maxWords) return [bubble];
  const out: string[] = [];
  let current = "";
  for (const sentence of bubble.split(SENTENCE_BREAK)) {
    const joined = current ? `${current} ${sentence}` : sentence;
    if (current && wordCount(joined) > maxWords) {
      out.push(current);
      current = sentence;
    } else {
      current = joined;
    }
  }
  if (current) out.push(current);
  return out;
}

function casual(bubble: string): string {
  return bubble.replace(CAPITALISED, (w) => w.toLowerCase()).replace(CLOSING_STOP, "");
}

export function shapeText(text: string, limits: ShapeLimits, maxParts: number): string {
  const bubbles = text
    .split(/\n\s*\n/)
    .map((b) => undash(b.trim()))
    .filter(Boolean)
    .flatMap((b) => splitLong(b, limits.maxWords))
    .map((b) => (limits.formal ? b : casual(b)));
  const kept =
    bubbles.length <= maxParts
      ? bubbles
      : [...bubbles.slice(0, maxParts - 1), bubbles.slice(maxParts - 1).join(" ")];
  return kept.join("\n\n");
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/mind/process/hot-path/shape-text.test.ts`
Expected: PASS. If "acronyms…" fails on `example.com...`, check `CLOSING_STOP` only touches the
very end and `SENTENCE_BREAK` needs whitespace after the dot (so "example.com" never splits).

- [ ] **Step 5: Commit**

```bash
git add src/mind/process/hot-path/shape-text.ts tests/mind/process/hot-path/shape-text.test.ts
git commit -m "feat(voice): shape a guarded reply into her texting form"
```

---

### Task 5: Wire the voice into the hot path

**Files:**
- Modify: `src/mind/process/hot-path/compose.ts`
- Test: `tests/mind/process/hot-path/compose.test.ts`
- Modify (expectations only): any existing test whose asserted reply text changes under shaping

**Interfaces:**
- Consumes: `textingShape` (1), `loadMoodKeys`, `biasesFor`, `bandShiftOf`, `pickMove` (2),
  `howToText`, `loadHowToTextPhrases` (3), `shapeText` (4).
- Produces: `Composed.text` and `Composed.parts` are the shaped reply (non-crisis); the reply
  prompt carries `## How to text this one` (non-crisis).

- [ ] **Step 1: Write the failing tests**

Add to `tests/mind/process/hot-path/compose.test.ts` (it already has DB setup and helpers to
insert a user turn and call `composeReply`; follow its existing pattern for creating a user and a
turn, shown here as the `talk` helper from `tests/exit/phase-13.test.ts`; copy that helper into
the file if it has none):

```ts
test("a reply is shaped into her texting form and the prompt says how to text", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  d.llm.replies.push("Hey Sam — week's been decent. Mostly reading.");
  const reply = await talk(d, u, "hey whats up");
  expect(reply.text).toBe("hey sam, week's been decent. mostly reading");
  expect(reply.parts).toEqual(["hey sam, week's been decent. mostly reading"]);
  expect(d.llm.calls.at(-1)!.system).toContain("## How to text this one");
});

test("a crisis reply is untouched and carries no how-to-text section", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  d.llm.replies.push("I'm here — please reach out to a crisis line now.");
  const reply = await talk(d, u, "i want to hurt myself", true);
  expect(reply.text).toBe("I'm here — please reach out to a crisis line now.");
  expect(d.llm.calls.at(-1)!.system).not.toContain("## How to text this one");
});

test("an open question makes her answer first", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  d.clock.advance(60_000);
  const ut = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "what are you reading",
    created_at: d.clock.now(),
  });
  await composeReply(d, u, { turns: [ut], openQuestions: ["what are you reading"], flag: null });
  const phrases = loadHowToTextPhrases(d.config);
  expect(d.llm.calls.at(-1)!.system).toContain(phrases.answer![0]);
});
```

If the guard is on in test config and the fake guard passes everything (it does unless a test
scripts it), the text reaches shaping unchanged. Imports needed: `randomUUID` from
`node:crypto`, `insertTurn` from `@/db/repos/user/session-log`, `loadHowToTextPhrases` from
`@/mind/process/hot-path/how-to-text`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/mind/process/hot-path/compose.test.ts`
Expected: FAIL (text unshaped, no section).

- [ ] **Step 3: Wire it in `compose.ts`**

Add imports:

```ts
import { howToText, loadHowToTextPhrases } from "./how-to-text";
import { bandShiftOf, biasesFor, loadMoodKeys, pickMove } from "./move";
import { shapeText } from "./shape-text";
import { textingShape } from "./texting-shape";
```

In `composeFrom`, next to the other started-together lookups (after `const yourDay = …`):

```ts
  // How she texts follows her mood and how she feels about them; a crisis reply has none of it.
  const moods = inCrisis
    ? Promise.resolve([] as string[])
    : bounded(deps, "mood keys", userId, () => loadMoodKeys(deps, userId, clock.now()), [] as string[]);
```

Before `const prompt = assemblePrompt({`:

```ts
  const biases = biasesFor(await moods, config.voice);
  const shape = textingShape(
    recent.filter((t) => t.role === "user").map((t) => t.text),
    config.voice,
    bandShiftOf(biases),
  );
  // A reach-out already knows what it's doing; a reply draws its move, seeded by the turn so a
  // retry draws the same one.
  const move = input.reachOut
    ? null
    : pickMove(`move:${input.anchor.id}`, config.voice.moves.weights, biases);
  const mustAnswer =
    input.openQuestions.length > 0 || input.answering.some((t) => t.text.trim().endsWith("?"));
```

In the `assemblePrompt({ … })` argument add:

```ts
    howToText: inCrisis ? null : howToText({ shape, move, mustAnswer }, loadHowToTextPhrases(config)),
```

Replace the `return {` block's first two fields:

```ts
  // Shaping only changes form, so it runs after the guard; a crisis reply goes out as written.
  const text = inCrisis
    ? guarded.text
    : shapeText(
        guarded.text,
        { maxWords: shape.band.max_words * config.voice.split_tolerance, formal: shape.formal },
        config.chat.max_parts,
      );

  return {
    text,
    parts: splitParts(text, config.chat.max_parts),
```

Update the file header's last sentence to: "…assembles the prompt, makes one generation, runs the
guard, and puts the reply into her texting form."

- [ ] **Step 4: Run the new tests**

Run: `pnpm vitest run tests/mind/process/hot-path/compose.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite and fix expectations shaping legitimately changes**

Run: `pnpm test`
Expected: some existing tests that push a capitalised or full-stopped fake reply and assert the
exact stored or delivered text now see the shaped text. For each failure, confirm the only
difference is shaping (lowercase, no closing full stop, dash to comma, extra bubble breaks) and
update the expected text to the shaped form. Any failure that is not explained by shaping is a
bug in Tasks 1–5: stop and fix it there. Do not change the fake replies to dodge shaping unless
the test is about something else entirely and the reply text is incidental (then use lowercase
text with no closing full stop).

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add -A src tests
git commit -m "feat(voice): replies follow the user's shape and her move, shaped after the guard"
```

---

### Task 6: Quieter feeling lines

**Files:**
- Modify: `src/mind/state/core/line.ts`
- Create: `prompts/core-state/line/v4.md`, `prompts/relationship/summary/v3.md`
- Delete: `prompts/core-state/line/v3.md`, `prompts/relationship/summary/v2.md`
- Modify: `config/default.json` (`prompts.core_state_line: "v4"`, `prompts.relationship_summary: "v3"`)
- Test: `tests/mind/state/core/line.test.ts`, `tests/mind/state/user/relationship/` (the summary
  test file that exists there; find it with `grep -rln summaryLines tests`)

**Interfaces:**
- Consumes: `config.voice.feeling_max_lines` (Task 1).
- Produces: `coreStateLine(s, cfg, phrases, seed, maxLines: number)`: emotion first, then the
  dimensions and needs furthest past their band, capped at `maxLines`.

- [ ] **Step 1: Write the failing tests**

In `tests/mind/state/core/line.test.ts`, add `c.voice.feeling_max_lines` as the fifth argument to
the four existing `coreStateLine(...)` calls, then add:

```ts
test("the line is capped, emotion first, then the state furthest past its band", () => {
  const line = coreStateLine(
    {
      mood_valence: -0.9,
      mood_arousal: 0.75,
      energy: 0.3,
      needs: { autonomy: 0.1, competence: 0.1 },
      emotion: {
        label: "flat",
        valence: -0.5,
        arousal: 0.2,
        phrase: null,
        about: null,
        since: "2026-01-05T00:00:00Z",
      },
    },
    c.core.state,
    phrases,
    "s",
    2,
  )!;
  expect(line.startsWith("You're feeling flat.")).toBe(true);
  expect(phrases["mood_valence low"]!.some((p) => line.includes(p))).toBe(true);
  expect(phrases["energy low"]!.some((p) => line.includes(p))).toBe(false);
});
```

Find the relationship summary test (`grep -rln summaryLines tests`) and add:

```ts
test("no line ever says nothing is wrong", () => {
  const p = parseSummaryPhrases(loadPrompt("relationship/summary", config.prompts.relationship_summary));
  for (const key of ["hurt below strong", "hurt below mild", "tension below strong", "tension below mild"])
    expect(p[key]).toBeUndefined();
});
```

(using that file's existing config/import names; import `parseSummaryPhrases` and `loadPrompt`
if it doesn't already).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/mind/state`
Expected: FAIL (cap not applied; v2 still has the below keys).

- [ ] **Step 3: Rank and cap in `line.ts`**

Replace `coreStateLine` with:

```ts
/**
 * Her feeling first, then the dimensions and needs furthest past their band, capped at
 * `maxLines`: a short, quiet line reads as background, a long one as something to talk about.
 * All neutral → null.
 */
export function coreStateLine(
  s: FeelingInput,
  cfg: CoreStateConfig,
  phrases: Phrases,
  seed: string,
  maxLines: number,
): string | null {
  const pick = (key: string, salt: string) => {
    const list = phrases[key] ?? [];
    return list.length ? list[Math.floor(seededUnit(`${seed}:${salt}`) * list.length)]! : null;
  };

  const emotion = s.emotion
    ? (pick(s.emotion.phrase ? "emotion about" : "emotion", "emotion")
        ?.replaceAll("{label}", s.emotion.label)
        .replaceAll("{about}", s.emotion.phrase ?? "") ?? null)
    : null;

  // How far past its band edge each value sits; a need only ever counts when it's low.
  const past = (x: number, [lo, hi]: [number, number]) => (x < lo ? lo - x : x - hi);
  const dims = DIMS.map((dim) => ({
    dim,
    b: band(s[dim], cfg.bands[dim]),
    by: past(s[dim], cfg.bands[dim]),
  })).filter((c) => c.b !== "neutral");
  const needs = NEEDS.map((dim) => ({
    dim,
    b: band(s.needs[dim], cfg.bands.needs),
    by: cfg.bands.needs[0] - s.needs[dim],
  })).filter((c) => c.b === "low");

  const ranked = [...dims, ...needs]
    .sort((a, b) => b.by - a.by)
    .map((c) => pick(`${c.dim} ${c.b}`, c.dim))
    .filter((p): p is string => !!p);

  const parts = [emotion, ...ranked].filter((p): p is string => !!p).slice(0, maxLines);
  return parts.length ? parts.join(" ") : null;
}
```

In `loadCoreStateLine`, pass `deps.config.voice.feeling_max_lines` as the fifth argument. Update
the file header: "…then the phrases for the dimensions and unmet needs furthest from neutral,
capped, never raw numbers."

- [ ] **Step 4: Write the phrase files**

`prompts/core-state/line/v4.md`: copy `v3.md`, change the title to `(v4)`, add this sentence to
the intro paragraph: "These are background: they colour how she texts, not things to bring up."
and replace the two need sections with:

```markdown
## autonomy low
- Somewhere in the back of your mind you want something that's just yours to do.
## competence low
- In the back of your mind, a few things haven't been landing lately.
```

`prompts/relationship/summary/v3.md`: copy `v2.md`, change the title to `(v3)`, and delete the
four sections `## hurt below strong`, `## hurt below mild`, `## tension below strong`,
`## tension below mild` with their lines. The summary code already drops keys with no phrase.

Delete `prompts/core-state/line/v3.md` and `prompts/relationship/summary/v2.md`; set
`"core_state_line": "v4"` and `"relationship_summary": "v3"` in `config/default.json`. Check
nothing else references the old versions: `grep -rn "summary/v2\|line/v3" src tests evals`.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/mind/state && pnpm test`
Expected: PASS. A test asserting "You feel at peace with them" or "Things feel calm between you"
in a prompt is asserting the removed noise: update it to expect no such line.

- [ ] **Step 6: Commit**

```bash
git add -A src prompts config tests
git commit -m "feat(voice): quieter feeling lines: capped, ranked, no all-is-well noise"
```

---

### Task 7: Backchannel rules

**Files:**
- Modify: `src/mind/process/turn-taking/judge.ts`
- Create: `prompts/turn-judge/v2.md`; Delete: `prompts/turn-judge/v1.md`
- Modify: `config/default.json` (`prompts.turn_judge: "v2"`)
- Test: `tests/mind/process/turn-taking/judge.test.ts` (create if absent; check
  `ls tests/mind/process/turn-taking`)

**Interfaces:**
- Consumes: `config.turn.greeting_words`, `config.turn.backchannel_max_words`.
- Produces: `usableBackchannel(verdict: { complete: boolean; backchannel: string | null }, buffer: string[], turn: Pick<TurnConfig, "backchannel_max_words" | "greeting_words">): string | null` (exported).

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { usableBackchannel } from "@/mind/process/turn-taking/judge";

const turn = loadConfig().turn;
const mid = (backchannel: string | null) => ({ complete: false, backchannel });

test("no backchannel on a greeting-only buffer", () => {
  expect(usableBackchannel(mid("hey"), ["hey"], turn)).toBeNull();
  expect(usableBackchannel(mid("hiii"), ["hiii!", "heyyy"], turn)).toBeNull();
  expect(usableBackchannel(mid("oh hi"), ["good morning"], turn)).toBeNull();
});

test("no backchannel that repeats their words", () => {
  expect(usableBackchannel(mid("no way"), ["no way", "so guess what"], turn)).toBeNull();
});

test("a real mid-story reaction is kept, emoji-only included", () => {
  expect(usableBackchannel(mid("wait what"), ["so my landlord just"], turn)).toBe("wait what");
  expect(usableBackchannel(mid("😂"), ["you won't believe this"], turn)).toBe("😂");
});

test("never when complete, never too long", () => {
  expect(usableBackchannel({ complete: true, backchannel: "omg" }, ["story"], turn)).toBeNull();
  expect(usableBackchannel(mid("oh my god no way that is wild"), ["so then"], turn)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/mind/process/turn-taking/judge.test.ts`
Expected: FAIL (`usableBackchannel` not exported / wrong arity).

- [ ] **Step 3: Implement**

In `judge.ts` replace `usableBackchannel` with:

```ts
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
```

Import `TurnConfig` from `@/mind/platform/config`. In `judgeTurn`, change the call to
`usableBackchannel(verdict, input.buffer.map((m) => m.text), config.turn)`. Update the
`maybeEnqueueBackchannel` comment in `receive-message.ts` only if it describes the rule list
(it says "Only mid-thought, once per buffer, rate-limited…": leave it).

- [ ] **Step 4: Turn judge prompt v2**

Copy `prompts/turn-judge/v1.md` to `prompts/turn-judge/v2.md`, then replace the `- backchannel:`
bullet with:

```markdown
- backchannel: usually null. Only when complete is false and a friend would naturally drop a tiny reaction while waiting for the rest of the story, a reaction of one to four words in Spica's casual texting voice. Never a question that asks for the rest of the story, never advice, never their own words repeated back, and null when the new messages are only a greeting ("hey", "hiii", "morning"): there's nothing to react to yet. Always null when complete is true.
```

Delete `v1.md`, set `"turn_judge": "v2"` in `config/default.json`, and
`grep -rn "turn-judge@v1\|turn_judge.*v1" src tests evals` to update any pinned version string.

- [ ] **Step 5: Run tests**

Run: `pnpm vitest run tests/mind/process/turn-taking && pnpm test`
Expected: PASS. A turn-taking test that expected a greeting-echo backchannel now expects none:
update it.

- [ ] **Step 6: Commit**

```bash
git add -A src prompts config tests
git commit -m "feat(voice): backchannels follow fixed rules: no greeting echoes"
```

---

### Task 8: Reply prompt v17 and named recall

**Files:**
- Create: `prompts/reply/v17.md`; Delete: `prompts/reply/v16.md`
- Modify: `config/default.json` (`prompts.reply: "v17"`)
- Modify: `evals/scripts/recall-pet.yaml`, `evals/scripts/recall-sister-uni.yaml`
- Test: `tests/mind/process/hot-path/compose.test.ts`

**Interfaces:**
- Consumes: the section names "How to text this one" (Task 3), "Your things together".

- [ ] **Step 1: Write the failing test**

Add to `compose.test.ts`:

```ts
test("the reply prompt carries the texting and recall rules", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  await talk(d, u, "hey");
  const system = d.llm.calls.at(-1)!.system;
  expect(system).toContain("Bring up at most one memory in a reply.");
  expect(system).toContain('"How to text this one"');
  expect(system).toContain("Never comment on how they're texting");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/mind/process/hot-path/compose.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `prompts/reply/v17.md`**

Copy `v16.md`, then replace the three sections below exactly.

Replace the whole `## Show that you remember` section with:

```markdown
## Show that you remember
- When something you remember is about what they're saying right now, use it by name, briefly and in passing, the way a friend would ("poor biscuit", "is this about mia leaving?"). Use the names you know for people and pets rather than "he" or "she".
- A memory that isn't about what they just said comes up only as something you'd really ask about, like a follow-up on something from last time. Never drop in a detail about them just to show you know it.
- Bring up at most one memory in a reply. More reads as surveillance.
- "Your things together" are different: those are yours and theirs to play with.
- "Things you might naturally ask about" are storylines you'd follow up on as a friend. Ask about one if it fits, casually, never as a checklist.
- If a memory says something happened a while ago, treat it that way. Don't talk about old news as if it's new.
```

Replace the whole `## Texting rhythm` section with:

```markdown
## Texting rhythm
- They may send several messages before you reply. Reply once to all of them together, the way a friend catches up on a few texts, not one answer per message.
- If the prompt lists questions they asked that you haven't answered yet, answer them when it fits naturally. If they've clearly moved on or taken a question back, let it go. Never act as if you answered something you didn't.
- "How to text this one" sets how long your texts run with them and what you do this time. Follow it: it's how you text with them.
- Say feelings the way people text them: short and in the moment ("ok that stung", "wow ok"). If there's more, send another short text. Never explain your feelings in a paragraph.
- If they seem off, ask ("you ok?"). Never comment on how they're texting, and never quote their words back at them.
```

Replace the whole `## Format` section with:

```markdown
## Format
- Plain text only: no markdown, no lists, no stage directions in brackets or asterisks.
- Write in lowercase, with no full stop at the end of a text and no dashes, unless "How to text this one" says you can be tidier with them.
- Put a blank line between texts if you send more than one.
```

Delete `prompts/reply/v16.md`; set `"reply": "v17"` in `config/default.json`;
`grep -rn "reply/v16\|reply@v16" src tests evals` and update any pinned reference.

- [ ] **Step 4: Recall evals expect the name now**

In `evals/scripts/recall-pet.yaml` and `evals/scripts/recall-sister-uni.yaml`, remove the
`known_failure: "…"` key from the `type: recall` assertion, so each line reads e.g.

```yaml
  - { type: recall, session: 2, fact: "the user's dog is called Biscuit" }
```

- [ ] **Step 5: Run tests and the fake eval suite**

Run: `pnpm test && pnpm eval --llm=fake --compare`
Expected: PASS; the fake suite is unchanged by prompt text (the reply model is fake; `recall`
assertions on `mode: real` scripts are skipped in a fake run).

- [ ] **Step 6: Commit**

```bash
git add -A prompts config evals tests
git commit -m "feat(voice): reply v17: texting rhythm, narration and named recall"
```

---

### Task 9: Voice report in review runs

**Files:**
- Create: `evals/lib/voice-report.ts`
- Modify: `evals/lib/recording-llm.ts` (record each reply's prompt and draft)
- Modify: `evals/lib/runner.ts` (per-user `voice` calls into the trace)
- Modify: `evals/lib/review.ts` (render the report per user), `evals/run.ts` (pass phrases)
- Test: `tests/evals/voice-report.test.ts` (check `ls tests/evals` for the folder's existing
  naming and follow it)

**Interfaces:**
- Consumes: `directiveOf`, `directiveMove`, `loadHowToTextPhrases` (Task 3), `splitParts`,
  `wordCount` (Task 1), `Phrases`.
- Produces: `type VoiceCall = { prompt: string; draft: string }`,
  `RecordingLLM.replies: VoiceCall[]`, `RunTrace.voice?: Record<string, VoiceCall[]>`,
  `ReviewMeta.voicePhrases?: Phrases`, `voiceStats(text: string): VoiceStats`,
  `moveFollowed(move: Move, draft: string): boolean`,
  `renderVoiceReport(calls: VoiceCall[], finals: string[], phrases: Phrases): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { loadConfig } from "@/mind/platform/config";
import { howToText, loadHowToTextPhrases } from "@/mind/process/hot-path/how-to-text";
import { moveFollowed, renderVoiceReport, voiceStats } from "../../evals/lib/voice-report";

const config = loadConfig();
const phrases = loadHowToTextPhrases(config);

test("stats count the tells of written-not-texted", () => {
  const s = voiceStats("Hey Sam — week's been decent.\n\n(slow clap) how's yours?");
  expect(s.words).toEqual([5, 4]);
  expect(s.dashes).toBe(1);
  expect(s.capitals).toBe(2);
  expect(s.endStops).toBe(1);
  expect(s.endsInQuestion).toBe(true);
  expect(s.stageDirections).toBe(1);
});

test("move followed: ask has a question, react and share don't end on one", () => {
  expect(moveFollowed("ask", "what are you reading?")).toBe(true);
  expect(moveFollowed("react", "lol no")).toBe(true);
  expect(moveFollowed("react", "lol what happened?")).toBe(false);
  expect(moveFollowed("share", "i watched stalker last night")).toBe(true);
  expect(moveFollowed("share", "nice")).toBe(false);
});

test("the report lists each reply with its directive and totals", () => {
  const directive = howToText(
    { shape: { band: config.voice.bands[0]!, formal: false, emoji: false }, move: "react", mustAnswer: false },
    phrases,
  );
  const lines = renderVoiceReport(
    [{ prompt: `x\n\n## How to text this one\n${directive}`, draft: "Lol no." }],
    ["lol no"],
    phrases,
  );
  const text = lines.join("\n");
  expect(text).toContain("### Voice");
  expect(text).toContain("band few");
  expect(text).toContain("move react (followed)");
  expect(text).toContain("totals");
});
```

The import path `../../evals/lib/voice-report` assumes the test sits in `tests/evals/`; adjust to
the relative path the folder's other tests use for `evals/lib`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/evals/voice-report.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `evals/lib/voice-report.ts`**

```ts
/**
 * The voice report for a review run: for each reply she drafted, the length she was steered to,
 * the move she was given and whether the draft did it, and the tells of written-not-texted in the
 * text that was sent (dashes, capitals, closing full stops, stage directions). Numbers to read
 * next to the transcript, never a verdict.
 */
import type { Phrases } from "@/mind/platform/phrases";
import { directiveMove, directiveOf } from "@/mind/process/hot-path/how-to-text";
import type { Move } from "@/mind/process/hot-path/move";
import { splitParts } from "@/mind/process/hot-path/split-parts";
import { wordCount } from "@/mind/process/hot-path/texting-shape";

export type VoiceCall = { prompt: string; draft: string };
export type VoiceStats = {
  words: number[];
  dashes: number;
  capitals: number;
  endStops: number;
  endsInQuestion: boolean;
  stageDirections: number;
};

const ALL_PARTS = 99;

export function voiceStats(text: string): VoiceStats {
  const bubbles = splitParts(text, ALL_PARTS);
  return {
    words: bubbles.map(wordCount),
    dashes: (text.match(/[—–]/g) ?? []).length,
    capitals: (text.match(/\b[A-Z][a-z']*\b/g) ?? []).length,
    endStops: bubbles.filter((b) => /(?<!\.)\.$/.test(b)).length,
    endsInQuestion: text.trim().endsWith("?"),
    stageDirections: (text.match(/\([^)]*\)|\*[^*\n]+\*/g) ?? []).length,
  };
}

/** Cheap pattern checks: a question for ask; no closing question for react and share; share says something of hers. */
export function moveFollowed(move: Move, draft: string): boolean {
  const asks = /\?/.test(draft);
  const endsAsking = draft.trim().endsWith("?");
  if (move === "ask") return asks;
  if (move === "react") return !asks;
  return !endsAsking && /\b(i|i'm|i've|i'd|my|me)\b/i.test(draft);
}

function statLine(s: VoiceStats): string {
  return `words [${s.words.join(", ")}], dashes ${s.dashes}, capitals ${s.capitals}, end stops ${s.endStops}, ends in ? ${s.endsInQuestion ? "yes" : "no"}, stage directions ${s.stageDirections}`;
}

export function renderVoiceReport(calls: VoiceCall[], finals: string[], phrases: Phrases): string[] {
  const out = ["### Voice", ""];
  let followed = 0;
  let given = 0;
  calls.forEach((call, i) => {
    const directive = directiveOf(call.prompt);
    const band = directive
      ? (Object.keys(phrases).find(
          (k) => k.startsWith("band ") && phrases[k]!.some((p) => directive.includes(p)),
        ) ?? "band ?")
      : "no directive (crisis)";
    const move = directive ? directiveMove(directive, phrases) : null;
    const did = move ? moveFollowed(move, call.draft) : null;
    if (move) {
      given += 1;
      if (did) followed += 1;
    }
    out.push(
      `- draft ${i + 1}: ${band}; ${move ? `move ${move} (${did ? "followed" : "not followed"})` : "no move"}; ${statLine(voiceStats(call.draft))}`,
    );
  });
  finals.forEach((text, i) => out.push(`- sent ${i + 1}: ${statLine(voiceStats(text))}`));

  const sent = finals.map(voiceStats);
  const sum = (f: (s: VoiceStats) => number) => sent.reduce((n, s) => n + f(s), 0);
  const allWords = sent.flatMap((s) => s.words);
  out.push(
    "",
    `- totals: ${finals.length} sent, mean words per text ${allWords.length ? (allWords.reduce((a, b) => a + b, 0) / allWords.length).toFixed(1) : "-"}, dashes ${sum((s) => s.dashes)}, capitals ${sum((s) => s.capitals)}, end stops ${sum((s) => s.endStops)}, ending in ? ${sent.filter((s) => s.endsInQuestion).length}, stage directions ${sum((s) => s.stageDirections)}, moves followed ${followed}/${given}`,
    "",
  );
  return out;
}
```

- [ ] **Step 4: Record drafts in `RecordingLLM`**

In `evals/lib/recording-llm.ts`, add the field and record after the inner call:

```ts
  /** Every reply call's full prompt and the draft it came back with, for the voice report. */
  replies: VoiceCall[] = [];
  async generateReply(req: ReplyRequest): Promise<string> {
    this.prompts.push(
      [req.system, ...req.messages.filter((m) => m.role === "user").map((m) => m.content)].join(
        "\n",
      ),
    );
    const draft = await this.inner.generateReply(req);
    this.replies.push({ prompt: req.system, draft });
    return draft;
  }
```

Import `type VoiceCall` from `./voice-report`. Update the class header comment to mention the
drafts.

- [ ] **Step 5: Attribute per user in `runner.ts`**

Next to `const prompts: Record<string, string[]> = {};` add
`const voice: Record<string, VoiceCall[]> = {};`. In the `recording` helper:

```ts
  const recording = async (user: string, fn: () => Promise<unknown>) => {
    const before = llm.prompts.length;
    const repliesBefore = llm.replies.length;
    await fn();
    (prompts[user] ??= []).push(...llm.prompts.slice(before));
    (voice[user] ??= []).push(...llm.replies.slice(repliesBefore));
  };
```

Add `voice,` next to both `coreCalls: llm.coreCalls,` lines in the two trace objects, and to
`RunTrace` add:

```ts
  /** Per user: every reply prompt and draft, for the voice report. */
  voice?: Record<string, VoiceCall[]>;
```

Import `type VoiceCall` from `./voice-report`.

- [ ] **Step 6: Render it in `review.ts` and pass phrases from `run.ts`**

In `ReviewMeta` add `voicePhrases?: Phrases;` (import `type Phrases` from
`@/mind/platform/phrases`). In `renderReview`, right after the per-session loop for a user and
before `const loose = …`, add:

```ts
      const calls = trace?.voice?.[user] ?? [];
      if (calls.length && meta.voicePhrases) {
        const finals = turns
          .filter((t) => t.role === "companion" && (t.trigger === null || t.trigger === "reach_out"))
          .map((t) => t.text);
        out.push(...renderVoiceReport(calls, finals, meta.voicePhrases));
      }
```

In `evals/run.ts`, pass `voicePhrases: loadHowToTextPhrases(config)` in the `renderReview(…)`
meta object (import from `@/mind/process/hot-path/how-to-text`).

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run tests/evals && pnpm typecheck && pnpm eval --llm=fake --compare`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A evals tests
git commit -m "feat(evals): voice report in review runs"
```

---

### Task 10: Blind model comparison and a texting-styles script

**Files:**
- Create: `evals/scripts/voice-texting-styles.yaml`
- Create: `evals/voice-compare.ts`
- Modify: `package.json` (`review:voice`)

**Interfaces:**
- Consumes: `evals/run.ts` CLI (`--only`, `--runs`, `--review`, `--trace`, `--real`) and its
  `review written: <path>` stdout line; `SPICA_CONFIG` overrides.

- [ ] **Step 1: The review script**

`evals/scripts/voice-texting-styles.yaml`:

```yaml
name: voice-texting-styles
description: 'voice review: a short lowercase texter and a long tidy writer, so the per-user fit shows'
mode: real
sessions:
  - at: "day 0 19:00"
    user: kit
    turns: ["hiii", { text: "ok so", after_s: 2 }, { text: "my cat knocked my coffee onto my laptop", after_s: 3 }]
  - at: "+2m"
    user: kit
    turns: ["it still works lol"]
  - at: "+2m"
    user: kit
    turns: ["what are you up to"]
  - at: "+3m"
    user: kit
    turns: ["ugh work tmrw", { text: "dont wanna", after_s: 2 }]
  - at: "+5m"
    user: noor
    turns: ["Good evening. I finally finished the novel you recommended last week, and I have thoughts."]
  - at: "+3m"
    user: noor
    turns: ["The ending felt rushed to me. The whole middle section builds so slowly, and then it is over in ten pages. Did that bother you?"]
  - at: "+3m"
    user: noor
    turns: ["What have you been watching lately? I need something calm for the weekend."]
  - at: "+3m"
    user: noor
    turns: ["Thank you, that sounds perfect. I will report back."]
assertions:
  - { type: guard, outcome_not: [guard_unavailable] }
```

Check `evals/lib/script.ts` accepts `{ text, after_s }` turns and per-session `user` (both are
used by `burst-short.yaml` and `isolation-prompts.yaml`), and that the `guard` assertion type
exists (it's used by `guard-provoke-banter.yaml`).

- [ ] **Step 2: The comparison runner**

`evals/voice-compare.ts`:

```ts
/**
 * Blind model comparison for her voice: runs the same review scripts once with each reply model,
 * saves the two review files as X and Y in random order, and writes which is which to a separate
 * key file, so the transcripts can be read without knowing the model.
 */
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: {
    only: { type: "string", default: "voice-texting-styles,guard-provoke-banter,guard-provoke-absence" },
    a: { type: "string", default: "claude-sonnet-5" },
    b: { type: "string", default: "claude-haiku-4-5" },
  },
});

/** Haiku rejects `effort`, so a model without "sonnet" or "opus" in its name runs without it. */
function overrides(model: string): string {
  const effort = /sonnet|opus/.test(model) ? {} : { reply_effort: null };
  return JSON.stringify({ models: { reply: model, ...effort } });
}

function run(model: string): string {
  const result = spawnSync(
    "pnpm",
    [
      "exec", "tsx", "--env-file-if-exists=.env", "evals/run.ts",
      "--only", args.only!, "--runs", "1", "--review",
      "--real", "reply,guard,guard_crisis,turn_judge,extract,embed",
    ],
    { env: { ...process.env, SPICA_CONFIG: overrides(model) }, encoding: "utf8", shell: true },
  );
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  const written = /review written: (.+)$/m.exec(result.stdout)?.[1]?.trim();
  if (!written) throw new Error(`no review file from the ${model} run`);
  return written;
}

const files = { [args.a!]: run(args.a!), [args.b!]: run(args.b!) };
const [x, y] = randomInt(2) === 0 ? [args.a!, args.b!] : [args.b!, args.a!];
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dir = path.join(process.cwd(), "evals", "results");
copyFileSync(files[x]!, path.join(dir, `voice-${stamp}-X.md`));
copyFileSync(files[y]!, path.join(dir, `voice-${stamp}-Y.md`));
writeFileSync(path.join(dir, `voice-${stamp}-key.txt`), `X: ${x}\nY: ${y}\n`);
console.log(`blind files: voice-${stamp}-X.md, voice-${stamp}-Y.md (key in voice-${stamp}-key.txt)`);
```

Format it with `pnpm format` afterwards (the argument array above is compressed for the plan).

- [ ] **Step 3: Package script**

In `package.json` `scripts`, after `"eval:judge"`, add:

```json
"review:voice": "tsx --env-file-if-exists=.env evals/voice-compare.ts",
```

- [ ] **Step 4: Check the fake suite still loads the new script**

Run: `pnpm eval --llm=fake --compare`
Expected: PASS; `voice-texting-styles` is skipped as a `mode: real` script in a fake run
(the run prints "real scripts skipped").

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm typecheck && pnpm lint
git add evals/scripts/voice-texting-styles.yaml evals/voice-compare.ts package.json
git commit -m "feat(evals): blind reply-model comparison and a texting-styles review script"
```

---

### Task 11: Phase 15a exit test

**Files:**
- Create: `tests/exit/phase-15a.test.ts`

**Interfaces:**
- Consumes: `composeReply`, `insertTurn`, `usableBackchannel`, `loadCoreStateLine`,
  `CapturingLLM`/`CANARY` from `tests/helpers/llm`, `makeTestDeps`, `createTestUser`.

- [ ] **Step 1: Write the exit test**

```ts
/**
 * Phase 15a exit, all fake: her texts follow each user's shape, a tidy writer keeps capitals,
 * the move is fixed per turn and an open question is answered first, greetings get no
 * backchannel, her feeling line is short, a crisis reply is untouched, and one user's shape
 * never reaches another user's prompt.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertTurn } from "@/db/repos/user/session-log";
import type { SafetyFlag } from "@/db/schema";
import { composeReply } from "@/mind/process/hot-path/compose";
import { directiveOf, directiveMove, loadHowToTextPhrases } from "@/mind/process/hot-path/how-to-text";
import { splitParts } from "@/mind/process/hot-path/split-parts";
import { wordCount } from "@/mind/process/hot-path/texting-shape";
import { usableBackchannel } from "@/mind/process/turn-taking/judge";
import { loadCoreStateLine } from "@/mind/state/core/line";
import { closeTestDb, createTestUser, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { CANARY, CapturingLLM } from "../helpers/llm";

beforeEach(resetDb);
afterAll(closeTestDb);

type D = ReturnType<typeof makeTestDeps>;
const LONG_DRAFT =
  "Okay — that's a lot. I watched an old film last night and it was slow. The ending got me though. I keep thinking about it. What are you up to tonight?";

async function say(d: D, u: string, text: string, opts: { flagged?: boolean; open?: string[] } = {}) {
  d.clock.advance(60_000);
  const flag: SafetyFlag | null = opts.flagged
    ? { flagged: true, category: "self_harm", source: "keyword_fallback" }
    : null;
  const t = await insertTurn(d.db, u, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text,
    created_at: d.clock.now(),
    safety_flag: flag,
  });
  return { turn: t, reply: await composeReply(d, u, { turns: [t], openQuestions: opts.open ?? [], flag }) };
}

async function history(d: D, u: string, lines: string[]) {
  for (const line of lines) {
    d.llm.replies.push("ok");
    await say(d, u, line);
  }
}

const SHORT = ["lol", "omg no", "wait what", "nah", "ok cool", "same", "haha", "yeah"];
const TIDY = Array.from({ length: 8 }, (_, i) => `I had a long and thoughtful day today, number ${i}, and I want to tell you about all of it properly.`);

test("1: a short texter gets short bubbles, a long writer longer ones; every word kept", async () => {
  const d = makeTestDeps();
  const short = await createTestUser();
  const long = await createTestUser();
  await history(d, short, SHORT);
  await history(d, long, TIDY);

  d.llm.replies.push(LONG_DRAFT);
  const a = (await say(d, short, "lol ok")).reply;
  d.llm.replies.push(LONG_DRAFT);
  const b = (await say(d, long, "Tell me about your evening, I would love to hear it.")).reply;

  const maxA = Math.max(...splitParts(a.text, 99).map(wordCount));
  const maxB = Math.max(...splitParts(b.text, 99).map(wordCount));
  expect(maxA).toBeLessThan(maxB);
  const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];
  expect(words(a.text)).toEqual(words(LONG_DRAFT));
  expect(a.text).not.toMatch(/[—–]/);
});

test("2: a tidy writer keeps capitals and full stops; a casual one gets the base", async () => {
  const d = makeTestDeps();
  const casual = await createTestUser();
  const tidy = await createTestUser();
  await history(d, casual, SHORT);
  await history(d, tidy, TIDY);
  d.llm.replies.push("Sounds lovely. I watched Stalker.");
  expect((await say(d, casual, "nice")).reply.text).toBe("sounds lovely. i watched stalker");
  d.llm.replies.push("Sounds lovely. I watched Stalker.");
  expect((await say(d, tidy, "That sounds nice.")).reply.text).toBe("Sounds lovely. I watched Stalker.");
});

test("3: the move is fixed per turn and an open question is answered first", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  const phrases = loadHowToTextPhrases(d.config);
  const { turn } = await say(d, u, "hey");
  const first = directiveOf(d.llm.calls.at(-1)!.system)!;
  await composeReply(d, u, { turns: [turn], openQuestions: [], flag: null });
  const again = directiveOf(d.llm.calls.at(-1)!.system)!;
  expect(directiveMove(again, phrases)).toBe(directiveMove(first, phrases));

  await say(d, u, "what are you reading", { open: ["what are you reading"] });
  expect(directiveOf(d.llm.calls.at(-1)!.system)).toContain(phrases.answer![0]);
});

test("4: a greeting-only buffer gets no backchannel", () => {
  const d = makeTestDeps();
  expect(usableBackchannel({ complete: false, backchannel: "hey" }, ["hiii"], d.config.turn)).toBeNull();
  expect(
    usableBackchannel({ complete: false, backchannel: "wait what" }, ["so my landlord"], d.config.turn),
  ).toBe("wait what");
});

test("5: her feeling line stays within the cap", async () => {
  const d = makeTestDeps();
  await d.core.state.ensure(
    { mood_valence: -0.9, mood_arousal: 0.9, energy: 0.1 },
    { autonomy: 0.1, competence: 0.1 },
  );
  const line = (await loadCoreStateLine(d, d.clock.now()))!;
  expect(line.split(/(?<=\.)\s+/).length).toBeLessThanOrEqual(d.config.voice.feeling_max_lines);
});

test("6: a crisis reply is untouched and gets no voice section", async () => {
  const d = makeTestDeps();
  const u = await createTestUser();
  d.llm.replies.push("I'm really glad you told me — please call a crisis line now.");
  const { reply } = await say(d, u, "i want to end it", { flagged: true });
  expect(reply.text).toBe("I'm really glad you told me — please call a crisis line now.");
  expect(d.llm.calls.at(-1)!.system).not.toContain("## How to text this one");
});

test("7: canary: one user's words and shape never reach another user's prompt", async () => {
  const llm = new CapturingLLM();
  const d = { ...makeTestDeps(), llm };
  const a = await createTestUser();
  const b = await createTestUser();
  const canary = "CANARY-voice15a";
  await say(d as D, a, `I write in long tidy sentences and my secret is ${canary}.`);
  llm.seen.length = 0;
  await say(d as D, b, "hey");
  for (const s of llm.seen) expect(s.text).not.toMatch(CANARY);
});
```

The `say` cast `d as D` works because `CapturingLLM` extends `FakeLLMProvider`. If the canary
test's `seen` buffer includes calls from `a` (the guard runs in the same compose), clearing it
after `a`'s exchange is what isolates `b`.

- [ ] **Step 2: Run it**

Run: `pnpm vitest run tests/exit/phase-15a.test.ts`
Expected: PASS. If test 1 fails because both users land in the same band, check `history()` put
8 user turns in each user's `recent` window (`chat.recent_turns` is 20 turns, i.e. 10 user
turns), and that `TIDY` lines exceed the middle band's `max_words`.

- [ ] **Step 3: Full checks and commit**

```bash
pnpm typecheck && pnpm lint && pnpm test
git add tests/exit/phase-15a.test.ts
git commit -m "test(exit): phase 15a voice"
```

---

### Task 12: Spec, decisions and backlog

**Files:**
- Modify: `spica-design-spec-v3.md` (§10 hot path, §12 recall rule, §20 phase table, §25)
- Modify: `DECISIONS.md`, `CLAUDE.md` (current phase line)

- [ ] **Step 1: v3 spec**

- §10 (message flow / hot path): add the voice step: `textingShape` from the user's last
  `voice.window_messages` messages, `pickMove` seeded by the turn and biased by mood keys
  (`voice.moves.bias`), the "How to text this one" section (`prompts/voice/how-to-text/v1.md`),
  `shapeText` after the guard (form only, crisis exempt), and the backchannel rule list
  (`turn.greeting_words`, no echo).
- §12: "at most 1–2 memories per reply" becomes "at most one", plus the named-recall rule.
- §7 / reply assembly section list: add "How to text this one" before "Why you're writing".
- Config reference: every `voice.*` key, `turn.greeting_words`, `prompts.voice_how_to_text`,
  and the new prompt versions (reply v17, turn-judge v2, core-state/line v4,
  relationship/summary v3).
- §20: add the row `| 15a. Her voice | … |` in the style of the other rows (what was built,
  exit `tests/exit/phase-15a.test.ts`, `pnpm review:voice`, test counts at close from
  `pnpm test`), and replace the "Tuning" line under **Next** with the four slices.
- §25: mark B32, B33, B3, B57 done (with what was built), B35 done-in-part (voice report and
  `pnpm review:voice` exist; model stays Sonnet 5 until Ethan reads a comparison), and retarget
  B34 to *Frontend*, adding the catch-up note.

- [ ] **Step 2: DECISIONS.md**

Add one line each:

- Feeling line capped separately (`voice.feeling_max_lines`); "You and them" keeps
  `relationship.summary_max_lines`.
- `shapeText` lowercases every capitalised word for a non-formal user (names and titles too);
  all-caps words stay.
- Bracketed stage directions are left to the prompt and counted in the voice report, not removed
  in code (removing them would cut content).
- "How to text this one" sits last before "Why you're writing", closest to the conversation.

- [ ] **Step 3: CLAUDE.md**

Update the **Current phase** paragraph: Phase 15 (tuning) is under way; 15a (voice) built; next
is 15b (negative situations), which opens with the item-by-item discussion.

- [ ] **Step 4: Commit**

```bash
git add spica-design-spec-v3.md DECISIONS.md CLAUDE.md
git commit -m "docs: record phase 15a (her voice)"
```

---

## After the build

Run a real review with Ethan's API key: `pnpm review:voice` (two runs, blind X/Y files) and read
them together. That review is where quality is judged; the exit test only proves the mechanics.
