import { expect, test } from "vitest";
import { decisionLine, renderReview } from "../../evals/lib/review";

test("renders every turn, decision, fact and annotation, with no pass/fail verdict on quality", () => {
  const at = (s: number) => new Date(Date.UTC(2026, 0, 5, 9, 0, s));
  const md = renderReview(
    [
      {
        script: "burst-short",
        attempt: 1,
        result: {
          name: "burst-short",
          status: "pass",
          meta: { decayPasses: 0, ticks: 0, lifeHours: 0, ungroundedClaims: 0 },
          assertions: [],
          annotations: [
            {
              type: "reply_about",
              user: "main",
              verdict: "yes",
              detail: "mentions the driving test",
            },
          ],
          trace: {
            transcripts: {},
            // The memory dump is { facts, threads, entities } per user.
            memory: {
              main: {
                facts: [
                  {
                    subject: "user",
                    kind: "event",
                    content: "The user passed their driving test.",
                    status: "active",
                  },
                ],
                threads: [],
                entities: [],
              },
            },
            turns: {
              main: [
                {
                  session: 1,
                  created_at: at(0),
                  role: "user",
                  trigger: null,
                  text: "omg",
                  reply_to: null,
                  id: "u1",
                },
                {
                  session: 1,
                  created_at: at(20),
                  role: "companion",
                  trigger: null,
                  text: "WAIT. first try??",
                  reply_to: "u1",
                  id: "r1",
                },
              ],
            },
            decisions: {
              main: [
                {
                  kind: "turn",
                  turn_id: "u1",
                  source: "model",
                  outcome: null,
                  output: { complete: true, wait_ms: 4000, reasoning: "short but done" },
                },
              ],
            },
          },
        },
      },
    ],
    { stamp: "s", real: ["turn_judge"], annotate: true },
  );
  for (const text of [
    "burst-short",
    "omg",
    "WAIT. first try??",
    "short but done",
    "passed their driving test",
    "mentions the driving test",
    "turn_judge",
  ])
    expect(md).toContain(text);
});

test("lists ungrounded self claims and every core-loop model call with its prompt and output", () => {
  const md = renderReview(
    [
      {
        script: "core-two-weeks",
        attempt: 1,
        result: {
          name: "core-two-weeks",
          status: "pass",
          meta: { decayPasses: 0, ticks: 0, lifeHours: 336, ungroundedClaims: 2 },
          assertions: [],
          annotations: [],
          trace: {
            transcripts: {},
            memory: {},
            coreCalls: [
              {
                purpose: "core_wander",
                input: "what is on her mind",
                output: { thought: "the Pleiades" },
              },
            ],
          },
        },
      },
    ],
    { stamp: "s", real: ["core_wander"], annotate: false },
  );
  expect(md).toContain("ungrounded self claims (life/opinion): 2");
  expect(md).toContain("what is on her mind");
  expect(md).toContain("the Pleiades");
});

test("a guard row shows her self claims with their grounding similarity", () => {
  const line = decisionLine({
    kind: "guard",
    turn_id: null,
    source: "model",
    outcome: "passed",
    for: "reply",
    output: {
      reasoning: "ok",
      violations: [],
      self_claims: [
        { claim: "she watched Stalker", similarity: 0.42 },
        { claim: "she read Solaris", similarity: null },
      ],
    },
  });
  expect(line).toContain("self claims: she watched Stalker (0.42); she read Solaris (unchecked)");
});
