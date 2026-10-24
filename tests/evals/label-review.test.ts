/** The labelling replay's review file: totals, named cases first, then every conversation. */
import { expect, test } from "vitest";
import { emptyLabels, type CheckedLabels } from "@/mind/memory/user/annotations";
import { conversations, type LayerTurn } from "@/mind/memory/user/layers";
import { conversationKey, type UnitResult } from "../../evals/lib/label-replay";
import { renderReview } from "../../evals/lib/label-review";
import type { ReplayConversation } from "../../evals/lib/replay-source";

const turn = (
  id: string,
  role: LayerTurn["role"],
  minute: number,
  text: string,
  extra: Partial<LayerTurn> = {},
): LayerTurn => ({
  id,
  role,
  text,
  created_at: new Date(Date.UTC(2026, 0, 12, 10, minute)),
  session_id: "s1",
  reply_to: null,
  trigger: null,
  ...extra,
});
const [conversation] = conversations([
  turn("r1", "companion", 0, "has it been dark since friday", { trigger: "reach_out" }),
  turn("u1", "user", 30, "yeah nothing yet"),
  turn("c1", "companion", 31, "ugh, waiting is the worst", { reply_to: "u1" }),
]);
const c: ReplayConversation = {
  run: "16c close",
  id: conversation!.id,
  zone: "UTC",
  before: [],
  turns: conversation!.turns,
  exchanges: conversation!.exchanges.map((e) => ({
    ...e,
    threads: [],
    interests: [],
    v11: {
      facts: [
        { subject: "user", kind: "event", content: "The user has been waiting since Friday." },
      ],
    },
  })),
};
const labelled: CheckedLabels = {
  ...emptyLabels(),
  moves: [
    { id: "m2", pieces: ["2.1"], coords: [], speaker: "user", act: "answers", repliesTo: "m1" },
  ],
  propositions: [
    {
      id: "p1",
      moves: ["m2"],
      subject: "user",
      kind: "state",
      label: "waiting to hear back",
      status: null,
      times: [],
      mentions: [],
      thread_id: null,
      new_thread: null,
      updates: null,
      salience: 0.5,
      valence: -0.3,
      confidence: 0.9,
      claim_kind: null,
    },
  ],
  drops: [{ layer: "proposition", id: "p2", reason: "wrong_speaker" }],
};
const results: UnitResult[] = [
  {
    unit: "conversation",
    thinking: false,
    calls: new Map([[conversationKey(c), [{ messages: "1 to 3", labels: labelled, error: null }]]]),
  },
  {
    unit: "conversation",
    thinking: true,
    calls: new Map([
      [conversationKey(c), [{ messages: "1 to 3", labels: null, error: "bad enum" }]],
    ]),
  },
];

test("the review shows totals, the named case, the numbered conversation, v11 and each unit's labels", () => {
  const out = renderReview({
    stamp: "STAMP",
    conversations: [c],
    results,
    usage: [
      {
        purpose: "extract_labels_conversation",
        calls: 1,
        input: 3500,
        output: 1200,
        cacheRead: 0,
        cost: 0.00095,
      },
    ],
    namedCases: [
      { title: "since friday, from her own question", text: "has it been dark since friday" },
    ],
  });
  expect(out).toContain("# Labelling replay STAMP");
  expect(out).toContain(
    "| conversation | off | 1 | 0 | 1 | 0 | 0 | 1 | 0 | 0 | 1 (wrong_speaker 1) |",
  );
  expect(out).toContain("| conversation | on | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |");
  expect(out).toContain("| extract_labels_conversation | 1 | 3500 | 1200 | 0 | $0.001 |");
  expect(out.indexOf("### since friday, from her own question")).toBeLessThan(
    out.indexOf("## Conversations"),
  );
  expect(out).toContain("[2.1] User · Mon 2026-01-12 10:30 (UTC): yeah nothing yet");
  expect(out).toContain("- user event: The user has been waiting since Friday.");
  expect(out).toContain('- m2 answers → m1: "yeah nothing yet" (User)');
  expect(out).toContain(
    '- p1 user state "waiting to hear back" · salience 0.5 · rests on m2: "yeah nothing yet" (User)',
  );
  expect(out).toContain("- dropped proposition p2: wrong_speaker");
  expect(out).toContain("- failed: bad enum");
});
