import { expect, test } from "vitest";
import { renderReview } from "../../evals/lib/review";

test("renders every turn, decision, fact and annotation, with no pass/fail verdict on quality", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 0, 5, 9, 0, s));
  const md = renderReview([{ script: "burst-short", attempt: 1, result: {
    name: "burst-short", status: "pass", meta: { decayPasses: 0 }, assertions: [],
    annotations: [{ type: "reply_about", user: "main", verdict: "yes", detail: "mentions the driving test" }],
    trace: {
      transcripts: {},
      // R2: the memory dump is { facts, threads, entities } per user.
      memory: { main: { facts: [{ subject: "user", kind: "event", content: "The user passed their driving test.", status: "active" }], threads: [], entities: [] } },
      turns: { main: [
        { session: 1, created_at: at(0), role: "user", trigger: null, text: "omg", reply_to: null, id: "u1" },
        { session: 1, created_at: at(20), role: "companion", trigger: null, text: "WAIT. first try??", reply_to: "u1", id: "r1" },
      ] },
      decisions: { main: [{ kind: "turn", turn_id: "u1", source: "model", outcome: null, output: { complete: true, wait_ms: 4000, reasoning: "short but done" } }] },
    },
  } }], { stamp: "s", real: ["turn_judge"], annotate: true });
  for (const text of ["burst-short", "omg", "WAIT. first try??", "short but done", "passed their driving test", "mentions the driving test", "turn_judge"]) expect(md).toContain(text);
});
