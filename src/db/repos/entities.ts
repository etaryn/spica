import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../client";
import { entity, entityType } from "../schema";
import { one } from "./util";

export type EntityRow = typeof entity.$inferSelect;
export type EntityMention = {
  name: string; aliases: string[]; type: (typeof entityType.enumValues)[number];
  subject: "user" | "self"; relation: string | null;
};

export const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const tidy = (s: string) => s.trim().replace(/\s+/g, " ");

export async function findEntityByName(db: Db, userId: string, subject: "user" | "self", name: string): Promise<EntityRow | null> {
  const n = normalizeName(name);
  if (!n) return null;
  const rows = await db.select().from(entity).where(and(
    eq(entity.user_id, userId), eq(entity.subject, subject),
    sql`(lower(${entity.name}) = ${n} OR ${n} = ANY(SELECT lower(a) FROM unnest(${entity.aliases}) AS a))`,
  )).limit(1);
  return rows[0] ?? null;
}

/** Resolve a mention to an existing entity (exact name/alias, case-insensitive) or create one. No fuzzy merging. */
export async function upsertEntityMention(
  db: Db, userId: string, m: EntityMention, now: Date, opts: { newSalience: number; bump: number; cap: number },
): Promise<{ id: string; created: boolean }> {
  let existing: EntityRow | null = null;
  for (const n of [m.name, ...m.aliases]) {
    existing = await findEntityByName(db, userId, m.subject, n);
    if (existing) break;
  }
  if (existing) {
    const known = new Set([existing.name, ...existing.aliases].map(normalizeName));
    const addAliases = [m.name, ...m.aliases].map(tidy).filter((a) => a && !known.has(normalizeName(a)));
    await db.update(entity).set({
      last_mentioned: now,
      salience: sql`LEAST(${opts.cap}::real, ${entity.salience} + ${opts.bump}::real)`,
      aliases: [...existing.aliases, ...new Set(addAliases)],
      relation: existing.relation ?? m.relation,
    }).where(and(eq(entity.user_id, userId), eq(entity.id, existing.id)));
    return { id: existing.id, created: false };
  }
  const row = one(await db.insert(entity).values({
    user_id: userId, name: tidy(m.name), aliases: [...new Set(m.aliases.map(tidy).filter(Boolean))], type: m.type,
    subject: m.subject, relation: m.relation, salience: opts.newSalience, first_seen: now, last_mentioned: now,
  }).returning());
  return { id: row.id, created: true };
}
