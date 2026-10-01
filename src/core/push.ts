/** Out-of-app delivery of her messages; the service worker hides it while a Spica tab is visible. */
export type PushMessage = { tag: string; body: string; url: string };

export interface Pusher {
  push(userId: string, msg: PushMessage): Promise<void>;
}

export const noopPusher: Pusher = { push: async () => {} };

/** Tests and evals: records synchronously, before any await, so callers needn't wait on the fire-and-forget push. */
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
