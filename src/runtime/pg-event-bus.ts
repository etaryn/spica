import { sql } from "drizzle-orm";
import type { ChatEvent, EventBus } from "@/core/events";
import type { Db } from "@/db/client";

/** NOTIFY on the shared channel; every web process's EventHub routes by userId. */
export class PgEventBus implements EventBus {
  constructor(
    private readonly db: Db,
    private readonly channel: string,
  ) {}
  async publish(userId: string, event: ChatEvent): Promise<void> {
    await this.db.execute(
      sql`SELECT pg_notify(${this.channel}, ${JSON.stringify({ userId, ...event })})`,
    );
  }
}
