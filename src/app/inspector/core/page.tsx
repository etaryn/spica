import Link from "next/link";
import { inspectCore } from "@/db/repos/admin/inspector-core";
import { budgetDayStart } from "@/mind/process/core/runner";
import { getDeps } from "@/server/deps";
import { assertInspectorAccess } from "@/server/inspector-guard";
import styles from "../inspector.module.css";

const json = (v: unknown) => JSON.stringify(v);
const iso = (d: Date | null) => (d ? d.toISOString().replace("T", " ").slice(0, 16) : "—");

export default async function InspectCore() {
  await assertInspectorAccess();
  const { db, config, clock } = getDeps();
  const v = await inspectCore(db, {
    limit: config.outreach.log_list_limit,
    snapshotVersions: config.inspector.snapshot_versions,
    dayStart: budgetDayStart(config, clock.now()),
  });
  const spent = v.budget.reduce((sum, b) => sum + b.calls, 0);

  return (
    <>
      <Link href="/inspector">← users</Link>
      <br />
      <Link href="/inspector/posts">her posts →</Link>
      <h1>Her core mind</h1>

      <h3>Budget today</h3>
      <p>
        spent {spent} / {config.core.daily_call_budget}
      </p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Loop</th>
            <th>Status</th>
            <th>Calls</th>
          </tr>
        </thead>
        <tbody>
          {v.budget.map((b) => (
            <tr key={`${b.loop}:${b.status}`}>
              <td>{b.loop}</td>
              <td>{b.status}</td>
              <td>{b.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>

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
              <td>emotion</td>
              <td>{json(v.state.emotion)}</td>
            </tr>
            <tr>
              <td>needs</td>
              <td>{json(v.state.needs)}</td>
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
            <tr>
              <td>last nightly day</td>
              <td>{v.state.last_nightly_day ?? "—"}</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className={styles.empty}>No core state yet.</p>
      )}

      <h3>Goals</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Progress</th>
            <th>Source</th>
            <th>Started</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {v.goals.map((g) => (
            <tr key={g.id}>
              <td>{g.title}</td>
              <td>{g.status}</td>
              <td>{g.progress.toFixed(2)}</td>
              <td>{g.source}</td>
              <td>{iso(g.started_at)}</td>
              <td>{iso(g.updated_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Snapshots</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Version</th>
            <th>Rendered</th>
            <th>Changed sections</th>
          </tr>
        </thead>
        <tbody>
          {v.snapshots.map((s) => (
            <tr key={s.version}>
              <td>{s.version}</td>
              <td>{iso(s.rendered_at)}</td>
              <td>{s.changed.length ? s.changed.join(", ") : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
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

      <h3>Drift log</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Version</th>
            <th>Check</th>
            <th>Value</th>
            <th>Verdict</th>
            <th>Score</th>
            <th>Excerpt</th>
          </tr>
        </thead>
        <tbody>
          {v.drift.map((d) => (
            <tr key={d.id}>
              <td>{d.version}</td>
              <td>{d.check}</td>
              <td>{d.value ?? "—"}</td>
              <td>{d.verdict ?? "—"}</td>
              <td>{d.score?.toFixed(2) ?? "—"}</td>
              <td>{d.excerpt ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Core memory counts</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Status</th>
            <th>Count</th>
          </tr>
        </thead>
        <tbody>
          {v.memoryCounts.map((c) => (
            <tr key={`${c.kind}:${c.status}`}>
              <td>{c.kind}</td>
              <td>{c.status}</td>
              <td>{c.n}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Recent core memory</h3>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Content</th>
            <th>Valence</th>
            <th>Status</th>
            <th>Occurred</th>
            <th>Links</th>
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
              <td>{m.links ? json(m.links) : "—"}</td>
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
            <th>Status</th>
            <th>Calls</th>
            <th>Tokens in/out</th>
            <th>Cost</th>
            <th>Error</th>
            <th>Outputs</th>
          </tr>
        </thead>
        <tbody>
          {v.traces.map((t) => (
            <tr key={t.id}>
              <td>{t.loop}</td>
              <td>{iso(t.created_at)}</td>
              <td>{t.status}</td>
              <td>{t.calls}</td>
              <td>
                {t.tokens_in ?? "—"}/{t.tokens_out ?? "—"}
              </td>
              <td>{t.cost?.toFixed(4) ?? "—"}</td>
              <td>{t.error ?? "—"}</td>
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
