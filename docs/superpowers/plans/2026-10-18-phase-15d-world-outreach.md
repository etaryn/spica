# Phase 15d: World, Outreach, Posts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Her own news reaches people, reach-outs know when things happen, her world and mind
vary, the night is one block, and her posts come from working sources with fixed captions and a
skill Ethan sets.

**Architecture:** Changes stay inside the existing modules: outreach candidates/inputs/send and
the reach-out prompt; the guard input; the reply's "Your day"; world blocks, events and plans;
core wander; the post engine (words, browse, sources, craft skill). Two migrations
(`world_event.subject`, `web_find.image_sha256`). Eval tooling gains a simulated user.

**Tech Stack:** TypeScript, Next.js, Postgres 16 + Drizzle, pg-boss, Vitest, pnpm, sharp.

**Spec:** `docs/2026-10-18-phase-15d-world-outreach-design.md` (read it first; this plan argues
from it). Project rules: `CLAUDE.md`.

## Global Constraints

- `src/mind` is framework-free: no `Date.now()`, no `process.env`; time from the injected clock.
- Every numeric constant goes in `config/default.json` with its zod schema in
  `src/mind/platform/config.ts`. Every prompt is a versioned file under `prompts/`; bump the
  version in `config.prompts` and **delete the old version file** (nothing configures it).
- Comments say why, never cite spec sections, phases or backlog numbers.
- Every file starts with a short plain-English header (existing files: keep it accurate).
- Prettier at 100 columns; `pnpm lint` must pass.
- Core-only code takes `CoreDeps` (no `db`); core loops never read user data (scope rules V2–V6).
- Run one test process at a time (shared test DB); a full `pnpm test` takes ~10 minutes.
- Migrations: edit `src/db/schema.ts`, then `pnpm db:generate`, and rename the generated file to
  the next number with a descriptive name (`0037_world_event_subject.sql`,
  `0038_find_image_hash.sql`), keeping `meta/_journal.json` consistent with the name.
- Commit after each task; end commit messages with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A thread with no live fact about them (only her own facts, or none): the topic key must still
  be stable (`@none`), not throw. (Test in Task 3.)
- A `her_day` memory whose `source_ref` isn't a world event (a loop memory) and is too deep: it
  stays filtered `too_deep`, never falls back to empty text. (Test in Task 6.)
- No plan for tomorrow when joining the night (tomorrow's plan not generated yet): today's block
  ends at 24:00 as before, no throw. (Test in Task 9.)
- A weekly feed with an empty channel or an item without an image enclosure: the source returns
  null, browse writes nothing. (Test in Task 14.)
- A caption with no space before the limit (one long word): the cut still returns non-empty text
  within the limit. (Test in Task 13.)

---

### Task 1: Eval tooling: commit the run logging, add the simulated user

The run logging, reach-out tick review and rotating replies are already in the working tree
(uncommitted). This task commits them and adds `user_replies.simulate`.

**Files:**
- Modify: `evals/lib/script.ts` (OutreachScript), `evals/lib/life-loop.ts` (autoReplies),
  `evals/run.ts` (fake `sim_user` handler), `evals/lib/profile.ts` (ALL_PURPOSES),
  `evals/scripts/world-outreach-two-weeks.yaml`, `config/default.json`,
  `src/mind/platform/config.ts` (prompts.sim_user)
- Create: `prompts/eval/sim-user/v1.md`, `evals/lib/sim-user.ts`, `tests/evals/sim-user.test.ts`

**Interfaces:**
- Produces: `simUserInput(card: string, turns: { role: "user" | "companion"; text: string }[]): string`
  and `SimUserSchema = z.object({ text: z.string() })` in `evals/lib/sim-user.ts`.

- [ ] **Step 1: Commit the existing tooling**

```bash
git add evals/lib/life-loop.ts evals/lib/outreach-check.ts evals/lib/review.ts evals/lib/script.ts evals/run.ts package.json tests/evals/outreach-check.test.ts evals/scripts/world-outreach-two-weeks.yaml docs/2026-10-18-phase-15d-world-outreach-design.md docs/superpowers/plans/2026-10-18-phase-15d-world-outreach.md spica-design-spec-v3.md
git commit -m "chore(evals): real runs dump the DB and trace; reach-out ticks in the review; 15d design doc and plan"
```

- [ ] **Step 2: Write the failing test**

`tests/evals/sim-user.test.ts`:

```ts
/** The simulated user's input: their card, then the conversation, her latest message last. */
import { expect, test } from "vitest";
import { simUserInput } from "../../evals/lib/sim-user";

test("card first, turns in order, her reach-out last", () => {
  const input = simUserInput("Sam, 27, designer.", [
    { role: "user", text: "big week" },
    { role: "companion", text: "how did thursday go" },
  ]);
  expect(input.indexOf("Sam, 27")).toBeLessThan(input.indexOf("big week"));
  expect(input.trim().endsWith("Spica: how did thursday go")).toBe(true);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm vitest run tests/evals/sim-user.test.ts`
Expected: FAIL (cannot find module `evals/lib/sim-user`).

- [ ] **Step 4: Implement**

`evals/lib/sim-user.ts`:

```ts
/**
 * The simulated user: answers her reach-outs in an eval from a short card about who they are and
 * the conversation so far, so an answer fits what she asked. Eval-only; every call goes through
 * the run's provider, so a real run logs it like any other.
 */
import { z } from "zod";

export const SimUserSchema = z.object({ text: z.string() });

export function simUserInput(
  card: string,
  turns: { role: "user" | "companion"; text: string }[],
): string {
  const convo = turns.map((t) => `${t.role === "user" ? "You" : "Spica"}: ${t.text}`).join("\n");
  return `Who you are:\n${card}\n\nThe conversation so far (oldest first):\n${convo}`;
}
```

`prompts/eval/sim-user/v1.md`:

```markdown
You are playing a person texting their friend Spica, for a test. Stay in character from the card.
Answer her latest message the way this person would text: short, casual, sometimes off-topic or
distracted, never an assistant. Only say things consistent with the card and the conversation;
when she asks about something, answer it plainly (it can have gone well, badly or not happened).
Return JSON: {"text": string}, one message.
```

`config/default.json` → `"prompts"`: add `"sim_user": "v1"`; `src/mind/platform/config.ts`
prompts schema: add `sim_user: text` (match the neighbouring keys' validator).

`evals/lib/script.ts` OutreachScript: add

```ts
  /** A card about the user: when set, a model plays them and writes each answer (`sim_user`). */
  simulate: z.string().min(1).optional(),
```

`evals/lib/life-loop.ts` in `autoReplies`, replace the `receiveMessage` text with a simulated
answer when `o.script.simulate` is set:

```ts
      const text = o.script.simulate
        ? await simulatedAnswer(deps, r.user_id, o.script.simulate)
        : texts[handled.size % texts.length]!;
      await receiveMessage(deps, r.user_id, { clientMessageId: randomUUID(), text });
```

and add in the same file:

```ts
/** The simulated user's answer to her latest message, from their card and the recent turns. */
async function simulatedAnswer(deps: Deps, userId: string, card: string): Promise<string> {
  const turns = await recentTurns(deps.db, userId, deps.config.chat.recent_turns);
  const out = await deps.llm.classifyJson({
    purpose: "sim_user",
    model: "cheap",
    system: loadPrompt("eval/sim-user", deps.config.prompts.sim_user),
    input: simUserInput(
      card,
      turns.map((t) => ({ role: t.role, text: t.text })),
    ),
    schema: SimUserSchema,
    timeoutMs: deps.config.models.structured_timeout_ms,
    maxTokens: 300,
  });
  return out.text.trim() || "haha";
}
```

(imports: `recentTurns` from `@/db/repos/user/session-log`, `loadPrompt` from
`@/mind/platform/prompts`, `simUserInput, SimUserSchema` from `./sim-user`. `maxTokens` 300 is
eval-only and stays a literal.)

`evals/lib/profile.ts`: add `"sim_user"` to `ALL_PURPOSES`. `evals/run.ts` `fakeProvider`: after
constructing, set the fake's handler so fake runs answer with the first canned line:

```ts
const fakeProvider = () => {
  const fake = new FakeLLMProvider({
    classify: (input) => keywordClassifier(config.safety.keywords)(messageToJudge(input)),
  });
  fake.handlers.sim_user = () => ({ text: "haha yes! tell me more" });
  return fake;
};
```

`evals/scripts/world-outreach-two-weeks.yaml`: under `outreach:` replace `reply_text:` with

```yaml
  simulate: >
    Sam, 27, they/them, a designer interviewing for a role at a small studio. Introverted, drinks a
    lot of coffee, honest and a bit dry. Training for a half marathon on Sunday 11 January; their
    sister visits the weekend of 17 January. The interview on Thursday 8 January went fine and
    they got a take-home task; the studio is slow to reply.
```

- [ ] **Step 5: Run tests and a fake eval**

Run: `pnpm vitest run tests/evals/sim-user.test.ts tests/evals/outreach-check.test.ts` → PASS.
Run: `pnpm eval --llm=fake --only world-outreach-two-weeks` → `PASS`.
Run: `pnpm typecheck && pnpm lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add -A evals prompts/eval config/default.json src/mind/platform/config.ts tests/evals/sim-user.test.ts
git commit -m "feat(evals): a simulated user answers reach-outs (sim_user, logged like any real call)"
```

---

### Task 2: Relative dates in her zone

**Files:**
- Modify: `src/mind/platform/relative-date.ts`, `src/mind/process/hot-path/assemble.ts:164,262`,
  `src/mind/world/events.ts:132`
- Test: `tests/mind/platform/relative-date.test.ts` (create if missing; else extend)

**Interfaces:**
- Produces: `relativeDate(when: Date, now: Date, tz: string): string` and
  `dayInWords(when: Date, now: Date, tz: string): string` → `"Sunday 11 January, yesterday"`.

- [ ] **Step 1: Write the failing test**

```ts
import { expect, test } from "vitest";
import { dayInWords, relativeDate } from "@/mind/platform/relative-date";

test("days are counted in her zone, not UTC", () => {
  // 23:30 UTC on the 10th is the 11th in Singapore; "now" is 09:00 on the 12th there.
  const when = new Date("2026-01-10T23:30:00Z");
  const now = new Date("2026-01-12T01:00:00Z");
  expect(relativeDate(when, now, "Asia/Singapore")).toBe("yesterday");
  expect(relativeDate(when, now, "UTC")).toBe("2 days ago");
});

test("dayInWords names the weekday and date with the relative day", () => {
  const when = new Date("2026-01-11T09:00:00Z");
  const now = new Date("2026-01-12T10:00:00Z");
  expect(dayInWords(when, now, "UTC")).toBe("Sunday 11 January, yesterday");
  expect(dayInWords(new Date("2026-01-14T09:00:00Z"), now, "UTC")).toBe(
    "Wednesday 14 January, in 2 days",
  );
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm vitest run tests/mind/platform/relative-date.test.ts` → FAIL (wrong arity / missing export).

- [ ] **Step 3: Implement**

```ts
import { DAY } from "./time";
import { localDateString } from "./timezone";
/**
 * Dates as she would say them: "today", "yesterday", "3 days ago", "in 2 days", counted in whole
 * calendar days of the given zone (hers, so "yesterday" is her yesterday).
 */

export function relativeDate(when: Date, now: Date, tz: string): string {
  const days = Math.round((dayStart(now, tz) - dayStart(when, tz)) / DAY);

  if (days < 0) return `in ${-days} day${days === -1 ? "" : "s"}`;
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/** "Sunday 11 January, yesterday": the date itself and how far it is from now. */
export function dayInWords(when: Date, now: Date, tz: string): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  })
    .format(when)
    .replace(",", "");
  return `${date}, ${relativeDate(when, now, tz)}`;
}

function dayStart(at: Date, tz: string): number {
  return Date.parse(`${localDateString(at, tz)}T00:00:00Z`);
}
```

Callers: pass her zone. In `assemble.ts` the input already has `now`; add
`timezone: string` to `AssembleInput` (set in `compose.ts` from
`lifeTimezone(config.life, clock.now())`) and call `relativeDate(x, now, input.timezone)`. In
`events.ts` `buildEventInput` add a `tz: string` parameter (caller passes
`lifeTimezone(config.life, now)`).

- [ ] **Step 4: Run** the new test plus `tests/mind/process/hot-path/assemble.test.ts` and
  `tests/mind/world/events.test.ts` → PASS (fix fixtures that call `assemblePrompt` /
  `buildEventInput` to pass `timezone: "UTC"` / `"UTC"`).

- [ ] **Step 5: Commit** — `git commit -m "feat(time): relative dates count her days"`

---

### Task 3: Candidates carry their dates; one reach-out per thread

**Files:**
- Modify: `src/mind/process/outreach/types.ts`, `src/mind/process/outreach/candidates.ts`,
  `src/mind/process/outreach/inputs.ts`, `src/db/repos/user/threads.ts`,
  `src/db/repos/user/facts.ts` (outreachCols), `config/default.json`, `src/mind/platform/config.ts`
- Test: `tests/mind/process/outreach/candidates.test.ts`, `tests/db/threads.test.ts` (or the
  existing threads repo test file)

**Interfaces:**
- Produces: `type Note = { text: string; at: string; dated: boolean }` (ISO `at`);
  `Candidate.notes: Note[]`; `CandidateInputs.dueThreads[i].facts: { id: string; content: string; at: Date; dated: boolean }[]`;
  `CandidateInputs.userEvents[i].occurred_at: Date | null`;
  repo `threadUserFacts(db, userId, threadId, limit): Promise<{ id; content; occurred_at: Date | null; created_at: Date }[]>`.

- [ ] **Step 1: Write the failing tests** (in `candidates.test.ts`; update `empty()` unchanged)

```ts
test("a thread's topic is keyed on its newest fact about them, and carries dated notes", () => {
  const i = empty();
  const cp = new Date("2026-01-10T09:00:00Z");
  i.dueThreads = [
    {
      id: "t1",
      title: "half marathon",
      detail: null,
      stakes: "med",
      next_checkpoint: cp,
      fact_id: "f9",
      sensitive: false,
      facts: [
        { id: "f2", content: "The user is running a half marathon on Sunday.", at: new Date("2026-01-11T09:00:00Z"), dated: true },
        { id: "f1", content: "The user is training.", at: new Date("2026-01-05T10:00:00Z"), dated: false },
      ],
    },
  ];
  const [c] = buildCandidates(i, cfg, now);
  expect(c!.topic).toBe("thread:t1@f2");
  expect(c!.notes).toEqual([
    { text: "The user is running a half marathon on Sunday.", at: "2026-01-11T09:00:00.000Z", dated: true },
    { text: "The user is training.", at: "2026-01-05T10:00:00.000Z", dated: false },
  ]);
});

test("a thread with no fact about them keys on none", () => {
  const i = empty();
  i.dueThreads = [
    { id: "t1", title: "x", detail: null, stakes: "high", next_checkpoint: now, fact_id: null, sensitive: false, facts: [] },
  ];
  expect(buildCandidates(i, cfg, now)[0]!.topic).toBe("thread:t1@none");
});

test("a user event carries its date", () => {
  const i = empty();
  i.userEvents = [
    { id: "f1", content: "Sister visits.", salience: 0.6, sensitive: false, occurred_at: new Date("2026-01-09T12:00:00Z") },
  ];
  expect(buildCandidates(i, cfg, now)[0]!.notes).toEqual([
    { text: "Sister visits.", at: "2026-01-09T12:00:00.000Z", dated: true },
  ]);
});
```

Also update the existing "due thread" test: its topic expectation becomes `thread:t1@none`
(its threads have no `facts`; add `facts: []` to both fixtures).

- [ ] **Step 2: Run** → FAIL (`facts`/`notes` unknown).

- [ ] **Step 3: Implement**

`types.ts`: add `export type Note = { text: string; at: string; dated: boolean };`, add
`notes: Note[];` to `Candidate` (doc: "What she knows behind the topic, each with when; rendered
in her words at compose time."), add `facts: { id: string; content: string; at: Date; dated: boolean }[];`
to `dueThreads` items and `occurred_at: Date | null;` to `userEvents` items.

`candidates.ts` thread loop:

```ts
  for (const thread of inputs.dueThreads) {
    if (thread.stakes !== "high" && thread.stakes !== "med") continue;
    const facts = thread.facts.slice(0, settings.reason_facts);

    raw.push({
      kind: "thread",
      // Keyed on what they last said about it: her own reach-out adds nothing about them, so the
      // thread goes out once until they bring it up again.
      topic: `thread:${thread.id}@${facts[0]?.id ?? "none"}`,
      text: thread.detail ? `${thread.title} (latest: ${thread.detail})` : thread.title,
      strength: settings.stakes_strength[thread.stakes],
      factId: thread.fact_id,
      coreMemoryId: null,
      threadId: thread.id,
      sensitive: thread.sensitive,
      notes: facts.map((f) => ({ text: f.content, at: f.at.toISOString(), dated: f.dated })),
    });
    if (thread.fact_id) claimedFacts.add(thread.fact_id);
  }
```

user_event: `notes: memory.occurred_at ? [{ text: memory.content, at: memory.occurred_at.toISOString(), dated: true }] : []`.
Every other kind: `notes: []` (her_day gets its note in Task 6). Update the file header: topic
keys and notes.

`threads.ts` add:

```ts
/** The live facts about them on a thread, newest first: what she knows behind a follow-up. */
export async function threadUserFacts(db: Db, userId: string, threadId: string, limit: number) {
  return db
    .select({ id: fact.id, content: fact.content, occurred_at: fact.occurred_at, created_at: fact.created_at })
    .from(fact)
    .where(
      and(
        eq(fact.user_id, userId),
        eq(fact.thread_id, threadId),
        eq(fact.subject, "user"),
        eq(fact.scope, "private"),
        notInArray(fact.status, ["superseded", "stale"]),
      ),
    )
    .orderBy(desc(fact.created_at))
    .limit(limit);
}
```

`facts.ts`: add `occurred_at: fact.occurred_at` to `outreachCols` and
`occurred_at: Date | null` to `OutreachFact`.

`inputs.ts` `dueThreads` mapping becomes async per thread:

```ts
    dueThreads: await Promise.all(
      due.map(async (thread) => ({
        id: thread.id,
        title: thread.title,
        detail: thread.content,
        stakes: thread.stakes,
        next_checkpoint: thread.next_checkpoint,
        fact_id: thread.fact_id,
        sensitive: thread.sensitive,
        facts: (await threadUserFacts(db, userId, thread.id, settings.reason_facts)).map((f) => ({
          id: f.id,
          content: f.content,
          at: f.occurred_at ?? f.created_at,
          dated: f.occurred_at !== null,
        })),
      })),
    ),
```

Config: `outreach.reason_facts: 3` (`positiveInt`).

- [ ] **Step 4: Run** `pnpm vitest run tests/mind/process/outreach` → PASS (fix `inputs.test.ts`
  / `tick.test.ts` topic expectations that assumed `@<checkpoint>`; a thread test now expects
  `@<fact id>` or `@none`).

- [ ] **Step 5: Commit** — `git commit -m "feat(outreach): candidates carry dated notes; a thread goes out once until they revive it"`

---

### Task 4: The reach-out prompt carries the reason with dates, last

**Files:**
- Modify: `src/mind/process/hot-path/compose.ts` (`ReachOutTrigger`, `renderReachOut`, call site),
  `config/default.json` (`prompts.reach_out` v3)
- Create: `prompts/reach-out/v3.md`; Delete: `prompts/reach-out/v2.md`
- Test: `tests/mind/process/hot-path/compose.test.ts`

**Interfaces:**
- Consumes: `Candidate.notes` (Task 3), `dayInWords` (Task 2).
- Produces: `ReachOutTrigger = Pick<Candidate, "kind" | "text" | "factId" | "threadId" | "coreMemoryId"> & { notes?: Note[] }`;
  `renderReachOut(markdown, trigger, now: Date, tz: string): { slot: string; cue: string; reason: string }`
  (`reason` is the topic plus dated notes; Task 5 hands it to the guard).

- [ ] **Step 1: Write the failing test**

```ts
test("renderReachOut: the reason carries dated notes, and the cue repeats the topic", () => {
  const r = renderReachOut(
    loadPrompt("reach-out", "v3"),
    {
      kind: "thread",
      text: "half marathon",
      factId: null,
      threadId: "t1",
      coreMemoryId: null,
      notes: [
        { text: "The user is running a half marathon on Sunday.", at: "2026-01-11T09:00:00.000Z", dated: true },
        { text: "The user is training.", at: "2026-01-05T10:00:00.000Z", dated: false },
      ],
    },
    new Date("2026-01-12T10:00:00Z"),
    "UTC",
  );
  expect(r.reason).toContain("The user is running a half marathon on Sunday. (Sunday 11 January, yesterday)");
  expect(r.reason).toContain("The user is training. (they told you 7 days ago)");
  expect(r.slot).toContain(r.reason);
  expect(r.slot).toContain("not about your last conversation");
  expect(r.cue).toContain("about: half marathon");
});
```

Update the existing check-in test to call `renderReachOut(loadPrompt("reach-out", "v3"), trigger, now, "UTC")`.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`prompts/reach-out/v3.md` (same `## key` format as v2; header comment updated to v3):

```markdown
<!-- prompts/reach-out/v3.md: slot 7b ("Why you're writing") and the trailing cue. Each `## key` holds bullet lines; `slot` and `cue` lines are joined, `{{reason}}`, `{{topic}}` and `{{guidance}}` are filled in. -->
## slot
- Nobody wrote to you: you're texting them first, because something is on your mind.
- On your mind: {{reason}}
- {{guidance}}
- Your message is about this, not about your last conversation with them.
- Write one short opener the way you'd text a friend, not a recap and not a list of questions.
- Never mention that they've been quiet, haven't written, or owe you a reply.

## cue
- [You're texting them first, about: {{topic}}. Write only your message.]

## thread
- Something they told you about has reached the point where you'd naturally ask how it went. Check the dates: if it's already happened, ask how it went, not how they feel about it coming up.

## make_up
- Things were left hurt between you. You're reaching out first to make up; keep it warm and simple.

## user_event
- Something they mentioned should have happened by now, and you're curious how it went.

## her_day
- Something from your own day that you'd want to tell a friend about.

## check_in
- It's been a while since you talked. Just say hi; nothing heavier, and don't comment on the gap.

## core_thought
- Something you've been thinking about on your own that you'd want to share with a friend.

## user_idea
- Something you'd been meaning to bring up with them.
```

`compose.ts`:

```ts
export type ReachOutTrigger = Pick<
  Candidate,
  "kind" | "text" | "factId" | "threadId" | "coreMemoryId"
> & { notes?: Note[] };

/**
 * Fills the reach-out prompt file's `slot` and `cue`: the topic with what she knows behind it,
 * each dated in her words, so a past event never reads as upcoming. The cue repeats the topic,
 * since it is the last thing she reads.
 */
export function renderReachOut(
  markdown: string,
  trigger: ReachOutTrigger,
  now: Date,
  tz: string,
): { slot: string; cue: string; reason: string } {
  const phrases = parseSummaryPhrases(markdown);
  const topic = trigger.text || "just saying hi";
  const notes = (trigger.notes ?? []).map((n) => {
    const at = new Date(n.at);
    const when = n.dated ? dayInWords(at, now, tz) : `they told you ${relativeDate(at, now, tz)}`;
    return `- ${n.text} (${when})`;
  });
  const reason = notes.length ? `${topic}\n${notes.join("\n")}` : topic;
  const guidance = (phrases[trigger.kind] ?? []).join(" ");
  const fill = (line: string) =>
    line
      .replace("{{reason}}", () => reason)
      .replace("{{topic}}", () => topic)
      .replace("{{guidance}}", () => guidance);
  return {
    slot: (phrases.slot ?? []).map(fill).join("\n"),
    cue: (phrases.cue ?? []).map(fill).join(" "),
    reason,
  };
}
```

At the call site (`assemblePrompt({... reachOut: ...})`) compute it once before assembling:

```ts
  const reachOutText = input.reachOut
    ? renderReachOut(
        loadPrompt("reach-out", config.prompts.reach_out),
        input.reachOut,
        clock.now(),
        lifeTimezone(config.life, clock.now()),
      )
    : null;
```

and pass `reachOut: reachOutText ? { slot: reachOutText.slot, cue: reachOutText.cue } : null`.
`send.ts` passes `winner` (a full `Candidate`, which has `notes`) unchanged. A row logged before
this change has no `notes`; `trigger.notes ?? []` covers it. Config `prompts.reach_out: "v3"`;
`git rm prompts/reach-out/v2.md`.

- [ ] **Step 4: Run** `pnpm vitest run tests/mind/process/hot-path tests/mind/process/outreach` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(reach-out): the reason carries its dates and comes last (reach-out v3)"`

---

### Task 5: The guard knows now and why she's writing

**Files:**
- Modify: `src/mind/process/guard/guard.ts` (`GuardInput`, `renderGuardInput`),
  `src/mind/process/hot-path/compose.ts` (guard call), `config/default.json` (`prompts.guard` v4)
- Create: `prompts/guard/v4.md` (copy v3, edit as below); Delete: `prompts/guard/v3.md`
- Test: `tests/mind/process/guard/guard.test.ts`

**Interfaces:**
- Consumes: `renderReachOut(...).reason` (Task 4).
- Produces: `GuardInput.now?: string` (her local time line), `GuardInput.reachOutReason?: string`.

- [ ] **Step 1: Write the failing test**

```ts
test("renderGuardInput: NOW first, and a reach-out's reason before the message", () => {
  const text = renderGuardInput({
    kind: "reach_out",
    text: "how did thursday go?",
    recentTurns: [],
    recalledFacts: [],
    onboardingFacts: [],
    now: "Thursday 8 January 2026, 19:12",
    reachOutReason: "job interview\n- The user has a job interview. (Thursday 8 January, today)",
  });
  expect(text.startsWith("NOW: Thursday 8 January 2026, 19:12")).toBe(true);
  expect(text).toContain("WHY SPICA IS WRITING FIRST:\njob interview");
  expect(text.indexOf("WHY SPICA")).toBeLessThan(text.indexOf("MESSAGE TO CHECK"));
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** in `renderGuardInput`:

```ts
  return [
    ...(input.now ? [`NOW: ${input.now}`] : []),
    `KNOWN FROM THE PROFILE CARD (filled in at sign-up, never discussed in conversation):\n${onboarding}`,
    `WHAT SPICA REMEMBERS FROM EARLIER CONVERSATIONS:\n${remembered}`,
    `RECENT CONVERSATION (oldest first):\n${turns || "(no earlier messages)"}`,
    ...occasion,
    ...(input.reachOutReason ? [`WHY SPICA IS WRITING FIRST:\n${input.reachOutReason}`] : []),
    `${MESSAGE_MARKER}${input.text}`,
  ].join("\n\n");
```

`GuardInput` gains the two optional fields with doc comments ("Her local date and time, so
'how did it go' about something dated earlier isn't presuming"; "A reach-out's reason, with
dates"). In `compose.ts` guard input add:

```ts
      now: new Intl.DateTimeFormat("en-GB", {
        timeZone: lifeTimezone(config.life, clock.now()),
        dateStyle: "full",
        timeStyle: "short",
      }).format(clock.now()),
      ...(reachOutText ? { reachOutReason: reachOutText.reason } : {}),
```

`prompts/guard/v4.md` = v3 plus, in the "You are given" list, two bullets:

```markdown
- NOW: Spica's current local date and time. Anything dated before NOW has already happened; asking how it went is not presuming.
- WHY SPICA IS WRITING FIRST (reach-outs only): the reason she is texting first, with what she knows and when. Facts there count as known, like WHAT SPICA REMEMBERS.
```

Config `prompts.guard: "v4"`; `git rm prompts/guard/v3.md`; update any test that loads
`loadPrompt("guard", "v3")` to v4.

- [ ] **Step 4: Run** `pnpm vitest run tests/mind/process/guard tests/mind/process/hot-path` → PASS.
  `pnpm eval --llm=fake --only "guard-*"` → no regressions.

- [ ] **Step 5: Commit** — `git commit -m "feat(guard): the guard sees her now and a reach-out's reason (guard v4)"`

---

### Task 6: Her own news: the plain event is surface; her things rank under theirs

**Files:**
- Modify: `src/mind/process/outreach/inputs.ts` (`loadHerDay`, ordering of `depthLimit`),
  `src/mind/process/outreach/candidates.ts` (her_day note, tier sort), `src/mind/process/outreach/types.ts`
  (herDay item gains `at: Date`), `config/default.json` (`outreach.weights.her_day` 1.0)
- Test: `tests/mind/process/outreach/candidates.test.ts`, `tests/mind/process/outreach/inputs.test.ts`

**Interfaces:**
- Produces: `CandidateInputs.herDay[i] = { id; content; salience; depth; sensitive; at: Date }`,
  where `content`/`depth` are already the plain event's when the memory was too deep.

- [ ] **Step 1: Write the failing tests**

`candidates.test.ts`:

```ts
test("her news beats an idea but never their thread", () => {
  const i = empty();
  i.depthLimit = 1;
  i.herDay = [{ id: "m1", content: "Spica went to the film club screening of Stalker.", salience: 0.4, depth: 1, sensitive: false, at: new Date("2026-01-10T11:00:00Z") }];
  i.userIdeas = [{ id: "i1", content: "ask about the task", salience: 0.5 }];
  expect(pickWinner(buildCandidates(i, cfg, now))!.kind).toBe("her_day");
  i.dueThreads = [{ id: "t1", title: "x", detail: null, stakes: "med", next_checkpoint: now, fact_id: null, sensitive: false, facts: [] }];
  expect(pickWinner(buildCandidates(i, cfg, now))!.kind).toBe("thread");
});
```

`inputs.test.ts` (DB test; follow the file's existing setup for core memory and world events):

```ts
test("a too-deep episode from a world event falls back to the plain event at depth 1", async () => {
  // Arrange: a relationship at experimenting (open depth 1); a world event "Spica went to the
  // film club screening of Stalker." that happened 2 h ago; its episode at depth 2 with
  // source_ref `world_event:<id>`.
  // Act: loadCandidateInputs(deps, userId, now)
  // Assert: herDay holds { content: "Spica went to the film club screening of Stalker.", depth: 1 }
});

test("a too-deep loop memory with no world event stays too deep", async () => {
  // A depth-2 intention with source_ref "core_reflect:x" → herDay keeps depth 2 and its content.
});
```

(Write both with the file's helpers: `insertCoreMemory`/`core.memory.insert`,
`core.world.recordEvent`, `setOutcome(id, "happened")`; assert exact fields.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

`inputs.ts`: compute `depthLimit` first (move the `loadDepth` call above `loadHerDay`) and pass
it: `loadHerDay(deps, now, settings.her_day_lookback_hours, settings.her_day_limit, depthLimit)`.
In `loadHerDay`, map each memory through:

```ts
/**
 * What happened is surface news anyone can hear, like her day plan; how it felt keeps its depth.
 * A memory deeper than she'd share falls back to its world event's plain words.
 */
async function shareable(
  deps: Pick<Deps, "core">,
  m: CoreMemoryItem,
  open: number,
  now: Date,
): Promise<CandidateInputs["herDay"][number]> {
  const at = m.occurred_at ?? m.created_at;
  const plain = { id: m.id, content: m.content, salience: m.salience, depth: m.depth, sensitive: false, at };
  if (m.depth <= open || !m.source_ref?.startsWith("world_event:")) return plain;
  const event = await deps.core.world.getEvent(m.source_ref.slice("world_event:".length));
  if (!event) return plain;
  const ahead = event.at.getTime() > now.getTime();
  return { ...plain, content: ahead ? `planned: ${event.content}` : event.content, depth: 1, at: event.at };
}
```

(`core.world.getEvent` is on `CoreDeps["core"]["world"]`; `Deps["core"]` exposes the same scope —
check `loadHerDay`'s `Pick<Deps, "core">` type covers `world`.) The preoccupation goes through
`shareable` too.

`candidates.ts` her_day push gains `notes: [{ text: memory.content, at: memory.at.toISOString(), dated: true }]`.
Sort: their things first, then score:

```ts
/** Their things (a due thread, making up, their event) always come before hers. */
const THEIRS: ReadonlySet<CandidateKind> = new Set(["thread", "make_up", "user_event"]);
const tier = (c: Candidate) => (THEIRS.has(c.kind) ? 0 : 1);
...
    .sort(
      (a, b) =>
        tier(a) - tier(b) ||
        b.score - a.score ||
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.topic.localeCompare(b.topic),
    );
```

`pickWinner` takes the first unfiltered, so a filtered thread doesn't block her news. Update the
file header ("Sorted their things first, then by score…"). Config
`outreach.weights.her_day: 1`.

- [ ] **Step 4: Run** `pnpm vitest run tests/mind/process/outreach` → PASS (adjust any test that
  relied on a high-scoring her_day beating a thread).

- [ ] **Step 5: Commit** — `git commit -m "feat(outreach): her plain news is surface and outranks ideas, never their things"`

---

### Task 7: "Your day" lists what happened earlier today

**Files:**
- Modify: `src/mind/process/hot-path/your-day-line.ts`, `config/default.json`
  (`life.your_day_events`, 3), `src/mind/platform/config.ts`
- Test: `tests/mind/process/hot-path/your-day-line.test.ts`

**Interfaces:**
- Produces: `yourDayLines(blocks, now, deferredLabel, happened: string[])`.

- [ ] **Step 1: Write the failing test**

```ts
test("lists what happened earlier today, plain", () => {
  const text = yourDayLines([], new Date("2026-01-10T15:00:00Z"), null, [
    "Spica went to the film club screening of Stalker.",
  ]);
  expect(text).toContain("Earlier today: Spica went to the film club screening of Stalker.");
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**: `yourDayLines` gains `happened: string[]` (returns null only when
  blocks, deferral and happened are all empty) and pushes
  `happened.map((h) => \`Earlier today: ${h}\`)` after "Later". `loadYourDayLine` reads
  `deps.core.world.events(lifeDate(deps.config.life, now))`, keeps `outcome !== "fell_through"`
  and `at <= now`, newest last, the last `config.life.your_day_events`, and passes their
  `content`. The guard already counts "Your day" as her own context, so these never read as
  invented.

- [ ] **Step 4: Run** `pnpm vitest run tests/mind/process/hot-path` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(reply): her day includes what happened earlier today"`

---

### Task 8: Her own rate moves her readiness (B117); jitter covers the hour (B24)

**Files:**
- Modify: `src/mind/process/outreach/candidates.ts` (`herThreshold`, `filterReason`),
  `src/mind/process/outreach/types.ts` (`CandidateInputs.theirRate: number | null`),
  `src/mind/process/outreach/inputs.ts`, `config/default.json`, `src/mind/platform/config.ts`
- Test: `tests/mind/process/outreach/candidates.test.ts`

**Interfaces:**
- Produces: `herThreshold(theirRate: number | null, settings: OutreachConfig): number`.

- [ ] **Step 1: Write the failing test**

```ts
test("her rate scales the bar: none before an estimate, lower for a chatty friend, higher for a quiet one", () => {
  expect(herThreshold(null, cfg)).toBe(cfg.threshold);
  // default 4, halfway to 12 → 8 → bar / 2
  expect(herThreshold(12, cfg)).toBeCloseTo(cfg.threshold / 2);
  // halfway to 1 → 2.5 → bar × 1.6
  expect(herThreshold(1, cfg)).toBeCloseTo(cfg.threshold * 1.6);
  // clamped at ×2
  expect(herThreshold(0, cfg)).toBeCloseTo(cfg.threshold * 2);
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * How readily she writes first to this person. Her own chattiness moves part-way toward how much
 * she thinks they text, once she has a sense of it; the caps and gates still apply.
 */
export function herThreshold(theirRate: number | null, settings: OutreachConfig): number {
  if (theirRate === null) return settings.threshold;
  const { default: base, toward_them, scale_min, scale_max } = settings.her_rate;
  const hers = base + toward_them * (theirRate - base);
  const scale = Math.min(scale_max, Math.max(scale_min, hers / base));
  return settings.threshold / scale;
}
```

`buildCandidates` computes `const threshold = herThreshold(inputs.theirRate, settings)` and passes
it to `filterReason` in place of `settings.threshold`. `inputs.ts`:
`theirRate: params && rateEstimated(params.msgs_per_day, config.relationship) ? params.msgs_per_day.baseline : null`.
Test `empty()` gains `theirRate: null`.

Config: `outreach.her_rate: { "default": 4, "toward_them": 0.5, "scale_min": 0.5, "scale_max": 2 }`
(schema: positive, unit, positive, positive, with a refine `scale_min <= 1 <= scale_max`), and
`outreach.jitter_max_minutes: 59`.

- [ ] **Step 4: Run** `pnpm vitest run tests/mind/process/outreach` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(outreach): her own rate sets how readily she writes first; jitter spans the hour"`

---

### Task 9: One night across midnight (B20)

**Files:**
- Modify: `src/mind/world/blocks.ts`
- Test: `tests/mind/world/blocks.test.ts`

**Interfaces:**
- Produces: `joinNight(today: WorldBlock[], tomorrow: WorldBlock[]): WorldBlock[]` (pure);
  `todaysBlocks` returns joined blocks.

- [ ] **Step 1: Write the failing tests**

```ts
const night = (start: string, end: string) => ({ start, end, kind: "quiet" as const, busy: 0.9, label: "offline, winding down" });

test("a quiet block ending at midnight runs on into tomorrow's from 00:00", () => {
  const today = blocksForDay(cfg, "2026-01-05", { blocks: [night("22:00", "24:00")] });
  const tomorrow = blocksForDay(cfg, "2026-01-06", { blocks: [night("00:00", "07:30")] });
  const [b] = joinNight(today, tomorrow);
  expect(b!.key).toBe("2026-01-05#22:00");
  expect(b!.end.toISOString()).toBe("2026-01-06T07:30:00.000Z");
});

test("no plan for tomorrow leaves midnight as the end", () => {
  const today = blocksForDay(cfg, "2026-01-05", { blocks: [night("22:00", "24:00")] });
  expect(joinNight(today, [])[0]!.end.toISOString()).toBe("2026-01-06T00:00:00.000Z");
});

test("todaysBlocks reads tomorrow to join the night", async () => {
  // insert both days' plans (life_day), then todaysBlocks at 23:50 → blockAt(...).end is 07:30 next day
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
/** Tonight's quiet block and tomorrow morning's are one night: one deferral, one note. */
export function joinNight(today: WorldBlock[], tomorrow: WorldBlock[]): WorldBlock[] {
  const last = today.at(-1);
  const first = tomorrow[0];
  if (!last || !first || last.block !== "quiet" || first.block !== "quiet") return today;
  if (last.end.getTime() !== first.start.getTime()) return today;
  return [...today.slice(0, -1), { ...last, end: first.end }];
}

export async function todaysBlocks(deps: Pick<Deps, "core" | "config">, now: Date): Promise<WorldBlock[]> {
  const day = lifeDate(deps.config.life, now);
  const next = nextLocalDate(day);
  return joinNight(
    blocksForDay(deps.config.life, day, await deps.core.world.plan(day)),
    blocksForDay(deps.config.life, next, await deps.core.world.plan(next)),
  );
}
```

Update the header ("…a quiet block ending at midnight runs on into tomorrow morning's"). Every
caller (deferral, outreach gate, openness, state tick, wander, browse, post) routes through
`todaysBlocks`; `blockByKey` only needs the label and stays as is.

- [ ] **Step 4: Run** `pnpm vitest run tests/mind/world tests/mind/process/availability` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "fix(world): the night is one quiet block across midnight"`

---

### Task 10: Plain events and code-picked subjects (B18, B19 world)

**Files:**
- Modify: `src/mind/world/events.ts` (`selectEventSubject` replaces `selectEventGoal`,
  `buildEventInput`), `src/mind/process/core/world-tick.ts` (records `subject`),
  `src/db/schema.ts` (`world_event.subject text`), the World repo insert
  (`src/db/repos/world/*` `recordEvent` / types `NewWorldEvent`), `config/default.json`,
  `src/mind/platform/config.ts`
- Create: `prompts/life/event/v5.md`; Delete: `prompts/life/event/v4.md`; migration
  `src/db/migrations/0037_world_event_subject.sql`
- Test: `tests/mind/world/events.test.ts`

**Interfaces:**
- Produces: `type EventSubject = { kind: "goal"; goal: CoreGoal } | { kind: "interest"; id: string; content: string } | { kind: "person"; name: string } | { kind: "everyday" }`;
  `subjectKey(s: EventSubject): string` (`goal:<id>`, `interest:<id>`, `person:<name>`, `everyday`);
  `selectEventSubject(options: { goals: CoreGoal[]; interests: {id: string; content: string}[]; people: string[] }, recentKeys: string[], day: string, cfg: WorldConfig): EventSubject`;
  World: `recentSubjects(sinceDay: string): Promise<string[]>`.

- [ ] **Step 1: Write the failing tests**

```ts
test("a subject used recently is drawn less", () => {
  const options = { goals: [], interests: [{ id: "i1", content: "old films" }], people: ["Alcor"] };
  const days = Array.from({ length: 400 }, (_, d) => `2026-01-${String((d % 28) + 1).padStart(2, "0")}#${d}`);
  const count = (recent: string[]) =>
    days.filter((day) => subjectKey(selectEventSubject(options, recent, day, cfg)) === "person:Alcor").length;
  expect(count(["person:Alcor"])).toBeLessThan(count([]));
});

test("no goals, interests or people still yields an everyday subject", () => {
  expect(selectEventSubject({ goals: [], interests: [], people: [] }, [], "2026-01-05", cfg)).toEqual({ kind: "everyday" });
});

test("the input names the subject and the target length", () => {
  const input = buildEventInput({ ...ctx, subject: { kind: "person", name: "Alcor" } }, "2026-01-05", [], now, "UTC", 140);
  expect(input).toContain("Today's event is about: Alcor");
  expect(input).toContain("one plain sentence, under 140 characters");
});
```

(`ctx` and `cfg` as the file's existing fixtures; `ctx` replaces `goal` with `subject`.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * What today's event is about, drawn in code so her days don't narrow to one theme: one of her
 * goals, an interest, someone she knows, or an ordinary thing, by weight, with anything used in
 * the last few days drawn less.
 */
export function selectEventSubject(
  options: { goals: CoreGoal[]; interests: { id: string; content: string }[]; people: string[] },
  recentKeys: string[],
  day: string,
  cfg: WorldConfig,
): EventSubject {
  const w = cfg.subject_weights;
  const pool: { subject: EventSubject; weight: number }[] = [
    ...options.goals
      .filter((g) => g.status === "active")
      .map((goal) => ({ subject: { kind: "goal", goal } as const, weight: w.goal * (1 - goal.progress + cfg.goal_weight_floor) })),
    ...options.interests.map((i) => ({ subject: { kind: "interest", ...i } as const, weight: w.interest / options.interests.length })),
    ...options.people.map((name) => ({ subject: { kind: "person", name } as const, weight: w.person / options.people.length })),
    { subject: { kind: "everyday" } as const, weight: w.everyday },
  ].map((o) => ({ ...o, weight: recentKeys.includes(subjectKey(o.subject)) ? o.weight * cfg.subject_recent_penalty : o.weight }));
  const total = pool.reduce((s, o) => s + o.weight, 0);
  let position = seededUnit(`${day}:subject`) * total;
  for (const o of pool) {
    position -= o.weight;
    if (position < 0) return o.subject;
  }
  return { kind: "everyday" };
}
```

(The goal weights are normalised the way `selectEventGoal` did: divide each goal's weight by the
sum of goal weights, then multiply by `w.goal`. Keep `goal_weight_floor`.) In
`generateCoreEvents` replace `selectEventGoal(...)` with:

```ts
  const subject = selectEventSubject(
    {
      goals: await deps.core.goals.active(),
      interests: (await deps.core.memory.activeByKind("interest", cfg.event_context_items)).map((m) => ({ id: m.id, content: m.content })),
      people: [...new Set([...cfg.canon_entities, ...(await deps.core.memory.entities()).map((e) => e.name)])],
    },
    await deps.core.world.recentSubjects(shiftLocalDate(day, -cfg.subject_recent_days)),
    day,
    cfg,
  );
```

`goalRef` stays `subject.kind === "goal" ? subject.goal.id : null`; each accepted event carries
`subject: subjectKey(subject)` (the injected event: `null`). `buildEventInput(ctx, day, rejected, now, tz, targetChars)`
replaces the goal paragraph with:

```ts
  parts.push(
    ctx.subject.kind === "goal"
      ? `Today's event is about her goal: ${ctx.subject.goal.title}. Why: ${ctx.subject.goal.why}. Progress: ${ctx.subject.goal.progress}. Let it advance or block it.`
      : ctx.subject.kind === "interest"
        ? `Today's event is about something she loves: ${ctx.subject.content}.`
        : ctx.subject.kind === "person"
          ? `Today's event is about: ${ctx.subject.name}. Something happens with them.`
          : "Today's event is about something ordinary, not her goals or usual interests.",
  );
  parts.push(`Write the event as one plain sentence, under ${targetChars} characters: what happened, no feelings.`);
```

Schema: `world_event.subject: text("subject")` (nullable; doc comment "What the day's event was
drawn about (`goal:<id>`, `interest:<id>`, `person:<name>`, `everyday`); recent ones are drawn
less"). Repo: `recentSubjects(sinceDay)` = `SELECT DISTINCT subject FROM world_event WHERE life_day >= sinceDay AND subject IS NOT NULL`.
Config: `core.world.subject_weights: { goal: 0.35, interest: 0.25, person: 0.15, everyday: 0.25 }`,
`subject_recent_days: 7`, `subject_recent_penalty: 0.25`, `event_target_chars: 140`; delete
`goal_driven_share` (schema and JSON).

`prompts/life/event/v5.md` = v4 with its length/content guidance replaced by: "Write `content` as
one plain sentence of what happened, in the third person ("Spica …"), with no feelings or
reflection: how it felt is added later. Keep it ordinary unless the input says otherwise." (Keep
v4's rules for `at`, `kind`, `thought`, `entity_names`, `stakes`.) Config `prompts.life_event: "v5"`;
`git rm prompts/life/event/v4.md`. Migration via `pnpm db:generate`, renamed to
`0037_world_event_subject.sql`.

- [ ] **Step 4: Run** `pnpm vitest run tests/mind/world tests/mind/process/core/world-tick.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(world): events are plain and drawn about varied subjects (event v5)"`

---

### Task 11: Varied day plans (B19 plans)

**Files:**
- Modify: `src/mind/world/day-plan.ts` (`validatePlan` gains `yesterday`), `config/default.json`
  (`prompts.life_plan` v2)
- Create: `prompts/life/plan/v2.md`; Delete: `prompts/life/plan/v1.md`
- Test: `tests/mind/world/day-plan.test.ts`

**Interfaces:**
- Produces: `validatePlan(raw: RawPlan, settings: LifeConfig, yesterday: LifePlan | null): PlanCheck`.

- [ ] **Step 1: Write the failing test**

```ts
test("a plan doing the same busy things as yesterday is rejected", () => {
  const raw = { blocks: [
    { start: "00:00", end: "08:00", kind: "quiet" as const, busy: 0.9, label: "offline" },
    { start: "09:00", end: "12:00", kind: "busy" as const, busy: 0.8, label: "reading fiction" },
    { start: "19:00", end: "21:00", kind: "busy" as const, busy: 0.9, label: "rewatching an old film" },
    { start: "22:00", end: "24:00", kind: "quiet" as const, busy: 0.9, label: "offline" },
  ] };
  const yesterday = validatePlan(raw, cfg, null);
  expect(yesterday.ok).toBe(true);
  const again = validatePlan(raw, cfg, yesterday.ok ? yesterday.plan : null);
  expect(again).toEqual({ ok: false, violations: [expect.stringContaining("same as yesterday")] });
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**: at the end of `validatePlan`:

```ts
  const busyLabels = (p: LifePlan) =>
    p.blocks.filter((b) => b.kind === "busy").map((b) => b.label).sort().join("|");
  if (yesterday && busyLabels({ blocks }) === busyLabels(yesterday)) {
    violations.push("busy blocks are the same as yesterday: change at least one");
  }
```

`generatePlan` passes `previous.at(-1)?.plan ?? null` (the day before). Update callers/tests of
`validatePlan` to pass `null` where no yesterday applies.

`prompts/life/plan/v2.md` = v1 with the last paragraph replaced by:

```markdown
Make each day its own. Look at her previous days and change things up: not every evening is a
film and not every morning is reading. Mix in an outing somewhere online (an archive, an
observatory's live feed, a museum's collection), time with Alcor as its own block, a slow day, a
day on one project. Weekends feel different from weekdays. Carry on with something unfinished only
when it makes sense, never by repeating yesterday's blocks.
```

Config `prompts.life_plan: "v2"`; `git rm prompts/life/plan/v1.md`.

- [ ] **Step 4: Run** `pnpm vitest run tests/mind/world/day-plan.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(world): day plans must differ from yesterday (plan v2)"`

---

### Task 12: Wander starts from a cue picked in code (B19 mind)

**Files:**
- Modify: `src/mind/process/core/wander.ts` (pool and `pickSeed`), `config/default.json`,
  `src/mind/platform/config.ts`
- Test: `tests/mind/process/core/wander.test.ts`

Design note: the design doc's embedding-based "recent themes" check is simplified here to the
memories her recent wanderings already used (their `payload.seed` and `payload.chain`), which
needs no extra embedding calls; and a person cue comes through events (Task 10 draws people as
event subjects, and those episodes are `memory` cues). The design doc's §9 already says this.

**Interfaces:**
- Produces: `wanderCues(deps, now): Promise<{ kind: CueKind; items: CoreMemoryItem[] }[]>`;
  `pickCue(cues, used: Set<string>, roll: number, cfg): CoreMemoryItem | null` (pure).

- [ ] **Step 1: Write the failing tests**

```ts
test("thoughts are never cues, and a recently used memory is drawn less", () => {
  const m = (id: string, kind: CoreMemoryKind) => ({ ...baseItem, id, kind });
  const cues = [{ kind: "memory" as const, items: [m("a", "episode"), m("b", "episode")] }];
  const rolls = Array.from({ length: 200 }, (_, i) => i / 200);
  const picks = (used: string[]) => rolls.filter((r) => pickCue(cues, new Set(used), r, cfg)?.id === "a").length;
  expect(picks(["a"])).toBeLessThan(picks([]));
});

test("no cue at all → null (wander skips)", () => {
  expect(pickCue([], new Set(), 0.5, cfg)).toBeNull();
});
```

(`baseItem` as the file's existing `CoreMemoryItem` fixture.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
type CueKind = "memory" | "interest" | "event";

/** Where her mind can start: any older memory of hers, an interest, or something from today. Never a thought. */
async function wanderCues(deps: CoreDeps, now: Date) {
  const { core, config } = deps;
  const limit = config.core.wander.seed_limit;
  const memory = (
    await Promise.all(["episode", "opinion", "insight"].map((k) => core.memory.activeByKind(k as CoreMemoryKind, limit)))
  ).flat();
  const interest = await core.memory.activeByKind("interest", limit);
  const day = lifeDate(config.life, now);
  const event = (
    await Promise.all(
      (await core.world.events(day))
        .filter((e) => e.at <= now)
        .map((e) => core.memory.bySourceRef("episode", `world_event:${e.id}`)),
    )
  ).filter((m): m is CoreMemoryItem => !!m);
  return [
    { kind: "memory" as const, items: memory.filter(recallable) },
    { kind: "interest" as const, items: interest.filter(recallable) },
    { kind: "event" as const, items: event },
  ].filter((c) => c.items.length);
}

/** A kind by weight, then an item by salience; one her recent wanderings already used counts less. */
export function pickCue(
  cues: { kind: CueKind; items: CoreMemoryItem[] }[],
  used: Set<string>,
  roll: number,
  cfg: Config["core"]["wander"],
): CoreMemoryItem | null {
  const pool = cues.flatMap((c) =>
    c.items.map((item) => ({
      item,
      weight:
        (cfg.cue_weights[c.kind] / c.items.length) *
        Math.max(item.salience, 0.01) *
        (used.has(item.id) ? cfg.recent_penalty : 1),
    })),
  );
  const total = pool.reduce((s, p) => s + p.weight, 0);
  if (!pool.length || total === 0) return null;
  let position = roll * total;
  for (const p of pool) {
    position -= p.weight;
    if (position < 0) return p.item;
  }
  return pool.at(-1)!.item;
}
```

`used` = ids in `payload.seed`/`payload.chain` of her last `cfg.recent_outputs` wander thoughts
(`core.memory.recentThoughts(new Date(0), now, cfg.recent_outputs)`, filtered to
`source_ref` starting `core_wander:`; read `payload` as `{ seed?: string; chain?: string[] }`).
In `coreWander`, replace the `recallable(...)` pool and `pickSeed` with `wanderCues` +
`pickCue(cues, used, seededUnit(...same key...), config.core.wander)`; when null return
`{ status: "not_due", applied: false, ids: [] }`. Mood bias: multiply each weight by
`Math.max(0, 1 + mood_bias * item.valence * mood)` as `pickSeed` did (keep mood-congruence).
Delete `pickSeed` and the now-unused `seed_days`. Config `core.wander`: add
`cue_weights: { memory: 0.4, interest: 0.2, event: 0.25 }` (sum need not be 1),
`recent_outputs: 10`, `recent_penalty: 0.2`; delete `seed_days`.

- [ ] **Step 4: Run** `pnpm vitest run tests/mind/process/core/wander.test.ts tests/mind/process/core/mind-tick.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(core): wander starts from a cue picked in code, not her latest thoughts"`

---

### Task 13: Captions: stated length, cut at a word, a fairer check (B110, B111)

**Files:**
- Modify: `src/mind/process/core/post-words.ts` (`tidy`, draft input), `config/default.json`
  (`posts.caption_target_chars` 200, prompts `post_draft` v2, `post_check` v2),
  `src/mind/platform/config.ts`
- Create: `prompts/post/draft/v2.md`, `prompts/post/check/v2.md`; Delete the v1 files
- Test: `tests/mind/process/core/post-words.test.ts`

**Interfaces:**
- Produces: `cutAtWord(s: string, max: number): string` (exported for the test).

- [ ] **Step 1: Write the failing tests**

```ts
test("a long caption is cut at the last whole word", () => {
  expect(cutAtWord("like they were trying to catch it", 26)).toBe("like they were trying to");
});
test("one long word still fits", () => {
  expect(cutAtWord("a".repeat(30), 10)).toBe("a".repeat(10));
});
test("short text is untouched", () => {
  expect(cutAtWord("short", 10)).toBe("short");
});
```

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
/** Cuts at the last whole word within `max`, dropping a dangling comma or dash. */
export function cutAtWord(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max + 1);
  const space = head.lastIndexOf(" ");
  const cut = space > 0 ? head.slice(0, space) : s.slice(0, max);
  return cut.replace(/[\s,;:—–-]+$/, "");
}
```

`tidy` uses `cutAtWord(…, max)` in place of `.slice(0, max)`. The draft input gains
`Keep the caption under ${config.posts.caption_target_chars} characters: one or two short sentences.`

`prompts/post/draft/v2.md` = v1 with "Never mention anyone you talk to, private feelings beyond this
moment, your mood or your needs, or other apps." replaced by "Never mention anyone you talk to,
your relationships, hurts or fears, or other apps. How the find makes you feel right now is fine."

`prompts/post/check/v2.md`:

```markdown
You check a post before it goes to its editor. Answer only from the post and the find.

Flag the post (ok: false) if any of these hold:
- it mentions or hints at a specific person she talks to, anything a user told her, or her relationships;
- it reveals a hurt, a fear, or something she's privately working through;
- it compares her to other apps, AIs or products;
- it misstates what the find is (its title, source or credit).

These are fine and must not be flagged: how the find makes her feel, her taste, a small mood, an
opinion, a reflection prompted by what she's looking at.

Otherwise ok: true. Return JSON: {"ok": boolean, "reason": string}; the reason is one short line.
```

Config prompts v2 for both; `git rm` the v1 files.

- [ ] **Step 4: Run** `pnpm vitest run tests/mind/process/core/post-words.test.ts` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(posts): captions state their length and cut at a word; the check allows her moods"`

---

### Task 14: New sources (ESO, NOIRLab) and no repeated image; APOD removed

**Files:**
- Modify: `src/runtime/web-sources.ts`, `src/runtime/deps.ts:76`, `src/runtime/env.ts:11`,
  `src/mind/process/core/browse.ts`, `src/mind/world/types.ts` (`findByHash`, `NewWebFind.image_sha256`),
  the posts repo, `src/db/schema.ts` (`web_find.image_sha256` text unique, not null),
  `config/default.json` (`posts.sources`, `posts.weekly_max_age_days` 7), `src/mind/platform/config.ts`,
  `.env.example` (drop `NASA_API_KEY` if listed)
- Create: migration `0038_find_image_hash.sql` (backfill: existing rows get
  `md5(id::text)` placeholders before `SET NOT NULL`, since their media is on disk only)
- Test: `tests/runtime/web-sources.test.ts`, `tests/mind/process/core/browse.test.ts`

**Interfaces:**
- Produces: `createWebSources(o: { userAgent; timeoutMs; maxDownloadBytes; weeklyMaxAgeDays })` →
  `{ commons_potd, eso_potw, noirlab_iotw }`; `rssPictureOfWeek(feedUrl, label, source, credit)`.

- [ ] **Step 1: Write the failing tests** (replace the two APOD tests)

```ts
const rss = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items}</channel></rss>`;
const item = (title: string, date: string, url: string) =>
  `<item><title>${title}</title><pubDate>${date}</pubDate><enclosure url="${url}" type="image/jpeg" length="1"/></item>`;

test("eso: the newest picture within a week, CC BY 4.0, credit ESO", async () => {
  stub({
    "https://www.eso.org/public/images/potw/feed/": rss(item("Massive antenna, silent mirror", "Mon, 12 Oct 2026 06:00:00 +0200", "https://cdn.eso.org/images/screen/potw2641a.jpg")),
    "https://cdn.eso.org/images/screen/potw2641a.jpg": png,
  });
  expect(await sources.eso_potw!.fetch("2026-10-14")).toMatchObject({
    source: "eso_potw",
    url: "https://cdn.eso.org/images/screen/potw2641a.jpg",
    title: "Massive antenna, silent mirror",
    credit: "ESO",
    licence: "CC BY 4.0",
  });
});

test("a weekly picture older than a week, an empty feed, or no enclosure is null", async () => {
  stub({ "https://www.eso.org/public/images/potw/feed/": rss(item("Old", "Mon, 28 Sep 2026 06:00:00 +0200", "https://cdn.eso.org/x.jpg")) });
  expect(await sources.eso_potw!.fetch("2026-10-14")).toBeNull();
  stub({ "https://noirlab.edu/public/images/iotw/feed/": rss("") });
  expect(await sources.noirlab_iotw!.fetch("2026-10-14")).toBeNull();
  stub({ "https://noirlab.edu/public/images/iotw/feed/": rss("<item><title>X</title><pubDate>Wed, 14 Oct 2026 12:00:00 -0700</pubDate></item>") });
  expect(await sources.noirlab_iotw!.fetch("2026-10-14")).toBeNull();
});
```

`browse.test.ts`: "a find whose image matches an earlier one is skipped" — run `browseIfDue`
twice with two different URLs serving the same bytes; the second writes no find.

(The `stub` helper returns JSON for objects; give it a string branch:
`typeof body === "string" ? new Response(body, { headers: { "content-type": "application/rss+xml" } })`.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
/**
 * A weekly picture from an observatory's RSS feed: the newest item with an image, if it was
 * published in the last `weeklyMaxAgeDays` before her `day`; null otherwise. Both feeds are
 * CC BY 4.0 with the institution as credit.
 */
function rssPictureOfWeek(
  o: Options,
  spec: { feed: string; label: string; source: string; credit: string },
): WebSource {
  return {
    label: spec.label,
    async fetch(day): Promise<WebItem | null> {
      const xml = await (await get(spec.feed, o)).text();
      const first = /<item>([\s\S]*?)<\/item>/.exec(xml)?.[1];
      if (!first) return null;
      const title = /<title>([\s\S]*?)<\/title>/.exec(first)?.[1]?.trim();
      const date = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(first)?.[1];
      const url = /<enclosure[^>]*url="([^"]+)"/.exec(first)?.[1];
      if (!title || !date || !url) return null;
      const ageDays = (Date.parse(`${day}T23:59:59Z`) - Date.parse(date)) / 864e5;
      if (!(ageDays >= 0 && ageDays <= o.weeklyMaxAgeDays)) return null;
      return {
        source: spec.source,
        url,
        title: decodeEntities(title),
        credit: spec.credit,
        licence: "CC BY 4.0",
        image: await bytes(url, o),
      };
    },
  };
}

const decodeEntities = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

export function createWebSources(o: Options): WebSources {
  return {
    commons_potd: commons(o),
    eso_potw: rssPictureOfWeek(o, {
      feed: "https://www.eso.org/public/images/potw/feed/",
      label: "ESO's picture of the week",
      source: "eso_potw",
      credit: "ESO",
    }),
    noirlab_iotw: rssPictureOfWeek(o, {
      feed: "https://noirlab.edu/public/images/iotw/feed/",
      label: "NOIRLab's image of the week",
      source: "noirlab_iotw",
      credit: "NOIRLab",
    }),
  };
}
```

`Options`: drop `nasaApiKey`, add `weeklyMaxAgeDays: number`. Delete `Apod` and `apod()`. Header:
"Where she browses: Wikimedia Commons' picture of the day, ESO's picture of the week and
NOIRLab's image of the week…". `deps.ts`: drop `nasaApiKey`, pass
`weeklyMaxAgeDays: config.posts.weekly_max_age_days`; `env.ts`: drop `NASA_API_KEY`.

`browse.ts`: after the licence/url check, hash the downloaded bytes and skip a known image:

```ts
    const hash = createHash("sha256").update(item.image).digest("hex");
    if (await core.posts.findByHash(hash)) return false;
```

and inside the transaction re-check `findByHash(hash)` alongside `findByUrl`, then insert with
`image_sha256: hash`. Schema: `image_sha256: text("image_sha256").notNull().unique()` with a doc
comment ("The downloaded image's hash: a source serving the same picture under a new URL, or a
broken one serving a logo, can't feed her it twice"). Config `posts.sources`:
`[{ "name": "commons_potd", "weight": 1 }, { "name": "eso_potw", "weight": 1 }, { "name": "noirlab_iotw", "weight": 1 }]`,
`posts.weekly_max_age_days: 7`. Browse already re-rolls the source each hour, so a weekly source
with nothing new simply yields to another on a later tick.

- [ ] **Step 4: Run** `pnpm vitest run tests/runtime/web-sources.test.ts tests/mind/process/core/browse.test.ts tests/mind/process/core/post-tick.test.ts` → PASS.
  Manually: `curl -s https://www.eso.org/public/images/potw/feed/ | head -c 600` still shows an
  `<enclosure url=…>` (feeds checked 2026-10-18).

- [ ] **Step 5: Commit** — `git commit -m "feat(posts): browse ESO and NOIRLab weekly pictures; never the same image twice; APOD removed"`

---

### Task 15: Her craft skill is set by Ethan; the craft goal can't be dropped (B109)

**Files:**
- Modify: `src/mind/process/core/post-library.ts` (`craftSkill`), `src/mind/process/core/reflect.ts`
  (drop loop), `src/mind/process/core/appraise.ts` (goal effects), `config/default.json`
  (`posts.craft_skill: { "still": 0 }`), `src/mind/platform/config.ts`,
  `evals/scripts/posts-review.ts` (read the configured skill)
- Test: `tests/mind/process/core/post-library.test.ts`, `tests/mind/process/core/reflect.test.ts`,
  `tests/mind/process/core/appraise.test.ts`

**Interfaces:**
- Produces: `craftSkill(deps, "still"): Promise<{ goalId: string | null; skill: number }>` with
  `skill === config.posts.craft_skill.still`; `isCraftGoal(goal: CoreGoal, config): boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
// post-library.test.ts
test("skill comes from config, and the goal's progress is set to it", async () => {
  const deps = makeTestDeps({ posts: { craft_skill: { still: 0.4 } } });
  const { goalId, skill } = await craftSkill(coreDepsOf(deps), "still");
  expect(skill).toBe(0.4);
  expect((await deps.core.goals.get(goalId!))?.progress).toBe(0.4);
});

test("a dropped craft goal comes back active, even with the active goals full", async () => {
  // insert max_active other active goals and a dropped "Get better at making posts"
  // → craftSkill returns an active goal id
});

// reflect.test.ts
test("reflection can't drop the craft goal", async () => {
  // fake core_reflect output dropping the craft goal's id → it stays active, others drop as before
});

// appraise.test.ts
test("appraisal goal effects skip the craft goal", async () => {
  // an appraisal with a goal effect on the craft goal leaves its progress unchanged
});
```

(Write each with the file's existing fixtures; assert exact statuses and progress.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement**

```ts
/** Her posting skill is set by Ethan, not earned by her loops; her craft goal is how she sees it. */
export const isCraftGoal = (goal: Pick<CoreGoal, "title">, config: Config) =>
  Object.values(config.posts.craft_goals).includes(goal.title);

/**
 * Her skill at a medium is the configured value: outward improvements are timed by Ethan and
 * read in her world as her learning. The craft goal always exists and mirrors the skill.
 */
export async function craftSkill(
  deps: Pick<CoreDeps, "core" | "config" | "embedder" | "log" | "clock">,
  medium: "still",
): Promise<{ goalId: string | null; skill: number }> {
  const { core, config } = deps;
  const skill = config.posts.craft_skill[medium];
  const now = deps.clock.now();
  const title = config.posts.craft_goals[medium];
  const goal = await core.goals.byTitle(title);
  if (goal?.status === "active") {
    if (goal.progress !== skill) await core.goals.setProgress(goal.id, skill, now);
    return { goalId: goal.id, skill };
  }
  const seed = parseSeedGoals(loadPersona(config).seedSelf).find((g) => g.title === title);
  if (!seed) {
    deps.log.info("craft goal not in the persona", { medium });
    return { goalId: null, skill };
  }
  const [embedding] = await deps.embedder.embed([`${seed.title}: ${seed.why}`], "document");
  const goalId = await core.goals.insert({
    ...seed,
    status: "active",
    progress: skill,
    source: "seed",
    source_ref: `persona:${config.prompts.persona}`,
    started_at: now,
    target_at: null,
    embedding: embedding!,
  });
  return { goalId, skill };
}
```

`reflect.ts` drop loop: `const g = await tx.goals.get(id); if (g?.status === "active" && !isCraftGoal(g, config)) …`.
`appraise.ts` goal effects loop: `if (!goal || goal.status !== "active" || isCraftGoal(goal, config)) continue;`.
Config: `posts.craft_skill: { "still": 0 }` (schema `z.object({ still: unit })`, comment: "Set by
Ethan when her posting should get better; she reads it as her own progress"). `posts-review.ts`:
`const skill = cfg.craft_skill.still;` (drop the goal read).

- [ ] **Step 4: Run** `pnpm vitest run tests/mind/process/core` → PASS.

- [ ] **Step 5: Commit** — `git commit -m "feat(posts): her craft skill is configured; the craft goal can't be dropped"`

---

### Task 16: Exit test, spec and docs

**Files:**
- Create: `tests/exit/phase-15d.test.ts`
- Modify: `spica-design-spec-v3.md` (§8.3, §8.5 wander, §11.3 depth, §13, §10.5 guard, §16a, §20
  row, §25 entries), `CLAUDE.md` (current-phase paragraph), `DECISIONS.md` (one line for the
  wander simplification), `docs/2026-10-18-phase-15d-world-outreach-design.md` (§9 wander as built)

- [ ] **Step 1: Write the exit test**, one `test` per design-doc exit item, each reusing the unit
  pieces already proven (pure functions where possible, the DB where the item needs it):

1. `buildCandidates` with a plain-event her_day (depth 1) and a user idea → her_day wins; add a
   due thread → thread wins.
2. `yourDayLines` lists "Earlier today: …".
3. `renderReachOut` (v3) reason has "(Sunday 11 January, yesterday)"; `renderGuardInput` has NOW
   and WHY SPICA IS WRITING FIRST.
4. Thread topic keys `@<fact>` / `@none`; the same thread with the same newest fact is
   `topic_used` after one send (seed `usedTopics`).
5. `herThreshold(null)`, `(12)`, `(1)`.
6. `selectEventSubject` recency; `validatePlan` same-as-yesterday rejection.
7. `pickCue` never returns a thought; used memory drawn less.
8. `joinNight` + `todaysBlocks` across 23:50 (DB).
9. `cutAtWord`; `browseIfDue` skips a repeated image hash (DB, stubbed fetch); a stale weekly
   feed yields null.
10. `craftSkill` returns the configured skill; reflect can't drop the craft goal.
11. The leak canary and side-channel: copy the pattern from `tests/exit/phase-15c.test.ts` (the
    `CANARY` planted in user A's facts never reaches core loop inputs or user B's reach-out
    prompt; user A's reach-out leaves `core_state` unchanged).

- [ ] **Step 2: Run** `pnpm vitest run tests/exit/phase-15d.test.ts` → PASS.

- [ ] **Step 3: Full checks**: `pnpm typecheck`, `pnpm lint`, `pnpm test` (one process; ~10 min),
  `pnpm eval --llm=fake --compare` → no regressions (refresh the baseline only for scripts whose
  expected change this phase explains).

- [ ] **Step 4: Spec and docs**: write each change back into its v3 section (the design doc's
  "Spec updates on build" list), mark §25 B18, B19, B20, B24, B25, B29, B108, B109, B110, B111,
  B117 done with one line each, add the §20 15d row with the final test counts, update
  `CLAUDE.md`'s current-phase paragraph (15d built; Phase 15 tuning complete; next: Ethan's
  review runs), add the `DECISIONS.md` line.

- [ ] **Step 5: Commit** — `git commit -m "test(exit): phase 15d exit and leak canary; docs: record phase 15d"`

---

## Real review runs (after the build; ask Ethan before each, all logged)

- `pnpm review:world-outreach` (simulated user): her news in reach-outs, dates, the reason
  followed, plan/event/thought variety, Alcor, the midnight case. Compare with
  `review-2026-10-17T18-15-24-654Z.md`.
- `pnpm posts:review` with the new sources and prompts.
- `pnpm eval:guard` for guard v4 (the rubric's calibration set; it was 86/87 on v3).
