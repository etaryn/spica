/**
 * The labelling call's input: whose zone, what she's into, the open threads, the conversation
 * numbered into pieces, what is already labelled in it, and which messages to label now. Message
 * numbers never shift within a conversation, and what changes from call to call comes last.
 */
import { renderResolved } from "@/mind/platform/time-labels";
import type { CheckedLabels } from "./annotations";
import { renderPieces, type Piece } from "./pieces";

export type ShownThread = { id: string; title: string };
export type LabelInputArgs = {
  pieces: Piece[];
  zone: string;
  threads: ShownThread[];
  /** Her snapshot's Interests, so her own film and book titles read right. */
  interests: string[];
  /** What earlier calls labelled in this conversation. */
  earlier: CheckedLabels;
};

export function buildLabelInput(args: LabelInputArgs): string {
  const sections = [`User's timezone: ${args.zone}`];
  if (args.interests.length) {
    sections.push(
      `What Spica is into (to read her own words right):\n${args.interests.map((i) => `- ${i}`).join("\n")}`,
    );
  }
  sections.push(
    args.threads.length
      ? `Open threads (id | title):\n${args.threads.map((t) => `- ${t.id} | ${t.title}`).join("\n")}`
      : "Open threads: none",
  );
  sections.push(`Conversation:\n${renderPieces(args.pieces, args.zone)}`);
  const already = renderLabels(args.earlier);
  if (already) {
    sections.push(
      `Already labelled in this conversation (don't repeat these; to change a proposition, give its id in updates):\n${already}`,
    );
  }
  sections.push(`Label the new messages (${newMessages(args.pieces)}).`);
  return sections.join("\n\n");
}

/** Labels made earlier, one line each, so a later call can point at them. */
export function renderLabels(l: CheckedLabels): string {
  const groups: [string, string[]][] = [
    [
      "moves",
      l.moves.map(
        (m) => `${m.id} ${m.act} [${m.pieces.join(" ")}]${m.repliesTo ? ` → ${m.repliesTo}` : ""}`,
      ),
    ],
    [
      "mentions",
      l.mentions.map(
        (m) =>
          `${m.id} "${m.words}" [${m.piece}] → ${m.refers_to ?? `new ${m.type ?? "thing"} "${m.name ?? m.words}"`}`,
      ),
    ],
    [
      "times",
      l.times.map(
        (t) =>
          `${t.id} "${t.words}" [${t.piece}] → ${t.resolved ? renderResolved(t.resolved) : `relative to ${t.relativeTo}`}`,
      ),
    ],
    [
      "propositions",
      l.propositions.map((p) =>
        [
          `${p.id} ${p.subject} ${p.kind} "${p.label}"${p.status ? ` ${p.status}` : ""}`,
          `moves ${p.moves.join(" ")}`,
          ...(p.times.length ? [`times ${p.times.join(" ")}`] : []),
          ...(p.thread_id ? [`thread ${p.thread_id}`] : []),
          ...(p.updates ? [`updates ${p.updates}`] : []),
        ].join(" · "),
      ),
    ],
    ["idiolect", l.idiolect.map((i) => `${i.id} ${i.type} [${i.pieces.join(" ")}]`)],
  ];
  return groups
    .filter(([, lines]) => lines.length)
    .map(([name, lines]) => `${name}:\n${lines.map((x) => `- ${x}`).join("\n")}`)
    .join("\n");
}

function newMessages(pieces: Piece[]): string {
  const numbers = pieces.filter((p) => p.isNew).map((p) => Number(p.id.split(".")[0]));
  if (numbers.length === 0) return "none";
  const first = Math.min(...numbers);
  const last = Math.max(...numbers);
  return first === last ? `${first}` : `${first} to ${last}`;
}
