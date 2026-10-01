import Link from "next/link";
import { inspectCore } from "@/db/repos/admin/inspector-core";
import { getDeps } from "@/server/deps";
import { assertInspectorAccess } from "@/server/inspector-guard";
import styles from "../inspector.module.css";

const json = (v: unknown) => JSON.stringify(v);
const iso = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : "—");

export default async function InspectCore() {
  await assertInspectorAccess();
  const { db, config } = getDeps();
  const v = await inspectCore(db, config.outreach.log_list_limit);

  return (
    <>
      <Link href="/inspector">← users</Link>
      <h1>Her core mind</h1>

      <h3>State</h3>
      {v.state ? (
        <table className={styles.table}>
          <tbody>
            <tr>
              <td>mood</td>
              <td>
                valence {v.state.mood_valence.toFixed(2)}, arousal {v.state.mood_arousal.toFixed(2)}
              </td>
            </tr>
            <tr>
              <td>energy</td>
              <td>{v.state.energy.toFixed(2)}</td>
            </tr>
            <tr>
              <td>preoccupation</td>
              <td>{v.state.preoccupation ?? "—"}</td>
            </tr>
            <tr>
              <td>last tick</td>
              <td>{iso(v.state.last_tick)}</td>
            </tr>
            <tr>
              <td>last event day</td>
              <td>{v.state.last_event_day ?? "—"}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className={styles.empty}>No core state yet.</p>
      )}

      <h3>Snapshot</h3>
      {v.snapshot ? (
        <>
          <p>
            version {v.snapshot.version}, rendered {iso(v.snapshot.rendered_at)}
          </p>
          <pre className={styles.pre}>{v.snapshot.content}</pre>
        </>
      ) : (
        <p className={styles.empty}>No snapshot yet.</p>
      )}

      <h3>Recent core memory</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Content</th>
            <th>Valence</th>
            <th>Status</th>
            <th>Occurred</th>
          </tr>
        </thead>
        <tbody>
          {v.memories.map((m) => (
            <tr key={m.id}>
              <td>{m.kind}</td>
              <td>{m.content}</td>
              <td>{m.valence}</td>
              <td>{m.status}</td>
              <td>{iso(m.occurred_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Loop traces</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Loop</th>
            <th>At</th>
            <th>Outputs</th>
          </tr>
        </thead>
        <tbody>
          {v.traces.map((t) => (
            <tr key={t.id}>
              <td>{t.loop}</td>
              <td>{iso(t.created_at)}</td>
              <td>{json(t.outputs)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Event attempts</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Day</th>
            <th>Decision</th>
            <th>Candidate</th>
          </tr>
        </thead>
        <tbody>
          {v.eventLog.map((e) => (
            <tr key={e.id}>
              <td>{e.life_day}</td>
              <td>{e.decision}</td>
              <td>{json(e.candidate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
