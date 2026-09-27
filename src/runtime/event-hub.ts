import { Client } from "pg";
import { isChatEvent, type ChatEvent } from "@/core/events";
import type { Logger } from "@/core/log";

type Listener = (e: ChatEvent) => void;
type Sub = { fn: Listener; onReset?: () => void };

/**
 * One LISTEN connection per process, fanning notifications out to in-memory subscribers by userId
 * (design §8.1). Reconnects with backoff; on loss every subscriber's `onReset` fires so its caller
 * (the SSE handler) can close the stream and let the client reconnect and catch up from history —
 * an open stream that just keeps heart-beating would never know it missed anything.
 */
export class EventHub {
  private subs = new Map<string, Set<Sub>>();
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryPromise: Promise<void> | null = null;
  private backoffMs = 1000;
  private stopped = false;

  constructor(private readonly url: string, private readonly channel: string, private readonly log: Logger) {
    if (!/^[a-z_][a-z0-9_]*$/.test(channel)) throw new Error("invalid channel name");
  }

  subscribe(userId: string, fn: Listener, onReset?: () => void): () => void {
    let set = this.subs.get(userId);
    if (!set) this.subs.set(userId, (set = new Set()));
    const sub: Sub = { fn, onReset };
    set.add(sub);
    void this.ready().catch(() => {});
    return () => {
      set.delete(sub);
      if (set.size === 0) this.subs.delete(userId);
    };
  }

  /** Resolves once connected. During an outage, returns the already-scheduled retry rather than jumping the backoff queue. */
  ready(): Promise<void> {
    if (this.connecting) return this.connecting;
    if (this.retryPromise) return this.retryPromise;
    this.connecting = this.connect();
    return this.connecting;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.retryPromise = null;
    const c = this.client;
    this.client = null;
    this.connecting = null;
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
      if (this.stopped) {
        // stop() ran while this connect() was in flight: don't adopt a client the hub no longer owns.
        await c.end().catch(() => {});
        return;
      }
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
    for (const set of this.subs.values()) {
      for (const sub of set) {
        try { sub.onReset?.(); } catch { /* one bad subscriber never affects the others */ }
      }
    }
    this.retryLater();
  }

  /** Schedules the next reconnect attempt. At most one pending timer: a subscribe/ready during the wait joins it instead of starting a second connect. */
  private retryLater(): void {
    if (this.stopped || this.retryTimer) return;
    const wait = this.backoffMs;
    this.backoffMs = Math.min(30_000, this.backoffMs * 2);
    this.retryPromise = new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        this.retryTimer = null;
        this.retryPromise = null;
        this.connecting = this.connect();
        this.connecting.then(resolve, reject);
      }, wait);
      t.unref?.();
      this.retryTimer = t;
    });
  }

  private dispatch(payload: string | undefined): void {
    if (!payload) return;
    let parsed: unknown;
    try { parsed = JSON.parse(payload); } catch { return; }
    if (!parsed || typeof parsed !== "object") return;
    const { userId, ...event } = parsed as { userId?: unknown };
    if (typeof userId !== "string" || !isChatEvent(event)) return;
    for (const sub of this.subs.get(userId) ?? []) {
      try { sub.fn(event); } catch { /* one bad subscriber never affects the others */ }
    }
  }
}
