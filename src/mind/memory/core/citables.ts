/**
 * Her memories as a core loop is shown them: numbered (m1, m2…) so what she writes can cite one.
 * Every one is hers and its words are already in the loop's input, so a citation reads as the
 * memory's date alone: a plan's moment for an intention, otherwise when it happened.
 */
import type { Citable } from "@/mind/platform/notes";
import { dateToken } from "@/mind/platform/time-anchors";
import type { CoreMemoryItem } from "./types";

export type CoreLine = { id: string; kind: string; content: string; when: string | null };

function moment(m: CoreMemoryItem): { at: Date; precision: "day" | "time" } {
  if (m.kind === "intention") {
    const p = m.payload as Record<string, unknown> | null;
    const at = typeof p?.event_at === "string" ? new Date(p.event_at) : null;
    if (at && Number.isFinite(at.getTime())) return { at, precision: "time" };
  }
  return { at: m.occurred_at ?? m.created_at, precision: "day" };
}

export function coreCitables(memories: CoreMemoryItem[], zone: string) {
  const out = memories.map((m, i) => {
    const id = `m${i + 1}`;
    const { at, precision } = moment(m);
    const date = dateToken(at, zone, precision);
    const item: Citable = { id, ref: m.id, kind: "memory", text: date, owner: null, at };
    // Words that already carry a date show no second one beside them.
    const line: CoreLine = {
      id,
      kind: m.kind,
      content: m.content,
      when: m.content.includes("⟦") ? null : date,
    };
    return { item, line };
  });
  return { lines: out.map((o) => o.line), items: out.map((o) => o.item) };
}

/** "[m1] She rewatched Solaris. (date)": a memory as a line of a text input. */
export function lineText(line: CoreLine): string {
  return `[${line.id}] ${line.content}${line.when ? ` (${line.when})` : ""}`;
}
