import webpush from "web-push";
import type { Pusher, PushMessage } from "@/mind/platform/push";
import type { Logger } from "@/mind/platform/log";
import { errorName } from "@/mind/platform/errors";
import type { Db } from "@/db/client";
import { deletePushSubscription, listPushSubscriptions } from "@/db/repos/push";

type Send = typeof webpush.sendNotification;
export type WebPushConfig = {
  publicKey: string;
  privateKey: string;
  subject: string;
  ttlSeconds: number;
  timeoutMs: number;
};

/** Sends to each of the user's subscriptions; 404/410 means the browser dropped it, so delete it. */
export class WebPushPusher implements Pusher {
  constructor(
    private readonly db: Db,
    private readonly cfg: WebPushConfig,
    private readonly log: Logger,
    private readonly send: Send = webpush.sendNotification,
  ) {}

  async push(userId: string, msg: PushMessage): Promise<void> {
    const subs = await listPushSubscriptions(this.db, userId);
    const payload = JSON.stringify({ title: "Spica", ...msg });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await this.send(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
            {
              TTL: this.cfg.ttlSeconds,
              timeout: this.cfg.timeoutMs,
              vapidDetails: {
                subject: this.cfg.subject,
                publicKey: this.cfg.publicKey,
                privateKey: this.cfg.privateKey,
              },
            },
          );
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410)
            await deletePushSubscription(this.db, userId, s.endpoint);
          else
            this.log.error("web push failed", {
              userId,
              status: status ?? null,
              error: errorName(e),
            });
        }
      }),
    );
  }
}
