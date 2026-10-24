/**
 * The layers code makes from the transcript alone: conversations (the turns sharing a session) and
 * exchanges (a reply of hers with the run of user turns it answers, or a reach-out on its own). No
 * model is involved, so these are always right about what they are.
 */
import type { Turn } from "@/db/repos/user/session-log";
import type { Message } from "./pieces";

export type LayerTurn = Pick<
  Turn,
  "id" | "role" | "text" | "created_at" | "session_id" | "reply_to" | "trigger"
>;
/** What one cold-path job reads: the user turns her reply answers (the burst), then the reply. */
export type Exchange = { burst: string[]; replyId: string };
export type Conversation = { id: string; turns: LayerTurn[]; exchanges: Exchange[] };

export function conversations(turns: LayerTurn[]): Conversation[] {
  const byId = new Map<string, Conversation>();
  let burst: string[] = [];
  for (const turn of [...turns].sort((a, b) => a.created_at.getTime() - b.created_at.getTime())) {
    const conversation = byId.get(turn.session_id) ?? {
      id: turn.session_id,
      turns: [],
      exchanges: [],
    };
    byId.set(turn.session_id, conversation);
    conversation.turns.push(turn);
    if (turn.role === "user") {
      burst.push(turn.id);
      continue;
    }
    // Only a reply or a reach-out ends an exchange; a backchannel or a busy note sits inside one.
    if (turn.reply_to) {
      const answered = burst.indexOf(turn.reply_to) + 1;
      conversation.exchanges.push({ burst: burst.slice(0, answered), replyId: turn.id });
      burst = burst.slice(answered);
    } else if (turn.trigger === "reach_out") {
      conversation.exchanges.push({ burst: [], replyId: turn.id });
    }
  }
  return [...byId.values()];
}

export function messagesOf(turns: LayerTurn[]): Message[] {
  return turns.map((t) => ({
    id: t.id,
    speaker: t.role === "user" ? "user" : "spica",
    text: t.text,
    at: t.created_at,
  }));
}
