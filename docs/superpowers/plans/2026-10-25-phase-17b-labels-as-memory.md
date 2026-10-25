# Phase 17b: Labels as Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The cold path labels each exchange with the three-call labelling pipeline (labels v1),
stores the labels in an `annotation` table and writes memories as code-built lines (label,
status, date tokens, quoted words). Readers show those lines unchanged, older messages get
glosses from time labels, and extract v11 with its anchoring is deleted.

**Architecture:**
- **Labelling** (`memory/user/label.ts`) runs a reading call, a propositions call and a signals
  call, all with thinking. Each sees the earlier calls' checked labels. A value outside its list
  drops only its own label.
- **Encoding** (`memory/user/encode.ts`) writes, in order: entities from mentions, threads by
  id, one fact per proposition (content from `memoryLine`, reconciled through `updates` or the
  existing reconcile call), idiolect, her hurt, then every label as an `annotation` row.
- **Readers** keep reading `fact.content`. Its dates are tokens that `withTimeRendering` renders
  with their distance.

**Tech Stack:** TypeScript, Zod 4, Drizzle + Postgres 16, Vitest, Anthropic SDK 0.127.0, pnpm.

**Spec:** `docs/2026-10-25-phase-17b-labels-as-memory-design.md` (and the phase doc
`docs/2026-10-25-phase-17-labelled-memory-design.md`). Read both before starting.

## Global Constraints

- Branch `phase-17b` from `main` (`git switch -c phase-17b`); commit after every task.
- Every file starts with a short plain-English header. Comments say why, never cite spec
  sections, phases or backlog numbers. Prettier at 100 columns.
- Every numeric constant goes in `config/default.json` and the schema in
  `src/mind/platform/config.ts`.
- Every prompt is a versioned file. Changing one means a new file plus the config bump.
  Versions nothing configures are deleted.
- Replace from the ground up: what this slice replaces goes in the same slice, with no shims:
  v11, `extract.ts`, `when_direction`, `models.extract*`, `extraction.max_candidates`,
  `prompts/extract/`, the `said` glossing in `time-anchors.ts`, and the tests of deleted code.
- `src/mind` is framework-free: no `Date.now()`, no `process.env`.
- `src/db/repos/user/*` functions take `userId` first, and every query is scoped by it.
- No prompt is retried. A labelling call that throws fails the cold path, which logs it and
  counts it (`extract_attempts`), as now.
- **Paid runs need Ethan's go-ahead** and go through the `review-run` skill (Task 4, Task 11).
  A hook asks before any command that calls a real model.
- One test process at a time (shared test DB). Run targeted tests while working
  (`pnpm test <path>`). The full suite runs only in Task 10 and the close, in foreground parts
  (`pnpm test tests/mind --maxWorkers=4`, then `tests/db`, `tests/exit`, `tests/evals`).
- Never write strings with backslashes through shell heredocs. Use the Edit/Write tools.
- Her speech stays free: nothing here templates or post-processes what she says.

## Review Focus

1. **A conversation longer than the window.** Earlier labels whose words have left the window
   must not break the call ("already labelled" leaves them out) or crash on piece lookups.
   Pinned in Task 5 (`fromRows` skips labels outside the shown pieces).
2. **A reach-out on its own (no user turn), and a crisis exchange.** No relationship, intimacy,
   bid or tone, and no hurt fact. Labels and memories of her words are still stored. Pinned in
   Task 8 (cold-path tests keep the existing reach-out and crisis cases, rewritten to labels).
3. **A labelling call that throws mid-way** (the second or third call). Nothing is written, the
   turns stay unextracted and the failure is counted. Pinned in Task 8 (atomic test with a
   throwing `labels_meaning`).
4. **A hurt with no hurt moves cited.** The hurt fact still gets words: the user's new moves.
   Pinned in Task 6 (`hurtCause`) and Task 8.
5. **Quotes with curly quotes, pipes or `⟧` in the user's words.** The line must not break the
   token grammar. Pinned in Task 6 (`memoryLine` strips `⟦⟧|` from quoted words).

---

### Task 1: B135 hand pass (free, no code)

**Files:**
- Modify: `evals/results/analysis-2026-10-25-phase-17a.md` (append a section)

**Interfaces:** Produces the list of prompt changes Task 3 writes into `prompts/labels/v1.md`.

- [ ] **Step 1: Read the rerun review by conversation.** Read
  `evals/results/review-extract-labels-2026-10-24T19-57-11-880Z.md` in ranges: `grep -n '^### '`
  first, then about 80 lines at a time. Each conversation lists "v11 (as logged)" and then each
  call's labels and drops.
- [ ] **Step 2: Sort every v11 user, self or shared fact with no v12 proposition** into one of:
  - (a) v11 split finer, and a v12 proposition covers it;
  - (b) v12 wrote no proposition for something said as true (prompt gap);
  - (c) v12 wrote one and a check dropped it: name the drop reason (`bad_ref` from an invented
    move is B133);
  - (d) v11 was wrong (from her words, from context, or an invented date).

  Keep a tally and one quoted example per kind of (b).
- [ ] **Step 3: Append the section** to the analysis file:

```markdown
---

# B135 hand pass (2026-10-25)

v11's 148 facts against the rerun's 57 memories, conversation by conversation.

| Kind | Count | Example |
|---|---|---|
| v11 split finer, covered by v12 | n | … |
| v12 wrote nothing for something said as true | n | "i have a job interview on thursday afternoon" (16b close, first conversation): no proposition |
| v12 wrote one, a check dropped it | n | reasons: bad_ref n (invented moves, B133), … |
| v11 was wrong | n | … |

**Prompt changes for labels v1** (one line each; each becomes a rule or an example in v1):
- …
```

- [ ] **Step 4: Commit**

```bash
git switch -c phase-17b
git add evals/results/analysis-2026-10-25-phase-17a.md
git commit -m "docs(evals): B135 hand pass: what labelled memory misses against v11"
```

---

### Task 2: Labels survive a bad value and hold times to their moves

B136: the model may write a value outside an enum, and today that fails the whole call. B134:
a memory may take a time from words it doesn't rest on. This task also splits the meaning
schema in two, so the propositions call and the signals call each fit the grammar limit with
thinking on.

**Files:**
- Modify: `src/mind/memory/user/annotations.ts`
- Test: `tests/mind/memory/user/annotations.test.ts`

**Interfaces:**
- Produces:
  - `loosen(schema: z.ZodType): z.ZodType`: the schema sent to the model, with every enum a
    described string.
  - `sieve<S extends z.ZodObject>(raw: unknown, strict: S): { labels: z.infer<S>; drops: Drop[] }`:
    keeps each label of each layer that fits `strict`, drops the rest with `bad_value`.
  - `PropositionsSchema` (propositions, threads) and `SignalsSchema` (idiolect, relationship,
    intimacy, bid_response).
  - `DropReason` gains `"bad_value"`.

- [ ] **Step 1: Write the failing tests** (append to `annotations.test.ts`; also import
  `loosen`, `sieve`, `ReadingSchema`, `PropositionsSchema`, `SignalsSchema`)

```ts
test("a memory's time must sit in the moves it rests on: one from elsewhere loses only the link", () => {
  const labels = base();
  // The train ticket rests on "and yes booked" and her question, never on "friday now lol".
  labels.propositions[1] = { ...labels.propositions[1]!, times: ["t1"] };
  const out = checkLabels(labels, ctx);
  expect(out.propositions.find((p) => p.id === "p2")?.times).toEqual([]);
  expect(out.drops).toContainEqual({
    layer: "proposition",
    id: "p2",
    reason: "bad_link",
    ref: "times t1",
  });
});

test("a value outside its list drops only that label; the rest of the call stays", () => {
  const raw = { ...base(), moves: [{ ...base().moves[0]!, act: "shrugs" }, base().moves[1]!] };
  const { labels, drops } = sieve(raw, ReadingSchema);
  expect(ids(labels.moves)).toEqual(["m4"]);
  expect(labels.times).toHaveLength(1);
  expect(drops).toEqual([{ layer: "moves", id: "m3", reason: "bad_value", ref: "act" }]);
});

test("a bad value in a block drops the block, not the call", () => {
  const raw = { ...base(), bid_response: { response: "sideways", move: "m4" } };
  const { labels, drops } = sieve(raw, SignalsSchema);
  expect(labels.bid_response).toBeNull();
  expect(labels.intimacy).not.toBeNull();
  expect(drops).toEqual([
    { layer: "bid_response", id: "bid_response", reason: "bad_value", ref: "response" },
  ]);
});

test("each call's loose schema converts and stays within the nullable limit", () => {
  const unions = (node: unknown): number => {
    if (!node || typeof node !== "object") return 0;
    const own = "anyOf" in node || Array.isArray((node as { type?: unknown }).type) ? 1 : 0;
    return own + Object.values(node).reduce((n: number, child) => n + unions(child), 0);
  };
  for (const schema of [ReadingSchema, PropositionsSchema, SignalsSchema]) {
    const format = zodOutputFormat(loosen(schema) as never);
    expect(unions(format.schema)).toBeLessThanOrEqual(16);
    // The enum is still described to the model.
    expect(JSON.stringify(format.schema)).toContain("one of:");
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test tests/mind/memory/user/annotations.test.ts`
Expected: FAIL (`sieve`/`loosen`/`PropositionsSchema` not exported, and p2 keeps `t1`).

- [ ] **Step 3: Implement.** In `annotations.ts`:

  1. Add `| "bad_value"` to `DropReason`.
  2. Under `MeaningSchema`, add:

```ts
// With thinking on, even the meaning grammar is over the limit, so it is asked in two parts.
export const PropositionsSchema = LabelsSchema.pick({ propositions: true, threads: true });
export const SignalsSchema = LabelsSchema.pick({
  idiolect: true,
  relationship: true,
  intimacy: true,
  bid_response: true,
});

/**
 * The schema as the model is sent it: every enum becomes a string described with its values.
 * Structured output enforces types only, so an enum there only fails the whole call at parse
 * time; `sieve` checks the values one label at a time instead.
 */
export function loosen(schema: z.ZodType): z.ZodType {
  if (schema instanceof z.ZodObject) {
    return z.object(
      Object.fromEntries(
        Object.entries(schema.shape).map(([k, v]) => [k, loosen(v as z.ZodType)]),
      ),
    );
  }
  if (schema instanceof z.ZodArray) return z.array(loosen(schema.element as z.ZodType));
  if (schema instanceof z.ZodNullable) return loosen(schema.unwrap() as z.ZodType).nullable();
  if (schema instanceof z.ZodEnum) {
    return z.string().describe(`one of: ${(schema.options as string[]).join(" | ")}`);
  }
  return schema;
}

/** Keeps each label that fits `strict`; one with a value outside its list is dropped alone. */
export function sieve<S extends z.ZodObject>(
  raw: unknown,
  strict: S,
): { labels: z.infer<S>; drops: Drop[] } {
  const input = (raw ?? {}) as Record<string, unknown>;
  const drops: Drop[] = [];
  const out: Record<string, unknown> = {};
  for (const [layer, field] of Object.entries(strict.shape)) {
    const value = input[layer];
    if (field instanceof z.ZodArray) {
      const items = Array.isArray(value) ? value : [];
      out[layer] = items.filter((item, i) => {
        const parsed = (field.element as z.ZodType).safeParse(item);
        if (!parsed.success) drops.push(badValue(layer, labelId(item, i), parsed.error));
        return parsed.success;
      });
      continue;
    }
    const parsed = (field as z.ZodType).safeParse(value ?? null);
    if (!parsed.success) drops.push(badValue(layer, layer, parsed.error));
    out[layer] = parsed.success ? parsed.data : null;
  }
  return { labels: out as z.infer<S>, drops };
}

function labelId(item: unknown, i: number): string {
  const o = item as { id?: unknown; thread_id?: unknown; title?: unknown } | null;
  for (const v of [o?.id, o?.thread_id, o?.title]) if (typeof v === "string" && v) return v;
  return String(i);
}

function badValue(layer: string, id: string, error: z.ZodError): Drop {
  return { layer, id, reason: "bad_value", ref: error.issues[0]?.path.join(".") ?? "" };
}
```

  3. In `Checker.propositions`, replace the `times` line with the B134 rule:

```ts
      // A memory's times come from the words it rests on, never from a question beside it.
      const own = new Set(moves.flatMap((m) => m.pieces));
      const times = this.keep("proposition", p.id, "times", p.times, (id) => {
        const t = this.allTimes.get(id);
        return !!t && own.has(t.piece);
      });
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test tests/mind/memory/user/annotations.test.ts`
Expected: PASS, including every earlier test.

- [ ] **Step 5: Commit**

```bash
git add src/mind/memory/user/annotations.ts tests/mind/memory/user/annotations.test.ts
git commit -m "feat(memory): a bad label value drops only that label; a memory's times sit in its moves"
```

---

### Task 3: The live labelling module, three calls with thinking, labels v1

**Files:**
- Create: `src/mind/memory/user/label.ts`, `prompts/labels/v1.md`
- Delete: `prompts/extract/v12.md`
- Modify: `src/mind/memory/user/annotations.ts` (delete `MeaningSchema`),
  `src/mind/platform/llm/types.ts`, `src/mind/platform/llm/anthropic.ts`,
  `src/mind/platform/config.ts`, `config/default.json`, `evals/lib/label-replay.ts`,
  `evals/extract-replay.ts`
- Test: `tests/mind/memory/user/label.test.ts`, `tests/mind/platform/llm.test.ts`

**Interfaces:**
- Consumes: `checkLabels`, `mergeLabels`, `emptyLabels`, `sieve`, `loosen`, `ReadingSchema`,
  `PropositionsSchema`, `SignalsSchema` (Task 2); `buildLabelInput` (`label-input.ts`).
- Produces:
  - `type Stretch = { pieces: Piece[]; zone: string; threads: ShownThread[]; interests: string[]; earlier: CheckedLabels }`
  - `labelStretch(deps: Pick<Deps, "llm" | "config">, s: Stretch): Promise<CheckedLabels>`:
    the checked labels of the new messages only (not merged with `earlier`), with every
    call's sieve drops.
  - `LABEL_PURPOSES = ["labels_read", "labels_meaning", "labels_signals"] as const`
  - Structured model role `"labels"`; config keys `models.labels`, `models.labels_thinking`,
    `models.labels_max_tokens`, `models.labels_timeout_ms`, `models.labels_cache`, and
    `prompts.labels`.

- [ ] **Step 1: Write the failing tests**

`tests/mind/memory/user/label.test.ts`:

```ts
/** Labelling one stretch: three calls, each seeing what the calls before it labelled. */
import { expect, test } from "vitest";
import { emptyLabels } from "@/mind/memory/user/annotations";
import { labelStretch, LABEL_PURPOSES } from "@/mind/memory/user/label";
import { numberPieces } from "@/mind/memory/user/pieces";
import { makeTestDeps } from "../../../helpers/deps";

const at = new Date("2026-01-07T20:30:00Z");
const pieces = numberPieces(
  [
    { id: "a", speaker: "spica", text: "how did it go?", at },
    { id: "b", speaker: "user", text: "the interview went well", at },
  ],
  1,
);
const stretch = { pieces, zone: "UTC", threads: [], interests: [], earlier: emptyLabels() };

function scripted() {
  const d = makeTestDeps();
  d.llm.handlers.labels_read = () => ({
    moves: [{ id: "m1", pieces: ["2.1"], act: "answers", replies_to: "" }],
    mentions: [],
    times: [],
  });
  d.llm.handlers.labels_meaning = (input: string) => {
    // The reading call's move is already labelled when the propositions call runs.
    expect(input).toContain("m1 answers [2.1]");
    return {
      propositions: [
        {
          id: "p1",
          moves: ["m1"],
          subject: "user",
          kind: "event",
          label: "job interview",
          status: "happened",
          times: [],
          mentions: [],
          thread_id: "",
          new_thread: "",
          updates: "",
          salience: 0.8,
          valence: 0.6,
          confidence: 0.9,
          claim_kind: null,
        },
      ],
      threads: [],
    };
  };
  d.llm.handlers.labels_signals = (input: string) => {
    expect(input).toContain('p1 user event "job interview"');
    return {
      idiolect: [],
      relationship: null,
      intimacy: { user_disclosure: 0.2, user_responsiveness: null, moves: ["m1"] },
      bid_response: { response: "toward", move: "m1" },
    };
  };
  return d;
}

test("three calls in order, each on the labels model, and the labels come back checked", async () => {
  const d = scripted();
  const out = await labelStretch(d, stretch);
  expect(d.llm.structuredCalls.map((c) => c.purpose)).toEqual([...LABEL_PURPOSES]);
  expect(out.moves.map((m) => m.id)).toEqual(["m1"]);
  expect(out.propositions.map((p) => p.label)).toEqual(["job interview"]);
  expect(out.bid_response).toEqual({ response: "toward", move: "m1" });
  expect(out.drops).toEqual([]);
});

test("a bad value in one call drops one label, and the other calls still run", async () => {
  const d = scripted();
  d.llm.handlers.labels_read = () => ({
    moves: [
      { id: "m1", pieces: ["2.1"], act: "answers", replies_to: "" },
      { id: "m2", pieces: ["1.1"], act: "wonders", replies_to: "" },
    ],
    mentions: [],
    times: [],
  });
  const out = await labelStretch(d, stretch);
  expect(out.moves.map((m) => m.id)).toEqual(["m1"]);
  expect(out.drops).toContainEqual({ layer: "moves", id: "m2", reason: "bad_value", ref: "act" });
  expect(out.propositions).toHaveLength(1);
});

test("a call that throws fails the labelling: nothing is asked again", async () => {
  const d = scripted();
  d.llm.handlers.labels_meaning = () => {
    throw new Error("Failed to parse structured output");
  };
  await expect(labelStretch(d, stretch)).rejects.toThrow("labels_meaning");
  expect(d.llm.structuredCalls.map((c) => c.purpose)).toEqual(["labels_read", "labels_meaning"]);
});
```

In `tests/mind/platform/llm.test.ts`, find the test that maps model roles to ids (it uses
`extract: "m-extract"`) and add `labels: "m-labels"` to its models and an expectation that a
`model: "labels"` call sends `m-labels` with `thinking: { type: "adaptive" }`, while a
`model: "cheap"` call keeps `structured_thinking`. Follow the file's existing pattern for
reading the request the client received.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test tests/mind/memory/user/label.test.ts tests/mind/platform/llm.test.ts`
Expected: FAIL (`@/mind/memory/user/label` missing; no `labels` model role).

- [ ] **Step 3: The model role and config.**

  - `types.ts`: add `"labels"` to `StructuredModel`.
  - `anthropic.ts`, in `classifyJson`, replace the thinking line:

```ts
    const thinking = isJudge
      ? this.models.judge_thinking
      : model === "labels"
        ? this.models.labels_thinking
        : this.models.structured_thinking;
```

    and add `labels: this.models.labels,` to `modelIdFor`'s map.
  - `config.ts`, in the models schema next to `extract`, add:

```ts
  labels: z.string(),
  labels_thinking: thinking,
  labels_max_tokens: positiveInt,
  labels_timeout_ms: positiveInt,
  labels_cache: cacheTtl,
```

    Use the same helpers the neighbouring keys use (`positiveInt`, and whatever
    `extract_cache` uses for its TTL type).
  - In the prompts schema add `labels: z.string()`.
  - `config/default.json`: under `models` add

```json
    "labels": "claude-haiku-5-5",
    "labels_thinking": "adaptive",
    "labels_max_tokens": 16000,
    "labels_timeout_ms": 180000,
    "labels_cache": "5m",
```

    and under `prompts` add `"labels": "v1"`.

  The token cap and timeout leave room for thinking (the 17a replay needed 16384 for the
  reading call). The cold path is asynchronous, so a slow call never delays a reply.

- [ ] **Step 4: The prompt.** `git mv prompts/extract/v12.md prompts/labels/v1.md`, then edit
  `prompts/labels/v1.md`:
  - In "What you get", replace the bullet beginning "A call asks for some of the layers below"
    with:

```markdown
- A call asks for some of the layers below: fill only the ones its output asks for. The reading call asks for moves, mentions and times. The next call asks for propositions and threads, and the last for idiolect and the relationship, intimacy and bid blocks. By then what earlier calls labelled is in "Already labelled": point at it by id, and never at an id that isn't listed.
```

  - In "propositions", after the `times and mentions` bullet, add:

```markdown
- A proposition's times come from the words its own moves cover. A time in a question or a message it doesn't rest on is not its time: cite that move too, or leave the time out.
```

  - Add each line from Task 1's "Prompt changes for labels v1" in the section it belongs to,
    in v12's style (a rule, or an invented example under "Examples").
  - `prompts/extract/v12.md` is gone. Nothing configures it, and the replay now reads
    `prompts.labels`.

- [ ] **Step 5: The module.** Create `src/mind/memory/user/label.ts`:

```ts
/**
 * Labelling one stretch of conversation: three calls, each thinking, each seeing what the calls
 * before it labelled. The first reads what the text holds (moves, mentions, times), the second
 * what it means (memories, threads), the third what it says about them (idiolect, how the user
 * treated her). Code checks every label against the transcript; a call that fails fails the
 * labelling, and nothing is asked again.
 */
import type { z } from "zod";
import type { Deps } from "@/mind/platform/deps";
import { loadPrompt } from "@/mind/platform/prompts";
import {
  checkLabels,
  loosen,
  mergeLabels,
  PropositionsSchema,
  ReadingSchema,
  SignalsSchema,
  sieve,
  type CheckedLabels,
  type Drop,
  type Labels,
} from "./annotations";
import { buildLabelInput, type ShownThread } from "./label-input";
import type { Piece } from "./pieces";

export const LABEL_PURPOSES = ["labels_read", "labels_meaning", "labels_signals"] as const;
type Purpose = (typeof LABEL_PURPOSES)[number];

export type Stretch = {
  pieces: Piece[];
  zone: string;
  threads: ShownThread[];
  interests: string[];
  /** What earlier calls labelled in this conversation. */
  earlier: CheckedLabels;
};

const NO_MEANING = { propositions: [], threads: [] } satisfies Pick<Labels, "propositions" | "threads">;
const NO_SIGNALS = {
  idiolect: [],
  relationship: null,
  intimacy: null,
  bid_response: null,
} satisfies Pick<Labels, "idiolect" | "relationship" | "intimacy" | "bid_response">;

/** The new messages' labels, checked; `earlier` is not repeated in them. */
export async function labelStretch(
  deps: Pick<Deps, "llm" | "config">,
  s: Stretch,
): Promise<CheckedLabels> {
  const { config } = deps;
  const ctx = { pieces: s.pieces, zone: s.zone, threadIds: s.threads.map((t) => t.id), earlier: s.earlier };
  const drops: Drop[] = [];
  const ask = async <S extends z.ZodObject>(purpose: Purpose, schema: S, known: CheckedLabels) => {
    const raw = await deps.llm
      .classifyJson({
        purpose,
        model: "labels",
        system: loadPrompt("labels", config.prompts.labels),
        input: buildLabelInput({ ...s, earlier: known }),
        schema: loosen(schema),
        timeoutMs: config.models.labels_timeout_ms,
        maxTokens: config.models.labels_max_tokens,
        cache: config.models.labels_cache,
      })
      .catch((e: unknown) => {
        throw new Error(`${purpose}: ${(e as Error).message}`, { cause: e });
      });
    const { labels, drops: bad } = sieve(raw, schema);
    drops.push(...bad);
    return labels;
  };

  const read = await ask("labels_read", ReadingSchema, s.earlier);
  const afterRead = checkLabels({ ...read, ...NO_MEANING, ...NO_SIGNALS }, ctx);
  const meant = await ask("labels_meaning", PropositionsSchema, mergeLabels(s.earlier, afterRead));
  const afterMeaning = checkLabels({ ...read, ...meant, ...NO_SIGNALS }, ctx);
  const signals = await ask("labels_signals", SignalsSchema, mergeLabels(s.earlier, afterMeaning));
  const out = checkLabels({ ...read, ...meant, ...signals }, ctx);
  return { ...out, drops: [...drops, ...out.drops] };
}
```

  Export `ShownThread` from `label-input.ts` if it isn't already (it is: `export type ShownThread`).
  Delete `MeaningSchema` from `annotations.ts`.

- [ ] **Step 6: The replay runs the live module.** In `evals/lib/label-replay.ts`:
  - delete `ReplayModels`, `ReplayOptions`, `NO_MEANING` and the inline `ask`;
  - `runReplay(deps: Pick<Deps, "llm" | "config">, conversations)` passes
    `{ pieces, zone: c.zone, threads: shown.threads, interests: shown.interests, earlier }` to
    `labelStretch`, catching errors into `CallResult.error` as now.

  In `evals/extract-replay.ts`:
  - delete `READ_TOKENS`, `MEANING_TOKENS`, `TIMEOUT_MS`, `thinkingConfig` and the
    `loadPrompt` import;
  - call `runReplay({ llm: realProvider(config, "extract-replay", usage.record), config }, conversations)`;
  - set the review title to `"exchange mode, three calls with thinking"`;
  - update the header comment to match;
  - delete the `DECISIONS.md` row about "The labelling replay's token caps and timeout are
    constants": those limits are config now.

- [ ] **Step 7: Run the tests, the typecheck and the free replay dry run**

Run: `pnpm test tests/mind/memory/user tests/mind/platform/llm.test.ts tests/mind/platform/prompts.test.ts`
Expected: PASS.
Run: `pnpm typecheck; pnpm lint`
Expected: clean.
Run: `pnpm review:extract-labels --dry`
Expected: the counts and one input print, and no model is called.

- [ ] **Step 8: Commit**

```bash
git add -A src/mind/memory/user src/mind/platform prompts config evals tests DECISIONS.md
git commit -m "feat(memory): labelling in three calls with thinking (labels v1); the replay runs it"
```

---

### Task 4: Paid replay rerun (gate: Ethan's go-ahead), then stop

**Files:**
- Modify: `evals/results/analysis-2026-10-25-phase-17a.md` (append)

- [ ] **Step 1: Pre-flight with the `review-run` skill.**
  - Purpose: measure B133 (memories lost to invented ids), B135 (the gaps from Task 1) and the
    cost of three thinking calls.
  - Estimate: $0.15–0.25, from 17a's $0.077 reading pass times about 2.5.
  - Outputs: `evals/results/review-extract-labels-<stamp>.md` and
    `evals/results/calls/extract-replay-<stamp>.jsonl`.
  - Ask Ethan for the go-ahead.
- [ ] **Step 2: Run it detached** (background shells get reaped on this box):
  `Start-Process cmd -ArgumentList '/c pnpm review:extract-labels > evals\results\run-extract-labels-17b.log 2>&1'`,
  then watch the log with Monitor.
- [ ] **Step 3: Read the review** by section, never the call log whole. Append a section
  "Rerun with three thinking calls (17b)" to the analysis, with:
  - the totals table against the 17a rerun (moves, times, memories written and kept, drops by
    reason, failed calls, cost per call kind);
  - the B133 count (`bad_ref` from moves never made);
  - each B135 gap from Task 1: fixed or not;
  - each named case, one line.
- [ ] **Step 4: Commit** the analysis (`docs(evals): 17b replay rerun`) and **stop.** Report
  the numbers to Ethan. Tasks 5 and on start only after he has read them; a prompt change he
  asks for is a new prompt version and another rerun.

---

### Task 5: The annotation table and stored labels

**Files:**
- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/0043_*.sql` (generated), `src/db/repos/user/annotations.ts`,
  `src/mind/memory/user/stored-labels.ts`
- Test: `tests/db/annotations.test.ts`, `tests/mind/memory/user/stored-labels.test.ts`

**Interfaces:**
- Produces:
  - Table `annotation` and enum `annotation_layer`.
  - `type AnnotationRow = typeof annotation.$inferSelect`;
    `type NewAnnotation = Omit<typeof annotation.$inferInsert, "user_id">`.
  - `insertAnnotations(db, userId, rows: NewAnnotation[]): Promise<void>`
  - `sessionAnnotations(db, userId, sessionId: string): Promise<AnnotationRow[]>`: oldest
    first.
  - `timeLabelsOn(db, userId, turnIds: string[]): Promise<AnnotationRow[]>`: the time labels
    whose words sit in those turns.
  - `toRows(labels: CheckedLabels, a: { sessionId: string; exchangeRef: string; at: Date; factIds: Map<string, string>; entityIds: Map<string, string> }): NewAnnotation[]`
    (`factIds` and `entityIds` are keyed by local id).
  - `fromRows(rows: AnnotationRow[], pieces: Piece[]): CheckedLabels`: earlier labels with
    their piece ids worked out again from coordinates. A label whose words aren't all shown is
    left out.
  - `factIdsByLocal(rows: AnnotationRow[]): Map<string, string>`: proposition and idiolect
    local id to fact id.
  - `entityIdsByLocal(rows: AnnotationRow[]): Map<string, string>`: mention local id to
    entity id.

- [ ] **Step 1: Write the failing pure test** `tests/mind/memory/user/stored-labels.test.ts`:

```ts
/** Labels stored by coordinate come back with the piece ids of whatever window shows them. */
import { expect, test } from "vitest";
import { checkLabels, emptyLabels } from "@/mind/memory/user/annotations";
import { numberPieces, type Message } from "@/mind/memory/user/pieces";
import { factIdsByLocal, fromRows, toRows } from "@/mind/memory/user/stored-labels";
import type { AnnotationRow } from "@/db/repos/user/annotations";

const at = new Date("2026-01-07T20:30:00Z");
const msgs: Message[] = [
  { id: "a", speaker: "spica", text: "is it still thursday?", at },
  { id: "b", speaker: "user", text: "yes thursday", at },
];
const labels = checkLabels(
  {
    moves: [{ id: "m1", pieces: ["2.1"], act: "confirms", replies_to: "" }],
    mentions: [],
    times: [
      {
        id: "t1",
        piece: "2.1",
        words: "thursday",
        from: "said",
        unit: "weekday",
        shift: 1,
        weekday: "thursday",
        month: null,
        day_of_month: null,
        part: null,
        clock: "",
        span: "at",
        rough: false,
      },
    ],
    propositions: [
      {
        id: "p1",
        moves: ["m1"],
        subject: "user",
        kind: "event",
        label: "job interview",
        status: "planned",
        times: ["t1"],
        mentions: [],
        thread_id: "",
        new_thread: "",
        updates: "",
        salience: 0.8,
        valence: 0,
        confidence: 0.9,
        claim_kind: null,
      },
    ],
    threads: [],
    idiolect: [],
    relationship: null,
    intimacy: null,
    bid_response: null,
  },
  { pieces: numberPieces(msgs, 1), zone: "UTC", threadIds: [], earlier: emptyLabels() },
);
const stored = (): AnnotationRow[] =>
  toRows(labels, {
    sessionId: "s",
    exchangeRef: "b",
    at,
    factIds: new Map([["p1", "f1"]]),
    entityIds: new Map(),
  }).map((r, i) => ({ ...r, id: `r${i}`, user_id: "u", fact_id: r.fact_id ?? null }) as AnnotationRow);

test("labels round-trip, and a window that grew in front renumbers their pieces", () => {
  const before: Message = { id: "z", speaker: "user", text: "hey", at };
  const back = fromRows(stored(), numberPieces([before, ...msgs], 3));
  expect(back.moves[0]).toMatchObject({ id: "m1", pieces: ["3.1"], speaker: "user" });
  expect(back.times[0]).toMatchObject({ id: "t1", piece: "3.1" });
  expect(back.propositions.map((p) => p.id)).toEqual(["p1"]);
  expect(factIdsByLocal(stored()).get("p1")).toBe("f1");
});

test("a label whose words have left the window is left out of what the call sees", () => {
  const back = fromRows(stored(), numberPieces([msgs[0]!], 1));
  expect(back.moves).toEqual([]);
  expect(back.times).toEqual([]);
  // The memory itself is still listed, so a later one can update it.
  expect(back.propositions.map((p) => p.id)).toEqual(["p1"]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test tests/mind/memory/user/stored-labels.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 3: The schema.** In `src/db/schema.ts`, after `session_log`:

```ts
export const annotationLayer = pgEnum("annotation_layer", [
  "move",
  "mention",
  "time",
  "proposition",
  "idiolect",
]);

// The labels on a conversation, apart from its words: each points into `session_log` by
// character range, and the memories it became point back through `fact_id`.
export const annotation = pgTable(
  "annotation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: userRef(),
    session_id: uuid("session_id").notNull(),
    // The reply whose cold path wrote it.
    exchange_ref: uuid("exchange_ref")
      .notNull()
      .references(() => session_log.id, { onDelete: "cascade" }),
    layer: annotationLayer("layer").notNull(),
    local_id: text("local_id").notNull(),
    coords: jsonb("coords").$type<{ turnId: string; start: number; end: number }[]>().notNull(),
    data: jsonb("data").notNull(),
    fact_id: uuid("fact_id").references(() => fact.id, { onDelete: "set null" }),
    created_at: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("annotation_session_local_uq").on(t.user_id, t.session_id, t.local_id),
    index("annotation_user_session_idx").on(t.user_id, t.session_id),
  ],
);
```

  Run `pnpm db:generate`, check the generated SQL creates only the enum, the table and its two
  indexes, then `pnpm db:migrate` (dev DB).

- [ ] **Step 4: The repo** `src/db/repos/user/annotations.ts`:

```ts
/**
 * One user's labels (the `annotation` table): written by the cold path, read back as what a
 * conversation already has labelled, and as the times behind her view of older messages.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { annotation } from "@/db/schema";

export type AnnotationRow = typeof annotation.$inferSelect;
export type NewAnnotation = Omit<typeof annotation.$inferInsert, "user_id">;

export async function insertAnnotations(
  db: Db,
  userId: string,
  rows: NewAnnotation[],
): Promise<void> {
  if (rows.length) await db.insert(annotation).values(rows.map((r) => ({ ...r, user_id: userId })));
}

export async function sessionAnnotations(
  db: Db,
  userId: string,
  sessionId: string,
): Promise<AnnotationRow[]> {
  return db
    .select()
    .from(annotation)
    .where(and(eq(annotation.user_id, userId), eq(annotation.session_id, sessionId)))
    .orderBy(asc(annotation.created_at));
}

// ponytail: scans the user's time labels; index the turn ids if one user's labels get large
export async function timeLabelsOn(
  db: Db,
  userId: string,
  turnIds: string[],
): Promise<AnnotationRow[]> {
  if (!turnIds.length) return [];
  return db
    .select()
    .from(annotation)
    .where(
      and(
        eq(annotation.user_id, userId),
        eq(annotation.layer, "time"),
        sql`${annotation.coords}->0->>'turnId' IN (${sql.join(
          turnIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    );
}
```

- [ ] **Step 5: The DB test** `tests/db/annotations.test.ts`. Follow the setup of a
  neighbouring test in `tests/db/` (`resetDb`, `createTestUser`, `insertTurn`):
  - insert two rows for user A in one session (a move and a time on turn T);
  - `sessionAnnotations` returns both, oldest first;
  - `timeLabelsOn(A, [T])` returns only the time;
  - user B sees none of them;
  - a second insert with the same `(session_id, local_id)` throws.
- [ ] **Step 6: Stored labels** `src/mind/memory/user/stored-labels.ts`:

```ts
/**
 * Labels as stored: one row per label, pointing at words by coordinate, and back again. Piece
 * ids are only the numbering of one call's window, so they're worked out again from the
 * coordinates each time; a label whose words aren't shown any more is left out.
 */
import type { AnnotationRow, NewAnnotation } from "@/db/repos/user/annotations";
import {
  emptyLabels,
  type CheckedIdiolect,
  type CheckedLabels,
  type CheckedMention,
  type CheckedMove,
  type CheckedProposition,
  type CheckedTime,
} from "./annotations";
import type { Coordinate, Piece } from "./pieces";

type Where = { sessionId: string; exchangeRef: string; at: Date };

export function toRows(
  labels: CheckedLabels,
  a: Where & { factIds: Map<string, string>; entityIds: Map<string, string> },
): NewAnnotation[] {
  const row = (
    layer: NewAnnotation["layer"],
    localId: string,
    coords: Coordinate[],
    data: unknown,
  ): NewAnnotation => ({
    session_id: a.sessionId,
    exchange_ref: a.exchangeRef,
    layer,
    local_id: localId,
    coords,
    data,
    fact_id: a.factIds.get(localId) ?? null,
    created_at: a.at,
  });
  return [
    ...labels.moves.map((m) => row("move", m.id, m.coords, m)),
    ...labels.mentions.map((m) =>
      row("mention", m.id, [m.coord], { ...m, entity_id: a.entityIds.get(m.id) ?? null }),
    ),
    ...labels.times.map((t) => row("time", t.id, [t.coord], t)),
    ...labels.propositions.map((p) => row("proposition", p.id, [], p)),
    ...labels.idiolect.map((i) => row("idiolect", i.id, i.coords, i)),
  ];
}

export function fromRows(rows: AnnotationRow[], pieces: Piece[]): CheckedLabels {
  const out = emptyLabels();
  const at = (c: Coordinate) =>
    pieces.find((p) => p.message.id === c.turnId && p.start <= c.start && c.end <= p.end)?.id;
  for (const r of rows) {
    const ids = r.coords.map(at);
    if (ids.some((id) => id === undefined)) continue;
    const found = ids as string[];
    switch (r.layer) {
      case "move":
        out.moves.push({ ...(r.data as CheckedMove), pieces: found });
        break;
      case "mention":
        out.mentions.push({ ...(r.data as CheckedMention), piece: found[0]! });
        break;
      case "time":
        out.times.push({ ...(r.data as CheckedTime), piece: found[0]! });
        break;
      case "proposition":
        out.propositions.push(r.data as CheckedProposition);
        break;
      case "idiolect":
        out.idiolect.push({ ...(r.data as CheckedIdiolect), pieces: found });
        break;
    }
  }
  return out;
}

export function factIdsByLocal(rows: AnnotationRow[]): Map<string, string> {
  return new Map(rows.flatMap((r) => (r.fact_id ? [[r.local_id, r.fact_id] as const] : [])));
}

export function entityIdsByLocal(rows: AnnotationRow[]): Map<string, string> {
  return new Map(
    rows.flatMap((r) => {
      const id = r.layer === "mention" ? (r.data as { entity_id?: string | null }).entity_id : null;
      return id ? [[r.local_id, id] as const] : [];
    }),
  );
}
```

  `CheckedIdiolect` has no `coords` today. Add `coords: Coordinate[]` to it in `annotations.ts`
  and set it in `Checker.idiolect` (`coords: cited.map(coordinate)`), so idiolect can be stored
  by coordinate like a move.

- [ ] **Step 7: Run the tests**

Run: `pnpm test tests/mind/memory/user/stored-labels.test.ts tests/db/annotations.test.ts tests/mind/memory/user/annotations.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/db src/mind/memory/user tests/db/annotations.test.ts tests/mind/memory/user/stored-labels.test.ts
git commit -m "feat(db): the annotation table: labels stored apart from the words, by coordinate"
```

---

### Task 6: The memory line and time tokens

**Files:**
- Modify: `src/mind/platform/time-anchors.ts` (export `formatToken`),
  `src/mind/platform/time-labels.ts`
- Create: `src/mind/memory/user/memory-line.ts`
- Test: `tests/mind/platform/time-labels.test.ts`, `tests/mind/memory/user/memory-line.test.ts`

**Interfaces:**
- Produces:
  - `formatToken(local: string, precision: Precision, zone: string, said?: string): string`
    (time-anchors).
  - `labelToken(t: ResolvedTime, zone: string, said?: string): string` and
    `labelInstant(t: ResolvedTime, zone: string): Date` (time-labels).
  - `type LineMove = { speaker: Speaker; act: Act; text: string }`
  - `memoryLine(p: { label: string; status: string | null }, moves: LineMove[], times: ResolvedTime[], zone: string, quoteChars: number): string`
  - `embedText(label: string, moves: LineMove[], quoteChars: number): string`
  - `quoted(moves: LineMove[], quoteChars: number): string`: "the user said "…"; Spica asked
    "…"".
  - `moveText(move: CheckedMove, pieces: Piece[]): string`: a move's words, its pieces joined
    with " / ".

- [ ] **Step 1: Write the failing tests**

Append to `tests/mind/platform/time-labels.test.ts`:

```ts
test("a resolved time becomes a token the renderer dates, with its edges outside", () => {
  const r = (t: Partial<ResolvedTime>): ResolvedTime => ({
    date: "2026-01-08",
    precision: "day",
    part: null,
    clock: null,
    span: "at",
    rough: false,
    ...t,
  });
  expect(labelToken(r({}), "UTC")).toBe("⟦2026-01-08|day|UTC⟧");
  expect(labelToken(r({ clock: "10:00" }), "UTC")).toBe("⟦2026-01-08T10:00|time|UTC⟧");
  expect(labelToken(r({ part: "evening" }), "UTC")).toBe("⟦2026-01-08|evening|UTC⟧");
  expect(labelToken(r({ span: "since" }), "UTC")).toBe("⟦2026-01-08|since|UTC⟧");
  expect(labelToken(r({ precision: "month", date: "2026-01-01", part: "end" }), "UTC")).toBe(
    "the end of ⟦2026-01|month|UTC⟧",
  );
  expect(labelToken(r({ rough: true, span: "until" }), "UTC")).toBe("around until ⟦2026-01-08|day|UTC⟧");
  expect(labelToken(r({}), "UTC", "thurs")).toBe("⟦2026-01-08|day|UTC|thurs⟧");
  expect(labelInstant(r({ clock: "10:00" }), "UTC").toISOString()).toBe("2026-01-08T10:00:00.000Z");
});
```

`tests/mind/memory/user/memory-line.test.ts`:

```ts
/** A memory as every reader sees it: label, status, dates as tokens, then the words it rests on. */
import { expect, test } from "vitest";
import { embedText, memoryLine, quoted } from "@/mind/memory/user/memory-line";

const interview = { date: "2026-01-08", precision: "day", part: null, clock: null, span: "at", rough: false } as const;

test("label, status, date token, then each move quoted with its speaker", () => {
  const line = memoryLine(
    { label: "train ticket", status: "happened" },
    [
      { speaker: "spica", act: "asks", text: "and did you book the train" },
      { speaker: "user", act: "confirms", text: "and yes booked" },
    ],
    [interview],
    "UTC",
    160,
  );
  expect(line).toBe(
    'train ticket, happened ⟦2026-01-08|day|UTC⟧ — Spica asked "and did you book the train"; the user confirmed "and yes booked"',
  );
});

test("a long quote is cut at a word, and token characters in their words can't break the grammar", () => {
  const text = "it went ⟦really⟧ well | i think, and then we talked about the studio for ages";
  expect(quoted([{ speaker: "user", act: "states", text }], 30)).toBe(
    'the user said "it went really well i think…"',
  );
});

test("no status and no time: just the label and the words", () => {
  expect(
    memoryLine({ label: "cat juniper", status: null }, [{ speaker: "user", act: "states", text: "my cat juniper" }], [], "UTC", 160),
  ).toBe('cat juniper — the user said "my cat juniper"');
});

test("what gets embedded: the label and the words, no dates", () => {
  expect(embedText("job interview", [{ speaker: "user", act: "answers", text: "it went well" }], 160)).toBe(
    "job interview: it went well",
  );
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test tests/mind/platform/time-labels.test.ts tests/mind/memory/user/memory-line.test.ts`
Expected: FAIL (missing exports).

- [ ] **Step 3: Implement.**

  In `time-anchors.ts`, replace the private `token` helper's body to call a new export:

```ts
/** A token in the one format every renderer reads. `said` keeps the words and glosses them. */
export function formatToken(local: string, precision: Precision, zone: string, said?: string): string {
  return `⟦${local}|${precision}|${zone}${said ? `|${said.replace(/[|⟧]/g, "")}` : ""}⟧`;
}

function token(local: string, precision: Precision, ctx: AnchorContext, words: string): string {
  return formatToken(local, precision, ctx.zone, ctx.said ? words : undefined);
}
```

  (`ctx.said` goes in Task 9.)

  In `time-labels.ts`:

```ts
import { formatToken, tokenDates } from "./time-anchors";

/**
 * A resolved time as a date token, so it reads with its distance on whatever day a prompt is
 * sent. Its edges ("around", "until", "the end of") sit outside the token; with `said`, the
 * words stay and the date is glossed beside them.
 */
export function labelToken(t: ResolvedTime, zone: string, said?: string): string {
  const day = t.part && t.part !== "start" && t.part !== "end" ? t.part : "day";
  const precision =
    t.span === "since" ? "since" : t.precision !== "day" ? t.precision : t.clock ? "time" : day;
  const local =
    precision === "month" ? t.date.slice(0, 7) : precision === "time" ? `${t.date}T${t.clock}` : t.date;
  const token = formatToken(local, precision, zone, said);
  if (said) return token;
  const edge = t.part === "start" || t.part === "end" ? `the ${t.part} of ` : "";
  return `${t.rough ? "around " : ""}${t.span === "until" ? "until " : ""}${edge}${token}`;
}

/** The moment a resolved time points at, as the renderer reads its token. */
export function labelInstant(t: ResolvedTime, zone: string): Date {
  return tokenDates(labelToken(t, zone))[0]!;
}
```

  `memory-line.ts`:

```ts
/**
 * A memory as every reader sees it: its label and status, its dates as tokens the renderer reads
 * on the day a prompt is sent, then the words it rests on, quoted, each with who said it. Built
 * once, when the memory is written: the label and the words never change after that.
 */
import { labelToken, type ResolvedTime } from "@/mind/platform/time-labels";
import type { Act, CheckedMove } from "./annotations";
import type { Piece, Speaker } from "./pieces";

export type LineMove = { speaker: Speaker; act: Act; text: string };

const VERB: Partial<Record<Act, string>> = {
  asks: "asked",
  answers: "answered",
  confirms: "confirmed",
  denies: "denied",
  corrects: "corrected",
  promises: "promised",
  offers: "offered",
  requests: "asked",
};

export function memoryLine(
  p: { label: string; status: string | null },
  moves: LineMove[],
  times: ResolvedTime[],
  zone: string,
  quoteChars: number,
): string {
  const head = [p.label, p.status].filter(Boolean).join(", ");
  const dates = times.map((t) => labelToken(t, zone)).join(", ");
  return `${head}${dates ? ` ${dates}` : ""} — ${quoted(moves, quoteChars)}`;
}

export function quoted(moves: LineMove[], quoteChars: number): string {
  return moves
    .map((m) => `${m.speaker === "user" ? "the user" : "Spica"} ${VERB[m.act] ?? "said"} "${cap(clean(m.text), quoteChars)}"`)
    .join("; ");
}

export function embedText(label: string, moves: LineMove[], quoteChars: number): string {
  return `${label}: ${moves.map((m) => cap(clean(m.text), quoteChars)).join(" / ")}`;
}

export function moveText(move: CheckedMove, pieces: Piece[]): string {
  return move.pieces
    .map((id) => pieces.find((p) => p.id === id)?.text)
    .filter(Boolean)
    .join(" / ");
}

// Their words may hold the token brackets or the separator; quoted, they must stay plain words.
function clean(text: string): string {
  return text.replace(/[⟦⟧|]/g, "").replace(/\s+/g, " ").trim();
}

function cap(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[,.;\s]+$/, "")}…`;
}
```

  If the expected strings in the tests don't match the cap rule exactly, fix the code to give
  the tests' output; the tests are the spec.

- [ ] **Step 4: Run the tests**

Run: `pnpm test tests/mind/platform/time-labels.test.ts tests/mind/memory/user/memory-line.test.ts tests/mind/platform/time-anchors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mind/platform src/mind/memory/user/memory-line.ts tests/mind
git commit -m "feat(memory): the memory line: label, status, date tokens and the words, quoted"
```

---

### Task 7: Scripted labels for fakes, tests and evals

The fake provider and every test script labels in the new shape. A script names memories by
words said in a new message, and the handlers read the numbered pieces from the call's input,
the way the model does.

**Files:**
- Create: `src/mind/platform/llm/fake-labels.ts`
- Modify: `src/mind/platform/llm/fake.ts` (default handlers), `tests/helpers/llm.ts`
  (`CapturingLLM` canary), `evals/lib/signal-llm.ts`
- Test: `tests/mind/platform/fake-labels.test.ts`, `tests/evals/signal-llm.test.ts`

**Interfaces:**
- Produces:
  - `type ScriptedMemory = { said: string; label: string; id?: string; subject?: "user" | "self" | "shared"; kind?: string; status?: string | null; act?: string; time?: { words: string } & Partial<TimeMeaning>; mention?: { words: string; name: string; type?: string; subject?: "user" | "self"; relation?: string }; thread_id?: string; new_thread?: string; updates?: string; salience?: number; valence?: number; confidence?: number; claim_kind?: string | null }`
  - `type LabelScript = { memories?: ScriptedMemory[]; threads?: { action: "open" | "touch" | "resolve"; title: string; thread_id?: string; subject?: string; stakes?: string; checkpoint?: string; propositions?: string[] }[]; idiolect?: { said: string; type: string }[]; relationship?: ScriptedSignals | null; intimacy?: { user_disclosure: number; user_responsiveness: number | null } | null; bid?: "toward" | "away" | "against" | null }`
  - `type ScriptedSignals = { warmth?: number; trust?: number; tension?: number; hurt?: { amount: number; said?: string } | null; apology?: boolean; make_up?: boolean; ends_relationship?: boolean; retracts_ending?: boolean; wants_repair?: boolean }`
  - `scriptedLabels(script: LabelScript | ((input: string) => LabelScript)): Record<"labels_read" | "labels_meaning" | "labels_signals", (input: string) => unknown>`
  - `newMessages(input: string): { message: number; speaker: "user" | "spica"; pieces: string[]; text: string }[]`:
    the new messages of a labelling input, each with its piece ids and its words joined by a
    space.

- [ ] **Step 1: Write the failing test** `tests/mind/platform/fake-labels.test.ts`:

```ts
/** Scripted labels: a script's memories land on the new message holding their words. */
import { expect, test } from "vitest";
import { checkLabels, emptyLabels, PropositionsSchema, ReadingSchema, SignalsSchema } from "@/mind/memory/user/annotations";
import { buildLabelInput } from "@/mind/memory/user/label-input";
import { numberPieces } from "@/mind/memory/user/pieces";
import { newMessages, scriptedLabels } from "@/mind/platform/llm/fake-labels";

const at = new Date("2026-01-05T10:00:00Z");
const pieces = numberPieces(
  [
    { id: "a", speaker: "spica", text: "hey", at },
    { id: "b", speaker: "user", text: "i have an interview thursday. kind of nervous", at },
  ],
  1,
);
const input = buildLabelInput({ pieces, zone: "UTC", threads: [], interests: [], earlier: emptyLabels() });

test("new messages are read from the input with their pieces", () => {
  expect(newMessages(input)).toEqual([
    { message: 2, speaker: "user", pieces: ["2.1", "2.2"], text: "i have an interview thursday. kind of nervous" },
  ]);
});

test("a scripted memory checks clean against the transcript", () => {
  const h = scriptedLabels({
    memories: [
      { said: "interview thursday", label: "job interview", status: "planned", time: { words: "thursday", unit: "weekday", shift: 1, weekday: "thursday" } },
    ],
    relationship: { warmth: 0.3, hurt: null },
    bid: "toward",
  });
  const labels = checkLabels(
    {
      ...ReadingSchema.parse(h.labels_read(input)),
      ...PropositionsSchema.parse(h.labels_meaning(input)),
      ...SignalsSchema.parse(h.labels_signals(input)),
    },
    { pieces, zone: "UTC", threadIds: [], earlier: emptyLabels() },
  );
  expect(labels.drops).toEqual([]);
  expect(labels.propositions.map((p) => p.label)).toEqual(["job interview"]);
  expect(labels.times[0]?.resolved?.date).toBe("2026-01-08");
  expect(labels.bid_response?.response).toBe("toward");
});

test("with no script, every new message still gets a move and nothing else", () => {
  const h = scriptedLabels({});
  const read = ReadingSchema.parse(h.labels_read(input));
  expect(read.moves).toHaveLength(1);
  expect(PropositionsSchema.parse(h.labels_meaning(input)).propositions).toEqual([]);
  expect(SignalsSchema.parse(h.labels_signals(input)).relationship).toBeNull();
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test tests/mind/platform/fake-labels.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `src/mind/platform/llm/fake-labels.ts`:

```ts
/**
 * Scripted labels for the fake provider, tests and fake-mode evals. A script names each memory
 * by words said in a new message; the handlers read the numbered pieces from the call's input the
 * way the model does, give every new message one move, and point each scripted memory, time and
 * mention at the message holding its words. Ids carry a hash of the words, so they stay unique
 * as a conversation grows. Never sent to a model.
 */
import type { TimeMeaning } from "@/mind/platform/time-labels";

export type ScriptedMemory = {
  said: string;
  label: string;
  id?: string;
  subject?: "user" | "self" | "shared";
  kind?: string;
  status?: string | null;
  act?: string;
  time?: { words: string } & Partial<TimeMeaning>;
  mention?: { words: string; name: string; type?: string; subject?: "user" | "self"; relation?: string };
  thread_id?: string;
  new_thread?: string;
  updates?: string;
  salience?: number;
  valence?: number;
  confidence?: number;
  claim_kind?: string | null;
};
export type ScriptedSignals = {
  warmth?: number;
  trust?: number;
  tension?: number;
  hurt?: { amount: number; said?: string } | null;
  apology?: boolean;
  make_up?: boolean;
  ends_relationship?: boolean;
  retracts_ending?: boolean;
  wants_repair?: boolean;
};
export type LabelScript = {
  memories?: ScriptedMemory[];
  threads?: {
    action: "open" | "touch" | "resolve";
    title: string;
    thread_id?: string;
    subject?: string;
    stakes?: string;
    checkpoint?: string;
    propositions?: string[];
  }[];
  idiolect?: { said: string; type: string }[];
  relationship?: ScriptedSignals | null;
  intimacy?: { user_disclosure: number; user_responsiveness: number | null } | null;
  bid?: "toward" | "away" | "against" | null;
};
type NewMessage = { message: number; speaker: "user" | "spica"; pieces: string[]; text: string };
type Handlers = Record<"labels_read" | "labels_meaning" | "labels_signals", (input: string) => unknown>;

const PIECE = /^\[(\d+)\.(\d+)\] (User|Spica)(?: · .*?\))?: (.*)$/;
const RANGE = /^Label the new messages \((\d+)(?: to (\d+))?\)\.$/m;

export function newMessages(input: string): NewMessage[] {
  const range = RANGE.exec(input);
  if (!range) return [];
  const [first, last] = [Number(range[1]), Number(range[2] ?? range[1])];
  const conversation = input.split("Conversation:\n")[1]?.split("\n\n")[0] ?? "";
  const byNumber = new Map<number, NewMessage>();
  for (const line of conversation.split("\n")) {
    const m = PIECE.exec(line);
    if (!m) continue;
    const message = Number(m[1]);
    if (message < first || message > last) continue;
    const msg = byNumber.get(message) ?? {
      message,
      speaker: m[3] === "User" ? ("user" as const) : ("spica" as const),
      pieces: [],
      text: "",
    };
    msg.pieces.push(`${m[1]}.${m[2]}`);
    msg.text = msg.text ? `${msg.text} ${m[4]}` : m[4]!;
    byNumber.set(message, msg);
  }
  return [...byNumber.values()];
}

export function scriptedLabels(script: LabelScript | ((input: string) => LabelScript)): Handlers {
  const at = (input: string) => {
    const s = typeof script === "function" ? script(input) : script;
    const messages = newMessages(input);
    const holding = (words: string) =>
      messages.find((m) => m.text.toLowerCase().includes(words.toLowerCase()));
    const moveId = (m: NewMessage) => `m${m.message}-${hash(m.text)}`;
    const pieceOf = (m: NewMessage, words: string) =>
      pieceHolding(input, m, words) ?? m.pieces[0]!;
    return { s, messages, holding, moveId, pieceOf };
  };
  return {
    labels_read: (input) => {
      const { s, messages, holding, moveId, pieceOf } = at(input);
      const scripted = (m: NewMessage) =>
        s.memories?.find((x) => holding(x.said) === m && x.act)?.act;
      return {
        moves: messages.map((m) => ({
          id: moveId(m),
          pieces: m.pieces,
          act: scripted(m) ?? "states",
          replies_to: "",
        })),
        mentions: (s.memories ?? []).flatMap((x) => {
          const m = x.mention && holding(x.mention.words);
          if (!x.mention || !m) return [];
          return [
            {
              id: `e-${hash(x.mention.words)}`,
              piece: pieceOf(m, x.mention.words),
              words: x.mention.words,
              refers_to: "",
              name: x.mention.name,
              type: x.mention.type ?? "other",
              subject: x.mention.subject ?? "user",
              relation: x.mention.relation ?? "",
            },
          ];
        }),
        times: (s.memories ?? []).flatMap((x) => {
          const m = x.time && holding(x.time.words);
          if (!x.time || !m) return [];
          const { words, ...meaning } = x.time;
          return [
            {
              id: `t-${hash(words + x.label)}`,
              piece: pieceOf(m, words),
              words,
              from: "said",
              unit: "day",
              shift: 0,
              weekday: null,
              month: null,
              day_of_month: null,
              part: null,
              span: "at",
              rough: false,
              ...meaning,
              clock: meaning.clock ?? "",
            },
          ];
        }),
      };
    },
    labels_meaning: (input) => {
      const { s, holding, moveId } = at(input);
      return {
        propositions: (s.memories ?? []).flatMap((x) => {
          const m = holding(x.said);
          if (!m) return [];
          return [
            {
              id: x.id ?? `p-${hash(x.label + x.said)}`,
              moves: [moveId(m)],
              subject: x.subject ?? (m.speaker === "user" ? "user" : "self"),
              kind: x.kind ?? "event",
              label: x.label,
              status: x.status ?? null,
              times: x.time && holding(x.time.words) ? [`t-${hash(x.time.words + x.label)}`] : [],
              mentions: x.mention && holding(x.mention.words) ? [`e-${hash(x.mention.words)}`] : [],
              thread_id: x.thread_id ?? "",
              new_thread: x.new_thread ?? "",
              updates: x.updates ?? "",
              salience: x.salience ?? 0.7,
              valence: x.valence ?? 0,
              confidence: x.confidence ?? 0.9,
              claim_kind: x.claim_kind ?? null,
            },
          ];
        }),
        threads: (s.threads ?? []).map((t) => ({
          action: t.action,
          thread_id: t.thread_id ?? "",
          title: t.title,
          subject: t.subject ?? "user",
          stakes: t.stakes ?? "med",
          checkpoint: t.checkpoint ?? "",
          propositions: t.propositions ?? [],
        })),
      };
    },
    labels_signals: (input) => {
      const { s, messages, holding, moveId } = at(input);
      const userMoves = messages.filter((m) => m.speaker === "user").map(moveId);
      const r = s.relationship;
      const hurtAt = r?.hurt?.said ? holding(r.hurt.said) : undefined;
      return {
        idiolect: (s.idiolect ?? []).flatMap((i) => {
          const m = holding(i.said);
          return m ? [{ id: `i-${hash(i.said)}`, pieces: m.pieces, type: i.type }] : [];
        }),
        relationship: r
          ? {
              warmth: r.warmth ?? 0,
              trust: r.trust ?? 0,
              tension: r.tension ?? 0,
              hurt: r.hurt ? { amount: r.hurt.amount, moves: hurtAt ? [moveId(hurtAt)] : [] } : null,
              apology: r.apology ?? false,
              make_up: r.make_up ?? false,
              ends_relationship: r.ends_relationship ?? false,
              retracts_ending: r.retracts_ending ?? false,
              wants_repair: r.wants_repair ?? false,
              moves: userMoves,
            }
          : null,
        intimacy: s.intimacy ? { ...s.intimacy, moves: userMoves } : null,
        bid_response: s.bid && userMoves[0] ? { response: s.bid, move: userMoves[0] } : null,
      };
    },
  };
}

/** The piece of `m` whose own line holds `words`. */
function pieceHolding(input: string, m: NewMessage, words: string): string | undefined {
  return m.pieces.find((id) =>
    input
      .split("\n")
      .find((l) => l.startsWith(`[${id}] `))
      ?.toLowerCase()
      .includes(words.toLowerCase()),
  );
}

function hash(text: string): string {
  let h = 5381;
  for (const c of text) h = (h * 33) ^ c.charCodeAt(0);
  return (h >>> 0).toString(36).slice(0, 5);
}
```

- [ ] **Step 4: Wire the fakes.**
  - `fake.ts`: import `scriptedLabels` and add `...scriptedLabels({}),` to `handlers`. Keep the
    `extract` handler until Task 8 deletes it.
  - `tests/helpers/llm.ts`, in `CapturingLLM.classifyJson`, before the `extract` branch:

```ts
    if (canary && request.purpose.startsWith("labels_")) {
      const labels = scriptedLabels({
        memories: [
          {
            said: canary,
            label: `code word ${canary}`,
            kind: "trait",
            salience: 0.9,
            valence: 0.9,
            mention: { words: canary, name: canary },
          },
        ],
        relationship: { hurt: { amount: 0.6, said: canary } },
      });
      return request.schema.parse(labels[request.purpose as keyof typeof labels](request.input));
    }
```

    Update the class comment: the hurt's words are the user's words holding the canary.
  - `evals/lib/signal-llm.ts`:
    - wrap purpose `labels_signals`;
    - find the newest new user message whose whitespace-collapsed text equals a scripted turn
      text (`newMessages(req.input)`, compare with `s.replace(/\s+/g, " ").trim()` on both
      sides);
    - return `relationship: hit ? { ...NONE, ...hit, hurt: hit.hurt ? { amount: hit.hurt.amount, moves: [] } : null, moves: [] } : null`.

    Drop `MARKER`, and update the comment and `tests/evals/signal-llm.test.ts` to build its
    input with `buildLabelInput` as the fake-labels test does.
- [ ] **Step 5: Run the tests**

Run: `pnpm test tests/mind/platform/fake-labels.test.ts tests/evals/signal-llm.test.ts tests/mind/platform/llm.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mind/platform/llm evals/lib/signal-llm.ts tests
git commit -m "test: scripted labels for the fake provider, the canary model and fake-mode signals"
```

---

### Task 8: The cold path on labels (deletes v11)

**Files:**
- Modify: `src/mind/process/cold-path/cold-path.ts`, `src/mind/memory/user/encode.ts`,
  `src/mind/memory/user/disclosure.ts` (type only), `src/mind/platform/config.ts`,
  `config/default.json`, `src/mind/platform/llm/types.ts`, `src/mind/platform/llm/anthropic.ts`,
  `src/mind/platform/llm/fake.ts`, `tests/helpers/llm.ts`, `evals/lib/profile.ts`,
  `evals/run.ts`, `package.json`
- Create: `src/mind/memory/user/label-memory.ts`
- Delete: `src/mind/memory/user/extract.ts`, `prompts/extract/` (v11),
  `tests/mind/memory/user/extract.test.ts`
- Tests: `tests/mind/memory/user/label-memory.test.ts` (new); rewrite the extract scripts in
  every file listed by `grep -rln "handlers.extract" tests`; rewrite or delete
  `tests/mind/memory/user/encode.test.ts` and `idiolect-encode.test.ts`; delete the
  `anchorExtraction` cases in `tests/exit/phase-16b.test.ts` and `phase-16c.test.ts` (the code
  they test is gone).

**Interfaces:**
- Consumes: `labelStretch` (Task 3); `toRows`, `fromRows`, `factIdsByLocal`,
  `entityIdsByLocal`, `sessionAnnotations`, `insertAnnotations` (Task 5); `memoryLine`,
  `embedText`, `quoted`, `moveText`, `labelInstant` (Task 6); `scriptedLabels` (Task 7).
- Produces:
  - `type MemoryPlan = { localId: string | null; subject: "user" | "self" | "shared"; kind: FactKind; content: string; embedText: string; occurred_at: Date | null; salience: number; valence: number; confidence: number; claim_kind: ClaimKind | null; mentions: string[]; threadId: string | null; newThread: string | null; updates: string | null; idiolect: IdiolectPayload | null }`
  - `memoryPlans(labels: CheckedLabels, all: CheckedLabels, pieces: Piece[], zone: string, settings: Config["extraction"]): MemoryPlan[]`
  - `hurtCause(labels: CheckedLabels, all: CheckedLabels, pieces: Piece[], quoteChars: number): string`
  - `signalsOf(labels, all, pieces, quoteChars): { signals: Signals | null; intimacy: Intimacy | null; bid: BidResponse | null }`
  - `PlannedFact.fact` becomes `MemoryPlan`.
  - `EncodeInput` gains `labels: CheckedLabels`, `stored: AnnotationRow[]`, `sessionId`,
    `zone`. It loses `entities` and `threads`.

- [ ] **Step 1: Write the failing pure test** `tests/mind/memory/user/label-memory.test.ts`:

```ts
/** From checked labels to the memories the cold path writes, with code-built words. */
import { expect, test } from "vitest";
import { checkLabels, emptyLabels, mergeLabels } from "@/mind/memory/user/annotations";
import { buildLabelInput } from "@/mind/memory/user/label-input";
import { hurtCause, memoryPlans } from "@/mind/memory/user/label-memory";
import { numberPieces } from "@/mind/memory/user/pieces";
import { scriptedLabels, type LabelScript } from "@/mind/platform/llm/fake-labels";
import { loadConfig } from "@/mind/platform/config";
import { PropositionsSchema, ReadingSchema, SignalsSchema } from "@/mind/memory/user/annotations";

const config = loadConfig();
const at = new Date("2026-01-05T10:00:00Z");
const pieces = numberPieces(
  [
    { id: "a", speaker: "spica", text: "how's the week looking", at },
    { id: "b", speaker: "user", text: "interview thursday at 10. my sis is visiting too", at },
  ],
  1,
);
const ctx = { pieces, zone: "UTC", threadIds: [], earlier: emptyLabels() };
function labelled(script: LabelScript) {
  const input = buildLabelInput({ pieces, zone: "UTC", threads: [], interests: [], earlier: emptyLabels() });
  const h = scriptedLabels(script);
  return checkLabels(
    {
      ...ReadingSchema.parse(h.labels_read(input)),
      ...PropositionsSchema.parse(h.labels_meaning(input)),
      ...SignalsSchema.parse(h.labels_signals(input)),
    },
    ctx,
  );
}

test("a memory's content is its line; it is dated by its first time", () => {
  const labels = labelled({
    memories: [
      {
        said: "interview thursday",
        label: "job interview",
        status: "planned",
        time: { words: "thursday at 10", unit: "weekday", shift: 1, weekday: "thursday", clock: "10:00" },
      },
    ],
  });
  const [plan] = memoryPlans(labels, mergeLabels(emptyLabels(), labels), pieces, "UTC", config.extraction);
  expect(plan).toMatchObject({
    subject: "user",
    kind: "event",
    content:
      'job interview, planned ⟦2026-01-08T10:00|time|UTC⟧ — the user said "interview thursday at 10. / my sis is visiting too"',
    embedText: "job interview: interview thursday at 10. / my sis is visiting too",
  });
  expect(plan!.occurred_at?.toISOString()).toBe("2026-01-08T10:00:00.000Z");
});

test("idiolect is shared, worded by its pieces, and started by whoever said it first", () => {
  const labels = labelled({ idiolect: [{ said: "my sis", type: "nickname" }] });
  const [plan] = memoryPlans(labels, labels, pieces, "UTC", config.extraction);
  expect(plan).toMatchObject({
    kind: "idiolect",
    subject: "shared",
    salience: config.extraction.idiolect.salience,
    idiolect: { type: "nickname", started_by: "user", established_at: null },
  });
  expect(plan!.content).toContain('"interview thursday at 10. / my sis is visiting too"');
});

test("her hurt is worded by the moves that hurt her, or by all their new moves when none is named", () => {
  const named = labelled({ relationship: { hurt: { amount: 0.6, said: "my sis" } } });
  expect(hurtCause(named, named, pieces, 160)).toBe(
    'the user said "interview thursday at 10. / my sis is visiting too"',
  );
  const unnamed = labelled({ relationship: { hurt: { amount: 0.6 } } });
  expect(hurtCause(unnamed, unnamed, pieces, 160)).toBe(
    'the user said "interview thursday at 10. / my sis is visiting too"',
  );
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm test tests/mind/memory/user/label-memory.test.ts`
Expected: FAIL (module missing; no `extraction.idiolect`).

- [ ] **Step 3: Config.**
  - Delete `extraction.max_candidates`.
  - Add to the extraction schema:

```ts
  window_messages: positiveInt,
  quote_chars: positiveInt,
  idiolect: z.object({ salience: unit, valence: z.number().min(-1).max(1), confidence: unit }),
```

  - In `default.json`, under `extraction`:

```json
    "window_messages": 40,
    "quote_chars": 160,
    "idiolect": { "salience": 0.6, "valence": 0.3, "confidence": 0.9 }
```

  - Delete `models.extract`, `models.extract_max_tokens`, `models.extract_cache` and
    `prompts.extract`, with their schema keys.
  - Remove `"extract"` from `StructuredModel` and from `modelIdFor`.
  - In `tests/mind/platform/llm.test.ts`, drop `extract: "m-extract"`.

  The idiolect numbers are the starting weight of something only the two of them share. The
  model gives no salience for idiolect, so code sets it.

- [ ] **Step 4: Implement** `src/mind/memory/user/label-memory.ts`:

```ts
/**
 * From one call's checked labels to what the cold path writes: a memory per proposition and per
 * idiolect label, worded by code (its line, `memoryLine`), dated by its first time, and how the
 * user treated her (the relationship, intimacy and bid blocks) in the shapes the relationship
 * reads. `all` is the conversation's labels so far, this call's included: a memory may rest on
 * an earlier move.
 */
import type { factKind, claimKind } from "@/db/schema";
import type { Config } from "@/mind/platform/config";
import { labelInstant } from "@/mind/platform/time-labels";
import {
  normalizeBid,
  normalizeIntimacy,
  normalizeSignals,
  type BidResponse,
  type Signals,
} from "@/mind/state/user/relationship/signals";
import type { Intimacy } from "@/mind/state/user/relationship/types";
import type { CheckedLabels, CheckedMove } from "./annotations";
import type { IdiolectPayload } from "./idiolect";
import { embedText, memoryLine, moveText, quoted, type LineMove } from "./memory-line";
import type { Piece } from "./pieces";

export type MemoryPlan = {
  /** The proposition's or idiolect label's id in this conversation; null for her hurt. */
  localId: string | null;
  subject: "user" | "self" | "shared";
  kind: (typeof factKind.enumValues)[number];
  content: string;
  embedText: string;
  occurred_at: Date | null;
  salience: number;
  valence: number;
  confidence: number;
  claim_kind: (typeof claimKind.enumValues)[number] | null;
  mentions: string[];
  threadId: string | null;
  newThread: string | null;
  updates: string | null;
  idiolect: IdiolectPayload | null;
};

export function memoryPlans(
  labels: CheckedLabels,
  all: CheckedLabels,
  pieces: Piece[],
  zone: string,
  settings: Config["extraction"],
): MemoryPlan[] {
  const moves = new Map(all.moves.map((m) => [m.id, m]));
  const times = new Map(all.times.map((t) => [t.id, t]));
  const words = (ids: string[]): LineMove[] =>
    ids
      .map((id) => moves.get(id))
      .filter((m): m is CheckedMove => !!m)
      .sort((a, b) => order(pieces, a) - order(pieces, b))
      .map((m) => ({ speaker: m.speaker, act: m.act, text: moveText(m, pieces) }));

  const propositions = labels.propositions.map((p): MemoryPlan => {
    const said = words(p.moves);
    const resolved = p.times.flatMap((id) => times.get(id)?.resolved ?? []);
    return {
      localId: p.id,
      subject: p.subject,
      kind: p.kind,
      content: memoryLine(p, said, resolved, zone, settings.quote_chars),
      embedText: embedText(p.label, said, settings.quote_chars),
      occurred_at: resolved[0] ? labelInstant(resolved[0], zone) : null,
      salience: p.salience,
      valence: p.valence,
      confidence: p.confidence,
      claim_kind: p.claim_kind,
      mentions: p.mentions,
      threadId: p.thread_id,
      newThread: p.new_thread,
      updates: p.updates,
      idiolect: null,
    };
  });
  const idiolect = labels.idiolect.map((i): MemoryPlan => {
    const said = byPiece(i.pieces, pieces);
    return {
      localId: i.id,
      subject: "shared",
      kind: "idiolect",
      content: quoted(said, settings.quote_chars),
      embedText: said.map((m) => m.text).join(" / "),
      occurred_at: null,
      ...settings.idiolect,
      claim_kind: null,
      mentions: [],
      threadId: null,
      newThread: null,
      updates: null,
      idiolect: { type: i.type, started_by: i.startedBy, established_at: null },
    };
  });
  return [...propositions, ...idiolect];
}

/** What hurt her, in their words: the moves named, or all their new moves when none was. */
export function hurtCause(
  labels: CheckedLabels,
  all: CheckedLabels,
  pieces: Piece[],
  quoteChars: number,
): string {
  const named = new Set(labels.relationship?.hurt?.moves ?? []);
  const theirs = all.moves.filter((m) => m.speaker === "user" && !m.context);
  const hurting = named.size
    ? theirs.filter((m) => named.has(m.id))
    : theirs.filter((m) => labels.moves.includes(m));
  return quoted(
    hurting.map((m) => ({ speaker: m.speaker, act: "states" as const, text: moveText(m, pieces) })),
    quoteChars,
  );
}

/** The relationship, intimacy and bid blocks in the shapes the relationship update reads. */
export function signalsOf(
  labels: CheckedLabels,
  all: CheckedLabels,
  pieces: Piece[],
  quoteChars: number,
): { signals: Signals | null; intimacy: Intimacy | null; bid: BidResponse | null } {
  const r = labels.relationship;
  const signals = r
    ? normalizeSignals({
        ...r,
        hurt: r.hurt && { amount: r.hurt.amount, cause: hurtCause(labels, all, pieces, quoteChars) },
      })
    : null;
  return {
    signals,
    intimacy: normalizeIntimacy(labels.intimacy),
    bid: normalizeBid(labels.bid_response?.response ?? null),
  };
}

function order(pieces: Piece[], m: CheckedMove): number {
  return Math.min(...m.pieces.map((id) => pieces.findIndex((p) => p.id === id)));
}

/** The pieces' words, one quote per run of one speaker, its pieces joined as a move's are. */
function byPiece(ids: string[], pieces: Piece[]): LineMove[] {
  const out: LineMove[] = [];
  for (const id of ids) {
    const p = pieces.find((x) => x.id === id);
    if (!p) continue;
    const last = out.at(-1);
    if (last?.speaker === p.message.speaker) last.text = `${last.text} / ${p.text}`;
    else out.push({ speaker: p.message.speaker, act: "states", text: p.text });
  }
  return out;
}
```

  If a test's expected string differs only in how pieces are joined (" / " within a move,
  "; " between moves), the test is the spec: adjust the code to it. Note that `hurtFactContent`
  then reads "Spica felt hurt because the user said "…"." and `pastHurtContent` still parses it.

- [ ] **Step 5: Encode on labels.** Rewrite `src/mind/memory/user/encode.ts`:
  - **Types:**
    - `PlannedFact` becomes `{ fact: MemoryPlan; embedding; decision; source?: "turn" | "inferred"; grounded?; groundRef? }`.
    - `EncodeInput` replaces `entities` and `threads` with:
      - `labels: CheckedLabels` (this call's);
      - `stored: AnnotationRow[]` (the session's earlier rows);
      - `sessionId: string`;
      - `zone: string`.
    - Keep `exchangeAt`, `now`, `sensitive`, `sourceRef`, `recalled`, `replyTurnId`, `turnIds`.
  - **Entities:** for each `labels.mentions` entry with `refers_to === null && name !== null`,
    call `upsertEntityMention` with:
    - `name`;
    - `aliases`: the words, when they differ from the name;
    - `type`: `type ?? "other"`;
    - `subject`: `subject ?? "user"`;
    - `relation`.

    Collect `entityIds: Map<localId, entityId>`, merged over `entityIdsByLocal(stored)`. Drop
    `withEntitiesNamedInFacts` and `mergeMentions`.
  - **Threads:** for each `labels.threads` action:
    - `open`: `findOpenThreadByTitle`, and touch it if open, else `insertThread` with
      `next_checkpoint` from `t.checkpointAt ? labelInstant(t.checkpointAt, zone) : null`;
    - `touch` and `resolve`: by `getOwnedThread(t.thread_id)`.

    Map the thread id by normalized title, and by each local proposition id in
    `t.propositions`.
  - **Facts:** keep the `duplicate` / `resolves` / `contradicts` / `new` logic exactly as now.
    The row is built from the plan:

```ts
    const row = {
      subject: plan.subject,
      kind: plan.kind,
      content: plan.content,
      payload: plan.idiolect ? { ...sensitive, idiolect: plan.idiolect } : sensitive,
      embedding: planned.embedding,
      entity_refs: [...new Set(plan.mentions.flatMap((id) => entityIds.get(id) ?? []))],
      thread_id:
        plan.threadId ??
        (plan.localId ? threadByProposition.get(plan.localId) : undefined) ??
        (plan.newThread ? threadIds.get(normalizeName(plan.newThread)) : undefined) ??
        null,
      occurred_at: plan.occurred_at,
      created_at: input.exchangeAt,
      salience: plan.salience,
      valence: plan.valence,
      confidence: plan.confidence,
      source: planned.source ?? "turn",
      source_ref: input.sourceRef,
      claim_kind: plan.claim_kind,
      grounded: planned.grounded ?? null,
    };
```

    `insertedFacts` reads `plan.content`. Each fact inserted or merged into is recorded in a
    `factIds: Map<localId, factId>` for the plans with a `localId`.
  - **Annotations:** after the facts, `insertAnnotations(db, userId, toRows(input.labels, { sessionId, exchangeRef: input.replyTurnId ?? input.turnIds.at(-1)!, at: input.exchangeAt, factIds, entityIds }))`.
  - **Then** recall write-back and `markExtracted`, as now.
  - **`insertFact`:** pass every labelled fact through unanchored. A label like "friday drinks"
    would otherwise be anchored. Change `const asSaid = row.kind === "idiolect"` in `facts.ts`
    to read an explicit flag: define
    `AnchorHints = Omit<AnchorContext, "at" | "zone"> & { asSaid?: boolean }`, use
    `const asSaid = hints.asSaid === true || row.kind === "idiolect"`, and pass
    `{ asSaid: true }` from encode. The comment says why: a labelled memory's words are quoted
    as said, and its dates are already tokens.
- [ ] **Step 6: The cold path.** In `cold-path.ts`:
  - **`labelExchange`** replaces `extractExchange`:

```ts
async function labelExchange(deps: Deps, tx: Db, userId: string, turns: Turn[]) {
  const { config } = deps;
  const last = turns.reduce((a, b) => (b.created_at > a.created_at ? b : a));
  const recent = await turnsUpTo(tx, userId, last, config.extraction.window_messages);
  // The conversation so far, with a few turns from before it to read it by.
  const start = recent.findIndex((t) => t.session_id === last.session_id);
  const shown = recent.slice(Math.max(0, start - config.extraction.context_turns));
  const firstNew = shown.findIndex((t) => turns.some((x) => x.id === t.id));
  const pieces = numberPieces(messagesOf(shown), firstNew);
  const stored = await sessionAnnotations(tx, userId, last.session_id);
  const earlier = fromRows(stored, pieces);
  const zone = zoneOrUtc(await getTimezone(tx, userId));
  const labels = await labelStretch(deps, {
    pieces,
    zone,
    threads: await listOpenThreads(tx, userId, config.extraction.open_threads_in_prompt),
    interests: snapshotSection((await deps.core.memory.latestSnapshot())?.content ?? "", "Interests"),
    earlier,
  });
  return {
    labels,
    all: mergeLabels(earlier, labels),
    stored,
    pieces,
    zone,
    sessionId: last.session_id,
    context: shown.slice(0, firstNew),
  };
}
```

    `// ponytail: a deferred reply in another session from the burst reads its own session's labels only; key by conversation layer if that loses links`
  - **In `runColdPath`:**
    - signals: `const { signals: read, intimacy: readIntimacy, bid: readBid } = signalsOf(labels, all, pieces, config.extraction.quote_chars)`;
    - keep the crisis and `!hasUserTurn` nulling;
    - `bidAfter(readBid, context, …)`;
    - candidates: `memoryPlans(labels, all, pieces, zone, config.extraction)` plus `hurtFeeling(hurt, config)`.
  - **`hurtFeeling`** returns a `MemoryPlan` with:
    - `localId: null`;
    - `content: hurtFactContent(hurt.cause)`;
    - `embedText` the same as `content`;
    - `mentions: []`;
    - null links;
    - `idiolect: null`;
    - `source "inferred"` on the candidate.
  - **`reconcileCandidates(deps, tx, userId, candidates, factIdsByLocal(stored))`:**
    - embed `c.fact.embedText`;
    - a plan whose `updates` maps to a stored fact id gets
      `decision = { relation: "contradicts", targetId }` and makes no reconcile call;
    - every other plan is reconciled as now, with `content: c.fact.content`.
  - **`groundClaim`** reads `fact.claim_kind` from the plan (same field name).
  - **`exchangeTone`** gets the plans (they have `subject`, `valence` and `salience`).
  - Delete the imports of `extract`, `Extraction` and `ExtractedFact`.
- [ ] **Step 7: Delete v11.**
  - `git rm src/mind/memory/user/extract.ts tests/mind/memory/user/extract.test.ts`, and
    `git rm -r prompts/extract`.
  - Delete the fake `extract` handler and the `CapturingLLM` `extract` branch.
  - `evals/lib/profile.ts`: replace `"extract"` with `"labels_read", "labels_meaning", "labels_signals"`.
  - `evals/run.ts`: `extractReal: realPurposes.has("labels_signals")`.
  - `package.json`: in every `exit:*` script, `--real extract` becomes
    `--real labels_read,labels_meaning,labels_signals` (so do `exit:user`'s list and any
    `review:*` script that names `extract`; check with
    `grep -n '"extract\|,extract' package.json`).
  - `evals/lib/replay-source.ts` keeps `purpose === "extract"`: it reads the old runs' logs.
  - Run `pnpm typecheck`: every error left is a reader of the old types; fix each one.
- [ ] **Step 8: Migrate the tests.** For each file in `grep -rln "handlers.extract" tests`,
  replace the v11 handler with scripted labels. The pattern, from `cold-path.test.ts`:

```ts
// before
deps.llm.handlers.extract = (input: string) => ({
  facts: input.includes("New exchange") && input.includes("Biscuit") ? [{ subject: "user", kind: "trait", content: "The user's dog is called Biscuit.", … }] : [],
  entities: [{ name: "Biscuit", aliases: [], type: "pet", subject: "user", relation: "dog" }],
  threads: [],
  relationship: null,
});
// after
Object.assign(
  deps.llm.handlers,
  scriptedLabels({
    memories: [
      {
        said: "Biscuit",
        label: "dog Biscuit",
        kind: "trait",
        salience: 0.8,
        valence: 0.6,
        mention: { words: "Biscuit", name: "Biscuit", type: "pet", relation: "dog" },
      },
    ],
  }),
);
```

  - A memory whose `said` words aren't in a new message is not made, which replaces the old
    `input.includes("New exchange")` guards.
  - An assertion on `content` now expects the line (`dog Biscuit — the user said "my dog
    Biscuit ate my headphones"`); write the exact expected line.
  - A handler counting calls or throwing moves to `labels_read` (it runs first).
  - `relationship: rel` becomes `relationship: { ...rel, hurt: rel.hurt && { amount: rel.hurt.amount } }`.
  - Never weaken an assertion to pass: an assertion that no longer means anything (it tested
    v11's anchoring or its field names) is deleted, with the test, and noted in the commit
    message.
  - `encode.test.ts`: rewrite its cases against `encodeExtraction` with labels built through
    `scriptedLabels` + `checkLabels`, as in `label-memory.test.ts`. Keep each behaviour it
    covered: a duplicate bumps, resolves, contradicts, a newer target wins, entities upsert,
    threads open, touch and resolve, recall write-back. Add:
    - (a) `updates` supersedes the earlier fact with no reconcile call;
    - (b) annotations are written with `fact_id` on the proposition row.
  - `idiolect-encode.test.ts`: script `idiolect: [{ said, type }]`.
  - Add the two Review Focus cases to `cold-path.test.ts`:
    - (3) a `labels_meaning` handler that throws leaves no fact, no annotation and no
      extracted turn, and `runColdPathJob` counts the attempt;
    - (2) a reach-out alone stores her words' labels and moves nothing in the relationship
      (keep or adapt the existing reach-out test).
- [ ] **Step 9: Run the affected tests**

Run: `pnpm test tests/mind/memory tests/mind/process/cold-path tests/mind/state tests/mind/platform`
Then: `pnpm test tests/exit tests/evals --maxWorkers=4`
Expected: PASS. A failure means fixing the code or the script, never weakening an assertion.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(memory): the cold path labels each exchange and stores memories as lines; extract v11 deleted"
```

---

### Task 9: Glosses from time labels, and thread lines that keep the event apart (B131)

**Files:**
- Modify: `src/mind/process/hot-path/assemble.ts`, `src/mind/process/hot-path/compose.ts`,
  `src/mind/platform/time-anchors.ts` (delete `said`), `src/mind/process/user/inputs.ts`,
  `src/db/repos/user/threads.ts`
- Test: `tests/mind/process/hot-path/assemble.test.ts` (or wherever `viewTurns` is tested:
  `grep -rln viewTurns tests`), `tests/mind/process/user/inputs.test.ts`,
  `tests/mind/platform/time-anchors.test.ts`

**Interfaces:**
- Consumes: `timeLabelsOn` (Task 5), `labelToken` (Task 6).
- Produces:
  - `type Gloss = { turnId: string; start: number; end: number; token: string }`
  - `viewTurns(turns: { id?: string; text: string; created_at?: Date }[], now: Date, zone: string, glosses?: Gloss[]): string[]`
  - `glossesOf(rows: AnnotationRow[], zone: string): Gloss[]` (in `assemble.ts`)
  - `AssembleInput.glosses?: Gloss[]`
  - `listOpenThreads` returns `event_at: Date | null` (its latest active fact's
    `occurred_at`).
  - `threadLines` writes `title (on ⟦event⟧; ask after ⟦checkpoint⟧)`.

- [ ] **Step 1: Write the failing tests.**

  `viewTurns`:

```ts
test("an older message's time words are glossed from its time label, and nothing else is parsed", () => {
  const now = new Date("2026-01-09T12:00:00Z");
  const turn = { id: "t1", text: "see you thursday, tomorrow works too", created_at: new Date("2026-01-07T20:00:00Z") };
  const glosses = [{ turnId: "t1", start: 8, end: 16, token: "⟦2026-01-08|day|UTC|thursday⟧" }];
  expect(viewTurns([turn], now, "UTC", glosses)).toEqual([
    "— ⟦2026-01-07|day|UTC⟧ —\nsee you ⟦2026-01-08|day|UTC|thursday⟧, tomorrow works too",
  ]);
  // Without a label, an older message reads as typed.
  expect(viewTurns([turn], now, "UTC")).toEqual([
    "— ⟦2026-01-07|day|UTC⟧ —\nsee you thursday, tomorrow works too",
  ]);
});
```

  `threadLines`:

```ts
test("a thread line keeps the event's day apart from when to ask", () => {
  const lines = threadLines(
    [{ title: "half marathon", event_at: new Date("2026-01-11T12:00:00Z"), next_checkpoint: new Date("2026-01-12T09:00:00Z") }],
    "UTC",
  );
  expect(lines).toEqual(["half marathon (on ⟦2026-01-11|day|UTC⟧; ask after ⟦2026-01-12|day|UTC⟧)"]);
});
```

  In `time-anchors.test.ts`, delete the cases that pass `said: true`: the code they test goes.
- [ ] **Step 2: Run them to see them fail**

Run: `pnpm test <the viewTurns test file> tests/mind/process/user/inputs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `assemble.ts`:

```ts
export type Gloss = { turnId: string; start: number; end: number; token: string };

/** Each time label on an older message, as a token that keeps the words and dates them. */
export function glossesOf(rows: AnnotationRow[], zone: string): Gloss[] {
  return rows.flatMap((r) => {
    const t = r.data as CheckedTime;
    const c = r.coords[0];
    return c && t.resolved ? [{ ...c, token: labelToken(t.resolved, zone, t.words) }] : [];
  });
}
```

    In `viewTurns`, the line that calls `anchorTimes` becomes:

```ts
    const own = (glosses ?? []).filter((g) => g.turnId === t.id);
    const text = day === today ? t.text : glossed(t.text, own);
```

    and add this helper below it:

```ts
/** The words at each gloss replaced by its token, last first so earlier ranges stay put. */
function glossed(text: string, glosses: Gloss[]): string {
  return [...glosses]
    .sort((a, b) => b.start - a.start)
    .reduce((out, g) => out.slice(0, g.start) + g.token + out.slice(g.end), text);
}
```

    Update the `viewTurns` header comment: older messages are glossed from their time labels;
    nothing is parsed. Add `id?: string` to `recentTurns` items and `glosses?: Gloss[]` to
    `AssembleInput`, and pass `input.glosses` in `conversationMessages`. Remove the
    `anchorTimes` import.
  - `compose.ts`: after `recent` is loaded (line ~161),
    `const glosses = glossesOf(await timeLabelsOn(deps.db, userId, recent.map((t) => t.id)), theirZone);`
    (the user's zone, as `viewTurns` already uses). Pass `glosses` into the assemble input,
    and as the fourth argument of the guard's `viewTurns` call (~568).
  - `time-anchors.ts`: delete `said` from `AnchorContext` and every `ctx.said` branch (lines
    ~246, ~261, ~319, ~362), and simplify `token` to `formatToken(local, precision, ctx.zone)`.
    Keep the `said` field of `formatToken` and of `renderTimes`: glosses use it.
  - `threads.ts`: add `f.occurred_at` to the `latestFact` lateral select, select
    `lf.occurred_at AS event_at` in `listOpenThreads`, and return `event_at`.
  - `inputs.ts`:

```ts
/** Open storylines: the event's day apart from when to ask, so a check-in never reads as the event. */
export function threadLines(
  threads: { title: string; event_at?: Date | null; next_checkpoint: Date | null }[],
  tz: string | null,
): string[] {
  const zone = zoneOrUtc(tz);
  return threads.map((t) => {
    const parts = [
      ...(t.event_at ? [`on ${dateToken(t.event_at, zone)}`] : []),
      ...(t.next_checkpoint ? [`ask after ${dateToken(t.next_checkpoint, zone)}`] : []),
    ];
    return parts.length ? `${t.title} (${parts.join("; ")})` : t.title;
  });
}
```

    Check every `threadLines` caller (`grep -rn threadLines src`) passes `listOpenThreads`
    rows, so `event_at` arrives.
- [ ] **Step 4: Run the tests**

Run: `pnpm test tests/mind/process/hot-path tests/mind/process/user tests/mind/platform/time-anchors.test.ts tests/db`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(reply): older messages glossed from their time labels; thread lines keep the event apart from the check-in"
```

---

### Task 10: Phase 17b exit test and the full suite

**Files:**
- Create: `tests/exit/phase-17b.test.ts`

- [ ] **Step 1: Write the exit test.** All fake (fake reply, fake guard, scripted labels), real
  test DB. Use the helpers from `cold-path.test.ts` (`exchange` turns via `insertTurn`,
  `makeTestDeps`, `ScriptedEmbedder`) and the canary pattern from `phase-15d.test.ts`.
  Scenarios:

```ts
/**
 * Phase 17b exit, all fake: the cold path labels each exchange and keeps its labels apart from
 * the words; a memory is its line (label, date token, words); a later exchange sees what is
 * already labelled and can update a memory by id; older messages are glossed from their time
 * labels; a thread line keeps the event apart from the check-in; a bad label value drops only
 * itself. A's labels never reach a core loop, and A's exchange leaves core unchanged.
 */
```

  1. **"two exchanges in one conversation: the second call sees the first's labels".** Run
     exchange 1 ("i have an interview thursday") with a scripted `id: "p-int"` memory, then
     exchange 2 in the same `session_id`. Assert the second `labels_read` input contains
     `Already labelled` and `p-int`, and that `annotation` holds rows of layers move, time and
     proposition with `fact_id` set on the proposition.
  2. **"'they moved it to friday' updates the interview by id, with no reconcile call".**
     Exchange 2 scripts `{ said: "friday now", label: "job interview", updates: "p-int", time: { words: "friday", unit: "weekday", shift: 1, weekday: "friday" } }`.
     Assert the first fact is `superseded` by the new one, the new content holds the Friday
     token, and `structuredCalls` has no `reconcile` purpose for it.
  3. **"a memory reaches the reply as its line".** After exchange 1, compose a reply (follow
     how `tests/exit/phase-16c.test.ts` or `compose` tests build one with the fake reply) on a
     later day. Assert the reply prompt (`d.llm.calls.at(-1).system`) contains
     `job interview, planned` and `the user said "i have an interview thursday"`, and the
     rendered date ("Thursday 8 January"), not the raw token.
  4. **"an older message is glossed from its time label".** In that same reply's messages,
     the user turn reads `i have an interview thursday (that's …Thursday 8 January)` after
     rendering.
  5. **"a thread line keeps the event apart from the check-in".** Script a thread `open` with
     a checkpoint time and the proposition. A user-mind input's `threadLines` (call
     `threadLines(await listOpenThreads(...), "UTC")`) holds `on …; ask after …`.
  6. **"a bad value drops one label".** Script `act: "shrugs"` on one memory's move. That
     memory is not written, its drop is logged as `bad_value`, and the other memory in the
     same exchange is written.
  7. **"leak canary and side channel".** User A's exchange text holds the token. Run A's cold
     path with `CapturingLLM` and dump the core tables before and after (`coreDump` as in
     15d): unchanged. No `core_*` purpose in `CapturingLLM.seen` contains the token. User B's
     exchange's prompts never contain it. A's `annotation` and `fact` rows do (so the canary
     really reached A).

- [ ] **Step 2: Run it**

Run: `pnpm test tests/exit/phase-17b.test.ts`
Expected: PASS. A scenario that fails is fixed in the code, never by loosening it.

- [ ] **Step 3: Full checks, in foreground parts**

Run: `pnpm typecheck; pnpm lint; pnpm format`
Run: `pnpm test tests/mind --maxWorkers=4`, then `pnpm test tests/db --maxWorkers=4`, then `pnpm test tests/exit --maxWorkers=4`, then `pnpm test tests/evals --maxWorkers=4`
Run: `pnpm eval --llm=fake --compare`
Expected: all green, and `tests/exit/mind-split.test.ts` (the leak canary) passes. A fake
eval baseline that moved is checked by hand: a change explained by labels (content lines,
counts) is accepted with `--update` only after reading the diff, and noted in the commit.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(exit): Phase 17b exit: labels as memory, with the leak canary"
```

---

### Task 11: Close (spica-close)

- [ ] **Step 1:** Run the `spica-close` skill. It runs the definition of done in order and
  stops at the first failure.
- [ ] **Step 2: Spec write-back** in `spica-design-spec-v3.md`:
  - **§6.1:**
    - `annotation` (columns as in Task 5);
    - `fact.content` for labelled facts is the memory line;
    - the 16b/16c anchoring text applies only to her notes now.
  - **§10.4 step 1:** labelling replaces extract:
    - three calls (`labels_read`, `labels_meaning`, `labels_signals`), thinking,
      `prompts.labels` v1;
    - `updates` supersedes directly;
    - B134 and B136 as built;
    - the window keys.
  - **§12.3:** labelled memories carry code-resolved date tokens, so the extraction anchoring
    and `when_direction` are gone.
  - **§20 row:** 17b built.
  - **§25:** B133–B136 moved to `docs/spec-v3-history.md` with their resolution.
- [ ] **Step 3: `DECISIONS.md` rows.** Add one each for:
  - B134's rule;
  - B136's sieve;
  - the line built at write time (the label and words never change; dates render per prompt);
  - the window (`window_messages`, `context_turns`);
  - the idiolect weights in config;
  - the hurt words falling back to all new user moves;
  - the fake labels' hash ids;
  - the session-keyed "already labelled" (the ponytail).
- [ ] **Step 4: `scope-reviewer` on the diff** (`main..phase-17b`). Tell it not to run tests.
  Fix what it finds.
- [ ] **Step 5: Close run** `review:world-outreach`, through `review-run` with Ethan's
  go-ahead. Afterwards:
  - a findings section in a new `evals/results/analysis-<date>-phase-17b.md`;
  - the **16d re-check**: B1, B129, B130, B131 and B132 each closed with evidence from the run,
    or kept with a target.
- [ ] **Step 6:**
  - Update `CLAUDE.md`'s current phase and the history doc row.
  - Delete this plan and the 17b design doc (history is in git).
  - Commit, merge to `main` and push, with Ethan's OK.
