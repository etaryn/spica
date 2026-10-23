/**
 * Every prompt passes through here on its way to a model: each date token in it is rendered on
 * its own calendar relative to the clock's now, so the model reads dates on the day it reads them
 * and never counts days. Wrapping by delegation keeps the inner provider's own fields reachable.
 */
import type { Clock } from "../clock";
import { renderTimes } from "../time-anchors";
import type { LLMProvider } from "./types";

export function withTimeRendering<T extends LLMProvider>(
  inner: T,
  clock: Clock,
  maxDays: number,
): T {
  const render = (text: string) => renderTimes(text, clock.now(), maxDays);
  const wrapped = Object.create(inner) as T;
  wrapped.generateReply = (request) =>
    inner.generateReply({
      system: request.system.map((b) => ({ ...b, text: render(b.text) })),
      messages: request.messages.map((m) => ({ ...m, content: render(m.content) })),
    });
  wrapped.classifyJson = (request) =>
    inner.classifyJson({
      ...request,
      system: render(request.system),
      input: render(request.input),
    });
  return wrapped;
}
