/**
 * Her core memory in Postgres. No query here takes or returns a user id.
 */
import { and, desc, eq, gt, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { core_entity, core_memory, core_snapshot } from "@/db/schema";
import type {
  CoreCandidate,
  CoreEntity,
  CoreMemory,
  CoreMemoryItem,
  CoreSnapshot,
} from "@/mind/memory/core/types";
import type { Neighbor } from "@/mind/memory/shared/types";
import { one, toDate, toDateOrNull, vecLiteral } from "../util";

const ACTIVE = sql`${core_memory.status} NOT IN ('superseded', 'stale')`;

function toItem(r: typeof core_memory.$inferSelect): CoreMemoryItem {
  return {
    id: r.id,
    kind: r.kind,
    content: r.content,
    payload: r.payload,
    occurred_at: r.occurred_at,
    created_at: r.created_at,
    last_recalled_at: r.last_recalled_at,
    status: r.status,
    salience: r.salience,
    valence: r.valence,
    source: r.source,
    source_ref: r.source_ref,
  };
}

const normal = (name: string) => name.trim().toLowerCase();

export function coreMemoryRepo(db: Db): CoreMemory {
  return {
    async insert(item) {
      const row = one(
        await db
          .insert(core_memory)
          .values({ ...item, entity_refs: item.entity_refs ?? [] })
          .returning({ id: core_memory.id }),
      );
      return row.id;
    },

    async get(id) {
      const row = (await db.select().from(core_memory).where(eq(core_memory.id, id)))[0];
      return row ? toItem(row) : null;
    },

    async near(embedding, k, minSimilarity): Promise<Neighbor[]> {
      const q = vecLiteral(embedding);
      const res = await db.execute(sql`
        SELECT id, content, status, (1 - (embedding <=> ${q}::vector))::float8 AS sim
        FROM core_memory
        WHERE status NOT IN ('superseded', 'stale')
          AND (1 - (embedding <=> ${q}::vector)) >= ${minSimilarity}
        ORDER BY embedding <=> ${q}::vector
        LIMIT ${k}`);
      return res.rows.map((r) => ({
        id: String(r.id),
        content: String(r.content),
        status: String(r.status),
        sim: Number(r.sim),
      }));
    },

    async candidates(embedding, limit): Promise<CoreCandidate[]> {
      const q = vecLiteral(embedding);
      const res = await db.execute(sql`
        SELECT m.id, m.content, m.salience, m.created_at, m.last_recalled_at, m.occurred_at,
               (1 - (m.embedding <=> ${q}::vector))::float8 AS sim,
               COALESCE((SELECT max(e.salience) FROM core_entity e
                         WHERE e.id = ANY(m.entity_refs)), 1.0)::float8 AS entity_salience
        FROM core_memory m
        WHERE m.status NOT IN ('superseded', 'stale') AND m.kind <> 'hypothetical'
        ORDER BY m.embedding <=> ${q}::vector
        LIMIT ${limit}`);
      return res.rows.map((r) => ({
        id: String(r.id),
        content: String(r.content),
        salience: Number(r.salience),
        created_at: toDate(r.created_at),
        last_recalled_at: toDateOrNull(r.last_recalled_at),
        occurred_at: toDateOrNull(r.occurred_at),
        sim: Number(r.sim),
        entity_salience: Number(r.entity_salience),
      }));
    },

    async recentEpisodes(from, to, limit) {
      const rows = await db
        .select()
        .from(core_memory)
        .where(
          and(
            eq(core_memory.kind, "episode"),
            ACTIVE,
            gt(core_memory.occurred_at, from),
            lte(core_memory.occurred_at, to),
          ),
        )
        .orderBy(core_memory.occurred_at)
        .limit(limit);
      return rows.map(toItem);
    },

    async entities(): Promise<CoreEntity[]> {
      return db.select().from(core_entity).orderBy(core_entity.first_seen);
    },

    async latestEntityFirstSeen() {
      const row = (
        await db
          .select({ at: core_entity.first_seen })
          .from(core_entity)
          .orderBy(desc(core_entity.first_seen))
          .limit(1)
      )[0];
      return row?.at ?? null;
    },

    async addEntities(names, salience, now) {
      const known = await db.select().from(core_entity);
      const byName = new Map(known.map((e) => [normal(e.name), e.id]));
      const ids: string[] = [];
      for (const name of names) {
        const existing = byName.get(normal(name));
        if (existing) {
          ids.push(existing);
          continue;
        }
        const row = one(
          await db
            .insert(core_entity)
            .values({ name: name.trim(), salience, first_seen: now })
            .returning({ id: core_entity.id }),
        );
        byName.set(normal(name), row.id);
        ids.push(row.id);
      }
      return ids;
    },

    async latestSnapshot(): Promise<CoreSnapshot | null> {
      const row = (
        await db.select().from(core_snapshot).orderBy(desc(core_snapshot.version)).limit(1)
      )[0];
      return row ?? null;
    },

    async insertSnapshot(snapshot) {
      const rows = await db
        .insert(core_snapshot)
        .values(snapshot)
        .onConflictDoNothing()
        .returning({ version: core_snapshot.version });
      return rows.length > 0;
    },
  };
}
