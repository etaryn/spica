/**
 * Where the labelling replay's recorded conversations come from: a world run's DB dump (every turn,
 * with its session and what it replied to) and its call log (the threads and her interests each
 * extract call was shown, and v11's output). Reads files only.
 */
import { readFileSync } from "node:fs";
import { conversations, type LayerTurn } from "@/mind/memory/user/layers";
import type { ShownThread } from "@/mind/memory/user/label-input";
import { zoneOrUtc } from "@/mind/platform/timezone";

export type ReplayExchange = {
  burst: string[];
  replyId: string;
  threads: ShownThread[];
  interests: string[];
  /** What v11 extracted from this exchange in the recorded run; null when no logged call matched. */
  v11: unknown;
};
export type ReplayConversation = {
  run: string;
  id: string;
  zone: string;
  /** What a right reading gives, for the invented conversations. */
  note?: string;
  /** The turns just before the conversation, shown as context. */
  before: LayerTurn[];
  turns: LayerTurn[];
  exchanges: ReplayExchange[];
};

type DumpTurn = Omit<LayerTurn, "created_at"> & { created_at: string };
type LoggedCall = { purpose: string; input: string; output?: unknown };

const NEW_EXCHANGE = "New exchange (extract from this):";

/** The threads and interests a logged v11 extract input showed. */
export function parseLoggedInput(input: string): { threads: ShownThread[]; interests: string[] } {
  const items = (header: string) => {
    const at = input.indexOf(`${header}\n`);
    if (at === -1) return [];
    const rest = input.slice(at + header.length + 1);
    const end = rest.indexOf("\n\n");
    return (end === -1 ? rest : rest.slice(0, end))
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2));
  };
  return {
    threads: items("Open threads (id | title):").map((line) => {
      const [id, ...title] = line.split(" | ");
      return { id: id!, title: title.join(" | ") };
    }),
    interests: items("What Spica is into (to read her own words right):"),
  };
}

export function loadRun(
  run: string,
  dumpPath: string,
  callLogPath: string,
  contextTurns: number,
): ReplayConversation[] {
  const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as {
    session_log: DumpTurn[];
    user: { timezone: string | null }[];
  };
  const turns: LayerTurn[] = dump.session_log
    .map((t) => ({
      id: t.id,
      role: t.role,
      text: t.text,
      created_at: new Date(t.created_at),
      session_id: t.session_id,
      reply_to: t.reply_to,
      trigger: t.trigger,
    }))
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  const calls = readFileSync(callLogPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedCall)
    .filter((c) => c.purpose === "extract");
  const zone = zoneOrUtc(dump.user[0]?.timezone);

  return conversations(turns).map((c) => {
    const start = turns.findIndex((t) => t.id === c.turns[0]!.id);
    return {
      run,
      id: c.id,
      zone,
      before: turns.slice(Math.max(0, start - contextTurns), start),
      turns: c.turns,
      exchanges: c.exchanges.map((e) => {
        const reply = c.turns.find((t) => t.id === e.replyId)!;
        // The call whose new exchange holds her reply, word for word.
        const call = calls.find((x) => {
          const at = x.input.indexOf(NEW_EXCHANGE);
          return at !== -1 && x.input.slice(at).includes(`Spica: ${reply.text}`);
        });
        return {
          ...e,
          ...(call ? parseLoggedInput(call.input) : { threads: [], interests: [] }),
          v11: call?.output ?? null,
        };
      }),
    };
  });
}
