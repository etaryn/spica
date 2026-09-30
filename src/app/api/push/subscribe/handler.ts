import { z } from "zod";
import type { Deps } from "@/core/deps";
import { deletePushSubscription, upsertPushSubscription } from "@/db/repos/push";

const Sub = z.object({ endpoint: z.url().max(2048), keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }) });
const Unsub = z.object({ endpoint: z.url().max(2048) });

export function createPushHandler(opts: { getUserId(req: Request): Promise<string | null>; getDeps(): Deps }) {
  async function withUser(req: Request, fn: (userId: string, deps: Deps, body: unknown) => Promise<Response>): Promise<Response> {
    const userId = await opts.getUserId(req);
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
    return fn(userId, opts.getDeps(), await req.json().catch(() => null));
  }
  return {
    POST: (req: Request) => withUser(req, async (userId, deps, body) => {
      const p = Sub.safeParse(body);
      if (!p.success) return Response.json({ error: "invalid_body" }, { status: 400 });
      await upsertPushSubscription(deps.db, userId, { endpoint: p.data.endpoint, ...p.data.keys }, deps.clock.now());
      return new Response(null, { status: 204 });
    }),
    DELETE: (req: Request) => withUser(req, async (userId, deps, body) => {
      const p = Unsub.safeParse(body);
      if (!p.success) return Response.json({ error: "invalid_body" }, { status: 400 });
      await deletePushSubscription(deps.db, userId, p.data.endpoint);
      return new Response(null, { status: 204 });
    }),
  };
}
