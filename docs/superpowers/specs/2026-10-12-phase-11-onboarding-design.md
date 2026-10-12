# Phase 11: Onboarding, the profile card swap — design

Date: 2026-10-12. Status: approved in conversation, awaiting spec review.

Phase 11 (v3 §14, §20) replaces §14's personality questionnaire with a short quiz framed as how
Spica meets people. Attachment stays out (§21 #8).

## Intent

The original questionnaire found you an ideal partner. Spica is now one fixed person, so a
one-way survey has no job: it shapes nothing about her, and reveal pacing would have locked its
output anyway. The reframe: **this is how she meets people.** The way people meet on social media
with an impression of each other first, you and Spica swap profile cards before the first chat.
It's dating apps, but for friends. The hook is curiosity about a specific person: how *you* would
get on with *her*.

Everything on the card is a first impression, taken lightly on both sides.

Test phase: functionality over accuracy. The questions, weights, her positions and every
threshold are a first draft, open to tweaks in the quiz file and config.

## Decisions taken with Ethan (2026-10-12)

- **36-questions style, symmetric.** You answer, then you see her answer. Her answers are fixed and
  written in advance. Multiple-choice questions show **only her pick**, with no commentary. Open
  questions (interests, hobbies) show her answer in **one or two words**. She gives away about as
  much as you do, so neither side knows much more about the other.
- **Our own friend dimensions, loosely backed by research.** No MBTI or Big Five labels: real
  personality tests are far longer than a short quiz, and getting mislabelled is an early reason to
  quit. The six dimensions below are a draft for Phase 11, open to tweaks.
- **Bars.** Each dimension is a bar, with your percentage overlaid on her fixed marker.
- **Both cards are known, lightly.** She has seen your card and you have seen hers. Card facts are
  low-confidence first impressions that real conversation corrects. The reveal-pacing lock is
  dropped (it changes §14 and its exit test).
- **Required, once.** `/chat` redirects to the quiz until it's done, and it can't be retaken.
  Taking it before signup, as a hook, is a later decision. The seam is kept: answers stay in the
  browser until submit, and scoring is a pure function of the answers.

## 1. The quiz file

`prompts/onboarding/quiz/v1.yaml`, selected by config `onboarding.quiz_version`. It's content,
versioned like a prompt, and the loader validates it with zod. It holds:

- **`dimensions`**: `id`, `left` and `right` labels, `her` (0–100, her fixed position, written to
  match `prompts/persona/v5.md`), `basis` (a one-line research note shown on the results page),
  `click` and `clash` (one line each, in her voice).
- **`questions`**, in display order:
  - `choice`: `id`, `prompt`, 3–4 `options`, each with `label` and `weights` (dimension id → a
    value from -1 for fully left to +1 for fully right; a missing dimension means no weight),
    `her` (the option index she picks) and an optional `her_fact` (§4).
  - `open`: `id`, `prompt`, `max_words` (2), `her` (her one-or-two-word answer), `fact` (the user
    fact template, e.g. `"On their profile card, they listed {answer} as a hobby."`) and `her_fact`
    (her side, e.g. `"You put old films on your profile card as a hobby."`).
- **`no_common`**: the line shown when no topics match (§3).
- About 10 choice questions (roughly two per dimension) and 2–3 open questions: 12–13 in all,
  under three minutes.

### Draft dimensions

| id | Left ↔ right | Basis (loosely) | Her |
|---|---|---|---|
| `social_energy` | Homebody ↔ out-and-about | Extraversion (Big Five) | 30 |
| `structure` | Planner ↔ spontaneous | Conscientiousness (Big Five) | 60 |
| `novelty` | Comfort picks ↔ new things | Openness to experience (Big Five) | 60 |
| `directness` | Keep the peace ↔ say it straight | Directness and conflict style (Gottman; agreeableness) | 90 |
| `talk` | Easy banter ↔ deep talk | Substantive vs small talk (Mehl et al. 2010) | 75 |
| `contact` | Check in now and then ↔ always texting | Friendship maintenance (Oswald; Hall) | 50 |

Night owl ↔ early bird was left out: she has no body or sleep, so her marker would be invented.

## 2. Flow

1. **Signup** is unchanged (name, email, password, date of birth, 18+).
2. **Gate.** The server page for `/chat` redirects to `/onboarding` when the user has no
   `onboarding` row. Existing accounts take the quiz on their next visit. `/onboarding` redirects
   to `/chat` once the row exists.
3. **`/onboarding`**: one question per screen, with a short framing line first ("this is how she
   meets people: you swap cards"). Choice: you pick, then her pick is highlighted. Open: you type
   up to two words, then her words appear. Answers stay in client state until the last question.
4. **Submit.** POST `/api/onboarding` with `{ quiz_version, answers }`. The server:
   - rejects a version other than the configured one, a missing or extra question, an option index
     out of range, and an open answer that is empty, longer than `max_words` words or longer than
     `onboarding.max_answer_chars` (trust boundary);
   - returns `409` if the user already has a row;
   - embeds the fact texts and the open answers (before the transaction, so a slow embedder never
     holds it open);
   - in one transaction, inserts the `onboarding` row and the card facts (§4);
   - returns `201`. The client goes to `/onboarding/results`.
5. **`/onboarding/results`**: the compatibility page (§3), with a "meet her" button to `/chat`. A
   link from settings ("your card") reopens it.

### Storage

One migration adds `onboarding`: `user_id` (primary key, references `user`, cascade on delete),
`quiz_version` text, `answers` jsonb (question id → option index or answer text), `completed_at`
(set from the injected clock). Derived values (scores, topics) aren't stored: the results page
recomputes them from the row and the quiz file. Account deletion removes the row through the
cascade.

## 3. Scoring and the compatibility page

All in code, no model call. `scoreCard(quiz, answers)` is a pure function in
`src/mind/process/onboarding/` (framework-free).

- **Your position** on a dimension is the mean of the chosen options' weights for it, mapped from
  -1..1 to 0..100. A dimension no answer weighted shows 50 (the quiz file validation stops that
  happening in practice: every dimension needs at least one weighted option in two questions).
- **Gap** = |you − her|. Below `onboarding.click_gap` (20) the page shows the dimension's `click`
  line, above `onboarding.clash_gap` (50) its `clash` line, and in between nothing.
- **Common topics.** Each of your open answers is compared with each of her open answers by cosine
  similarity of their embeddings. A pair at or above `onboarding.topic_similarity` (0.6) counts,
  and an exact match after lowercasing and trimming always counts. Embeddings are computed at
  submit and stored in `answers` (`{ text, embedding }` for open answers), so the results page
  makes no calls. Her answers' embeddings are computed once per quiz version and cached in memory.
- **No topics in common:** the page shows the quiz file's `no_common` line, in her voice (her
  persona argues that friends don't need common ground), e.g. *"nothing in common. good,
  honestly."*
- **Page layout:**
  - her card (her name, her open answers);
  - your card (your name, your open answers);
  - six bars, each with her marker, your marker and the gap, the dimension's basis in small text,
    and its click or clash line when it has one;
  - the common topics, or the `no_common` line.

  It's designed to read well as a screenshot.
- **Sharing:** screenshot only for now. A public share link needs auth and abuse work, so it goes
  in §25 as a "before users" item.

## 4. How the card reaches her mind

Written in the submit transaction, user-scoped (V2, V7). Nothing touches core.

**Your card** (`subject: user`, `source: onboarding`, `source_ref: onboarding:<quiz_version>`):
- One `trait` fact per dimension, as an impression: the side you lean to, worded from its label
  (`"On their profile card they came across as more of a homebody."`). A score within
  `onboarding.neutral_band` (15) of 50 writes `"…came across as somewhere between a homebody and
  out-and-about."`.
- One `preference` fact per open answer, from the question's `fact` template.
- Confidence `onboarding.confidence` (0.4), salience `onboarding.salience` (0.5). These facts
  decay and get superseded by conversation like any other.
- **Name floor (B6):** one `trait` fact `"Their name is {user.name}."` at salience 1.0. Decay
  leaves salience 1 unchanged, so it never goes `stale`. No decay code changes.

**Her card** (`subject: self`, `source: onboarding`): one fact per open question from its
`her_fact`, plus one per choice question where her pick says something about her (the quiz file
marks those with `her_fact` too; others write nothing). Same confidence and salience as yours.
This is the existing "what she told this user" record, so she won't present them as news later.
They don't go in the disclosure ledger, which only tracks core memories and self lines.

**Reply.**
- The retrieval origin `onboarding` keeps its name. Its mark in `assemble.ts` changes from *(from
  when you first met)* to *(from their profile card, a first impression)*.
- Reply prompt v16 replaces v15's onboarding sentence: card facts are what each of you put on your
  profile cards when you met; hold them loosely, let what they actually say override them, and
  never treat them as something said in chat. v15 is deleted once nothing configures it.
- The guard and false-recall judge `onboarding_as_chat` categories stay unchanged.
- **Reveal pacing is dropped:** no lock and no unlock. §14 and §20 are updated to match.
- Capping onboarding facts in the guard input moves to the guard phase (B6 split), since the guard
  is off.

**Evals:** the `basic` / `minimal` / `rich` profiles stay as the stand-in for scripted users, and
their wording moves to card phrasing (`"On their profile card…"`). The profile experiment from B6
stays in tuning.

## 5. Config

```json
"onboarding": {
  "quiz_version": "v1",
  "confidence": 0.4,
  "salience": 0.5,
  "neutral_band": 15,
  "click_gap": 20,
  "clash_gap": 50,
  "topic_similarity": 0.6,
  "max_answer_chars": 40
}
```

## 6. Testing and exit

Unit tests:
- `scoreCard`: positions, gaps, click and clash selection, the neutral band, topics by similarity
  and by exact match, the `no_common` case.
- Quiz file validation: rejects a dimension with too few weighted questions, a `her` index out of
  range, and a two-word limit broken by her own answer.
- Submit validation: wrong version, missing or extra answers, an over-long open answer, a second
  submit returning `409`.

Exit test `tests/exit/phase-11.test.ts` (deterministic; embeddings faked; reply model faked; guard
off; no LLM calls in this phase):
1. A finished quiz writes exactly the expected card facts for both sides: source, `source_ref`,
   confidence, salience, and the name fact at 1.0.
2. Card facts reach the reply prompt with the card mark.
3. A later conversation fact supersedes a card fact through the normal reconcile path.
4. `/chat` redirects to `/onboarding` until the row exists, and back afterwards.
5. The results page data (bars, lines, topics) matches a fixed set of answers.
6. After a decay pass far in the future, the name fact is still live and the other card facts can
   go stale.
7. **Leak canary:** a token in user A's open answer never appears in core tables or in user B's
   reply prompt. Side channel: A's submit leaves core state unchanged.

## 7. Spec and log updates

- **§14** rewritten: the card swap, symmetric answers, the six dimensions, no lock, the name floor,
  required once, pre-signup as a later decision.
- **§20** Phase 11 row and exit test replaced with §6 above. The facts schema section notes
  `source_ref` `onboarding:<version>`.
- **§25:** B6 is split (name floor done; the guard-input cap moves to the guard phase; the profile
  experiment stays in tuning). New: a public share link (before users) and a pre-signup quiz
  (later).
- **§21 #8** (attachment) stays open; the quiz file can take attachment questions later with no
  schema change.
- **`DECISIONS.md`:** the dropped reveal-pacing lock; screenshot-only sharing; her card as `self`
  facts rather than the disclosure ledger.

## Out of scope

Attachment measurement, retakes, the pre-signup quiz, public share links, the guard-input cap, and
any effect of the card on relationship params (e.g. seeding `msgs_per_day` from `contact`). All
of these stay possible.
