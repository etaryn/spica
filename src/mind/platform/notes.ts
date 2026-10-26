/**
 * Her notes as code keeps them. A model writes a note that points at what it rests on by the ids
 * it was shown ("[m3]"), and code puts that memory's or thread's own line there, with whose it is.
 * The time words a note uses itself come labelled with what they mean, and code counts the day,
 * as it does for the user's words: no code reads a note for dates, and no model works one out.
 * It holds no one's data, so both minds write through it.
 */
import { z } from "zod";
import { loadPrompt } from "./prompts";
import {
  labelToken,
  resolveTime,
  TimeMeaningSchema,
  type ResolvedTime,
  type TimeMeaning,
} from "./time-labels";
import { localDateString } from "./timezone";

export type Owner = "theirs" | "yours" | "you both";

/** Something a note may cite. */
export type Citable = {
  /** What the model writes: "m3", "t1". */
  id: string;
  /** The stored row it stands for. */
  ref: string;
  kind: "memory" | "thread";
  /** Its own line, as the note reads where it's cited. */
  text: string;
  owner: Owner | null;
  /** The moment it's about, or null when it has none. */
  at: Date | null;
};

const CITE = /\[([mt]\d+)\]/g;
// The length fit can cut a citation off at the end.
const CUT_CITE = /\s*\[[mt]?\d*$/;
// A citation or a token already placed: neither is the note's own words.
const KEPT = /\[[mt]\d+\]|⟦[^⟧]*⟧/g;

/** The note's own time words with what they mean. A clock of "" is none: few fields may be null. */
export function noteTimesSchema(fields: readonly [string, ...string[]]) {
  return z.array(
    z.object({
      field: z.enum(fields),
      words: z.string(),
      from: z.string(),
      ...TimeMeaningSchema.shape,
      clock: z.string(),
    }),
  );
}
export type NoteTime = z.infer<ReturnType<typeof noteTimesSchema>>[number];

export type Dropped = {
  what: string;
  reason: "bad_cite" | "bad_ref" | "bad_time" | "words_missing";
};

export type WrittenNote = {
  fields: Record<string, string>;
  cited: Citable[];
  /** The stored ids it cites, each once. */
  memories: string[];
  threads: string[];
  times: ResolvedTime[];
  dropped: Dropped[];
};

export function writeNote(
  fields: Record<string, string>,
  times: NoteTime[],
  citables: Citable[],
  ctx: { now: Date; zone: string },
): WrittenNote {
  const byId = new Map(citables.map((c) => [c.id, c]));
  const today = localDateString(ctx.now, ctx.zone);
  const cited = new Map<string, Citable>();
  const resolved: ResolvedTime[] = [];
  const dropped: Dropped[] = [];
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(fields)) {
    let text = raw.replace(CUT_CITE, "");
    // Its own times first, between citations, so a cited line's words are never read as its own.
    for (const t of times.filter((x) => x.field === name)) {
      const base = t.from === "" ? today : dayOf(byId.get(t.from), ctx.zone);
      if (base === null) {
        dropped.push({ what: t.words, reason: "bad_ref" });
        continue;
      }
      const r = resolveTime(meaningOf(t), base);
      if (!r) {
        dropped.push({ what: t.words, reason: "bad_time" });
        continue;
      }
      const at = findOutside(text, t.words);
      if (at < 0) {
        dropped.push({ what: t.words, reason: "words_missing" });
        continue;
      }
      const end = at + t.words.trim().length;
      text = text.slice(0, at) + labelToken(r, ctx.zone, text.slice(at, end)) + text.slice(end);
      resolved.push(r);
    }
    out[name] = text
      .replace(CITE, (_m, id: string) => {
        const c = byId.get(id);
        if (!c) {
          dropped.push({ what: `[${id}]`, reason: "bad_cite" });
          return "";
        }
        cited.set(id, c);
        return c.owner ? `${c.text} (${c.owner})` : c.text;
      })
      .replace(/\s+([.,;:!?])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  const all = [...cited.values()];
  return {
    fields: out,
    cited: all,
    memories: all.filter((c) => c.kind === "memory").map((c) => c.ref),
    threads: all.filter((c) => c.kind === "thread").map((c) => c.ref),
    times: resolved,
    dropped,
  };
}

/** Cites only what's hers: a note about them resting on her own life reads it as theirs. */
export function onlyHers(note: Pick<WrittenNote, "cited">): boolean {
  return note.cited.length > 0 && note.cited.every((c) => c.owner === "yours");
}

/** What a stored note keeps of what it cites; nothing when it cites nothing. */
export function noteRefs(note: WrittenNote): { cites?: string[]; cites_threads?: string[] } {
  return {
    ...(note.memories.length ? { cites: note.memories } : {}),
    ...(note.threads.length ? { cites_threads: note.threads } : {}),
  };
}

/** A loop's prompt with the shared rules for citing and for labelling its own time words. */
export function withNoteRules(system: string, version: string): string {
  return `${system}\n\n${loadPrompt("notes", version)}`;
}

function dayOf(c: Citable | undefined, zone: string): string | null {
  return c?.at ? localDateString(c.at, zone) : null;
}

function meaningOf(t: NoteTime): TimeMeaning {
  return {
    unit: t.unit,
    shift: t.shift,
    weekday: t.weekday,
    month: t.month,
    day_of_month: t.day_of_month,
    part: t.part,
    clock: t.clock === "" ? null : t.clock,
    span: t.span,
    rough: t.rough,
  };
}

/** Where `words` first stand as the note's own, case aside; -1 when they don't. */
function findOutside(text: string, words: string): number {
  const w = words.trim().toLowerCase();
  if (!w) return -1;
  const kept = [...text.matchAll(KEPT)].map((m) => [m.index, m.index + m[0].length] as const);
  const lower = text.toLowerCase();
  for (let i = lower.indexOf(w); i >= 0; i = lower.indexOf(w, i + 1))
    if (!kept.some(([a, b]) => i < b && i + w.length > a)) return i;
  return -1;
}
