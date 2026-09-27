import { Client } from "pg";
import { isChatEvent, type ChatEvent } from "@/core/events";
import type { Logger } from "@/core/log";

type Listener = (e: ChatEvent) => void;

/**
 * One LISTEN connection per process, fanning notifications out to in-memory subscribers by userId
 * (design §8.1). Reconnects with backoff; clients catch up from history on their own reconnect.
 */
export class EventHub {
  private subs = new Map<string, Set<Listener>>();
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private backoffMs = 1000;
  private stopped = false;

  constructor(private readonly url: string, private readonly channel: string, private readonly log: Logger) {
    if (!/^[a-z_][a-z0-9_]*$/.test(channel)) throw new Error("invalid channel name");
  }

  subscribe(userId: string, fn: Listener): () => void {
    let set = this.subs.get(userId);
    if (!set) this.subs.set(userId, (set = new Set()));
    set.add(fn);
    void this.ready().catch(() => {});
    return () => {
      set.delete(fn);
      if (set.size === 0) this.subs.delete(userId);
    };
  }

  ready(): Promise<void> {
    this.connecting ??= this.connect();
    return this.connecting;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const c = this.client;
    this.client = null;
    await c?.end().catch(() => {});
  }

  private async connect(): Promise<void> {
    const c = new Client({ connectionString: this.url });
    c.on("notification", (m) => this.dispatch(m.payload));
    const lost = () => this.onLost(c);
    c.on("error", lost);
    c.on("end", lost);
    try {
      await c.connect();
      await c.query(`LISTEN ${this.channel}`);
      this.client = c;
      this.backoffMs = 1000;
    } catch (e) {
      this.log.error("event hub connect failed", { error: e instanceof Error ? e.constructor.name : "UnknownError" });
      this.connecting = null;
      await c.end().catch(() => {});
      this.retryLater();
      throw e;
    }
  }

  private onLost(c: Client): void {
    if (this.client !== c || this.stopped) return;
    this.client = null;
    this.connecting = null;
    this.retryLater();
  }

  private retryLater(): void {
    if (this.stopped) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(30_000, this.backoffMs * 2);
    setTimeout(() => { void this.ready().catch(() => {}); }, wait).unref?.();
  }

  private dispatch(payload: string | undefined): void {
    if (!payload) return;
    let parsed: unknown;
    try { parsed = JSON.parse(payload); } catch { return; }
    if (!parsed || typeof parsed !== "object") return;
    const { userId, ...event } = parsed as { userId?: unknown };
    if (typeof userId !== "string" || !isChatEvent(event)) return;
    for (const fn of this.subs.get(userId) ?? []) {
      try { fn(event); } catch { /* one bad subscriber never affects the others */ }
    }
  }
}
