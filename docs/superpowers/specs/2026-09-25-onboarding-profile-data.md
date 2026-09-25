# Onboarding profile data — testing phase

Addendum to v2 §12 (onboarding) and §14.2 (onboarding profile in evals). Scopes
what goes into `evals/profiles/*.yaml` while the Phase 7 survey doesn't exist
yet. Ignores test UI/question content entirely — that's Phase 7.

## 1. Profile data — what to capture

A profile (`ProfileSchema`, `evals/lib/script.ts`) is a flat `{kind, content}`
fact list plus one profile-level `confidence` and `salience`. For testing,
cover the same ground a short bio-style intro would — not a quiz transcript:

| Category | `kind` | Example |
|---|---|---|
| Identity basics | `trait` | name, age, occupation/study, general location |
| Self-described personality | `trait` | introvert/extrovert, 1-2 self-described quirks |
| Values | `trait` | one thing they care about in a friend |
| Communication style | `preference` | text vs. call, how fast they reply |
| Interests / hobbies | `preference` | 2-3 concrete interests, media taste |
| Current life context | `state` | what's going on right now (exams, new job) — optional; gives Spica something timely without it reading as a fact "learned in chat" |

**Exclude**, same as the existing `basic.yaml` comment: any topic an eval
script probes for (siblings, pets, jobs, cities, food, hobbies, health) — a
profile fact overlapping an eval's target fact contaminates `recall` /
`no_false_recall` judging.

**Exclude from every profile, regardless of eval overlap:** anything
sensitive (health, crisis-adjacent, family conflict). The warming-up phase
and the crisis carve-out (rule 7) both assume this surfaces through
conversation, never through a form.

**To test "how much profile data a good start needs" (§14.2, still open):**
add two more profile files, varying only fact count/category coverage, not
the schema:
- `minimal.yaml` — identity basics only, ~3-4 facts. The cold-start end.
- `rich.yaml` — every category above, 2-3 facts each, ~12-15 facts. The
  full-personality-test end.

`basic.yaml` (existing, 8 facts) sits in between. Swap via a script's
`profile:` field — no runner changes needed.

## 2. Backend treatment — labelling and comparison to other memories

**Already decided, do not re-derive** (v2 §5.1, §12; `evals/lib/script.ts`):
- `source = onboarding` (vs. `turn` for chat, `generated` for life sim,
  `inferred` for extraction)
- `subject = user`, always
- `confidence` and `salience` are set once per profile, not per fact — lower
  confidence and moderate salience than a fact stated in conversation
- `kind` is one of the existing enum values. An onboarding profile never
  produces `feeling` or `promise` facts — those describe things that happen
  *in* the relationship, not information declared upfront
- Seeded before session 1: `created_at`/`occurred_at` at seed time,
  `status = open`, `recall_count = 0`
- **Reveal pacing is Phase 7, not built.** In Phase 1, onboarding facts are
  fully retrievable the moment they're seeded — same as any other fact.

**What that means for Phase 1, concretely:** an onboarding fact and a
conversation fact go through the identical scoring formula
(`sim × salience × recency`). The only differences today are the numbers a
profile ships with and the `source` tag (kept for later filtering). There is
no "unconfirmed" state and no code path that treats an onboarding fact
differently once it's in the retrieval pool — that distinction is Phase 7's
job by design (§12) and should stay deferred; Phase 1 is retrieval mechanics,
not reveal gating.

**Worth knowing, not worth building around:** recall reinforcement (§7.2)
bumps salience every time a fact is actually used in a reply, so a profile
fact that keeps getting pulled into conversation drifts toward
conversation-fact salience over time, same as anything else. That's the
existing recall-bump mechanic doing what it always does — it fires on
retrieval *use*, not on the user *confirming* the fact — so don't read it as
confirmation logic. It just explains why a profile fact "settling in" over
the first few sessions is expected, not a bug.

**Not to build yet:** a per-fact unconfirmed→confirmed status, or any gating
logic. That's the actual content of Phase 7 reveal pacing. Adding it now
would be a second half-built feature (CLAUDE.md: build only the current
phase).
