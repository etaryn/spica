import { z } from "zod";
import { handleUserMessage } from "@/core/chat/handle-user-message";
import type { Deps } from "@/core/deps";
import { ConflictError, InputError, ReplyFailedError } from "@/core/errors";

const Body = z.object({ clientMessageId: z.uuid(), text: z.string() });

export function createChatHandler(opts: { getUserId(req: Request): Promise<string | null>; getDeps(): Deps }) {
  return async function POST(req: Request): Promise<Response> {
    const userId = await opts.getUserId(req);
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400 });

    try {
      return Response.json(await handleUserMessage(opts.getDeps(), userId, parsed.data));
    } catch (e) {
      if (e instanceof InputError) return Response.json({ error: "invalid_message", message: e.message }, { status: 400 });
      if (e instanceof ConflictError) return Response.json({ error: "conflict" }, { status: 409 });
      if (e instanceof ReplyFailedError) {
        return Response.json({ error: "reply_failed", crisisCard: e.crisisCard }, { status: 503 });
      }
      throw e;
    }
  };
}
