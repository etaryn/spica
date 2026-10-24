/**
 * The labelling replay's review file: totals per unit and pass, tokens and cost, the named cases,
 * then every conversation numbered into pieces with v11's facts beside each unit's labels, cited
 * words and dates written out, and every dropped label with its reason.
 */
import { emptyLabels, mergeLabels, type CheckedLabels } from "@/mind/memory/user/annotations";
import { messagesOf } from "@/mind/memory/user/layers";
import { numberPieces, renderPieces, type Piece } from "@/mind/memory/user/pieces";
import { renderResolved } from "@/mind/platform/time-labels";
import { conversationKey, type UnitResult } from "./label-replay";
import type { ReplayConversation } from "./replay-source";

export type UsageLine = {
  purpose: string;
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cost: number | null;
};
export type NamedCase = { title: string; text: string };
export type ReviewInput = {
  stamp: string;
  conversations: ReplayConversation[];
  results: UnitResult[];
  usage: UsageLine[];
  namedCases: NamedCase[];
};

/** The recorded moments the old pipeline got wrong, found by their words. */
export const NAMED_CASES: NamedCase[] = [
  { title: "since friday, from her own question", text: "has it been dark since friday" },
  { title: "a day added to the interview", text: "okay the interview happened" },
  { title: "a user fact from her words", text: "ok i should really try to sleep" },
  { title: "the speaker swap", text: "telescope zoning out sounds nice" },
  { title: "the interview moved to the race's Sunday", text: "no half marathon yet lol" },
  { title: "extract's own ISO dates", text: "i think it went well?" },
];

const LAYERS = ["moves", "mentions", "times", "propositions", "threads", "idiolect"] as const;

export function renderReview(input: ReviewInput): string {
  const named = input.namedCases.flatMap((n) => {
    const c = input.conversations.find((x) =>
      [...x.before, ...x.turns].some((t) => t.text.includes(n.text)),
    );
    return c ? [{ title: n.title, c }] : [];
  });
  const invented = input.conversations.filter((c) => c.run === "invented").length;
  return [
    `# Labelling replay ${input.stamp}`,
    "",
    `Extract v12 over ${input.conversations.length} conversations (${invented} invented).`,
    "",
    "## Totals",
    "",
    ...totals(input.results),
    "",
    "## Tokens and cost",
    "",
    ...usage(input.usage),
    "",
    "## Named cases",
    "",
    ...named.flatMap(({ title, c }) => [`### ${title}`, "", ...conversation(c, input.results)]),
    "## Conversations",
    "",
    ...input.conversations.flatMap((c) => [
      `### ${c.run} · ${c.turns[0]?.created_at.toISOString().slice(0, 16) ?? ""} · ${c.id.slice(0, 8)}`,
      "",
      ...conversation(c, input.results),
    ]),
  ].join("\n");
}

function totals(results: UnitResult[]): string[] {
  const rows = results.map((r) => {
    const calls = [...r.calls.values()].flat();
    const ok = calls.flatMap((x) => (x.labels ? [x.labels] : []));
    const counts = LAYERS.map((layer) => ok.reduce((n, l) => n + l[layer].length, 0));
    const drops = ok.flatMap((l) => l.drops);
    const reasons = new Map<string, number>();
    for (const d of drops) reasons.set(d.reason, (reasons.get(d.reason) ?? 0) + 1);
    const why = [...reasons].map(([reason, n]) => `${reason} ${n}`).join(", ");
    const failed = calls.length - ok.length;
    return `| ${r.unit} | ${r.thinking ? "on" : "off"} | ${calls.length} | ${failed} | ${counts.join(" | ")} | ${drops.length}${why ? ` (${why})` : ""} |`;
  });
  return [
    `| Unit | Thinking | Calls | Failed | ${LAYERS.map((l) => l[0]!.toUpperCase() + l.slice(1)).join(" | ")} | Drops |`,
    `|${" --- |".repeat(LAYERS.length + 5)}`,
    ...rows,
  ];
}

function usage(lines: UsageLine[]): string[] {
  const money = (cost: number | null) => (cost === null ? "?" : `$${cost.toFixed(3)}`);
  const total = lines.reduce<number | null>(
    (sum, u) => (sum === null || u.cost === null ? null : sum + u.cost),
    0,
  );
  return [
    "| Purpose | Calls | Input | Output | Cache read | Cost |",
    "| --- | --- | --- | --- | --- | --- |",
    ...lines.map(
      (u) =>
        `| ${u.purpose} | ${u.calls} | ${u.input} | ${u.output} | ${u.cacheRead} | ${money(u.cost)} |`,
    ),
    `| total | | | | | ${money(total)} |`,
  ];
}

function conversation(c: ReplayConversation, results: UnitResult[]): string[] {
  const turns = [...c.before, ...c.turns];
  const pieces = numberPieces(messagesOf(turns), c.before.length);
  const byId = new Map(pieces.map((p) => [p.id, p]));
  const number = (id: string) => turns.findIndex((t) => t.id === id) + 1;
  const exchanges = c.exchanges.map((e) => [...e.burst, e.replyId].map(number).join(","));
  const v11 = c.exchanges.flatMap((e) => factsOf(e.v11));
  const lines = [
    ...(c.note ? [`Expected: ${c.note}`, ""] : []),
    "```",
    renderPieces(pieces, c.zone),
    "```",
    "",
    `Exchanges (messages): ${exchanges.join(" · ") || "none"}`,
    "",
    ...(v11.length ? ["v11 (as logged):", ...v11, ""] : []),
  ];
  for (const r of results) {
    lines.push(`#### ${r.unit} mode, thinking ${r.thinking ? "on" : "off"}`, "");
    let known = emptyLabels();
    for (const call of r.calls.get(conversationKey(c)) ?? []) {
      lines.push(`Call (messages ${call.messages}):`);
      if (!call.labels) {
        lines.push(`- failed: ${call.error}`, "");
        continue;
      }
      known = mergeLabels(known, call.labels);
      lines.push(...describe(call.labels, known, byId), "");
    }
  }
  return lines;
}

function factsOf(output: unknown): string[] {
  const facts =
    (output as { facts?: { subject: string; kind: string; content: string }[] } | null)?.facts ??
    [];
  return facts.map((f) => `- ${f.subject} ${f.kind}: ${f.content}`);
}

/** One call's labels for a reader, with cited words and dates written out. */
function describe(l: CheckedLabels, known: CheckedLabels, pieces: Map<string, Piece>): string[] {
  const words = (ids: string[]) => ids.map((id) => pieces.get(id)?.text ?? `?${id}`).join(" / ");
  const who = (ids: string[]) =>
    pieces.get(ids[0] ?? "")?.message.speaker === "user" ? "User" : "Spica";
  const cited = (ids: string[]) => `"${words(ids)}" (${who(ids)})`;
  const when = (id: string) => {
    const t = known.times.find((x) => x.id === id);
    if (t?.resolved) return renderResolved(t.resolved);
    return t?.relativeTo ? `relative to ${t.relativeTo}` : id;
  };
  const moves = new Map(known.moves.map((m) => [m.id, m]));
  return [
    ...l.moves.map(
      (m) => `- ${m.id} ${m.act}${m.repliesTo ? ` → ${m.repliesTo}` : ""}: ${cited(m.pieces)}`,
    ),
    ...l.mentions.map(
      (m) =>
        `- ${m.id} "${m.words}" → ${m.refers_to ?? `new ${m.type ?? "thing"} "${m.name ?? m.words}"${m.relation ? ` (${m.subject ?? "?"}, ${m.relation})` : ""}`}`,
    ),
    ...l.times.map((t) => `- ${t.id} "${t.words}" → ${when(t.id)}`),
    ...l.propositions.map((p) => {
      const rests = p.moves.map((id) => {
        const m = moves.get(id);
        return m ? `${id}: ${cited(m.pieces)}` : id;
      });
      const parts = [
        `${p.subject} ${p.kind} "${p.label}"`,
        p.status,
        ...p.times.map(when),
        p.updates && `updates ${p.updates}`,
        p.thread_id && `thread ${p.thread_id}`,
        p.new_thread && `new thread "${p.new_thread}"`,
        `salience ${p.salience}`,
      ].filter(Boolean);
      return `- ${p.id} ${parts.join(" · ")} · rests on ${rests.join("; ")}`;
    }),
    ...l.threads.map(
      (t) =>
        `- thread ${t.action} ${t.thread_id ?? "new"} "${t.title}" ${t.stakes}${t.checkpointAt ? ` · check in ${renderResolved(t.checkpointAt)}` : ""}`,
    ),
    ...l.idiolect.map((i) => `- ${i.id} ${i.type}, started by ${i.startedBy}: ${cited(i.pieces)}`),
    ...(l.relationship ? [`- relationship ${JSON.stringify(l.relationship)}`] : []),
    ...(l.intimacy ? [`- intimacy ${JSON.stringify(l.intimacy)}`] : []),
    ...(l.bid_response
      ? [`- bid response ${l.bid_response.response} (${l.bid_response.move})`]
      : []),
    ...l.drops.map((d) => `- dropped ${d.layer} ${d.id}: ${d.reason}`),
  ];
}
