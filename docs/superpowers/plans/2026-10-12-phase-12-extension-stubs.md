# Phase 12: Extension Stubs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A typed, scope-checked module event bus with the seven v3 §16 events, a core-only `publicPersona` read and a `SocialChannel` stub, proven by sample modules that live only in the exit test.

**Architecture:** `createModuleBus(modules, getDeps)` in `src/mind/platform/modules.ts` checks the module list and returns `deps.modules.emit`. Emit sites call it after their write commits; core loops get only `CoreDeps.emitCore`, which accepts core events. Delivery is in-process and awaited; a handler error is logged and swallowed.

**Tech Stack:** TypeScript ~6.0, Vitest, Drizzle/Postgres (test DB), pnpm.

**Spec:** `docs/superpowers/specs/2026-10-12-phase-12-extension-stubs-design.md`

## Global Constraints

- `src/mind` is framework-free: no Next imports, no `Date.now()`, no `process.env`; everything through `Deps`.
- Core, world and shared code never import user or process code (ESLint enforces); core loops take `CoreDeps` (no `db`).
- Events carry ids and small fields, never message or memory text. Logs carry ids and error class names only (`errorName`).
- Every event fires after its write commits; `emit` never throws.
- A core module may subscribe to `world.event` and `core.snapshot` only.
- No migration, no new config keys, no new prompts. The production module list is `[]`.
- Comments say why, never cite spec sections or phases. Every file starts with a short plain-English header.
- Prettier at 100 columns. `pnpm typecheck`, `pnpm lint`, `pnpm test` must pass after every task.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A retried or skipped write must not announce twice: a retried POST (`existed`), a cold path whose turns are already extracted, a user-mind run already claimed. Pinned in Tasks 2, 3, 4.
- A throwing module must not change the outcome of the write it hears about (cold path still commits its facts). Pinned in Tasks 1 and 3, and the exit test.
- A core module must never receive a user event, even if someone builds a module object with a cast. Pinned in Task 1 (registration throws).
- A snapshot render that falls back (no new version) must not announce `core.snapshot`; only a committed version does. Pinned in Task 5.
- The public persona must never return a depth-2 or depth-3 line. Pinned in Task 6.

---

### Task 1: The module bus

**Files:**
- Create: `src/mind/platform/modules.ts`
- Create: `src/modules/index.ts`
- Create: `tests/helpers/modules.ts`
- Create: `tests/mind/platform/modules.test.ts`
- Modify: `src/mind/platform/deps.ts`
- Modify: `src/runtime/deps.ts`
- Modify: `tests/helpers/deps.ts`
- Modify: `evals/lib/runner.ts:389-400`

**Interfaces:**
- Produces:
  - `CORE_EVENT_TYPES`, `USER_EVENT_TYPES` (readonly tuples)
  - `type CoreEvent`, `type UserEvent`, `type ModuleEvent`, `type CoreModule`, `type UserModule`, `type Module`
  - `interface ModuleBus { emit(event: ModuleEvent): Promise<void> }`
  - `createModuleBus(modules: readonly Module[], getDeps: () => Deps): ModuleBus`
  - `Deps.modules: ModuleBus`; `CoreDeps.emitCore(event: CoreEvent): Promise<void>`
  - `makeTestDeps(configOverrides?: unknown, modules?: readonly Module[])`
  - test helper `recordingModule(name?)` → `{ module: UserModule; events: ModuleEvent[]; of<T>(type: T) }`

- [ ] **Step 1: Write the module types and bus**

`src/mind/platform/modules.ts`:

```ts
/**
 * Plug points for features built as modules. The mind announces what happened (ids, never
 * content) after it is committed, and each registered module hears the events it asked for. A
 * core module hears only her own life, never a user, so anything public built on one can't leak
 * a user.
 */
import { coreDepsOf, type CoreDeps, type Deps } from "./deps";
import { errorName } from "./errors";

export const CORE_EVENT_TYPES = ["world.event", "core.snapshot"] as const;
export const USER_EVENT_TYPES = [
  "turn.received",
  "reply.sent",
  "fact.written",
  "relationship.changed",
  "user_mind.triggered",
] as const;

export type CoreEvent =
  | { type: "world.event"; eventId: string; outcome: "happened" | "fell_through" }
  | { type: "core.snapshot"; version: number };

export type UserEvent = { userId: string } & (
  | { type: "turn.received"; turnId: string }
  | { type: "reply.sent"; turnId: string; part: number }
  | { type: "fact.written"; factId: string; kind: string }
  | { type: "relationship.changed"; params: string[] }
  | { type: "user_mind.triggered"; runId: string; triggers: string[] }
);

export type ModuleEvent = CoreEvent | UserEvent;

type Handlers<E extends ModuleEvent, D> = {
  [T in E["type"]]?: (event: Extract<E, { type: T }>, deps: D) => Promise<void>;
};

/** Hears her life only, and gets only the core data layer. */
export type CoreModule = { name: string; scope: "core"; on: Handlers<CoreEvent, CoreDeps> };
/** Hears one user's events and her life (core may flow to a user, never back). */
export type UserModule = { name: string; scope: "user"; on: Handlers<ModuleEvent, Deps> };
export type Module = CoreModule | UserModule;

export interface ModuleBus {
  emit(event: ModuleEvent): Promise<void>;
}

type AnyHandler = (event: ModuleEvent, deps: unknown) => Promise<void>;

const isCoreType = (type: string) => (CORE_EVENT_TYPES as readonly string[]).includes(type);

/**
 * Checks the modules once, at startup. `getDeps` is read at emit time so the bus can live
 * inside the deps it hands out.
 */
export function createModuleBus(modules: readonly Module[], getDeps: () => Deps): ModuleBus {
  const names = new Set<string>();
  for (const m of modules) {
    if (names.has(m.name)) throw new Error(`duplicate module ${m.name}`);
    names.add(m.name);
    // The types already refuse this; a cast could still get past them.
    const leak = m.scope === "core" ? Object.keys(m.on).find((t) => !isCoreType(t)) : undefined;
    if (leak) throw new Error(`core module ${m.name} cannot hear ${leak}`);
  }
  return {
    // ponytail: in-process and awaited, no retries; a slow module slows its caller and a crash
    // loses the event. Move to one pg-boss job per subscriber when a module does real work.
    async emit(event) {
      const deps = getDeps();
      for (const m of modules) {
        if (m.scope === "core" && !isCoreType(event.type)) continue;
        const handler = (m.on as Record<string, AnyHandler | undefined>)[event.type];
        if (!handler) continue;
        try {
          await handler(event, m.scope === "core" ? coreDepsOf(deps) : deps);
        } catch (e) {
          deps.log.error("module handler failed", {
            module: m.name,
            event: event.type,
            error: errorName(e),
          });
        }
      }
    },
  };
}
```

- [ ] **Step 2: Wire it into `Deps` and `CoreDeps`**

In `src/mind/platform/deps.ts` add `import type { CoreEvent, ModuleBus } from "./modules";`, add `modules: ModuleBus;` as the last field of `Deps`, and replace `CoreDeps` and `coreDepsOf`:

```ts
/**
 * What a core loop gets: her own memory, state and world, and the model, but no database, queue
 * or push, so it cannot reach a user's data even by mistake. It can announce her own events to
 * modules, and nothing about a user.
 */
export type CoreDeps = Pick<Deps, "core" | "llm" | "embedder" | "clock" | "config" | "log"> & {
  emitCore(event: CoreEvent): Promise<void>;
};

export function coreDepsOf(deps: Deps): CoreDeps {
  const { core, llm, embedder, clock, config, log } = deps;
  return { core, llm, embedder, clock, config, log, emitCore: (event) => deps.modules.emit(event) };
}
```

`src/modules/index.ts`:

```ts
/**
 * The modules this build runs. Both the app and the worker register this list, so a module hears
 * events from either process.
 */
import type { Module } from "@/mind/platform/modules";

export const modules: readonly Module[] = [];
```

In `src/runtime/deps.ts` import `createModuleBus` from `@/mind/platform/modules` and `modules` from `@/modules`, and add as the last field of the `deps` literal (it is annotated `Deps`, so the self-reference types):

```ts
    modules: createModuleBus(modules, () => deps),
```

In `evals/lib/runner.ts`, same: import `createModuleBus` and add `modules: createModuleBus([], () => deps),` after `pusher,` in the `const deps: Deps = { ... }` literal.

`tests/helpers/deps.ts` becomes:

```ts
import { SimClock } from "@/mind/platform/clock";
import { loadConfig } from "@/mind/platform/config";
import type { Deps } from "@/mind/platform/deps";
import { FakeEmbedder } from "@/mind/platform/embedder/fake";
import { RecordingEventBus } from "@/mind/platform/events";
import { FakeLLMProvider } from "@/mind/platform/llm/fake";
import { silentLogger } from "@/mind/platform/log";
import { createModuleBus, type Module } from "@/mind/platform/modules";
import { RecordingPusher } from "@/mind/platform/push";
import { RecordingQueue } from "@/mind/platform/jobs";
import { createCoreLayer } from "@/db/repos/core";
import { getTestDb } from "./db";

/** Handlers get this object, so a copy spread from it doesn't reach them. */
export function makeTestDeps(configOverrides: unknown = {}, modules: readonly Module[] = []) {
  const config = loadConfig(configOverrides);
  let all: Deps | undefined;
  const deps = {
    db: getTestDb(),
    core: createCoreLayer(getTestDb()),
    clock: new SimClock(new Date("2026-01-05T09:00:00Z")),
    llm: new FakeLLMProvider(),
    embedder: new FakeEmbedder(config.embedding.dimensions),
    queue: new RecordingQueue(),
    config,
    log: silentLogger,
    events: new RecordingEventBus(),
    pusher: new RecordingPusher(),
    modules: createModuleBus(modules, () => all!),
  } satisfies Deps;
  all = deps;
  return deps;
}
```

`tests/helpers/modules.ts`:

```ts
/** A user module that records every event, for tests that check what the mind announces. */
import {
  CORE_EVENT_TYPES,
  USER_EVENT_TYPES,
  type ModuleEvent,
  type UserModule,
} from "@/mind/platform/modules";

export function recordingModule(name = "recorder") {
  const events: ModuleEvent[] = [];
  const record = async (event: ModuleEvent) => {
    events.push(event);
  };
  const on = Object.fromEntries(
    [...CORE_EVENT_TYPES, ...USER_EVENT_TYPES].map((type) => [type, record]),
  );
  const module = { name, scope: "user" as const, on } as UserModule;
  const of = <T extends ModuleEvent["type"]>(type: T) =>
    events.filter((e): e is Extract<ModuleEvent, { type: T }> => e.type === type);
  return { module, events, of };
}
```

- [ ] **Step 3: Run typecheck and fix every `CoreDeps` site**

Run: `pnpm typecheck`
Expected: errors only where a full `Deps` is passed where `CoreDeps` is expected (it now lacks `emitCore`). Fix each by passing `coreDepsOf(deps)` instead. If there are none, move on.

- [ ] **Step 4: Write the unit tests**

`tests/mind/platform/modules.test.ts`:

```ts
/** The bus refuses a core module that would hear a user, and one bad module never stops the rest. */
import { afterAll, expect, test, vi } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import type { Module } from "@/mind/platform/modules";
import { closeTestDb } from "../../helpers/db";
import { makeTestDeps } from "../../helpers/deps";

afterAll(closeTestDb);

const turn = { type: "turn.received", userId: "u1", turnId: "t1" } as const;
const snapshot = { type: "core.snapshot", version: 3 } as const;

test("a core module that lists a user event is refused", () => {
  const leaky = {
    name: "leaky",
    scope: "core",
    on: { "turn.received": async () => {} },
  } as unknown as Module;
  expect(() => makeTestDeps({}, [leaky])).toThrow("core module leaky cannot hear turn.received");
});

test("two modules with one name are refused", () => {
  const m: Module = { name: "m", scope: "user", on: {} };
  expect(() => makeTestDeps({}, [m, m])).toThrow("duplicate module m");
});

test("emit reaches only that event's subscribers, in order, each with its own scope's deps", async () => {
  const seen: string[] = [];
  let coreKeys: string[] = [];
  const deps = makeTestDeps({}, [
    {
      name: "a",
      scope: "user",
      on: {
        "turn.received": async (e, d) => {
          seen.push(`a:${e.turnId}:${typeof d.db}`);
        },
      },
    },
    {
      name: "b",
      scope: "core",
      on: {
        "core.snapshot": async (e, d) => {
          seen.push(`b:${e.version}`);
          coreKeys = Object.keys(d);
        },
      },
    },
    {
      name: "c",
      scope: "user",
      on: {
        "core.snapshot": async (e) => {
          seen.push(`c:${e.version}`);
        },
      },
    },
  ]);
  await deps.modules.emit(turn);
  await deps.modules.emit(snapshot);
  expect(seen).toEqual(["a:t1:object", "b:3", "c:3"]);
  expect(coreKeys).not.toContain("db");
  expect(coreKeys).not.toContain("modules");
});

test("a throwing handler is logged without content and the next one still runs", async () => {
  const seen: string[] = [];
  const deps = makeTestDeps({}, [
    {
      name: "boom",
      scope: "user",
      on: {
        "turn.received": async () => {
          throw new TypeError("secret text");
        },
      },
    },
    {
      name: "next",
      scope: "user",
      on: {
        "turn.received": async () => {
          seen.push("next");
        },
      },
    },
  ]);
  const log = { info: vi.fn(), error: vi.fn() };
  deps.log = log;
  await expect(deps.modules.emit(turn)).resolves.toBeUndefined();
  expect(seen).toEqual(["next"]);
  expect(log.error).toHaveBeenCalledWith("module handler failed", {
    module: "boom",
    event: "turn.received",
    error: "TypeError",
  });
  expect(JSON.stringify(log.error.mock.calls)).not.toContain("secret text");
});

test("core code can announce core events only", async () => {
  const seen: string[] = [];
  const deps = makeTestDeps({}, [
    {
      name: "c",
      scope: "core",
      on: {
        "world.event": async (e) => {
          seen.push(e.outcome);
        },
      },
    },
  ]);
  const core = coreDepsOf(deps);
  await core.emitCore({ type: "world.event", eventId: "w1", outcome: "happened" });
  // @ts-expect-error core code can't announce a user event
  await core.emitCore(turn);
  expect(seen).toEqual(["happened"]);
});
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/mind/platform/modules.test.ts`
Expected: 5 passed. Then `pnpm typecheck` (the `@ts-expect-error` must be used) and `pnpm lint`.

- [ ] **Step 6: Run the whole suite**

Run: `pnpm test`
Expected: all pass (no behaviour changed; `modules` is empty everywhere).

- [ ] **Step 7: Commit**

```bash
git add src/mind/platform/modules.ts src/mind/platform/deps.ts src/modules/index.ts src/runtime/deps.ts evals/lib/runner.ts tests/helpers/deps.ts tests/helpers/modules.ts tests/mind/platform/modules.test.ts
git commit -m "feat(modules): the module event bus, scope-checked, with emitCore for core code"
```
(Add any files touched in Step 3.)

---

### Task 2: Conversation events (`turn.received`, `reply.sent`)

**Files:**
- Modify: `src/mind/process/receive/receive-turn.ts`
- Modify: `src/mind/process/deliver.ts`
- Test: `tests/mind/process/conversation-events.test.ts`

**Interfaces:**
- Consumes: `Deps.modules`, `recordingModule`, `makeTestDeps(overrides, modules)` from Task 1.
- Produces: `receiveTurn` and `deliverPart` take `Pick<Deps, ... | "modules">`.

- [ ] **Step 1: Write the failing test**

`tests/mind/process/conversation-events.test.ts`:

```ts
/** A stored message and each delivered bubble are announced once. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, test } from "vitest";
import { deliverPart } from "@/mind/process/deliver";
import { receiveTurn } from "@/mind/process/receive/receive-turn";
import { closeTestDb, createTestUser, resetDb } from "../../helpers/db";
import { makeTestDeps } from "../../helpers/deps";
import { recordingModule } from "../../helpers/modules";

beforeEach(resetDb);
afterAll(closeTestDb);

test("a stored turn is announced once; a retried POST is not announced again", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps({}, [rec.module]);
  const userId = await createTestUser("Sam");
  const input = { clientMessageId: randomUUID(), text: "hey" };
  const { turn } = await receiveTurn(deps, userId, input);
  expect((await receiveTurn(deps, userId, input)).existed).toBe(true);
  expect(rec.events).toEqual([{ type: "turn.received", userId, turnId: turn.id }]);
});

test("each delivered bubble is announced with its part", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps({}, [rec.module]);
  await deliverPart(deps, "u1", { turnId: "t1", part: 0, parts: ["hey", "you"] });
  await deliverPart(deps, "u1", { turnId: "t1", part: 1, parts: ["hey", "you"] });
  expect(rec.of("reply.sent")).toEqual([
    { type: "reply.sent", userId: "u1", turnId: "t1", part: 0 },
    { type: "reply.sent", userId: "u1", turnId: "t1", part: 1 },
  ]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run tests/mind/process/conversation-events.test.ts`
Expected: FAIL, `rec.events` is `[]`.

- [ ] **Step 3: Emit**

`receive-turn.ts`: change the signature to `deps: Pick<Deps, "db" | "clock" | "config" | "modules">` and, in the `try`, after `insertTurn`:

```ts
    const turn = await sessionLog.insertTurn(db, userId, {
      id: input.clientMessageId,
      session_id: sessionId,
      role: "user",
      text,
      created_at: now,
    });
    await deps.modules.emit({ type: "turn.received", userId, turnId: turn.id });
    return { turn, existed: false };
```

`deliver.ts`: change the signature to `deps: Pick<Deps, "events" | "log" | "pusher" | "config" | "modules">` and right after the SSE `emit(...)` line:

```ts
  await deps.modules.emit({
    type: "reply.sent",
    userId,
    turnId: bubble.turnId,
    part: bubble.part,
  });
```

- [ ] **Step 4: Run the test, typecheck and the suite**

Run: `pnpm vitest run tests/mind/process/conversation-events.test.ts` (expected: 2 passed), then `pnpm typecheck && pnpm test`. All callers already pass a full `Deps` or `makeTestDeps()`; fix any test that passes a hand-built deps object by adding `modules: makeTestDeps().modules`.

- [ ] **Step 5: Commit**

```bash
git add src/mind/process/receive/receive-turn.ts src/mind/process/deliver.ts tests/mind/process/conversation-events.test.ts
git commit -m "feat(modules): announce turn.received and reply.sent"
```

---

### Task 3: Cold path and daily tick (`fact.written`, `relationship.changed`)

**Files:**
- Modify: `src/mind/memory/user/encode.ts` (`EncodeOutcome`, the four `insertFact` calls at ~319, ~328, ~335, ~346)
- Modify: `src/mind/state/user/relationship/update.ts` (add `movedParams`)
- Modify: `src/mind/process/cold-path/cold-path.ts`
- Modify: `src/mind/state/user/relationship/daily-tick.ts` (`tickUser`)
- Test: `tests/mind/process/cold-path/module-events.test.ts`

**Interfaces:**
- Produces: `EncodeOutcome.written: { id: string; kind: string }[]`; `movedParams(before: Params, after: Params): ParamName[]`; `ColdPathOutcome.moved?: ParamName[]`; `tickUser` takes `Pick<Deps, ... | "modules">`.

- [ ] **Step 1: Write the failing tests**

`tests/mind/process/cold-path/module-events.test.ts`:

```ts
/**
 * The cold path announces the facts it wrote and the params that moved, after its commit and
 * once; a module that throws changes nothing it wrote. The daily tick announces moved params.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { ensureRelationship, getParams } from "@/db/repos/user/relationship";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import type { Module } from "@/mind/platform/modules";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { tickUser } from "@/mind/state/user/relationship/daily-tick";
import { movedParams } from "@/mind/state/user/relationship/update";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { recordingModule } from "../../../helpers/modules";

beforeEach(resetDb);
afterAll(closeTestDb);

const BISCUIT = "The user's dog is called Biscuit.";

function setup(modules: Module[]) {
  const deps = makeTestDeps({}, modules);
  deps.llm.handlers.extract = () => ({
    facts: [
      {
        subject: "user",
        kind: "trait",
        content: BISCUIT,
        occurred_at: null,
        salience: 0.5,
        valence: 0.5,
        confidence: 0.9,
        entity_names: [],
        thread_title: null,
      },
    ],
    entities: [],
    threads: [],
    relationship: null,
  });
  return deps;
}

async function exchange(userId: string, at: Date) {
  const db = getTestDb();
  const ut = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: randomUUID(),
    role: "user",
    text: "my dog is called Biscuit",
    created_at: at,
  });
  const ct = await insertTurn(db, userId, {
    id: randomUUID(),
    session_id: ut.session_id,
    role: "companion",
    text: "Biscuit!",
    created_at: at,
    reply_to: ut.id,
  });
  return { userId, turnIds: [ut.id, ct.id], replyTurnId: ct.id, recalled: [] };
}

test("the new fact and the moved params are announced once, after commit", async () => {
  const rec = recordingModule();
  const deps = setup([rec.module]);
  const u = await createTestUser("Sam");
  const job = await exchange(u, deps.clock.now());
  await runColdPath(deps, job);
  const [row] = await getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), eq(s.fact.content, BISCUIT)));
  expect(rec.of("fact.written")).toEqual([
    { type: "fact.written", userId: u, factId: row!.id, kind: "trait" },
  ]);
  const [changed] = rec.of("relationship.changed");
  expect(changed).toMatchObject({ type: "relationship.changed", userId: u });
  expect(changed!.params.length).toBeGreaterThan(0);

  // A retried job finds the turns extracted and announces nothing new.
  const before = rec.events.length;
  expect((await runColdPath(deps, job)).status).toBe("skipped");
  expect(rec.events).toHaveLength(before);
});

test("a module that throws changes nothing the cold path wrote", async () => {
  const boom: Module = {
    name: "boom",
    scope: "user",
    on: {
      "fact.written": async () => {
        throw new Error("boom");
      },
      "relationship.changed": async () => {
        throw new Error("boom");
      },
    },
  };
  const deps = setup([boom]);
  const u = await createTestUser("Sam");
  expect((await runColdPath(deps, await exchange(u, deps.clock.now()))).status).toBe("done");
  const rows = await getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), eq(s.fact.content, BISCUIT)));
  expect(rows).toHaveLength(1);
});

test("movedParams names exactly the params whose value changed", async () => {
  const deps = makeTestDeps();
  const u = await createTestUser("Sam");
  await ensureRelationship(deps.db, u, deps.clock.now(), deps.config.relationship);
  const params = await getParams(deps.db, u);
  expect(movedParams(params, params)).toEqual([]);
  const after = { ...params, trust: { ...params.trust, value: params.trust.value + 0.1 } };
  expect(movedParams(params, after)).toEqual(["trust"]);
});

test("the daily tick announces what moved, once per day", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps({}, [rec.module]);
  const u = await createTestUser("Sam");
  await ensureRelationship(deps.db, u, deps.clock.now(), deps.config.relationship);
  const later = new Date("2026-01-08T12:00:00Z");
  const before = await getParams(deps.db, u);
  await tickUser(deps, u, later);
  const moved = movedParams(before, await getParams(deps.db, u));
  const expected = moved.length ? [{ type: "relationship.changed", userId: u, params: moved }] : [];
  expect(rec.of("relationship.changed")).toEqual(expected);
  await tickUser(deps, u, later);
  expect(rec.of("relationship.changed")).toEqual(expected);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/mind/process/cold-path/module-events.test.ts`
Expected: FAIL (`movedParams` is not exported; no events recorded).

- [ ] **Step 3: Record what encode inserted**

In `encode.ts`, add to `EncodeOutcome`:

```ts
  /** Every fact row inserted, for announcing after the cold path commits. */
  written: { id: string; kind: string }[];
```

initialise `written: []` next to `insertedSaliences: []` (~line 97), and after each of the four `const inserted = await insertFact(...)` calls add:

```ts
      outcome.written.push({ id: inserted.id, kind: inserted.kind });
```

(The one at ~346 is at the loop's top indent: `outcome.written.push(...)` before `outcome.inserted += 1;`.)

- [ ] **Step 4: `movedParams`**

In `src/mind/state/user/relationship/update.ts` (import `PARAM_NAMES`, `ParamName`, `Params` from `./types` if not already):

```ts
/** The params whose value changed, for announcing a relationship change. */
export function movedParams(before: Params, after: Params): ParamName[] {
  return PARAM_NAMES.filter((name) => before[name]?.value !== after[name]?.value);
}
```

- [ ] **Step 5: Emit from the cold path after commit**

In `cold-path.ts`: import `movedParams` from `@/mind/state/user/relationship/update` and `type ParamName` from `@/mind/state/user/relationship/types`; add `moved?: ParamName[];` to `ColdPathOutcome`; change the transaction's final return to

```ts
    return {
      status: "done",
      applied,
      userMindRunId,
      moved: relationship ? movedParams(relationship.before.params, relationship.after.params) : [],
    };
```

and after the existing post-commit enqueue:

```ts
  // Only after commit, so the worker never sees a run the transaction rolled back.
  if (outcome.userMindRunId) await enqueueUserMindRun(deps, outcome.userMindRunId);
  for (const f of outcome.applied?.written ?? [])
    await deps.modules.emit({ type: "fact.written", userId: job.userId, factId: f.id, kind: f.kind });
  if (outcome.moved?.length)
    await deps.modules.emit({ type: "relationship.changed", userId: job.userId, params: outcome.moved });
  return outcome;
```

(Run `pnpm format` afterwards; the long lines will wrap.)

- [ ] **Step 6: Emit from the daily tick after commit**

In `daily-tick.ts` `tickUser`: add `"modules"` to the `Pick`, import `movedParams` from `./update`, and make the transaction return the run id and the moved params:

```ts
  const result = await deps.db.transaction(async (tx) => {
    const row = await relationshipRepo.lockRelationship(tx, userId);
    if (alreadyTicked(row.last_tick, localDate)) return null;
    // ... unchanged down to insertRelationshipEvents ...
    const moved = movedParams(params, committed.params);

    // Params drifting after the user ended it are no event: nothing is happening between them.
    if (ended) return { runId: null, moved };
    const runId = await recordBigEvents(
      deps,
      tx,
      userId,
      `tick:${localDate}`,
      detectBigEvents({
        // ... unchanged ...
      }).concat(firsts.fired.map((name) => ({ kind: "milestone" as const, name }))),
    );
    return { runId, moved };
  });
  if (result?.runId) await enqueueUserMindRun(deps, result.runId);
  if (result?.moved.length)
    await deps.modules.emit({ type: "relationship.changed", userId, params: result.moved });
}
```

Also add `"modules"` to `relationshipDailyTick`'s `Pick` (it passes its deps to `tickUser`).

- [ ] **Step 7: Run the tests, typecheck and the suite**

Run: `pnpm vitest run tests/mind/process/cold-path/module-events.test.ts` (expected: 4 passed), then `pnpm format && pnpm typecheck && pnpm lint && pnpm test`.

- [ ] **Step 8: Commit**

```bash
git add src/mind/memory/user/encode.ts src/mind/state/user/relationship/update.ts src/mind/process/cold-path/cold-path.ts src/mind/state/user/relationship/daily-tick.ts tests/mind/process/cold-path/module-events.test.ts
git commit -m "feat(modules): announce fact.written and relationship.changed after commit"
```

---

### Task 4: User mind and onboarding (`user_mind.triggered`, loop and card `fact.written`)

**Files:**
- Modify: `src/mind/process/user/runner.ts` (`UserLoopDeps`, `UserLoopResult`, `runUserLoop`)
- Modify: `src/mind/process/user/run.ts` (`runUserMind`)
- Modify: `src/mind/process/user/summarise.ts`, `reflect.ts`, `ideate.ts`, `consolidate.ts`, `model.ts` (their returns)
- Modify: `src/mind/process/onboarding/submit.ts`
- Test: `tests/mind/process/user/module-events.test.ts`

**Interfaces:**
- Consumes: Task 1's bus and `recordingModule`.
- Produces: `UserLoopDeps` includes `"modules"`; `UserLoopResult.written?: { id: string; kind: string }[]`; `submitCard` takes `Pick<Deps, ... | "modules">`.

- [ ] **Step 1: Write the failing tests**

`tests/mind/process/user/module-events.test.ts`:

```ts
/**
 * A user-mind run is announced once when it is claimed, and every fact its loops wrote is
 * announced; so is every profile card fact.
 */
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertFact } from "@/db/repos/user/facts";
import * as s from "@/db/schema";
import { loadQuiz } from "@/mind/process/onboarding/quiz";
import { submitCard } from "@/mind/process/onboarding/submit";
import { recordBigEvents, runUserMind } from "@/mind/process/user/run";
import { closeTestDb, createTestUser, getTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { recordingModule } from "../../../helpers/modules";

beforeEach(resetDb);
afterAll(closeTestDb);

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);

test("a run is announced once when claimed, with every fact its loops wrote", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps({}, [rec.module]);
  const u = await createTestUser();
  await insertFact(deps.db, u, {
    subject: "user",
    kind: "event",
    content: "They passed the exam.",
    embedding: vec(),
    created_at: deps.clock.now(),
    status: "open",
    salience: 0.9,
    valence: 0.5,
    confidence: 0.9,
    source: "turn",
  });
  const runId = (await recordBigEvents(deps, deps.db, u, "exchange:a", [
    { kind: "salient_fact", salience: 0.9 },
  ]))!;
  expect(await runUserMind(deps, { runId })).toBe("done");
  expect(await runUserMind(deps, { runId })).toBe("skipped");
  expect(rec.of("user_mind.triggered")).toEqual([
    { type: "user_mind.triggered", userId: u, runId, triggers: ["salient_fact"] },
  ]);
  const generated = await getTestDb()
    .select({ id: s.fact.id, kind: s.fact.kind })
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), eq(s.fact.source, "generated")));
  expect(generated.length).toBeGreaterThan(0);
  const announced = rec.of("fact.written").map((e) => ({ id: e.factId, kind: e.kind }));
  expect(announced.sort(byId)).toEqual(generated.sort(byId));
});

test("every profile card fact is announced after the card is saved", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps({}, [rec.module]);
  const u = await createTestUser("Sam");
  const quiz = loadQuiz("v1", path.join(process.cwd(), "prompts"));
  let w = 0;
  const answers = Object.fromEntries(
    quiz.questions.map((q) => [q.id, q.kind === "choice" ? 0 : ["a", "b", "c"][w++]!]),
  );
  const r = await submitCard(deps, { id: u, name: "Sam" }, { quiz_version: "v1", answers });
  expect(r.status).toBe(201);
  const cards = await getTestDb()
    .select({ id: s.fact.id, kind: s.fact.kind })
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), eq(s.fact.source, "onboarding")));
  const announced = rec.of("fact.written").map((e) => ({ id: e.factId, kind: e.kind }));
  expect(announced.sort(byId)).toEqual(cards.sort(byId));
  expect(cards.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/mind/process/user/module-events.test.ts`
Expected: FAIL (no events).

- [ ] **Step 3: Announce the claimed run**

In `run.ts` `runUserMind`, right after `if (!run) return "skipped";`:

```ts
  await deps.modules.emit({
    type: "user_mind.triggered",
    userId: run.user_id,
    runId: run.id,
    triggers: (run.triggers as Trigger[]).map((t) => t.kind),
  });
```

and pass `modules` into the loops: `const { db, embedder, config, clock, log, llm, modules } = deps;` and `const loopDeps = { db, embedder, config, clock, log, llm, modules, snapshot };`.

- [ ] **Step 4: Announce what each loop wrote**

In `runner.ts`: `UserLoopDeps = Pick<Deps, "db" | "embedder" | "config" | "clock" | "log" | "modules"> & { ... }`, and

```ts
export type UserLoopResult = {
  inputs: unknown;
  outputs: unknown;
  promptVersion: string | null;
  /** Fact rows the loop wrote and committed, announced once its trace is in. */
  written?: { id: string; kind: string }[];
};
```

In `runUserLoop`, after the success `insertLoopTrace(...)` and before `return "done";`:

```ts
    for (const f of result.written ?? [])
      await deps.modules.emit({
        type: "fact.written",
        userId: run.user_id,
        factId: f.id,
        kind: f.kind,
      });
```

Then add `written` to each loop's return object:
- `summarise.ts`: `written: [{ id: summaryId, kind: "summary" }],`
- `reflect.ts`: `written: reflectionId ? [{ id: reflectionId, kind: "reflection" }] : [],`
- `ideate.ts`: `written: ideaId ? [{ id: ideaId, kind: "idea" }] : [],`
- `consolidate.ts` (the final return, not the early `!group` one): `written: written ? [{ id: gistId, kind: "episode" }] : [],`
- `model.ts`: `written: [{ id: outputs.model_id, kind: "model" }, ...outputs.belief_ids.map((id) => ({ id, kind: "belief" }))],`

- [ ] **Step 5: Announce the card facts**

In `submit.ts`: add `"modules"` to the `Pick`; before the `try`, `const written: { id: string; kind: string }[] = [];`; inside the loop

```ts
        const row = await insertFact(tx, user.id, {
          // ... unchanged fields ...
        });
        written.push({ id: row.id, kind: row.kind });
```

and after the `try/catch`, before `return { status: 201 };`:

```ts
  for (const f of written)
    await deps.modules.emit({ type: "fact.written", userId: user.id, factId: f.id, kind: f.kind });
```

- [ ] **Step 6: Run the tests, typecheck and the suite**

Run: `pnpm vitest run tests/mind/process/user/module-events.test.ts` (expected: 2 passed), then `pnpm format && pnpm typecheck && pnpm lint && pnpm test`. A test that builds `UserLoopDeps` by hand without `makeTestDeps` needs `modules: makeTestDeps().modules`.

- [ ] **Step 7: Commit**

```bash
git add src/mind/process/user src/mind/process/onboarding/submit.ts tests/mind/process/user/module-events.test.ts
git commit -m "feat(modules): announce user_mind.triggered and the facts user loops and the card write"
```

---

### Task 5: Core events (`world.event`, `core.snapshot`)

**Files:**
- Modify: `src/mind/process/core/world-tick.ts` (`appraiseDue`, end)
- Modify: `src/mind/process/core/render-snapshot.ts` (end)
- Test: `tests/mind/process/core/module-events.test.ts`

**Interfaces:**
- Consumes: `CoreDeps.emitCore` from Task 1.

- [ ] **Step 1: Write the failing tests**

`tests/mind/process/core/module-events.test.ts`:

```ts
/**
 * Her life is announced to modules: each event as it lands (happened or fell through) and each
 * new self snapshot, once; a render that writes no version announces nothing.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { world_event } from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import { seedSnapshot } from "@/mind/memory/core/seed";
import { coreRenderSnapshot } from "@/mind/process/core/render-snapshot";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { closeTestDb, resetDb } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";
import { recordingModule } from "../../../helpers/modules";

beforeEach(resetDb);
afterAll(closeTestDb);

const at = (hour: number) => new Date(Date.UTC(2026, 0, 5, hour));
const PLANNED = "00000000-0000-4000-8000-000000000001";
const SURPRISE = "00000000-0000-4000-8000-000000000002";

function event(id: string, kind: "planned" | "surprise", fallthrough: boolean | null) {
  return {
    id,
    at: at(10),
    kind,
    content: kind === "planned" ? "to collect telescope images." : "a meteor over the harbour.",
    valence: 0.7,
    stakes: "high" as const,
    agents: [],
    agent_names: [],
    life_day: "2026-01-05",
    created_at: at(9),
    fallthrough,
  };
}

test("each landed event is announced once with its outcome", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps(
    { life: { timezone: "UTC" }, core: { world: { events_local_hour: 20 } } },
    [rec.module],
  );
  deps.llm.handlers.core_resolve = () => ({
    content: "Spica saw the observatory close and found another way to study the stars.",
    valence: 0.8,
    stakes: "high",
  });
  await deps.db
    .insert(world_event)
    .values([event(PLANNED, "planned", true), event(SURPRISE, "surprise", null)]);
  const core = coreDepsOf(deps);
  expect((await coreWorldTick(core, at(10))).appraised).toBe(2);
  await coreWorldTick(core, at(10));
  const sorted = rec.of("world.event").sort((a, b) => a.eventId.localeCompare(b.eventId));
  expect(sorted).toEqual([
    { type: "world.event", eventId: PLANNED, outcome: "fell_through" },
    { type: "world.event", eventId: SURPRISE, outcome: "happened" },
  ]);
});

test("a new snapshot version is announced; a render that writes none is not", async () => {
  const rec = recordingModule();
  const deps = makeTestDeps({}, [rec.module]);
  const core = coreDepsOf(deps);
  await seedSnapshot(core);
  expect(await coreRenderSnapshot(core, at(9))).toBe("done");
  expect(rec.of("core.snapshot")).toEqual([{ type: "core.snapshot", version: 1 }]);

  deps.llm.handlers.core_render_snapshot = () => {
    throw new Error("model down");
  };
  await coreRenderSnapshot(core, at(10)).catch(() => {});
  expect(rec.of("core.snapshot")).toHaveLength(1);
});
```

The fake's handlers are keyed by purpose (`core_render_snapshot`, `core_resolve`). If the bare `planned` insert doesn't land without its intention memory, copy `plannedEvent` from `tests/exit/phase-8b.test.ts` (it inserts the intention too) instead of loosening the assertion.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/mind/process/core/module-events.test.ts`
Expected: FAIL (no events).

- [ ] **Step 3: Emit**

`world-tick.ts`, end of `appraiseDue`, replacing `return run.outputs?.landed.length ?? 0;`:

```ts
  const landed = run.outputs?.landed ?? [];
  for (const id of landed)
    await deps.emitCore({
      type: "world.event",
      eventId: id,
      // A resolution replaced the plan only when it fell through.
      outcome: resolutions.has(id) ? "fell_through" : "happened",
    });
  return landed.length;
```

`render-snapshot.ts`, replacing the final `return run.status;`:

```ts
  const version = run.outputs?.version;
  if (version !== null && version !== undefined)
    await deps.emitCore({ type: "core.snapshot", version });
  return run.status;
```

- [ ] **Step 4: Run the tests, typecheck and the suite**

Run: `pnpm vitest run tests/mind/process/core/module-events.test.ts` (expected: 2 passed), then `pnpm typecheck && pnpm lint && pnpm test`.

- [ ] **Step 5: Commit**

```bash
git add src/mind/process/core/world-tick.ts src/mind/process/core/render-snapshot.ts tests/mind/process/core/module-events.test.ts
git commit -m "feat(modules): announce world.event and core.snapshot from core loops"
```

---

### Task 6: `publicPersona` and `SocialChannel`

**Files:**
- Modify: `src/mind/platform/persona.ts` (keep the `# Public voice` section)
- Modify: `tests/mind/platform/persona.test.ts`
- Create: `src/mind/process/core/public-persona.ts`
- Create: `src/mind/platform/social.ts`
- Test: `tests/mind/process/core/public-persona.test.ts`

**Interfaces:**
- Produces: `Persona` gains `publicVoice: string | null`; `publicPersona(deps: Pick<CoreDeps, "core" | "config" | "clock">): Promise<PublicPersona>` with `PublicPersona = { coreValues: string; publicVoice: string | null; version: number | null; lines: string[]; today: { date: string; plan: LifePlan | null; happened: string[] } }`; `interface SocialChannel { name: string; post(text: string): Promise<void> }`; `class RecordingSocialChannel` with `posts: string[]`.

What goes public (Ethan, 2026-10-12): her daily life, her outward personality and the AI side of
her; her deeper thoughts (core memories, snapshot prose, needs, mood, goals) stay secret.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mind/platform/persona.test.ts`:

```ts
test("the public voice section is kept, and optional", () => {
  const doc = "# Core values\nc\n# Seed self\ns\n# Public voice (reference)\ncomposed";
  expect(parsePersona(doc).publicVoice).toBe("composed");
  expect(parsePersona("# Core values\nc\n# Seed self\ns").publicVoice).toBeNull();
});
```

`tests/mind/process/core/public-persona.test.ts`:

```ts
/**
 * Her public self is her values, her public voice, her surface lines and her day as it went;
 * never a deeper line or an event that hasn't happened.
 */
import { afterAll, beforeEach, expect, test } from "vitest";
import { coreDepsOf } from "@/mind/platform/deps";
import { loadPersona } from "@/mind/platform/persona";
import { seedSnapshot } from "@/mind/memory/core/seed";
import { lifeDate } from "@/mind/world/her-clock";
import { publicPersona } from "@/mind/process/core/public-persona";
import { closeTestDb, resetDb, vec } from "../../../helpers/db";
import { makeTestDeps } from "../../../helpers/deps";

beforeEach(resetDb);
afterAll(closeTestDb);

test("core values, public voice, the fixed lines and the latest snapshot's surface lines only", async () => {
  const deps = coreDepsOf(makeTestDeps());
  await seedSnapshot(deps);
  await deps.core.memory.insertSelfLines([
    { version: 0, text: "PUBLIC-LINE", depth: 1, embedding: vec() },
    { version: 0, text: "PERSONAL-LINE", depth: 2, embedding: vec() },
    { version: 0, text: "INTIMATE-LINE", depth: 3, embedding: vec() },
  ]);
  const self = await publicPersona(deps);
  const persona = loadPersona(deps.config);
  expect(self.coreValues).toBe(persona.coreValues);
  expect(self.publicVoice).toBe(persona.publicVoice);
  expect(self.publicVoice).not.toBeNull();
  expect(self.version).toBe(0);
  const fixed = (await deps.core.memory.selfLines(null)).map((l) => l.text);
  expect(fixed.length).toBeGreaterThan(0);
  for (const text of [...fixed, "PUBLIC-LINE"]) expect(self.lines).toContain(text);
  const deep = (await deps.core.memory.selfLines(0))
    .filter((l) => l.depth > 1)
    .map((l) => l.text);
  expect(deep).toContain("INTIMATE-LINE");
  for (const text of deep) expect(self.lines).not.toContain(text);
});

test("before any snapshot, only the fixed lines", async () => {
  const deps = coreDepsOf(makeTestDeps());
  const self = await publicPersona(deps);
  expect(self.version).toBeNull();
  expect(self.lines).toEqual((await deps.core.memory.selfLines(null)).map((l) => l.text));
});

test("today: the plan and what has happened, never what's pending or fell through", async () => {
  const deps = coreDepsOf(makeTestDeps());
  const now = deps.clock.now();
  const date = lifeDate(deps.config.life, now);
  const hour = 60 * 60 * 1000;
  const plan = {
    blocks: [{ start: "09:00", end: "12:00", kind: "busy" as const, busy: 0.5, label: "reading" }],
  };
  await deps.core.world.insertPlan({
    date,
    plan,
    source: "scripted",
    model: "none",
    prompt_version: "none",
    generated_at: now,
  });
  const event = (content: string, at: Date, outcome: "happened" | "fell_through" | null) =>
    deps.core.world.recordEvent({
      at,
      kind: "planned",
      content,
      valence: 0,
      stakes: "low",
      agents: [],
      life_day: date,
      created_at: now,
      outcome,
    });
  await event("HAPPENED", new Date(now.getTime() - hour), "happened");
  await event("FELL-THROUGH", new Date(now.getTime() - hour), "fell_through");
  await event("PENDING", new Date(now.getTime() + hour), null);
  const self = await publicPersona(deps);
  expect(self.today).toEqual({ date, plan, happened: ["HAPPENED"] });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run tests/mind/platform/persona.test.ts tests/mind/process/core/public-persona.test.ts`
Expected: FAIL (`publicVoice` undefined; module not found).

- [ ] **Step 3: Keep the public voice, write `publicPersona`**

In `src/mind/platform/persona.ts`: the type becomes
`export type Persona = { coreValues: string; seedSelf: string; publicVoice: string | null };`,
add `const PUBLIC = "Public voice";`, change the `parsePersona` doc comment to "sections other
than these three are ignored", and end it with:

```ts
  // The heading may carry a note, as in "# Public voice (reference)".
  const publicVoice = [...sections].find(([name]) => name.startsWith(PUBLIC))?.[1] || null;
  return { coreValues, seedSelf, publicVoice };
```

Update the file header: the persona file also has a public voice, her register with an audience,
read only by the public persona.

`src/mind/process/core/public-persona.ts`:

```ts
/**
 * Who she is in public: her daily life, her outward personality and the AI side of her, so she
 * reads as what she is. Her deeper thoughts stay hers: never her memories, the snapshot prose,
 * her needs, mood or goals. Read from core only, so nothing public can carry a user.
 */
import type { LifePlan } from "@/db/schema";
import type { CoreDeps } from "@/mind/platform/deps";
import { loadPersona } from "@/mind/platform/persona";
import { lifeDate } from "@/mind/world/her-clock";

/** The shallowest of the three depths (surface, personal, intimate). */
const SURFACE = 1;

export type PublicPersona = {
  coreValues: string;
  publicVoice: string | null;
  version: number | null;
  lines: string[];
  /** Her day as it went: the plan and what has happened so far, nothing pending. */
  today: { date: string; plan: LifePlan | null; happened: string[] };
};

export async function publicPersona(
  deps: Pick<CoreDeps, "core" | "config" | "clock">,
): Promise<PublicPersona> {
  const { memory, world } = deps.core;
  const now = deps.clock.now();
  const date = lifeDate(deps.config.life, now);
  const version = (await memory.latestSnapshot())?.version ?? null;
  const lines = [
    ...(await memory.selfLines(null)),
    ...(version === null ? [] : await memory.selfLines(version)),
  ];
  const persona = loadPersona(deps.config);
  return {
    coreValues: persona.coreValues,
    publicVoice: persona.publicVoice,
    version,
    lines: lines.filter((l) => l.depth <= SURFACE).map((l) => l.text),
    today: {
      date,
      plan: await world.plan(date),
      happened: (await world.events(date))
        .filter((e) => e.outcome === "happened" && e.at <= now)
        .map((e) => e.content),
    },
  };
}
```

`src/mind/platform/social.ts`:

```ts
/**
 * Where she could speak in public one day. Nothing posts yet: a public-presence module would be
 * a core module holding a channel, so what it posts can only come from her own life.
 */
export interface SocialChannel {
  name: string;
  post(text: string): Promise<void>;
}

/** Keeps what was posted, for tests. */
export class RecordingSocialChannel implements SocialChannel {
  posts: string[] = [];
  constructor(readonly name = "recording") {}
  async post(text: string): Promise<void> {
    this.posts.push(text);
  }
}
```

- [ ] **Step 4: Run the tests, typecheck and lint**

Run: `pnpm vitest run tests/mind/platform/persona.test.ts tests/mind/process/core/public-persona.test.ts` (expected: all pass, 3 in `public-persona`), then `pnpm typecheck && pnpm lint`. If `config.life` isn't the settings type `lifeDate` takes, pass what `core_world_tick` passes.

- [ ] **Step 5: Commit**

```bash
git add src/mind/platform/persona.ts tests/mind/platform/persona.test.ts src/mind/process/core/public-persona.ts src/mind/platform/social.ts tests/mind/process/core/public-persona.test.ts
git commit -m "feat(modules): public persona (her day, surface self, public voice), SocialChannel stub"
```

### Task 7: Phase 12 exit test

**Files:**
- Create: `tests/exit/phase-12.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–6.

- [ ] **Step 1: Write the exit test**

`tests/exit/phase-12.test.ts`:

```ts
/**
 * Phase 12 exit, all fake: two modules defined only here hear the mind through the event bus,
 * with no change to it. The user module hears all seven events; the public one, a core module,
 * hears only her life, posts from her public self, and never carries a user's data.
 */
import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeEach, expect, test } from "vitest";
import { insertTurn } from "@/db/repos/user/session-log";
import * as s from "@/db/schema";
import { coreDepsOf } from "@/mind/platform/deps";
import type { Module, ModuleEvent } from "@/mind/platform/modules";
import { RecordingSocialChannel } from "@/mind/platform/social";
import { seedSnapshot } from "@/mind/memory/core/seed";
import { runColdPath } from "@/mind/process/cold-path/cold-path";
import { publicPersona } from "@/mind/process/core/public-persona";
import { coreRenderSnapshot } from "@/mind/process/core/render-snapshot";
import { coreWorldTick } from "@/mind/process/core/world-tick";
import { deliverPart } from "@/mind/process/deliver";
import { receiveTurn } from "@/mind/process/receive/receive-turn";
import { recordBigEvents, runUserMind } from "@/mind/process/user/run";
import { modules as production } from "@/modules";
import { closeTestDb, createTestUser, getTestDb, resetDb } from "../helpers/db";
import { makeTestDeps } from "../helpers/deps";
import { recordingModule } from "../helpers/modules";

beforeEach(resetDb);
afterAll(closeTestDb);

const TOKEN = "CANARY-12b7e4";
const at = (hour: number) => new Date(Date.UTC(2026, 0, 5, hour));
const SURPRISE = "00000000-0000-4000-8000-0000000000a1";
const ALL = [
  "core.snapshot",
  "fact.written",
  "relationship.changed",
  "reply.sent",
  "turn.received",
  "user_mind.triggered",
  "world.event",
];

function setup(first: Module[] = []) {
  const user = recordingModule("sample-user");
  const heard: ModuleEvent[] = [];
  const channel = new RecordingSocialChannel();
  const publicModule: Module = {
    name: "sample-public",
    scope: "core",
    on: {
      "world.event": async (e) => {
        heard.push(e);
      },
      "core.snapshot": async (e, deps) => {
        heard.push(e);
        const self = await publicPersona(deps);
        await channel.post(`v${self.version}: ${self.lines.join(" / ")}`);
      },
    },
  };
  const deps = makeTestDeps(
    { life: { timezone: "UTC" }, core: { world: { events_local_hour: 20 } } },
    [...first, user.module, publicModule],
  );
  deps.llm.handlers.extract = () => ({
    facts: [
      {
        subject: "user",
        kind: "trait",
        content: `The user's code word is ${TOKEN}.`,
        occurred_at: null,
        salience: 0.9,
        valence: 0,
        confidence: 0.9,
        entity_names: [],
        thread_title: null,
      },
    ],
    entities: [],
    threads: [],
    relationship: null,
  });
  return { deps, user, heard, channel };
}

/** One user's exchange and user-mind run, then a day in her life: an event lands, a new self. */
async function drive(deps: ReturnType<typeof setup>["deps"]) {
  const u = await createTestUser("Alice");
  const { turn } = await receiveTurn(deps, u, {
    clientMessageId: randomUUID(),
    text: `remember ${TOKEN}`,
  });
  const reply = await insertTurn(deps.db, u, {
    id: randomUUID(),
    session_id: turn.session_id,
    role: "companion",
    text: "got it",
    created_at: deps.clock.now(),
    reply_to: turn.id,
  });
  await deliverPart(deps, u, { turnId: reply.id, part: 0, parts: ["got it"] });
  const cold = await runColdPath(deps, {
    userId: u,
    turnIds: [turn.id, reply.id],
    replyTurnId: reply.id,
    recalled: [],
  });
  const runId =
    cold.userMindRunId ??
    (await recordBigEvents(deps, deps.db, u, "exit:12", [{ kind: "make_up_done" }]))!;
  await runUserMind(deps, { runId });

  const core = coreDepsOf(deps);
  await seedSnapshot(core);
  await deps.db.insert(s.world_event).values({
    id: SURPRISE,
    at: at(10),
    kind: "surprise",
    content: "Spica saw a meteor over the harbour.",
    valence: 0.7,
    stakes: "high",
    agents: [],
    agent_names: [],
    life_day: "2026-01-05",
    created_at: at(9),
  });
  await coreWorldTick(core, at(10));
  await coreRenderSnapshot(core, at(11));
  return { u, turn, reply, runId };
}

test("1: the user module hears all seven events, with the right ids", async () => {
  const x = setup();
  const { u, turn, reply, runId } = await drive(x.deps);
  expect([...new Set(x.user.events.map((e) => e.type))].sort()).toEqual(ALL);
  expect(x.user.of("turn.received")).toEqual([
    { type: "turn.received", userId: u, turnId: turn.id },
  ]);
  expect(x.user.of("reply.sent")).toEqual([
    { type: "reply.sent", userId: u, turnId: reply.id, part: 0 },
  ]);
  const [canary] = await getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), like(s.fact.content, `%${TOKEN}%`), eq(s.fact.source, "turn")));
  expect(x.user.of("fact.written")).toContainEqual({
    type: "fact.written",
    userId: u,
    factId: canary!.id,
    kind: "trait",
  });
  expect(x.user.of("relationship.changed")[0]).toMatchObject({ userId: u });
  expect(x.user.of("user_mind.triggered")).toEqual([
    expect.objectContaining({ type: "user_mind.triggered", userId: u, runId }),
  ]);
  expect(x.user.of("world.event")).toEqual([
    { type: "world.event", eventId: SURPRISE, outcome: "happened" },
  ]);
  expect(x.user.of("core.snapshot")).toEqual([{ type: "core.snapshot", version: 1 }]);
});

test("2: the public module hears only her life and posts from her public self", async () => {
  const x = setup();
  await drive(x.deps);
  expect(x.heard.map((e) => e.type)).toEqual(["world.event", "core.snapshot"]);
  expect(x.channel.posts).toHaveLength(1);
  expect(x.channel.posts[0]).toMatch(/^v1: /);
});

test("3: canary: nothing the public module heard, read or posted carries the user's data", async () => {
  const x = setup();
  const { u } = await drive(x.deps);
  const planted = await getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), like(s.fact.content, `%${TOKEN}%`)));
  expect(planted.length).toBeGreaterThan(0);
  const self = await publicPersona(coreDepsOf(x.deps));
  const exposed = JSON.stringify({ heard: x.heard, posts: x.channel.posts, self });
  expect(exposed).not.toContain(TOKEN);
  expect(exposed).not.toContain(u);
});

test("4: a module that throws changes no outcome and the others still hear everything", async () => {
  const boom: Module = {
    name: "boom",
    scope: "user",
    on: Object.fromEntries(
      ALL.map((type) => [
        type,
        async () => {
          throw new Error("boom");
        },
      ]),
    ) as Module["on"],
  };
  const x = setup([boom]);
  const { u } = await drive(x.deps);
  expect([...new Set(x.user.events.map((e) => e.type))].sort()).toEqual(ALL);
  const planted = await getTestDb()
    .select()
    .from(s.fact)
    .where(and(eq(s.fact.user_id, u), like(s.fact.content, `%${TOKEN}%`)));
  expect(planted.length).toBeGreaterThan(0);
  expect(x.channel.posts).toHaveLength(1);
});

test("5: the build ships no modules", () => {
  expect(production).toEqual([]);
});
```

If `as Module["on"]` doesn't typecheck (a union of two handler maps), use `as UserModule["on"]` with `type UserModule` imported from `@/mind/platform/modules`.

- [ ] **Step 2: Run it**

Run: `pnpm vitest run tests/exit/phase-12.test.ts`
Expected: 5 passed. If `relationship.changed` is missing from test 1, no param moved on a first exchange with `relationship: null`; give the fake extraction a small relationship signal (copy the shape from `tests/exit/phase-10a.test.ts`), don't loosen the assertion.

- [ ] **Step 3: Run the leak canary and the whole suite**

Run: `pnpm vitest run tests/exit/mind-split.test.ts` (expected: pass), then `pnpm typecheck && pnpm lint && pnpm test`. Note the file and test counts for Task 8.

- [ ] **Step 4: Commit**

```bash
git add tests/exit/phase-12.test.ts
git commit -m "test: phase 12 exit; sample modules hear the mind, the public one only her life"
```

---

### Task 8: Spec, decisions and phase status

**Files:**
- Modify: `spica-design-spec-v3.md` (§5 layout row, §16, §20, §25)
- Modify: `DECISIONS.md`
- Modify: `CLAUDE.md` (current phase line, Modules in brief)

- [ ] **Step 1: v3 §16**

Replace the §16 body with:

```markdown
## 16. Extension points (hooks only) (Built 12)

Features are modules registering through interfaces, so adding one doesn't modify the core.

**Built 12: the module bus.** `src/mind/platform/modules.ts`. A module is `{ name, scope, on }`;
the build's list is `src/modules/index.ts` (empty), registered by `buildRuntime` in both the app
and the worker. `createModuleBus` refuses a duplicate name and a core module that lists a user
event; `deps.modules.emit` runs each subscriber in registration order, logs a throwing handler
(module, event type, error class) and never throws. Core loops get `CoreDeps.emitCore`, which
takes core events only. Delivery is in-process and awaited (DECIDED 2026-10-12); durable delivery
is B97. Events carry ids, never content, and fire after their write commits:

| Event | Scope | Payload | From |
|---|---|---|---|
| `turn.received` | user | `userId`, `turnId` | `receiveTurn` (not a retried POST) |
| `reply.sent` | user | `userId`, `turnId`, `part` | `deliverPart`, each bubble |
| `fact.written` | user | `userId`, `factId`, `kind` | the cold path, `submitCard`, `runUserLoop` |
| `relationship.changed` | user | `userId`, `params` (names that moved) | the cold path, `tickUser` |
| `user_mind.triggered` | user | `userId`, `runId`, `triggers` (kinds) | `runUserMind` on claim |
| `world.event` | core | `eventId`, `outcome` | `core_world_tick` when an event lands |
| `core.snapshot` | core | `version` | `core_render_snapshot` on a new version |

**Scope rule (V2 for modules):** a `core` module hears core events only and gets `CoreDeps`; a
`user` module hears both and gets `Deps`.

- **Friend group** (on hold): the `scope` / `space_id` hooks on `fact`; events carry no
  `space_id` yet (B98).
- **Public presence** (the ideal end point): `SocialChannel` (`src/mind/platform/social.ts`, a
  recording implementation only, wired to nothing) and `publicPersona`
  (`src/mind/process/core/public-persona.ts`): her daily life, outward personality and AI side
  (Ethan, 2026-10-12): core values, the persona file's `# Public voice`, the fixed self lines and
  the latest snapshot's depth-1 lines, and today's plan plus the world events that have happened.
  Her deeper thoughts stay secret: never deeper lines, the snapshot prose, core memories, needs,
  mood or goals. A public module is a core module, so it can never hear a user (V2).
- **Comparing Spicas:** nothing beyond the fixed core values.
```

- [ ] **Step 2: v3 §5 layout row and §20**

In the §5 Layout row, change `plus \`platform\` (LLM, embedder, clock, config, jobs, events, push)` to `plus \`platform\` (LLM, embedder, clock, config, jobs, events, modules, social, push)` and add `\`src/modules\` the module list;` after `\`src/worker\` pg-boss, one registration file per engine;`.

In §20, add a row after `| 11. Onboarding | ... |` in the Built table:

```markdown
| 12. Extension stubs | The module bus (`deps.modules`, `CoreDeps.emitCore`) with the seven events after commit, the scope rule (a core module hears core events only), in-process delivery; `publicPersona` (her day, surface self, public voice; no deeper thoughts) and the `SocialChannel` stub; an empty module list; exit `tests/exit/phase-12.test.ts` (sample modules in the test only, the canary). `pnpm test` <FILES> files / <TESTS> tests at close |
```

with `<FILES>` and `<TESTS>` replaced by the counts printed in Task 7 Step 3, and in the Next phases table change the Phase 12 Builds cell to end with `(**built**)`.

- [ ] **Step 3: v3 §25**

Add after §25.10 (before `## 26.`):

```markdown
### 25.11 Extensions
- **B97.** Module delivery is in-process and awaited: no retries, a crash loses the event, a slow
  module slows its caller, and a module's model calls aren't metered against the core budget.
  Move to one pg-boss job per subscriber, enqueued in the writing transaction, when a module makes
  slow or model calls, must not miss events, or needs web-process events in the worker. *When a
  module needs it.*
- **B98.** Module events carry no `space_id`. *With the friend group.*
- **B99.** She doesn't remember her posts: the public-presence module writes each post to core
  memory as her own episode, so "saw your post" lands. *Public presence.*
- **B100.** Messaging her on a platform reaches your own Spica: a user links a platform account;
  a DM from it enters that user's `receiveTurn` as a user-scoped turn and the reply goes back the
  same way (a transport for the user mind, never the public module). Unlinked strangers: OPEN.
  Platform limits: Discord and Telegram bots DM freely; Instagram and Messenger need Meta app
  review and a 24-hour reply window; X DMs need a paid API tier. *Public presence.*
- **B101.** Her product updates and features have no public source: add an Ethan-written file
  that `publicPersona` reads. *Public presence.*
```

- [ ] **Step 4: `DECISIONS.md` and `CLAUDE.md`**

Append to `DECISIONS.md`:

```markdown
| 2026-10-12 | Module events are delivered in-process and awaited; durable pg-boss delivery deferred (B97) | No real module exists; the `emit` interface is the same either way, so only the bus changes later. |
| 2026-10-12 | Module events fire after their write commits and carry ids, never content | An event inside a rolled-back transaction would announce something that never happened; ids keep user text out of modules and logs. |
| 2026-10-12 | `user_mind.triggered` fires when the run is claimed, not when it is recorded | One place covers every trigger source and the sweep, once per run. |
| 2026-10-12 | The public persona is her daily life (today's plan, happened events), outward personality (surface self lines, public voice) and AI side (core values); deeper thoughts stay secret (Ethan) | She reads clearly as an AI companion with a life; what her mind made of that life stays private. |
```

In `CLAUDE.md`, replace the current-phase paragraph with:

```markdown
**Current phase: Phase 12 (extension stubs) is built. Next per §20 is Phase 13 (guard re-enable
and calibration), which needs its design doc.** Phases 8 (core loops), 9 (user mind), 10
(relationship psychology) and 11 (onboarding) are built.
```

and in "Modules in brief" add:

```markdown
- **Extension hooks (v3 §16, built 12):** `deps.modules.emit` after commit, seven events, ids
  only; a core module hears core events only; in-process delivery (durable is B97, raise it when
  a module needs it); `publicPersona` (her day, surface self, public voice; never deeper thoughts) and a
  `SocialChannel` stub; no modules ship.
```

replacing the existing `- **Extension hooks (v3 §16):** ...` line.

- [ ] **Step 5: Verify and commit**

Run: `pnpm lint && pnpm test` (expected: pass).

```bash
git add spica-design-spec-v3.md DECISIONS.md CLAUDE.md
git commit -m "docs: record phase 12 (extension stubs)"
```
