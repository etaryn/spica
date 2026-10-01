import Link from "next/link";
import type { LifeConfig } from "@/mind/platform/config";
import { lifeDate } from "@/mind/world/her-clock";
import type { RelationshipConfig } from "@/mind/state/user/relationship/types";
import type { Db } from "@/db/client";
import type { Deps } from "@/mind/platform/deps";
import * as r from "@/db/repos/admin/inspector";
import { listJudgeLogs } from "@/db/repos/user/judge-log";
import { listTurns } from "@/db/repos/user/session-log";
import styles from "../inspector.module.css";

const Empty = ({ phase }: { phase: number }) => (
  <p className={styles.empty}>Nothing yet. Filled from Phase {phase}.</p>
);
const iso = (d: Date | null | undefined) =>
  d ? d.toISOString().replace("T", " ").slice(0, 16) : "—";
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
          <p className={styles.session}>
            session {sid.slice(0, 8)} · {iso(ts[0]!.created_at)}
          </p>
          <table className={styles.table}>
            <tbody>
              {ts.map((t) => (
                <tr key={t.id}>
                  <td>{iso(t.created_at)}</td>
                  <td>{t.role}</td>
                  <td>{t.text}</td>
                  <td>{t.extracted ? "extracted" : "pending"}</td>
                  <td>{t.trigger ?? ""}</td>
                  <td>
                    {t.safety_flag?.flagged
                      ? `⚠ ${t.safety_flag.category} (${t.safety_flag.source})`
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

export async function FactsTab({
  db,
  userId,
  sp,
}: {
  db: Db;
  userId: string;
  sp: Record<string, string | undefined>;
}) {
  const f = r.parseFactFilters(sp);
  const facts = await r.listFacts(db, userId, f);
  return (
    <>
      <form className={styles.filters}>
        <input type="hidden" name="tab" value="facts" />
        <select name="subject" defaultValue={f.subject ?? ""}>
          <option value="">any subject</option>
          <option>user</option>
          <option>self</option>
          <option>shared</option>
        </select>
        <select name="status" defaultValue={f.status ?? ""}>
          <option value="">any status</option>
          <option>open</option>
          <option>resolved</option>
          <option>recurring</option>
          <option>stale</option>
          <option>superseded</option>
        </select>
        <input name="entityId" placeholder="entity id" defaultValue={f.entityId ?? ""} />
        <input name="threadId" placeholder="thread id" defaultValue={f.threadId ?? ""} />
        <select name="sort" defaultValue={f.sort}>
          <option value="recency">recency</option>
          <option value="salience">salience</option>
        </select>
        <button type="submit">Apply</button>
      </form>
      {!facts.length ? (
        <Empty phase={1} />
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>content</th>
              <th>subject</th>
              <th>kind</th>
              <th>status</th>
              <th>sal</th>
              <th>val</th>
              <th>conf</th>
              <th>created</th>
              <th>recalled</th>
            </tr>
          </thead>
          <tbody>
            {facts.map((x) => (
              <tr key={x.id}>
                <td>{x.content}</td>
                <td>{x.subject}</td>
                <td>{x.kind}</td>
                <td>{x.status}</td>
                <td>{x.salience.toFixed(2)}</td>
                <td>{x.valence.toFixed(2)}</td>
                <td>{x.confidence.toFixed(2)}</td>
                <td>{iso(x.created_at)}</td>
                <td>{iso(x.last_recalled_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export async function EntitiesThreadsTab({
  db,
  userId,
  base,
}: {
  db: Db;
  userId: string;
  base: string;
}) {
  const [entities, threads] = await Promise.all([
    r.listEntities(db, userId),
    r.listThreads(db, userId),
  ]);
  return (
    <>
      <h3>Entities</h3>
      {!entities.length ? (
        <Empty phase={1} />
      ) : (
        <table className={styles.table}>
          <tbody>
            {entities.map((e) => (
              <tr key={e.id}>
                <td>{e.name}</td>
                <td>{e.type}</td>
                <td>{e.subject}</td>
                <td>{e.relation}</td>
                <td>{e.salience.toFixed(2)}</td>
                <td>
                  <Link href={`${base}?tab=facts&entityId=${e.id}`}>facts</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>Threads</h3>
      {!threads.length ? (
        <Empty phase={1} />
      ) : (
        <table className={styles.table}>
          <tbody>
            {threads.map((t) => (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td>{t.subject}</td>
                <td>{t.status}</td>
                <td>{t.stakes}</td>
                <td>next: {iso(t.next_checkpoint)}</td>
                <td>
                  <Link href={`${base}?tab=facts&threadId=${t.id}`}>facts</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export async function RelationshipTab({
  db,
  userId,
  now,
  cfg,
}: {
  db: Db;
  userId: string;
  now: Date;
  cfg: RelationshipConfig;
}) {
  const v = await r.getRelationshipView(db, userId, now, cfg);
  if (!v) return <Empty phase={4} />;
  const { row } = v;
  return (
    <>
      <h3>State</h3>
      {json({
        status: row.status,
        make_up_state: row.make_up_state,
        make_up_replies: row.make_up_replies,
        hurt_cause_fact: row.hurt_cause_fact,
        end_pending_since: row.end_pending_since,
        ended_at: row.ended_at,
        repair_started_at: row.repair_started_at,
        crisis_quiet_until: row.crisis_quiet_until,
        unanswered_reach_outs: row.unanswered_reach_outs,
        last_contact: row.last_contact,
        last_tick: row.last_tick,
        cadence: row.cadence,
      })}
      <h3>Params</h3>
      <table className={styles.table}>
        <tbody>
          {v.params.map((p) => (
            <tr key={p.name}>
              <td>{p.name}</td>
              <td>val {p.value.toFixed(3)}</td>
              <td>base {p.baseline.toFixed(3)}</td>
              <td>var {p.variance.toFixed(3)}</td>
              <td>effect {p.effect.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Events</h3>
      {!v.events.length ? (
        <Empty phase={4} />
      ) : (
        <table className={styles.table}>
          <tbody>
            {v.events.map((e) => (
              <tr key={e.id}>
                <td>{iso(e.created_at)}</td>
                <td>{e.cause}</td>
                <td>{e.param ?? "—"}</td>
                <td>
                  {e.before?.toFixed(3) ?? ""} → {e.after?.toFixed(3) ?? ""}
                </td>
                <td>{e.deviation?.toFixed(2) ?? ""}</td>
                <td>{JSON.stringify(e.detail)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export async function RetrievalTab({ db, userId }: { db: Db; userId: string }) {
  const rows = await r.listRetrievalTraces(db, userId);
  if (!rows.length) return <Empty phase={1} />;
  const byTurn = new Map<string, typeof rows>();
  for (const row of rows)
    byTurn.set(row.trace.turn_id, [...(byTurn.get(row.trace.turn_id) ?? []), row]);
  return (
    <>
      {[...byTurn].map(([turnId, rs]) => (
        <section key={turnId}>
          <p className={styles.session}>turn {turnId.slice(0, 8)}</p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>fact</th>
                <th>sim</th>
                <th>fact sal</th>
                <th>entity sal</th>
                <th>recency</th>
                <th>score</th>
                <th>forced</th>
              </tr>
            </thead>
            <tbody>
              {rs.map(({ trace: t, content }) => (
                <tr key={t.id}>
                  <td>{content}</td>
                  <td>{t.sim.toFixed(3)}</td>
                  <td>{t.fact_salience.toFixed(2)}</td>
                  <td>{t.entity_salience.toFixed(2)}</td>
                  <td>{t.recency.toFixed(2)}</td>
                  <td>{t.score.toFixed(3)}</td>
                  <td>{t.forced ? "yes" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

type GateRes = { rule: string; pass: boolean; detail?: string };
type DropShape = {
  tick?: GateRes[];
  dropped?: string;
  recheck?: { gate?: GateRes[]; topicUsed?: boolean; epochChanged?: boolean; newTurn?: boolean };
};

const Gate = ({ results }: { results: unknown }) => (
  <>
    {Array.isArray(results) && results.length
      ? (results as GateRes[]).map((g) => (
          <span key={g.rule} title={g.detail} style={{ marginRight: 6 }}>
            {g.pass ? "✓" : "✗"}
            {g.rule}
          </span>
        ))
      : "—"}
  </>
);

/**
 * `gate_results` is the tick's array, or (after a send-job drop) `{ tick, dropped, recheck? }`; a `precheck` drop
 * (before typing) carries the same `recheck` shape from the unlocked check.
 */
function GateCell({ value }: { value: unknown }) {
  if (Array.isArray(value)) return <Gate results={value} />;
  const d = (value ?? {}) as DropShape;
  return (
    <>
      <div>dropped: {d.dropped ?? "—"}</div>
      <div>
        tick: <Gate results={d.tick} />
      </div>
      {d.recheck && (
        <div>
          {d.dropped === "precheck" ? "precheck" : "recheck"}: <Gate results={d.recheck.gate} />{" "}
          topicUsed {String(!!d.recheck.topicUsed)} · epochChanged{" "}
          {String(!!d.recheck.epochChanged)} · newTurn {String(!!d.recheck.newTurn)}
        </div>
      )}
    </>
  );
}

export async function ReachOutsTab({
  db,
  userId,
  limit,
}: {
  db: Db;
  userId: string;
  limit: number;
}) {
  const rows = await r.listReachOuts(db, userId, limit);
  if (!rows.length) return <Empty phase={6} />;
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>at</th>
          <th>status</th>
          <th>winner</th>
          <th>topic</th>
          <th>gate</th>
          <th>send at</th>
          <th>answered</th>
          <th>turn</th>
          <th>candidates</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x) => {
          const w = x.winner as { kind?: string; score?: number } | null;
          return (
            <tr key={x.id}>
              <td>{iso(x.created_at)}</td>
              <td>{x.status}</td>
              <td>
                {w
                  ? `${w.kind ?? "?"} ${typeof w.score === "number" ? w.score.toFixed(2) : ""}`
                  : "—"}
              </td>
              <td>{x.topic ?? "—"}</td>
              <td>
                <GateCell value={x.gate_results} />
              </td>
              <td>{iso(x.send_at)}</td>
              <td>{iso(x.answered_at)}</td>
              <td>{x.turn_id ? x.turn_id.slice(0, 8) : "—"}</td>
              <td>
                <details>
                  <summary>{Array.isArray(x.candidates) ? x.candidates.length : 0}</summary>
                  {json(x.candidates)}
                </details>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export async function TurnStateTab({ db, userId }: { db: Db; userId: string }) {
  const s = await r.getConversationState(db, userId);
  if (!s) return <Empty phase={3} />;
  return (
    <table className={styles.table}>
      <tbody>
        <tr>
          <th>buffer</th>
          <td>{json(s.buffer_turn_ids)}</td>
        </tr>
        <tr>
          <th>open questions</th>
          <td>{json(s.open_questions)}</td>
        </tr>
        <tr>
          <th>wait until</th>
          <td>{s.wait_until ? iso(s.wait_until) : "—"}</td>
        </tr>
        <tr>
          <th>version</th>
          <td>{s.buffer_version}</td>
        </tr>
        <tr>
          <th>in flight</th>
          <td>
            {json(s.inflight_turn_ids)} {s.inflight_since ? `since ${iso(s.inflight_since)}` : ""}
          </td>
        </tr>
        <tr>
          <th>sending</th>
          <td>{s.sending_since ? `since ${iso(s.sending_since)}` : "—"}</td>
        </tr>
        <tr>
          <th>reply epoch</th>
          <td>{s.reply_epoch}</td>
        </tr>
        <tr>
          <th>last backchannel</th>
          <td>{s.last_backchannel_at ? iso(s.last_backchannel_at) : "—"}</td>
        </tr>
      </tbody>
    </table>
  );
}

type FactRef = { id: string };

/** `judge_log.input` holds fact ids only; resolve them to current content for display, "(deleted)" if gone. */
function resolveJudgeInput(input: unknown, facts: Map<string, string>): unknown {
  if (!input || typeof input !== "object") return input;
  const i = input as Record<string, unknown>;
  const withContent = (f: FactRef) => ({ ...f, content: facts.get(f.id) ?? "(deleted)" });
  return {
    ...i,
    ...(Array.isArray(i.recalledFacts)
      ? { recalledFacts: (i.recalledFacts as FactRef[]).map(withContent) }
      : {}),
    ...(Array.isArray(i.onboardingFacts)
      ? { onboardingFacts: (i.onboardingFacts as FactRef[]).map(withContent) }
      : {}),
  };
}

export async function JudgeLogTab({ db, userId }: { db: Db; userId: string }) {
  const rows = await listJudgeLogs(db, userId);
  if (!rows.length) return <Empty phase={2} />;
  const ids = rows.flatMap((x) => {
    const i = x.input as { recalledFacts?: FactRef[]; onboardingFacts?: FactRef[] };
    return [...(i.recalledFacts ?? []), ...(i.onboardingFacts ?? [])].map((f) => f.id);
  });
  const facts = await r.resolveFactContents(db, userId, ids);
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th>at</th>
          <th>kind</th>
          <th>attempt</th>
          <th>outcome</th>
          <th>source</th>
          <th>ms</th>
          <th>prompt</th>
          <th>output</th>
          <th>input</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((x) => (
          <tr key={x.id}>
            <td>{iso(x.created_at)}</td>
            <td>{x.kind}</td>
            <td>{x.attempt}</td>
            <td>{x.outcome ?? "—"}</td>
            <td>{x.source}</td>
            <td>{x.latency_ms}</td>
            <td>{x.prompt_version}</td>
            <td>{json(x.output)}</td>
            <td>{json(resolveJudgeInput(x.input, facts))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export async function LifeTab({
  db,
  core,
  now,
  cfg,
}: {
  db: Db;
  core: Deps["core"];
  now: Date;
  cfg: LifeConfig;
}) {
  const day = lifeDate(cfg, now);
  const v = await r.getLifeView(db, day);
  const events = await core.world.events(day);
  return (
    <>
      <h3>
        Her plan for {day} ({cfg.timezone})
      </h3>
      {v.plan ? (
        <table className={styles.table}>
          <tbody>
            {v.plan.plan.blocks.map((b) => (
              <tr key={b.start}>
                <td>
                  {b.start}–{b.end}
                </td>
                <td>{b.kind}</td>
                <td>{b.busy.toFixed(2)}</td>
                <td>{b.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty phase={5} />
      )}
      <p>source: {v.plan?.source ?? "—"}</p>
      <h3>What happened today</h3>
      {events.length > 0 ? (
        <table className={styles.table}>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{iso(e.at)}</td>
                <td>{e.kind}</td>
                <td>{e.stakes}</td>
                <td>{e.content}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={styles.empty}>No events yet today.</p>
      )}
    </>
  );
}
