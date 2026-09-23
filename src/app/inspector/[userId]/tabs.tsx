import Link from "next/link";
import type { Db } from "@/db/client";
import * as r from "@/db/repos/inspector";
import { listTurns } from "@/db/repos/session-log";
import styles from "../inspector.module.css";

const Empty = ({ phase }: { phase: number }) => <p className={styles.empty}>Nothing yet. Filled from Phase {phase}.</p>;
const iso = (d: Date | null | undefined) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : "—");
const json = (v: unknown) => <pre className={styles.pre}>{JSON.stringify(v, null, 2)}</pre>;

export async function TranscriptTab({ db, userId }: { db: Db; userId: string }) {
  const turns = await listTurns(db, userId);
  if (!turns.length) return <p className={styles.empty}>No turns yet.</p>;
  const sessions = new Map<string, typeof turns>();
  for (const t of turns) sessions.set(t.session_id, [...(sessions.get(t.session_id) ?? []), t]);
  return (
    <>
      {[...sessions].map(([sid, ts]) => (
        <section key={sid}>
          <p className={styles.session}>session {sid.slice(0, 8)} · {iso(ts[0]!.created_at)}</p>
          <table className={styles.table}>
            <tbody>
              {ts.map((t) => (
                <tr key={t.id}>
                  <td>{iso(t.created_at)}</td><td>{t.role}</td><td>{t.text}</td>
                  <td>{t.extracted ? "extracted" : "pending"}</td>
                  <td>{t.trigger ?? ""}</td>
                  <td>{t.safety_flag?.flagged ? `⚠ ${t.safety_flag.category} (${t.safety_flag.source})` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

export async function FactsTab({ db, userId, sp }: { db: Db; userId: string; sp: Record<string, string | undefined> }) {
  const f = r.parseFactFilters(sp);
  const facts = await r.listFacts(db, userId, f);
  return (
    <>
      <form className={styles.filters}>
        <input type="hidden" name="tab" value="facts" />
        <select name="subject" defaultValue={f.subject ?? ""}><option value="">any subject</option><option>user</option><option>self</option><option>shared</option></select>
        <select name="status" defaultValue={f.status ?? ""}><option value="">any status</option><option>open</option><option>resolved</option><option>recurring</option><option>stale</option><option>superseded</option></select>
        <input name="entityId" placeholder="entity id" defaultValue={f.entityId ?? ""} />
        <input name="threadId" placeholder="thread id" defaultValue={f.threadId ?? ""} />
        <select name="sort" defaultValue={f.sort}><option value="recency">recency</option><option value="salience">salience</option></select>
        <button type="submit">Apply</button>
      </form>
      {!facts.length ? <Empty phase={1} /> : (
        <table className={styles.table}>
          <thead><tr><th>content</th><th>subject</th><th>kind</th><th>status</th><th>sal</th><th>val</th><th>conf</th><th>created</th><th>recalled</th></tr></thead>
          <tbody>
            {facts.map((x) => (
              <tr key={x.id}>
                <td>{x.content}</td><td>{x.subject}</td><td>{x.kind}</td><td>{x.status}</td>
                <td>{x.salience.toFixed(2)}</td><td>{x.valence.toFixed(2)}</td><td>{x.confidence.toFixed(2)}</td>
                <td>{iso(x.created_at)}</td><td>{iso(x.last_recalled_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export async function EntitiesThreadsTab({ db, userId, base }: { db: Db; userId: string; base: string }) {
  const [entities, threads] = await Promise.all([r.listEntities(db, userId), r.listThreads(db, userId)]);
  return (
    <>
      <h3>Entities</h3>
      {!entities.length ? <Empty phase={1} /> : (
        <table className={styles.table}><tbody>
          {entities.map((e) => (
            <tr key={e.id}>
              <td>{e.name}</td><td>{e.type}</td><td>{e.subject}</td><td>{e.relation}</td><td>{e.salience.toFixed(2)}</td>
              <td><Link href={`${base}?tab=facts&entityId=${e.id}`}>facts</Link></td>
            </tr>
          ))}
        </tbody></table>
      )}
      <h3>Threads</h3>
      {!threads.length ? <Empty phase={1} /> : (
        <table className={styles.table}><tbody>
          {threads.map((t) => (
            <tr key={t.id}>
              <td>{t.title}</td><td>{t.subject}</td><td>{t.status}</td><td>{t.stakes}</td><td>next: {iso(t.next_checkpoint)}</td>
              <td><Link href={`${base}?tab=facts&threadId=${t.id}`}>facts</Link></td>
            </tr>
          ))}
        </tbody></table>
      )}
    </>
  );
}

export async function IdentityTab({ db, userId }: { db: Db; userId: string }) {
  const [identity, rel, ticks] = await Promise.all([r.getIdentity(db, userId), r.getRelationship(db, userId), r.listEgoTicks(db, userId)]);
  return (
    <>
      <h3>Identity</h3>{identity ? json(identity) : <Empty phase={2} />}
      <h3>Relationship</h3>{rel ? json(rel) : <Empty phase={3} />}
      <h3>Ego history</h3>
      {!ticks.length ? <Empty phase={2} /> : (
        <table className={styles.table}><tbody>
          {ticks.map((t) => (
            <tr key={t.id}><td>{iso(t.created_at)}</td><td>val {t.mood_valence.toFixed(2)}</td><td>ar {t.mood_arousal.toFixed(2)}</td><td>en {t.energy.toFixed(2)}</td><td>{t.reason}</td></tr>
          ))}
        </tbody></table>
      )}
    </>
  );
}

export async function RetrievalTab({ db, userId }: { db: Db; userId: string }) {
  const rows = await r.listRetrievalTraces(db, userId);
  if (!rows.length) return <Empty phase={1} />;
  const byTurn = new Map<string, typeof rows>();
  for (const row of rows) byTurn.set(row.trace.turn_id, [...(byTurn.get(row.trace.turn_id) ?? []), row]);
  return (
    <>
      {[...byTurn].map(([turnId, rs]) => (
        <section key={turnId}>
          <p className={styles.session}>turn {turnId.slice(0, 8)}</p>
          <table className={styles.table}>
            <thead><tr><th>fact</th><th>sim</th><th>fact sal</th><th>entity sal</th><th>recency</th><th>score</th><th>forced</th></tr></thead>
            <tbody>
              {rs.map(({ trace: t, content }) => (
                <tr key={t.id}>
                  <td>{content}</td><td>{t.sim.toFixed(3)}</td><td>{t.fact_salience.toFixed(2)}</td><td>{t.entity_salience.toFixed(2)}</td>
                  <td>{t.recency.toFixed(2)}</td><td>{t.score.toFixed(3)}</td><td>{t.forced ? "yes" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

export async function ReachOutsTab({ db, userId }: { db: Db; userId: string }) {
  const rows = await r.listReachOuts(db, userId);
  if (!rows.length) return <Empty phase={3} />;
  return (
    <table className={styles.table}>
      <thead><tr><th>at</th><th>sent</th><th>winner</th><th>gate</th><th>candidates</th></tr></thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.id}><td>{iso(x.created_at)}</td><td>{x.sent ? "yes" : "no"}</td><td>{json(x.winner)}</td><td>{json(x.gate_results)}</td><td>{json(x.candidates)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
