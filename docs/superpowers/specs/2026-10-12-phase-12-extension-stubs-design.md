# Phase 12: Extension stubs — design

2026-10-12. Source: v3 §16 (extension points), §20 (Phase 12 row), §4 (scope rules).

## Goal

Plug points, so a future feature can be added as a module without editing the mind. Nothing in
this phase changes what Spica does or says. Exit (v3 §20): a sample module registers and receives
events with no change to the core.

Delivers:

1. A typed **module event bus** with the seven §16 events.
2. **Module registration**, with the scope rule enforced (a core module can never hear a user
   event).
3. A **`public_persona`** read: who she is publicly, from core only.
4. A **`SocialChannel`** interface with a recording implementation, wired to nothing.

Already built, nothing to do: the friend-group hooks `fact.scope` / `fact.space_id`.

No migration, no new config keys, no new prompts. No real module ships; the production module list
is empty.

## Decisions taken in design

- **Delivery is in-process (Ethan, 2026-10-12).** `emit` awaits each subscribed handler in the
  emitting process. Durable delivery (one pg-boss job per subscriber, enqueued in the writing
  transaction) is deferred, not rejected: raise it when a module makes slow or model calls, must
  not miss events, would delay the cold path or a tick, or needs web-process events handled in the
  worker. The `emit` interface stays the same either way. Logged in `DECISIONS.md` and §25.
- **New bus, separate from the chat bus.** The existing `EventBus` (`deps.events`, SSE chat
  notifications over NOTIFY) is unchanged. The new one is `deps.modules`.
- **Events carry ids and small fields, never content**, as the chat events do. A module reads what
  its scope allows through its deps.
- **Events fire after their write commits.** An event inside a transaction that rolls back would
  announce something that never happened.

## 1. The bus and the events

### Where it lives

- `src/mind/platform/modules.ts`: the event types, the `Module` shape, and
  `createModuleBus(modules, getDeps)`, which checks the modules (registration) and returns the
  `ModuleBus` (`emit`). The deps getter lets the bus be built inside `Deps`, so emit sites need
  only `deps.modules`.
- `src/modules/index.ts`: the production module list (`[]`).
- `buildRuntime` (`src/runtime/deps.ts`, shared by the web app and the worker) builds the registry
  from that list, so both processes register the same modules. `makeTestDeps` takes an optional
  module list.
- `Deps` gains `modules: ModuleBus`.
- `CoreDeps` gains `emitCore: (event: CoreEvent) => Promise<void>` (bound from the registry by
  `coreDepsOf`). Core code can announce core events and nothing else; it still can't reach a
  user. A core module's handler gets `coreDepsOf(deps)`, so its model calls are not metered
  against a core loop's budget (fine for stubs; a real module meters its own).

### Events

| Event | Scope | Payload | Emitted from |
|---|---|---|---|
| `turn.received` | user | `userId`, `turnId` | `receiveTurn` after the turn is stored |
| `reply.sent` | user | `userId`, `turnId`, `part` | `deliverPart` after a part is delivered |
| `fact.written` | user | `userId`, `factId`, `kind` | after commit: the cold path (from `encodeExtraction`'s inserted rows), onboarding `submitCard`, and `runUserLoop` for the five user loops (each loop returns the rows it wrote) |
| `relationship.changed` | user | `userId`, `params` (names that moved) | `updateRelationship` and the daily `tickUser`, only when a value moved |
| `user_mind.triggered` | user | `userId`, `runId`, `triggers` (kinds) | `runUserMind` when it claims the run: one place covering every trigger source and the sweep, once per run |
| `world.event` | core | `eventId`, `outcome` (`happened` / `fell_through`) | `core_world_tick` when an event lands, not when it's planned |
| `core.snapshot` | core | `version` | `core_render_snapshot` after a new version commits |

Exact payload field names follow the existing ids at each site; the plan pins them.

### Shapes

```ts
type CoreEvent =
  | { type: "world.event"; eventId: string; outcome: "happened" | "fell_through" }
  | { type: "core.snapshot"; version: number };
type UserEvent = { userId: string } & (
  | { type: "turn.received"; turnId: string }
  | { type: "reply.sent"; turnId: string; part: number }
  | { type: "fact.written"; factId: string; kind: string }
  | { type: "relationship.changed"; params: string[] }
  | { type: "user_mind.triggered"; runId: string; triggers: string[] }
);
type ModuleEvent = CoreEvent | UserEvent;

type CoreModule = {
  name: string;
  scope: "core";
  on: { [T in CoreEvent["type"]]?: (e: Extract<CoreEvent, { type: T }>, deps: CoreDeps) => Promise<void> };
};
type UserModule = {
  name: string;
  scope: "user";
  on: { [T in ModuleEvent["type"]]?: (e: Extract<ModuleEvent, { type: T }>, deps: Deps) => Promise<void> };
};
type Module = CoreModule | UserModule;
```

### Rules

- **Scope (V2 applied to modules).** A core module may subscribe to core events only: the handler
  map's type rejects user events at compile time, and `createModuleBus` throws if a core module
  lists one (the runtime backstop). A user module may hear both kinds (core to user is allowed).
- Handlers get their own scope's deps: a core module gets `CoreDeps`, a user module gets `Deps`.
- `createModuleBus` rejects a duplicate module name.
- `emit` runs subscribed handlers in registration order, awaiting each. A throwing handler is logged
  with the module name, event type and error class (never content); the next handler still runs.
  `emit` never throws, so a module can never fail a reply, a write or a tick.
- `ponytail:` note on `emit`: in-process and awaited; a slow module slows its caller; move to a
  pg-boss job per subscriber when a module needs durability or does real work.

## 2. `public_persona` and `SocialChannel`

### `public_persona`

`publicPersona(deps: Pick<CoreDeps, "core" | "config">)` in
`src/mind/process/core/public-persona.ts`. A pure read: no table, no prompt, no model call.
Returns:

- `coreValues`: from the persona file (`loadPersona`).
- `version`: the latest snapshot's version, or `null` before any snapshot.
- `lines`: the **surface** self lines only (depth 1, what she'd tell an acquaintance): the fixed
  lines (`version: null`, always depth 1: an AI, Alcor, what she loves) plus the latest snapshot's
  depth-1 lines. Depth 2 and 3 never go public.

It never reads the snapshot prose (which can hold deeper material) or core memories: a public post
shouldn't surface her private life. It takes core only, so it cannot name a user. The spec's
"view" is a function, not a database view, because its only reader is code.

### `SocialChannel`

`src/mind/platform/social.ts`:

```ts
interface SocialChannel { name: string; post(text: string): Promise<void> }
class RecordingSocialChannel implements SocialChannel { posts: string[] }
```

Not in `Deps`, no posting job, no compose prompt, no real platform. A future public-presence
module is a core module holding a channel, building posts from `publicPersona` and core events;
by the scope rule it can't hear a user event.

Skipped until the public-presence phase: cadence, a public voice prompt, moderation, rate limits,
and `space_id` on events (add with the friend group).

## 3. Testing

### Unit (`tests/mind/platform/modules.test.ts`, no database)

- `createModuleBus` throws for a core module that lists a user event, and for a duplicate name.
- `emit` reaches only subscribers of that event type, in registration order.
- A throwing handler is logged (module, type, error class only); the next still runs; `emit`
  resolves.
- `emitCore` with a user event is a compile error (`@ts-expect-error`).

### `public_persona` (`tests/mind/process/core/public-persona.test.ts`)

Against the test database's core layer: it returns the core values, the fixed lines and the latest
snapshot's depth-1 lines, and no depth-2 or depth-3 line.

### Exit (`tests/exit/phase-12.test.ts`, all fake)

Two sample modules defined only in the test file, with no edit to `src/`:

- `sample-user`: a user module recording every event.
- `sample-public`: a core module holding a `RecordingSocialChannel`; on `core.snapshot` it posts
  from `publicPersona`.

It drives the real pipeline with `makeTestDeps` and the faked reply model: receive a turn, deliver
a reply, run the cold path (fact written, relationship moved), trigger a big event, land a world
event, render a snapshot. It asserts:

1. `sample-user` received all seven event types with the right ids.
2. `sample-public` received only `world.event` and `core.snapshot`.
3. **Canary:** a token planted in user A's data never appears in anything `sample-public`
   received, read or posted.
4. A module whose handler throws changes no outcome: the reply is delivered and the facts are
   written.
5. With the empty production list the pipeline runs as before (the existing suites stay green).

The existing leak canary (`tests/exit/mind-split.test.ts`) still passes; `pnpm test`, `pnpm
typecheck` and `pnpm lint` pass.

## Spec upkeep (definition of done)

- v3 §16: mark Built 12: the event list and payloads, the scope rule, in-process delivery with
  durable deferred, `public_persona` (surface lines only), `SocialChannel`.
- v3 §5 / §6: `Deps.modules`, `CoreDeps.emitCore`.
- v3 §20: Phase 12 built row with the test count.
- v3 §25: durable module delivery (target: when a module needs it); `space_id` on module events
  (target: the friend group).
- `DECISIONS.md`: in-process delivery; events after commit; ids not content.
- `CLAUDE.md`: current phase line.
