/**
 * When a hurt has passed, her memory of it turns past: each open hurt memory is replaced by a
 * resolved copy that says it's over. The replies and her notes never show a memory's status, so
 * the words have to say it.
 */
import type { Db } from "@/db/client";
import { insertFact, openHurtFacts, setFactStatus } from "@/db/repos/user/facts";
import { pastHurtContent } from "@/mind/state/user/relationship/signals";

export async function settleHurtFacts(
  db: Db,
  userId: string,
  via: "apology" | "fade",
  now: Date,
): Promise<number> {
  const open = await openHurtFacts(db, userId);
  for (const row of open) {
    // The old embedding is kept: the meaning hasn't moved, and no network call runs in the transaction.
    const copy = await insertFact(db, userId, {
      subject: row.subject,
      kind: row.kind,
      content: pastHurtContent(row.content, via),
      payload: row.payload,
      embedding: row.embedding,
      entity_refs: row.entity_refs,
      thread_id: row.thread_id,
      occurred_at: row.occurred_at,
      created_at: now,
      status: "resolved",
      salience: row.salience,
      valence: row.valence,
      confidence: row.confidence,
      source: row.source,
      source_ref: row.source_ref,
    });
    await setFactStatus(db, userId, row.id, "superseded", copy.id);
  }
  return open.length;
}
