/**
 * Labels as stored: one row per label, pointing at words by coordinate, and back again. Piece
 * ids are only the numbering of one call's window, so they're worked out again from the
 * coordinates each time; a label whose words aren't shown any more is left out.
 */
import type { AnnotationRow, NewAnnotation } from "@/db/repos/user/annotations";
import {
  emptyLabels,
  type CheckedIdiolect,
  type CheckedLabels,
  type CheckedMention,
  type CheckedMove,
  type CheckedProposition,
  type CheckedTime,
} from "./annotations";
import type { Coordinate, Piece } from "./pieces";

type Where = { sessionId: string; exchangeRef: string; at: Date };

export function toRows(
  labels: CheckedLabels,
  a: Where & { factIds: Map<string, string>; entityIds: Map<string, string> },
): NewAnnotation[] {
  const row = (
    layer: NewAnnotation["layer"],
    localId: string,
    coords: Coordinate[],
    data: unknown,
  ): NewAnnotation => ({
    session_id: a.sessionId,
    exchange_ref: a.exchangeRef,
    layer,
    local_id: localId,
    coords,
    data,
    fact_id: a.factIds.get(localId) ?? null,
    created_at: a.at,
  });
  return [
    ...labels.moves.map((m) => row("move", m.id, m.coords, m)),
    ...labels.mentions.map((m) =>
      row("mention", m.id, [m.coord], { ...m, entity_id: a.entityIds.get(m.id) ?? null }),
    ),
    ...labels.times.map((t) => row("time", t.id, [t.coord], t)),
    ...labels.propositions.map((p) => row("proposition", p.id, [], p)),
    ...labels.idiolect.map((i) => row("idiolect", i.id, i.coords, i)),
  ];
}

export function fromRows(rows: AnnotationRow[], pieces: Piece[]): CheckedLabels {
  const out = emptyLabels();
  const at = (c: Coordinate) =>
    pieces.find((p) => p.message.id === c.turnId && p.start <= c.start && c.end <= p.end)?.id;
  for (const r of rows) {
    const ids = r.coords.map(at);
    if (ids.some((id) => id === undefined)) continue;
    const found = ids as string[];
    switch (r.layer) {
      case "move":
        out.moves.push({ ...(r.data as CheckedMove), pieces: found });
        break;
      case "mention":
        out.mentions.push({ ...(r.data as CheckedMention), piece: found[0]! });
        break;
      case "time":
        out.times.push({ ...(r.data as CheckedTime), piece: found[0]! });
        break;
      case "proposition":
        out.propositions.push(r.data as CheckedProposition);
        break;
      case "idiolect":
        out.idiolect.push({ ...(r.data as CheckedIdiolect), pieces: found });
        break;
    }
  }
  return out;
}

export function factIdsByLocal(rows: AnnotationRow[]): Map<string, string> {
  return new Map(rows.flatMap((r) => (r.fact_id ? [[r.local_id, r.fact_id] as const] : [])));
}

export function entityIdsByLocal(rows: AnnotationRow[]): Map<string, string> {
  return new Map(
    rows.flatMap((r) => {
      const id = r.layer === "mention" ? (r.data as { entity_id?: string | null }).entity_id : null;
      return id ? [[r.local_id, id] as const] : [];
    }),
  );
}
