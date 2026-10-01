/**
 * Web Push: delivers her messages outside the app. The service worker hides the notification
 * while a Spica tab is visible.
 */

export type PushMessage = { tag: string; body: string; url: string };

export interface Pusher {
  push(userId: string, msg: PushMessage): Promise<void>;
}

export const noopPusher: Pusher = { push: async () => {} };

/**
 * Tests and evals. Records synchronously, before any await, so callers don't have to wait on a
 * fire-and-forget push to see it.
 */
export class RecordingPusher implements Pusher {
  pushes: { userId: string; msg: PushMessage }[] = [];
  failNext = false;

  push(userId: string, msg: PushMessage): Promise<void> {
    this.pushes.push({ userId, msg });

    if (this.failNext) {
      this.failNext = false;
      return Promise.reject(new Error("push unavailable"));
    }
    return Promise.resolve();
  }
}
