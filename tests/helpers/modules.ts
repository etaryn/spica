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
