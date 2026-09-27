import { z } from "zod";
import { splitParts } from "@/core/chat/parts";
import type { Config, CrisisCard } from "@/core/config";
import type { Deps } from "@/core/deps";
import { crisisCardFor } from "@/core/safety/crisis";
import { recentTurns, turnsAfter, type Turn } from "@/db/repos/session-log";

export type HistoryMessage = { id: string; role: "user" | "companion"; parts: string[]; crisisCard: CrisisCard | null; trigger: string | null };

export function toHistoryMessage(t: Turn, config: Config): HistoryMessage {
  return {
    id: t.id, role: t.role,
    parts: t.role === "companion" ? splitParts(t.text, config.chat.max_parts) : [t.text],
    crisisCard: crisisCardFor(t.safety_flag, config), trigger: t.trigger ?? null,
  };
}

const After = z.uuid();

export function createHistoryHandler(opts: { getUserId(req: Request): Promise<string | null>; getDeps(): Deps }) {
  return async function GET(req: Request): Promise<Response> {
    const userId = await opts.getUserId(req);
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
    const { db, config } = opts.getDeps();
    const after = new URL(req.url).searchParams.get("after");
    if (after !== null && !After.safeParse(after).success) return Response.json({ error: "invalid_after" }, { status: 400 });
    const turns = after ? await turnsAfter(db, userId, after, config.chat.history_page_size) : await recentTurns(db, userId, config.chat.history_page_size);
    return Response.json({ messages: turns.map((t) => toHistoryMessage(t, config)) });
  };
}
