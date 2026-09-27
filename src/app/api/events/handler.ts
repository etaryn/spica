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
  send("message", { turnId: t.id, part: e.part, of: parts.length, text: parts[e.part] ?? "", role: "companion", crisisCard: crisisCardFor(t.safety_flag, deps.config), trigger: t.trigger ?? null });
}

export function createEventsHandler(opts: {
  getUserId(req: Request): Promise<string | null>;
  getDeps(): Deps;
  subscribe(userId: string, fn: (e: ChatEvent) => void): () => void;
}) {
  return async function GET(req: Request): Promise<Response> {
    const userId = await opts.getUserId(req);
    if (!userId) return new Response("unauthorized", { status: 401 });
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
        const unsubscribe = opts.subscribe(userId, (e) => {
          chain = chain.then(() => forward(deps, userId, e, send)).catch((err) =>
            deps.log.error("sse forward failed", { userId, type: e.type, error: err instanceof Error ? err.constructor.name : "UnknownError" }));
        });
        const heartbeat = setInterval(() => write(": hb\n\n"), deps.config.events.heartbeat_ms);
        write(": connected\n\n");
        cleanup = () => {
          if (!open) return;
          open = false;
          clearInterval(heartbeat);
          unsubscribe();
          try { controller.close(); } catch { /* already closed */ }
        };
        req.signal.addEventListener("abort", () => cleanup());
      },
      cancel() { cleanup(); },
    });
    return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
  };
}
