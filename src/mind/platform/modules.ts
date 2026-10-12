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
    // Anything but a known scope fails closed: it would otherwise get a user module's access.
    const scope: string = m.scope;
    if (scope !== "core" && scope !== "user")
      throw new Error(`module ${m.name} has unknown scope ${scope}`);
    // The types already refuse this; a cast could still get past them.
    const leak = m.scope === "core" ? Object.keys(m.on).find((t) => !isCoreType(t)) : undefined;
    if (leak) throw new Error(`core module ${m.name} cannot hear ${leak}`);
  }
  return {
    // ponytail: in-process and awaited (except where a crisis may follow), no retries; a slow
    // module slows its caller and a crash loses the event. Move to one pg-boss job per
    // subscriber when a module does real work.
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
