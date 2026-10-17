import type { Phrases } from "@/mind/platform/phrases";
import type { GroundedClaim } from "@/mind/process/guard/self-claims";
import type { Candidate, GateResult } from "@/mind/process/outreach/types";
import type { OutreachSnapshot } from "./outreach-check";
import type { RelSnapshot } from "./relationship-check";
import type { ScriptResult, TraceDecision, TraceTurn } from "./runner";
import { renderVoiceReport } from "./voice-report";

export type ReviewRun = {
  script: string;
  attempt: number;
  result: ScriptResult;
  description?: string;
  profile?: string;
};
export type ReviewMeta = {
  stamp: string;
  real: string[];
  annotate: boolean;
  /** The how-to-text phrases, to read each reply's band and move back out of its prompt. */
  voicePhrases?: Phrases;
};

const time = (d: Date | string) => new Date(d).getTime();
const oneLine = (s: string) => s.trim().replace(/\s*\n\s*/g, " ⏎ ");
const fmt = (v: unknown) => (typeof v === "string" ? oneLine(v) : JSON.stringify(v));
const selfClaims = (claims: GroundedClaim[]) =>
  claims
    .map((c) => `${c.claim} (${c.similarity === null ? "unchecked" : c.similarity.toFixed(2)})`)
    .join("; ");

export function decisionLine(d: TraceDecision): string {
  const o = (d.output ?? {}) as Record<string, unknown>;
  if (d.kind === "turn") {
    const parts = [
      `complete: ${fmt(o.complete)}`,
      `wait ${fmt(o.wait_ms)}ms`,
      `backchannel: ${o.backchannel ? fmt(o.backchannel) : "none"}`,
      ...(Array.isArray(o.open_questions) && o.open_questions.length
        ? [`open questions: ${fmt(o.open_questions)}`]
        : []),
      ...(o.reasoning !== undefined ? [`reasoning: ${fmt(o.reasoning)}`] : []),
      ...(o.error ? [`error: ${fmt(o.error)}`] : []),
    ];
    return `turn judge (${d.source}): ${parts.join("; ")}`;
  }
  if (d.kind === "guard") {
    const violations = (o.violations ?? o.keyword_violations ?? []) as unknown[];
    const parts = [
      `outcome: ${d.outcome ?? "(regenerated)"}`,
      `violations: ${violations.length ? fmt(violations) : "none"}`,
      ...(Array.isArray(o.self_claims) && o.self_claims.length
        ? [`self claims: ${selfClaims(o.self_claims as GroundedClaim[])}`]
        : []),
      ...(o.reasoning !== undefined ? [`reasoning: ${fmt(o.reasoning)}`] : []),
      ...(o.error ? [`error: ${fmt(o.error)}`] : []),
    ];
    return `guard${d.for ? ` (${d.for})` : ""} (${d.source}): ${parts.join("; ")}`;
  }
  return `${d.kind} (${d.source}): ${fmt(d.output)}`;
}

/** The extractor's raw hurt and tension readings, so a review can check them against the scale. */
export function signalsLine(
  events: { cause: string; param: string | null; detail: Record<string, unknown> }[],
): string {
  const readings = events
    .filter((e) => e.cause === "signal" && (e.param === "hurt" || e.param === "tension"))
    .map((e) => `${e.param} ${String(e.detail.signal)}`);
  return `Signals: ${readings.join(" · ") || "none"}`;
}

/** The relationship snapshot right after a session: state, params and event counts. No pass/fail. */
function renderRelationship(snap: RelSnapshot): string[] {
  const counts = new Map<string, number>();
  for (const e of snap.events) counts.set(e.cause, (counts.get(e.cause) ?? 0) + 1);
  const eventsLine =
    [...counts.entries()].map(([cause, n]) => `${cause} ${n}`).join(", ") || "none";
  return [
    `Relationship: status ${snap.state.status} · make_up ${snap.state.make_up_state} · end_pending ${snap.state.end_pending_since ? "yes" : "no"}`,
    "",
    "| param | value | baseline | effect |",
    "|---|---|---|---|",
    ...Object.entries(snap.params).map(
      ([name, p]) =>
        `| ${name} | ${p.value.toFixed(3)} | ${p.baseline.toFixed(3)} | ${snap.effects[name as keyof typeof snap.effects].toFixed(3)} |`,
    ),
    "",
    `Events by cause: ${eventsLine}`,
    signalsLine(snap.events),
  ];
}

/** Every outreach tick that got past the pre-check: candidates by score, the winner, failed gates. */
export function reachOutTicks(log: OutreachSnapshot["log"]): string[] {
  const cand = (c: Candidate) => `${c.kind} ${c.score.toFixed(2)} "${oneLine(c.topic)}"`;
  return [
    `Reach-out ticks (${log.length}):`,
    "",
    ...log.map((l) => {
      const cs = [...(l.candidates as Candidate[])].sort((a, b) => b.score - a.score);
      // A send-time drop wraps the tick's gates: `{ tick, dropped, recheck? }`.
      const g = l.gate_results as GateResult[] | { tick: GateResult[]; dropped: string };
      const failed = (Array.isArray(g) ? g : g.tick).filter((r) => !r.pass);
      return [
        `- ${new Date(l.created_at).toISOString()} **${l.status}**${Array.isArray(g) ? "" : ` (${oneLine(g.dropped)})`}`,
        `winner: ${l.winner ? cand(l.winner as Candidate) : "none"}`,
        `gates failed: ${failed.map((g) => `${g.rule}${g.detail ? ` (${oneLine(g.detail)})` : ""}`).join(", ") || "none"}`,
        `candidates: ${cs.map(cand).join(" | ") || "none"}`,
      ].join(" · ");
    }),
    "",
  ];
}

/** One user's session, chronologically: turns with their offset, what each reply covered, and the decisions on each turn. */
function renderSession(
  out: string[],
  turns: TraceTurn[],
  decisions: TraceDecision[],
  all: TraceTurn[],
) {
  const t0 = time(turns[0]!.created_at);
  const byId = new Map(all.map((t) => [t.id, t]));
  const userIndex = new Map(turns.filter((t) => t.role === "user").map((t, i) => [t.id, i + 1]));
  const byTurn = new Map<string, TraceDecision[]>();
  for (const d of decisions)
    if (d.turn_id) (byTurn.get(d.turn_id) ?? byTurn.set(d.turn_id, []).get(d.turn_id)!).push(d);
  let prevEnd = -Infinity;
  for (const t of turns) {
    const at = `\`+${Math.round((time(t.created_at) - t0) / 1000)}s\``;
    if (t.role === "user") {
      out.push(`- ${at} **user #${userIndex.get(t.id)}**: ${oneLine(t.text)}`);
    } else if (t.trigger === "backchannel") {
      out.push(`- ${at} _backchannel_: ${oneLine(t.text)}`);
    } else if (t.reply_to) {
      const anchor = byId.get(t.reply_to);
      const end = anchor ? time(anchor.created_at) : -Infinity;
      const covers = turns
        .filter(
          (u) => u.role === "user" && time(u.created_at) > prevEnd && time(u.created_at) <= end,
        )
        .map((u) => `#${userIndex.get(u.id)}`);
      prevEnd = Math.max(prevEnd, end);
      out.push(
        `- ${at} **Spica** (covers ${covers.join(", ") || "none in this session"}): ${oneLine(t.text)}`,
      );
    } else {
      out.push(`- ${at} **Spica**${t.trigger ? ` (${t.trigger})` : ""}: ${oneLine(t.text)}`);
    }
    for (const d of byTurn.get(t.id) ?? []) out.push(`  - ${decisionLine(d)}`);
  }
}

/**
 * The `--review` file: every input and output of a run, for manual analysis. It carries no
 * pass/fail verdict on quality; deterministic checks are listed as facts about the run.
 */
export function renderReview(runs: ReviewRun[], meta: ReviewMeta): string {
  const out: string[] = [
    `# Eval review ${meta.stamp}`,
    "",
    `- real: ${meta.real.length ? meta.real.join(", ") : "(none)"}; everything else fake`,
    `- annotations: ${meta.annotate ? "on" : "off"}`,
    "- For manual analysis. Nothing here is a pass/fail verdict on reply quality.",
    "",
  ];
  for (const { script, attempt, result, description, profile } of runs) {
    out.push(`## ${script} (attempt ${attempt})`, "");
    if (description) out.push(oneLine(description), "");
    if (profile) out.push(`Onboarding profile: ${profile}`, "");
    if (result.error) out.push(`**Run error:** ${oneLine(result.error)}`, "");
    const trace = result.trace;
    const users = Object.keys({ ...trace?.turns, ...trace?.memory });
    for (const user of users) {
      out.push(`### ${user}`, "");
      const turns = trace?.turns?.[user] ?? [];
      const decisions = trace?.decisions?.[user] ?? [];
      const known = new Set(turns.map((t) => t.id));
      for (const session of [...new Set(turns.map((t) => t.session))]) {
        const rows = turns.filter((t) => t.session === session);
        out.push(`#### Session ${session} (${new Date(rows[0]!.created_at).toISOString()})`, "");
        renderSession(out, rows, decisions, turns);
        out.push("");
        const snap = trace?.relationship?.[user]?.[session - 1];
        if (snap) out.push(...renderRelationship(snap), "");
      }
      const calls = trace?.voice?.[user] ?? [];
      if (calls.length && meta.voicePhrases) {
        const finals = turns
          .filter(
            (t) => t.role === "companion" && (t.trigger === null || t.trigger === "reach_out"),
          )
          .map((t) => t.text);
        out.push(...renderVoiceReport(calls, finals, meta.voicePhrases));
      }
      const loose = decisions.filter((d) => !d.turn_id || !known.has(d.turn_id));
      if (loose.length)
        out.push("Decisions without a turn:", "", ...loose.map((d) => `- ${decisionLine(d)}`), "");
      const facts = (trace?.memory?.[user]?.facts ?? []) as Record<string, unknown>[];
      out.push("Final facts:", "");
      out.push(
        ...(facts.length
          ? facts.map(
              (f) => `- [${fmt(f.status)}] ${fmt(f.subject)}/${fmt(f.kind)}: ${fmt(f.content)}`,
            )
          : ["- (none)"]),
        "",
      );
      const ticks = trace?.outreach?.[user]?.log;
      if (ticks) out.push(...reachOutTicks(ticks));
    }
    out.push("### Annotations", "");
    out.push(
      ...(result.annotations.length
        ? result.annotations.map(
            (a) =>
              `- ${a.type} (${a.user}): ${a.verdict}${a.detail ? ` — ${oneLine(a.detail)}` : ""}`,
          )
        : [meta.annotate ? "- (none)" : "- (not run; use --annotate)"]),
      "",
    );
    out.push(
      "### Her claims",
      "",
      `- ungrounded self claims (life/opinion): ${result.meta.ungroundedClaims}`,
      "",
    );
    const calls = trace?.coreCalls ?? [];
    if (calls.length) {
      out.push("### Core loop calls", "");
      for (const c of calls)
        out.push(
          `#### ${c.purpose}`,
          "",
          "```",
          c.input,
          "```",
          "",
          "```json",
          JSON.stringify(c.output, null, 2),
          "```",
          "",
        );
    }
    out.push("### Checks", "");
    out.push(
      ...(result.assertions.length
        ? result.assertions.map(
            (a) =>
              `- ${a.status === "pass" ? "✓" : a.status === "skipped" ? "–" : "✗"} ${a.type}${a.check ? `/${a.check}` : ""}${a.user ? ` (${a.user})` : ""}${a.detail ? ` — ${oneLine(a.detail)}` : ""}`,
          )
        : ["- (none)"]),
      "",
    );
  }
  return out.join("\n");
}
