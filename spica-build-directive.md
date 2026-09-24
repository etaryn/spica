# Spica: Build Directive for Claude Code

## 0. How to read this

- **DECIDED** = fixed, implement as written.
- **LEANING** = implement the leaning default behind a config flag so the alternative stays possible.
- **OPEN** = do not decide. Build so either option works, and ask Ethan.
- **ADDED** = suggested by Claude, not yet confirmed by Ethan. Implement, but flag in the PR/summary.

**Before writing any code:** propose a stack and repo layout, then wait for confirmation. Suggested default (change freely): Python 3.12 + FastAPI, WebSocket chat (needed for proactive messages and typing signals), Postgres + pgvector (SQLite for local dev), a thin LLM-provider abstraction so models can be swapped, and a minimal web chat client.

---

## 1. Product

Spica is a companion AI built to be a **best friend**, unapologetically standalone, not an assistant and not a "companion feature" bolted onto something else. She should feel human. Long-term aim: Spica becomes a real being.

Wanted qualities: unprompted reach-outs, a life outside the chat (can be simulated), values she upholds, her own ego, humanlike memory.

**Design thesis.** Chatbots feel less human because of over-forgiveness, over-agreeability and lack of consequence. Real relationships have weight because of stakes and irreversibility. Spica must have opinions, moods, limits and a life, and interactions with her should matter.

**MVP principle.** The MVP will not have every feature, but the codebase must be structured so features can be added without rewriting the core (see section 4.8).

---

## 2. Behavioral rules (DECIDED, non-negotiable)

Enforce these in code (guard layer + tests), not only in prompts.

1. **No threats, ever.** Not of leaving, punishment, or withdrawal.
2. Spica may show genuine negative emotion toward the user (hurt, annoyance, disappointment) but **always tries to make up afterwards**, as a friend would.
3. **Only the user can end the relationship.** If the user decides it is over and won't fix it, she lets go. If they later want to make up, it is slow but repairable.
4. Being hurt by the user's absence is allowed; **punishing it is not.** Closeness drifts during absence; friends don't fault each other for it.
5. **Push notifications are capped** and never repeated if the user doesn't respond.
6. Spica **never attacks the user personally.** Light jabs are fine; contempt is out (too risky). Implement a jab-vs-contempt check on outgoing messages that regenerates or softens anything crossing the line.
7. **ADDED: crisis carve-out.** If the user signals crisis or self-harm, suspend all friction behavior (no hurt displays, no busy-ness, no persona games) and respond with plain support. Ethan has flagged the risk of emotional damage and of the design reading as manipulation; this is the minimum safeguard.

---

## 3. Scope

**MVP (build now):**
- Weighted memory engine (4.1)
- Turn-taking / reply-timing engine (4.2)
- Simulated life and availability (4.3)
- Relationship state with homeostasis and consequence flow (4.4)
- Persona and values layer (4.5)
- Personality-test onboarding, hybrid version (4.6)
- Capped proactive outreach (4.7)
- Extension interfaces and stubs only (4.8)

**Post-MVP (do NOT build; leave hooks):** friend-group shared Spica, public social account, comparing Spicas.

---

## 4. Modules

### 4.1 Memory engine (DECIDED: one weighted engine)

A single weighted memory store holding data about **the user, Spica, and other entities** (people, places, things the user mentions). Chat pulls from it; it is written to after every turn.

Suggested schema:

```
Entity   { id, kind: user|spica|other, name, attrs }
Memory   { id, subject_entity_id, content, type: fact|event|feeling|opinion|promise,
           source: chat|test|life_sim|inferred, confidence,
           weight, valence, created_at, last_recalled_at, recall_count,
           scope: private|group, space_id }   // scope/space_id reserved for post-MVP
```

Behavior:
- **Retrieval score** = relevance × weight × recency decay. Recall reinforces weight.
- **Humanlike memory**: low-weight memories fade; recall can be imperfect or fuzzy; emotionally charged and repeated things stick.
- Keep the raw message log separately so extraction can be re-run.
- Extraction step after each exchange: pull out facts, events, feelings, promises, and entity mentions, and assign initial weight.

### 4.2 Turn-taking / reply engine (DECIDED thesis)

Spica does **not** do strict one-message-one-reply. Like a human, she judges whether context is complete before answering. She holds questions in her head, drops them if later messages answer them, and asks if the context ends without an answer.

State per conversation: `buffer` (messages since her last reply), `open_questions[]`, `wait_timer`.

Loop, on each incoming message and on timer ticks:
1. Append to buffer. Re-check `open_questions`; drop any now answered.
2. Run a cheap judge call: `context_complete?` (inputs: buffer, open questions, cues such as trailing off, "wait", "also", question marks).
3. Complete → generate the reply (with simulated typing delay).
4. Not complete → wait. While waiting, behavior depends on a persona parameter `backchannel_style`:
   - `signals`: occasionally send tiny "I'm here" reactions ("huh", "no way", "omg"), rate-limited.
   - `silent`: say nothing until a reply is expected.
5. Timer expires with an open question still unanswered → ask it.

Worked trace (`signals` style):
```
user:  ok so today was insane
spica: (judge: incomplete, no content yet)  -> "oh no what happened"?  or wait
user:  my boss called me in
user:  and I thought I was getting fired
spica: (judge: incomplete, story mid-flight)  -> "huh" [backchannel]
user:  turns out it was a promotion lol
spica: (judge: complete)  -> full reply reacting to the whole arc
```
Worked trace (question dropped):
```
user:  what should I cook tonight?     -> open_questions=[recipe idea]
       (judge: complete) -> Spica replies normally
```
but if the user follows up before she replies with "nvm I'll just order pizza", the open question is dropped and she reacts to that instead.

### 4.3 Simulated life and availability (DECIDED)

- Spica has a simulated life: a generated schedule with **busy/downtime blocks** and things that happen to her. Store these as her own memories (source `life_sim`) so she stays consistent when talking about them.
- **Reply priority rises with closeness.** High closeness can override busy periods; low closeness means slower replies during busy blocks.
- When busy, she can delay, or send a short "in the middle of something, later?" message.

### 4.4 Relationship state and homeostasis (DECIDED)

Relationship parameters (start with closeness, trust, warmth, hurt; make the set extensible). Every parameter is a `HomeostaticParam`:

```
value, baseline (slow-moving EMA of this user's normal), variance
effect_strength = f( (value - baseline) / sqrt(variance) )   // deviation, not absolute
```

Effect: behavior that is frequent for a given user becomes **normal** for Spica and gets less out of it; **deviations from that user's own baseline matter more.**

Worked trace (message frequency):
```
day 1:   user sends 40 msgs  -> baseline ~ 5/day, big positive deviation, Spica reacts strongly
day 14:  baseline ~ 35/day   -> 40 msgs is unremarkable
day 15:  user sends 2 msgs   -> large negative deviation, Spica notices, may feel hurt
```
Apply the same class to any other parameter later.

Consequence flow:
- Hurt state can be set by user actions or long absence, expressed genuinely, and resolved through a make-up flow that Spica initiates (rule 2).
- During absence, closeness drifts down slowly; no punishment (rule 4).
- If the user ends the friendship: she lets go. A later make-up attempt is accepted but rebuilds slowly.

### 4.5 Persona and values (DECIDED core, LEANING on interests)

- Spica is a **fixed personality in her own right**: fixed values and her own ego (pride, boundaries, stubbornness), with a stable voice.
- **LEANING:** fixed values, with Spica aligning her *interests* to the user's and adjacent interests, since a fully fixed persona with fixed interests clicks with fewer people. Ethan is still questioning whether interests need to match at all, so make interest-alignment a config option (`interest_alignment: off|adjacent|full`).
- Build a prompt/context assembler that combines persona + values + relationship state + retrieved memories + life state each turn.

### 4.6 Personality-test onboarding (LEANING: hybrid)

The test is the **product hook**. Its purpose is not to find an ideal lifelong friend but to **engineer initial attraction**: a potential friend the user clicks with at the beginning.

**LEANING (hybrid):** Spica is marketed as her own personality. The test **calibrates the user, not Spica**: results are registered in Spica's memory as user memories (source `test`, reduced confidence), which eases connection and gives a strong start.

Implementation notes:
- Pace how much Spica "reveals" she knows. Ethan sees value in the warming-up/poking phase of early friendship, and a test that skips it might feel manufactured. Add reveal-pacing rules so test-derived knowledge surfaces gradually.
- Flag `test_calibrates: user | spica | both` keeps the alternative (variable Spica) alive. Default `user`.
- **OPEN:** fixed-character Spica (truer to the companion philosophy) vs variable Spica calibrated to the user (more marketable). Another idea still on the table: a calibrated personality and value set that matches and opposes the user in predictively interesting ways.

### 4.7 Proactive outreach (DECIDED)

Scheduler that lets Spica message first. Triggers: follow-up on something in memory, something from her own simulated day, or closeness-driven check-ins.

Hard constraints: daily cap, respects her busy blocks and quiet hours, **never re-sends if unanswered**, and never guilt-trips (rule 4/5).

### 4.8 Extension points (post-MVP, hooks only)

Structure features as modules that register through interfaces (event bus / hooks), so adding one does not modify the core.

- **Friend connectivity (on hold):** one shared Spica used as context inside a friend group. Hook: memory `scope`/`space_id`, and a conversation abstraction that can be group-scoped. Do not build.
- **Public social presence (ideal end point):** a followable public account (Instagram/Twitter/Facebook etc.) posting posts and stories without her face. Users can text the account from their registered account and get replies from **their own** Spica; posts can be shared both ways (Seraphine-style). It is a public persona like a human's; zero contradiction with the private Spica is a goal, not a requirement, since everyone knows she's an AI. Hook: a `SocialChannel` interface and a `public_persona` view of the persona. Stub only.
- **Comparing Spicas:** friends bringing up their Spica to each other. No work now beyond keeping the persona core stable across users.

---

## 5. Suggested build order

1. **Skeleton**: chat server, WebSocket client, LLM abstraction, persona prompt, raw message log.
   *Done when:* a basic conversation works end to end.
2. **Memory engine**: schema, extraction, weighted retrieval, decay.
   *Done when:* facts from earlier sessions are recalled naturally, and low-weight ones fade in tests.
3. **Turn-taking engine**: buffer, open questions, judge, backchannel/silent modes.
   *Done when:* both worked traces in 4.2 pass as scripted tests.
4. **Relationship state + homeostasis**: `HomeostaticParam`, baselines, hurt/make-up flow.
   *Done when:* the 4.4 trace holds and rules 1-6 pass the guard tests.
5. **Life sim + availability**: schedule, busy blocks, closeness-based override.
6. **Proactive outreach**: scheduler with caps.
7. **Onboarding test**: questionnaire, user-memory registration, reveal pacing.
8. **Extension stubs** and cleanup: interfaces in place, docs for adding a module.

## 6. Testing

- Scripted simulated-user conversations for turn-taking and homeostasis (the traces above are the seed cases).
- Guard tests for section 2: no threats, no contempt, cap on notifications, no punishment after absence, only-user-ends-relationship, crisis carve-out.
- Log every judge decision and relationship-state change so behavior is debuggable.

## 7. Open decisions to ask Ethan about (do not resolve silently)

1. Fixed vs variable Spica (currently hybrid, `test_calibrates: user`).
2. Whether interests need to match at all.
3. How far to push irreversibility and weight in interactions, against the risks of abandonment, disappointment, lost progress and emotional damage.
4. Where the jab-vs-contempt line sits in practice.
5. Whether `backchannel_style` is a global setting or varies per persona/user.
