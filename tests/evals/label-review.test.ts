/** The labelling replay's review file: totals, named cases first, then every conversation. */
import { expect, test } from "vitest";
import { emptyLabels, type CheckedLabels } from "@/mind/memory/user/annotations";
import { conversations, type LayerTurn } from "@/mind/memory/user/layers";
import { conversationKey } from "../../evals/lib/label-replay";
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
    {
      id: "m2",
      pieces: ["2.1"],
      coords: [],
      speaker: "user",
      act: "answers",
      repliesTo: "m1",
      context: false,
    },
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
  drops: [
    { layer: "proposition", id: "p2", reason: "wrong_speaker" },
    { layer: "move", id: "m2", reason: "bad_link", ref: "replies_to m9" },
  ],
};
// A later conversation whose context turns hold the named words but whose own turns don't.
const later: ReplayConversation = {
  ...c,
  id: "later-conversation",
  before: c.turns,
  turns: [turn("u9", "user", 59, "morning")],
  exchanges: [],
};

test("the review shows totals, the named case, the numbered conversation, v11 and the labels", () => {
  const out = renderReview({
    stamp: "STAMP",
    title: "exchange mode, reading with thinking",
    conversations: [later, c],
    calls: new Map([
      [conversationKey(c), [{ messages: "1 to 3", labels: labelled, error: null }]],
      [conversationKey(later), [{ messages: "4 to 4", labels: null, error: "read: bad enum" }]],
    ]),
    usage: [
      {
        purpose: "extract_labels_read",
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
  expect(out).toContain("# Labelling replay STAMP: exchange mode, reading with thinking");
  expect(out).toContain("| 2 | 1 | 1 | 0 | 0 | 1 | 0 | 0 | 2 (wrong_speaker 1, bad_link 1) |");
  expect(out).toContain("| extract_labels_read | 1 | 3500 | 1200 | 0 | $0.001 |");
  // The named case is the conversation where the words were said, not one that only shows them.
  const named = out.slice(out.indexOf("## Named cases"), out.indexOf("## Conversations"));
  expect(named).toContain("### since friday, from her own question");
  expect(named).toContain("- p1 user state");
  expect(named).not.toContain("failed");
  expect(out).toContain(`### 16c close · 2026-01-12T10:00 · ${c.id}`);
  expect(out).toContain("### 16c close · 2026-01-12T10:59 · later-conversation");
  expect(out).toContain("[2.1] User · Mon 2026-01-12 10:30 (UTC): yeah nothing yet");
  expect(out).toContain("- user event: The user has been waiting since Friday.");
  expect(out).toContain('- m2 answers → m1: "yeah nothing yet" (User)');
  expect(out).toContain(
    '- p1 user state "waiting to hear back" · salience 0.5 · rests on m2: "yeah nothing yet" (User)',
  );
  expect(out).toContain("- dropped proposition p2: wrong_speaker");
  expect(out).toContain("- dropped move m2: bad_link (replies_to m9)");
  expect(out).toContain("- failed: read: bad enum");
});
