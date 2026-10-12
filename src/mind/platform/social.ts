/**
 * Where she could speak in public one day. Nothing posts yet: a public-presence module would be
 * a core module holding a channel, so what it posts can only come from her own life.
 */
export interface SocialChannel {
  name: string;
  post(text: string): Promise<void>;
}

/** Keeps what was posted, for tests. */
export class RecordingSocialChannel implements SocialChannel {
  posts: string[] = [];
  constructor(readonly name = "recording") {}
  async post(text: string): Promise<void> {
    this.posts.push(text);
  }
}
