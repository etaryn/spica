import { splitParts } from "@/core/chat/parts";
import type { Deps } from "@/core/deps";
import type { ChatEvent } from "@/core/events";
import { crisisCardFor } from "@/core/safety/crisis";
import { getTurn } from "@/db/repos/session-log";

type Send = (event: string, data: unknown) => void;

/** Resolves a `message` event to its bubble text (user-scoped read); other events pass through. */
export async function forward(deps: Deps, userId: string, e: ChatEvent, send: Send): Promise<void> {
  if (e.type !== "message") return send(e.type, e);
  const t = await getTurn(deps.db, userId, e.turnId);
  if (!t || t.role !== "companion") return;
  const parts = splitParts(t.text, deps.config.chat.max_parts);
  if (e.part < 0 || e.part >= parts.length) {
    deps.log.error("sse message event part out of range", { userId, turnId: e.turnId, part: e.part, of: parts.length });
    return;
  }
  send("message", { turnId: t.id, part: e.part, of: parts.length, text: parts[e.part]!, role: "companion", crisisCard: crisisCardFor(t.safety_flag, deps.config), trigger: t.trigger ?? null });
}

export function createEventsHandler(opts: {
  getUserId(req: Request): Promise<string | null>;
  getDeps(): Deps;
  subscribe(userId: string, fn: (e: ChatEvent) => void, onReset?: () => void): () => void;
  /** Awaited before the stream opens; on rejection the request fails with 503 so EventSource retries. */
  ready?: () => Promise<void>;
}) {
  return async function GET(req: Request): Promise<Response> {
    const userId = await opts.getUserId(req);
    if (!userId) return new Response("unauthorized", { status: 401 });
    if (opts.ready) {
      try {
        await opts.ready();
      } catch {
        return new Response("unavailable", { status: 503 });
      }
    }
    const deps = opts.getDeps();
    const enc = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let open = true;
        const write = (s: string) => { if (open) controller.enqueue(enc.encode(s)); };
        const send: Send = (event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        // Serialise: a message event awaits a DB read, and bubbles must arrive in order.
        let chain = Promise.resolve();
        // A lost LISTEN connection closes the stream (rather than silently keep heart-beating) so
        // EventSource reconnects and the client runs history catch-up on the new connection.
        const unsubscribe = opts.subscribe(userId, (e) => {
          chain = chain.then(() => forward(deps, userId, e, send)).catch((err) =>
            deps.log.error("sse forward failed", { userId, type: e.type, error: err instanceof Error ? err.constructor.name : "UnknownError" }));
        }, () => cleanup());
        const heartbeat = setInterval(() => write(": hb\n\n"), deps.config.events.heartbeat_ms);
        write(": connected\n\n");
        cleanup = () => {
          if (!open) return;
          open = false;
          clearInterval(heartbeat);
          unsubscribe();
          try { controller.close(); } catch { /* already closed */ }
        };
        if (req.signal.aborted) {
          cleanup();
          return;
        }
        req.signal.addEventListener("abort", () => cleanup());
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
  };
}
