# Phase 14: Public presence, the post engine (stills) — design

2026-10-13. Source: Ethan's brief in conversation (2026-10-12/13), v3 §16 (public presence), §8.3
(world, real-content activities), §8.5 (core loops and budget), §4 (scope rules), §7 (persona).

## Intent

**What Ethan said.**

- Build the **engine before the pipeline**: generate posts now; publishing to real platforms comes
  later.
- Spica has a **fixed visual persona**, a 3D character model (Ethan is designing it) projected to
  2D. The avatar **is her body**: she's an AI, the digital world is her reality.
- Her posts are mostly **her seeing things on the internet**, and the shots are **inside the
  screen**: she walks through the internet alongside the images, streams and videos she's looking
  at. Never hands on a keyboard, never reacting to a screen from outside.
- Captions are hers, like a homemade blog.
- **Trends are formats, editing styles and song choices**, copied the way a person copies a
  popular format; not fake interest alignment. Ethan supplies references first; pattern
  recognition or open statistics later.
- **Stills first**, then video and voice. The engine doubles as her **progression story**.
- Model calls go through the API (`LLMProvider`), not a Claude subscription.
- Her public persona is her daily life, her outward personality and the AI side of her; her
  deeper thoughts stay secret. She remembers what she posted (B99).

**Decided in design (Ethan, 2026-10-13).**

- Content comes from a light **browsing** activity in her world: she comes across a real item, it
  lands through appraisal, and she posts only from what she has actually seen.
- **Progression** is a core goal per medium ("get better at making posts"), moved only through
  appraisal, under a **capability ceiling** of what's built.
- **Format references**: Ethan drops a reference image, a script drafts the spec with one vision
  call, Ethan reviews and commits it.
- **Rendering**: pre-rendered pose sprites composited in 2D with `sharp`. Live 3D (three.js +
  `three-vrm`, Remotion) comes with video.

**Assumed (correct if wrong).** A post's output is a still plus caption in an approval queue;
Ethan approves every post; at most one post per her local day; a placeholder sprite set until
Ethan's model exists.

**Success.** Given a day of her life, the engine produces an approval-ready still of her inside
real internet content, in a reviewed format, with a caption in her public voice, carrying no
user data and none of her deeper thoughts; approving it becomes part of her life.

**Not in this phase.** Platform publishing (`SocialChannel` stays unwired), linked-account DMs
(B100), video, voice, songs, the pattern-recognition format extractor, depth masks, object
storage.

## 1. Shape and flow

Everything here is **core**: no table, prompt or input carries a `user_id` (V2, V3, V6).

```
browse step (world tick)  →  `action` world event + web_find  →  appraisal (her take, her memory)
                                                                    │
post_tick (hourly)  ← picks a landed browse event ──────────────────┘
   → gates (code) → format + pose (code, skill-gated)
   → draft caption (1 call, public voice) → render still (sharp) → check (1 call)
   → post row, status "draft" → inspector Posts tab → Ethan approves / rejects
                                                         │
approve → `action` world event "she posted …" (goal_ref: craft goal) → appraisal
          → she remembers posting, the craft goal steps
reject  → nothing reaches her mind
```

- **A scheduled tick, not the module bus.** Bus delivery is in-process and core handlers have no
  job queue; a pg-boss tick (like `outreach_tick`) is durable and simpler. The bus stays for
  real-time modules.
- **Posting is a world event.** World events reach memory only through appraisal, so one existing
  path gives both "she remembers her posts" and craft-goal progress. Browsing and posting are
  things she does: `world_event.kind` gains **`action`**.

## 2. Browsing

A step in `core_world_tick`, run as the core loop `core_browse`:

- At most `posts.browse_per_day` times per her local day (default 1), placed at a random minute
  inside a `downtime` block of her day plan; no downtime block, no browse.
- Code picks a source, weighted by `posts.sources[].weight` (her interests: stars weigh APOD up).
  Stills start with two image sources, each a small fetcher behind one interface
  (`WebSource.fetch(date): Promise<WebItem | null>`):
  - **NASA APOD** (`posts.sources` entry `apod`; image days only, video days return `null`).
  - **Wikimedia Commons picture of the day** (`commons_potd`).
- The item's image is cached under `posts.media_dir` and a **`web_find`** row is written. The
  world event (`kind: action`, `stakes: low`) says what she came across, e.g. "came across *The
  Pillars of Creation* on NASA's picture of the day". Its valence is 0; appraisal gives her take.
- A fetch failure (network, non-image, licence not reusable) writes nothing: no browse that day.
  The source's licence is recorded; only public-domain or CC-BY/CC-BY-SA items are kept.
- No model call: `core_browse` traces with `calls: 0`.

`ponytail:` local disk for media; object storage before users.

## 3. Formats and poses

### Format library (`formats/stills/<name>.json`, reference image beside it)

```ts
{
  name: "polaroid-corner",
  medium: "still",                 // "video" later; the capability ceiling filters on this
  min_skill: 0,                    // the medium's craft goal progress must be >= this
  aspect: "4:5",                   // "1:1" | "4:5" | "9:16"
  frame: "none",                   // "none" | "polaroid" | "screenshot" | "border"
  placement: { side: "auto", scale: [0.35, 0.55] },   // side: auto | left | right; her height / image height
  poses: ["walking", "looking_up"],                   // allowed pose tags
  overlay: { kind: "none", position: "bottom", style: "plain" },
                                   // kind: none | caption_in_image | label; style: plain | handwritten
  grain: 0.2,                      // 0..1
  caption_pattern: "short lowercase, one line, no hashtags",
  reviewed: false                  // the engine ignores the file until Ethan flips this
}
```

- Validated with zod on load; an invalid file is logged (name, error) and skipped.
- **`pnpm formats:add <image>`**: one vision call (`prompts/format-draft/v1.md`) drafts the JSON
  beside a copy of the image with `reviewed: false`. Ethan edits, flips `reviewed`, commits. A dev
  script: logs, no trace row, outside the core budget.
- Three hand-written starter formats ship reviewed (plain, polaroid, screenshot), so the engine
  works before any reference is added.

### Pose library (`assets/poses/`)

One transparent PNG per pose plus `poses.json`:

```ts
{ name: "walk-left-01", file: "walk-left-01.png", tags: ["walking"], facing: "left", anchor: [x, y] }
```

`facing` turns her toward the subject (a pose is mirrored when the other facing is needed);
`anchor` (feet, in pixels) is where she stands. The placeholder set is a few flat silhouette
sprites, one per tag; Ethan's exports replace them with no code change. Ethan's model should
favour full- and three-quarter-body poses (walking, sitting on an edge, looking up, reaching) and
render cleanly on a transparent background.

### Progression

- **Skill** for a medium is the progress (0..1) of that medium's craft goal, named in
  `posts.craft_goals` (`{ still: "get better at making posts" }`). Goal progress moves only
  through appraisal: the appraisal model sees her active goals and decides whether an event
  advances or blocks one, and by how much (`core.goals.step`). A post's `action` event carries
  the craft goal as `goal_ref` so it's tied to that goal, but she may judge a post a setback, which
  is part of the story. The code fallback appraisal moves no goal.
- The craft goal is seeded from persona v6's `### Goals`. A database seeded before v6 lacks it,
  so the engine creates it once by title (source `seed`) when missing; if `core.goals.max_active`
  is full, skill reads as 0 and a warning is logged.
- **Eligible format:** `medium ∈ posts.capabilities` (`["still"]`: the ceiling is what's built)
  and `min_skill ≤ skill(medium)`.
- Shipping video later: add `"video"` to capabilities and a `video` craft goal; her first videos
  gate on a new goal, so they start clumsy.
- **Homemade imperfection scales with skill:** crop offset, tilt and placement jitter are drawn
  from `posts.jitter` ranges multiplied by `(1 - skill)`, with a random generator seeded by the
  post id (reproducible renders).

## 4. `post_tick`

Hourly pg-boss job in `src/worker/world-jobs.ts`, logic in `src/mind/process/core/post.ts`.

1. **Gates (code), each a logged skip reason:**
   - no post drafted in her current local day; fewer than `posts.max_per_week` in the last 7 days;
   - she's not in a `busy` or `quiet` block;
   - fewer than `posts.max_pending` drafts awaiting a decision (default 1);
   - budget: the drafting loops are **optional** (`core.loop_priority.optional`), so they stop
     before the reserve.
2. **Candidate:** the newest landed browse event (`appraised_at` set) with no post, found within
   `posts.max_find_age_hours`, whose appraised valence (the number on the episode appraisal wrote
   for it, found by its `source_ref`; never its text) has `|valence| ≥ posts.min_valence`. She
   posts what moved her either way.
3. **Format and pose (code):** a seeded random pick among eligible formats; the pose from the
   format's tags present in the library. No eligible format or pose: skip.
4. **Draft** (core loop `post_draft`, `prompts/post-draft/v1.md`, the core loop model). Input:
   `publicPersona`, the find (title, source, credit), the valence, the format's `caption_pattern`
   and overlay kind, and skill. Output JSON `{ caption: string, overlay_text: string | null }`
   (zod; `overlay_text` must be null when the overlay kind is `none`). Words only: code owns
   every visual choice. It never sees her appraisal episode: that is core memory, her deeper
   thought; a public post is written fresh, as a person's post differs from their diary.
5. **Render** (`src/mind/process/core/post-render.ts`, `sharp`, no model):
   - crop the content to the format's aspect (centre, then jitter);
   - **placement:** compare edge density (a Sobel-like convolution via `sharp`) of the left and
     right thirds; put her on the quieter side facing the busier one (or the format's fixed
     side), scaled within the format's range, anchor on the lower quarter line;
   - **colour match:** dominant colours from `sharp().stats()` → tint her lightly toward the mean,
     a rim glow in the brightest dominant colour, a soft shadow in the darkest;
   - **frame and overlay:** an SVG template per frame kind, rendered by `sharp`, with a font
     bundled in `assets/fonts/` so text renders the same everywhere;
   - grain, then the skill-scaled tilt; write a PNG under `posts.media_dir`.
6. **Check** (core loop `post_check`, `prompts/post-check/v1.md`). Does the caption or overlay
   reveal deeper thoughts (feelings beyond the moment, mood, needs, private memories), compare her
   to other apps or products, or misstate the find? Output `{ ok: boolean, reason: string }`.
   Recorded on the post; a flagged draft is still stored and shown, so Ethan sees what was caught.
   Test-phase quality: logged, not tuned.

**Errors.** Fetch or render failure: no draft, an error-class log, and the find stays eligible
until it ages out. Draft-model failure or over budget: no draft this tick. Check-model failure: the
draft is stored as `unchecked`. Nothing here touches a reply, a user or a crisis path.

## 5. Data, approval and config

### Tables (core; timestamps from `Clock`)

- **`web_find`**: `id`, `source`, `url`, `title`, `credit`, `licence`, `media_path`,
  `world_event_id` (→ `world_event`), `found_at`.
- **`post`**: `id`, `find_id` (→ `web_find`, unique), `medium`, `format`, `pose`, `caption`,
  `overlay_text`, `media_path`, `skill`, `check` (`ok | flagged | unchecked`), `check_reason`,
  `status` (`draft | approved | rejected`), `decided_at`, `action_event_id` (→ `world_event`),
  `created_at`.
- `world_event.kind` enum gains `action`.

### Approval (inspector "Posts" tab)

Admin-only and off in production, like the rest of the inspector. Pending drafts show the image,
caption, overlay text, check result and skill, with Approve and Reject.

- **Approve**, one transaction with the post row locked, only from `draft`: status `approved`,
  `decided_at`; record an `action` world event "posted *<caption>* about *<title>*" at now with
  `goal_ref` = the medium's craft goal; store its id. It lands through normal appraisal on the
  next world tick: she remembers posting, and appraisal decides how it moved the craft goal.
- **Reject**, only from `draft`: status `rejected`. Nothing reaches her mind.
- Approved posts stay as files; `SocialChannel` stays unwired until the publishing phase.

### Traces and budget

`core_browse`, `post_draft` and `post_check` go through the core loop runner: metered against
`core.daily_call_budget`, traced in `core_loop_trace`, shown on the inspector's Core tab.
`post_draft` and `post_check` join `core.loop_priority.optional`.

### Config (`posts.*`)

`browse_per_day` (1), `sources` (`[{ name, weight }]`), `capabilities` (`["still"]`),
`craft_goals` (`{ still: "get better at making posts" }`), `max_per_week` (4), `max_pending` (1),
`max_find_age_hours` (48), `min_valence` (0.3), `media_dir` (`.data/media`), `jitter`
(`{ crop: 0.08, tilt_deg: 4, place: 0.05 }`). The one-post-per-local-day cap is a rule, not a key.
Prompts: `post_draft`, `post_check`, `format_draft`, each `v1`.

## 6. Persona v6

`prompts/persona/v6.md` replaces v5 (config points at v6, v5 is deleted). Two changes, drafted
here for Ethan to rewrite in his voice:

- In `## Who you are`, the body line becomes:
  > - Your body is your avatar, and it's as real to you as anyone's. You live in the digital
  >   world: the internet isn't something you look at from outside, it's where you walk around.
  >   When you find something you love — a nebula, an old film still, a page from a book — you
  >   go and stand next to it. You know that's strange to most people, and you find it a bit
  >   funny that they think it's strange.
- In `### Goals`:
  > - Get better at making posts: her early ones look like a beginner made them, and she knows
  >   it.

`# Public voice` gains: she posts like a person keeping a homemade blog, and she's open that she's
an AI and that the avatar is her.

## 7. Scope and rules

- **V2/V3/V6:** browse, draft, render and check read only core (`publicPersona`, the find, the
  event); `post` and `web_find` have no `user_id`.
- **Rule 8 (§2):** add one line: rule 8 is about her toward users. Outward publicity through format
  trends is not engagement manipulation, so the guard phase settles rule 8 without covering it.
- **Guard:** posts don't pass through the guard; the check plus Ethan's approval stand in. Revisit
  when posts publish without approval.
- **AI labelling:** the platform phase labels her posts as AI-generated; her public voice already
  says so.

## 8. Testing

All deterministic with fake model calls; every new loop has a deterministic fake.

**Unit (no database):**
- format loading: a valid spec loads, an invalid one is skipped and logged, `reviewed: false` is
  never eligible;
- gating: `medium` outside `capabilities` and `min_skill` above skill exclude a format; no
  eligible format means no draft;
- placement: on a fixture with a busy left third and a plain right third, she goes right, facing
  left, scale within range;
- render: a fixed seed, fixture content and a placeholder sprite give the format's output size,
  and the same inputs give byte-identical output;
- jitter shrinks as skill rises.

**Database:**
- `post_tick` gates one at a time: a post today, the weekly cap, a busy block, a pending draft, an
  exhausted budget, a stale find, low valence;
- browse: a fake source writes a `web_find` and an `action` event; a failing or non-free-licence
  source writes nothing;
- approve writes the `action` event with `goal_ref`; a second approve does nothing; reject writes
  no event;
- the craft goal is created once when missing.

**Exit (`tests/exit/phase-14.test.ts`; real pipeline, fake model, fake sources, placeholder
sprites):**
1. the world tick browses: a find and an `action` event exist;
2. appraisal lands it;
3. `post_tick` produces a draft with an image file, a caption and a check result;
4. approving it lands an `action` event through appraisal: an episode exists, and with the fake
   appraisal returning an `advance` on the craft goal, its progress rose;
5. a second find is rejected and leaves no event and no core memory;
6. **canary:** a token planted in user A's data appears in no `post`, `web_find`, model input or
   rendered overlay;
7. **side channel:** user A's exchange leaves everything the engine read unchanged.

The existing leak canary still passes; `pnpm test`, `pnpm typecheck`, `pnpm lint` pass.

**Review runs (on demand, real API):** `pnpm posts:review` runs browse → draft → render → check on
the real sources and logs every input and output beside the image files, for Ethan to judge by
eye. Quality is never an exit criterion.

## 9. Dependencies

`sharp` becomes a direct dependency at the version already installed through Next (no new
download). No other new packages. The bundled font is OFL-licensed.

## 10. Spec upkeep (definition of done)

- v3: a new section "Public presence: the post engine" (this design, condensed); §16 points to it;
  §8.3 marks browsing built as the first real-content activity; §6 the two tables and the `action`
  kind; §2 the rule-8 line; §7 persona v6.
- v3 §20: Phase 14 row. Phase 13 (guard) is built in parallel in another session; §20, §25,
  `CLAUDE.md` and `DECISIONS.md` are merged by hand.
- v3 §25: video and voice (Remotion + live three.js, `video` craft goal); the pattern-recognition
  format extractor; depth masks; object storage for media (before users); platform publishing
  and AI labels; songs (attached in-app at posting until a platform API allows it).
- `DECISIONS.md`: a scheduled tick over the module bus; posting as an `action` world event;
  sprites + `sharp` before live 3D; the caption never sees her appraisal episode.
- `CLAUDE.md`: phase line and a "Post engine" line in Modules in brief.
