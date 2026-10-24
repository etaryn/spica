/** Replay sources: recorded runs rebuilt into conversations, and the invented chat ones. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { loadRun, parseLoggedInput } from "../../evals/lib/replay-source";
import { SLANG_CONVERSATIONS } from "../../evals/lib/slang-conversations";

const loggedInput = (exchange: string) =>
  [
    "User's timezone: UTC",
    "",
    "What Spica is into (to read her own words right):",
    "- Tarkovsky films",
    "- astronomy",
    "",
    "Open threads (id | title):",
    "- 162f | job interview at small design studio",
    "- 9a1b | half marathon",
    "",
    "New exchange (extract from this):",
    exchange,
  ].join("\n");

test("a logged extract input gives back the threads and interests it showed", () => {
  expect(parseLoggedInput(loggedInput("[Mon 2026-01-05 10:00 (UTC)] User: hey"))).toEqual({
    threads: [
      { id: "162f", title: "job interview at small design studio" },
      { id: "9a1b", title: "half marathon" },
    ],
    interests: ["Tarkovsky films", "astronomy"],
  });
  expect(
    parseLoggedInput(
      "User's timezone: UTC\n\nOpen threads: none\n\nNew exchange (extract from this):\nx",
    ),
  ).toEqual({ threads: [], interests: [] });
});

test("a run's conversations carry the turns before them and each exchange's logged call", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "replay-source-"));
  const row = (id: string, role: string, iso: string, session: string, extra = {}) => ({
    id,
    role,
    text: `${id} text`,
    created_at: iso,
    session_id: session,
    reply_to: null,
    trigger: null,
    ...extra,
  });
  const dump = path.join(dir, "db.json");
  writeFileSync(
    dump,
    JSON.stringify({
      user: [{ timezone: null }],
      session_log: [
        row("u1", "user", "2026-01-05T10:00:00+00:00", "s1"),
        row("c1", "companion", "2026-01-05T10:01:00+00:00", "s1", { reply_to: "u1" }),
        row("u2", "user", "2026-01-06T10:00:00+00:00", "s2"),
        row("c2", "companion", "2026-01-06T10:01:00+00:00", "s2", { reply_to: "u2" }),
        row("u3", "user", "2026-01-06T10:02:00+00:00", "s2"),
      ],
    }),
  );
  const calls = path.join(dir, "calls.jsonl");
  writeFileSync(
    calls,
    [
      { purpose: "reply", input: "Spica: c1 text" },
      {
        purpose: "extract",
        input: loggedInput(
          "[Mon 2026-01-05 10:00 (UTC)] User: u1 text\n[Mon 2026-01-05 10:01 (UTC)] Spica: c1 text",
        ),
        output: { facts: [{ subject: "user", kind: "event", content: "The user said u1." }] },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n"),
  );
  const [first, second] = loadRun("test", dump, calls, 6);
  expect(first!.zone).toBe("UTC");
  expect(first!.before).toEqual([]);
  expect(first!.exchanges[0]).toMatchObject({
    burst: ["u1"],
    replyId: "c1",
    interests: ["Tarkovsky films", "astronomy"],
    v11: { facts: [{ content: "The user said u1." }] },
  });
  expect(second!.before.map((t) => t.id)).toEqual(["u1", "c1"]);
  expect(second!.turns.map((t) => t.id)).toEqual(["u2", "c2", "u3"]);
  // No logged call matches this exchange: it still replays, with nothing shown.
  expect(second!.exchanges[0]).toMatchObject({ threads: [], interests: [], v11: null });
});

test("the invented conversations each end in an exchange and say what a right reading gives", () => {
  expect(SLANG_CONVERSATIONS).toHaveLength(10);
  for (const c of SLANG_CONVERSATIONS) {
    expect(c.run).toBe("invented");
    expect(c.note).toBeTruthy();
    expect(c.exchanges.length).toBeGreaterThan(0);
  }
});
