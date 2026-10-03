/**
 * Her core memory in Postgres. No query here takes or returns a user id.
 */
import { and, desc, eq, gt, gte, lte, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/db/client";
import { core_entity, core_memory, core_snapshot, world_event } from "@/db/schema";
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

export function toItem(r: typeof core_memory.$inferSelect): CoreMemoryItem {
  return {
    id: r.id,
    kind: r.kind,
    content: r.content,
    payload: r.payload,
    entity_refs: r.entity_refs,
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
const eventTime = z.iso.datetime({ offset: true });

function payloadObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function coreMemoryRepo(db: Db): CoreMemory {
  async function neighbors(
    embedding: number[],
    k: number,
    minSimilarity: number,
    factual: boolean,
  ): Promise<Neighbor[]> {
    const q = vecLiteral(embedding);
    const res = await db.execute(sql`
      SELECT id, content, status, (1 - (embedding <=> ${q}::vector))::float8 AS sim
      FROM core_memory
      WHERE status NOT IN ('superseded', 'stale')
        AND ${factual ? sql`kind <> 'hypothetical'` : sql`true`}
        AND (1 - (embedding <=> ${q}::vector)) >= ${minSimilarity}
      ORDER BY embedding <=> ${q}::vector, id
      LIMIT ${k}`);
    return res.rows.map((r) => ({
      id: String(r.id),
      content: String(r.content),
      status: String(r.status),
      sim: Number(r.sim),
    }));
  }

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
      return neighbors(embedding, k, minSimilarity, true);
    },

    async dedupeNear(embedding, k, minSimilarity) {
      return neighbors(embedding, k, minSimilarity, false);
    },

    async anticipationCandidate(now, until) {
      const rows = await db
        .select()
        .from(core_memory)
        .where(and(eq(core_memory.kind, "intention"), eq(core_memory.status, "open")))
        .orderBy(core_memory.id);
      // Validate before choosing a row: malformed JSON must never reach a SQL timestamp cast.
      let selected: typeof core_memory.$inferSelect | null = null;
      let soonest = Infinity;
      for (const row of rows) {
        const payload = payloadObject(row.payload);
        if (!payload || "anticipated_at" in payload) continue;
        const parsed = eventTime.safeParse(payload.event_at);
        if (!parsed.success) continue;
        const at = new Date(parsed.data).getTime();
        if (at > now.getTime() && at <= until.getTime() && at < soonest) {
          const source = /^world_event:(.+)$/.exec(row.source_ref ?? "");
          const eventId = source ? z.uuid().safeParse(source[1]) : null;
          if (!eventId?.success) continue;
          const [event] = await db
            .select({ kind: world_event.kind })
            .from(world_event)
            .where(eq(world_event.id, eventId.data))
            .limit(1);
          if (event?.kind !== "planned") continue;
          selected = row;
          soonest = at;
        }
      }
      return selected ? toItem(selected) : null;
    },

    async ruminationCandidate(from, to, minValence, maxCount) {
      const rows = await db
        .select()
        .from(core_memory)
        .where(
          and(
            eq(core_memory.kind, "episode"),
            ACTIVE,
            gte(core_memory.created_at, from),
            lte(core_memory.created_at, to),
            sql`abs(${core_memory.valence}) >= ${minValence}`,
          ),
        )
        .orderBy(core_memory.created_at, core_memory.id);
      const row = rows.find((item) => {
        const payload = item.payload === null ? {} : payloadObject(item.payload);
        if (!payload) return false;
        const count = "ruminated" in payload ? payload.ruminated : 0;
        return (
          typeof count === "number" && Number.isInteger(count) && count >= 0 && count < maxCount
        );
      });
      return row ? toItem(row) : null;
    },

    async recallable(from, to, limit) {
      const rows = await db
        .select()
        .from(core_memory)
        .where(
          and(
            ACTIVE,
            gte(core_memory.created_at, from),
            lte(core_memory.created_at, to),
            sql`${core_memory.kind} <> 'hypothetical'`,
            sql`NOT (${core_memory.kind} = 'intention' AND ${core_memory.status} = 'resolved')`,
          ),
        )
        .orderBy(desc(core_memory.created_at), core_memory.id)
        .limit(limit);
      return rows.map(toItem);
    },

    async mergePayload(id, patch) {
      await db
        .update(core_memory)
        .set({
          payload: sql`COALESCE(${core_memory.payload}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
        })
        .where(eq(core_memory.id, id));
    },

    async reinforce(id, now, bump, cap) {
      await db
        .update(core_memory)
        .set({
          salience: sql`least(${core_memory.salience} + ${bump}, ${cap})`,
          recall_count: sql`${core_memory.recall_count} + 1`,
          last_recalled_at: now,
        })
        .where(eq(core_memory.id, id));
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
          AND NOT (m.kind = 'intention' AND m.status = 'resolved')
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

    async openIntentions(from, to, limit) {
      const rows = await db
        .select()
        .from(core_memory)
        .where(
          and(
            eq(core_memory.kind, "intention"),
            eq(core_memory.status, "open"),
            gt(core_memory.created_at, from),
            lte(core_memory.created_at, to),
          ),
        )
        .orderBy(core_memory.created_at)
        .limit(limit);
      return rows.map(toItem);
    },

    async bySourceRef(kind, sourceRef) {
      const row = (
        await db
          .select()
          .from(core_memory)
          .where(and(eq(core_memory.kind, kind), eq(core_memory.source_ref, sourceRef)))
          .limit(1)
      )[0];
      return row ? toItem(row) : null;
    },

    async setStatus(id, status) {
      await db.update(core_memory).set({ status }).where(eq(core_memory.id, id));
    },

    async entities(): Promise<CoreEntity[]> {
      return db.select().from(core_entity).orderBy(core_entity.first_seen);
    },

    async latestEntityFirstSeen(excludeNames) {
      const row = (
        await db
          .select({ at: core_entity.first_seen })
          .from(core_entity)
          .where(notInArray(sql`lower(${core_entity.name})`, excludeNames.map(normal)))
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
