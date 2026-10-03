# Phase 8b restart execution ledger

Plan: `docs/superpowers/plans/2026-10-03-phase-8b-restart.md`, approved 2026-10-03.
Baseline: ae87bd0. Worktree: `.worktrees/phase-8b-restart`, branch `phase-8b-restart`.
The original checkout retains all unfinished work. No Claude files may change.
Detailed task/review artifacts: `.superpowers/sdd/2026-10-03-phase-8b-restart/`.

## Task status

- Task 1: complete — baseline checks passed; independent review approved.
- Task 2: complete — 27c2f72, spec and quality approved by Sartre (gpt-6-sol/high).
- Task 3: complete — b91eafc, spec and quality approved by Tesla (astra/high).
- Task 4: complete — adcf31a + 8693965, fix re-review approved by Kant (luna/high).
- Task 5: complete — 9bba422, product review approved; both test-only scope adjustments approved.
- Task 6: complete — 81c8aac + 40e4917; scoped fix rereview approved.
- Task 7: complete — ec6a489, independent spec/quality review approved.
- Task 8: complete — 772a5d0, independent spec/quality review approved.
- Task 9: complete — 0f02b4e + 58c995f; scoped fix rereview approved.
- Task 10: starting; isolation exit and documentation remain outstanding.

## Setup evidence

- Carried approved documents via 44bbeca and 3b2fee5; ignore entry via 6ca34cd.
- Carried AGENTS.md from the original checkout explicitly, not any implementation files.
- Docker spica-db-1 healthy; created previously absent spica_8b_restart_test and
  spica_8b_restart_eval. Existing databases unchanged.
- pnpm install --frozen-lockfile: exit 0, 241 packages from store, no lockfile updates.
- typecheck: exit 0 before baseline test run.
- Baseline full test run: exit 0, 103 files / 741 tests passed, 142.89s.
- Fake eval comparison on restart eval DB: exit 0, no regressions; real-only scripts skipped by design.
- Baseline lint: exit 0, ESLint and Prettier checks passed.
- Diagnostic sidecar Pascal confirmed no unresolved test issue after the quiet test run completed.
- Installed Bash artifact scripts required normal filesystem permission; a failed sandbox helper
  was stopped. No product-code workaround was introduced.

## Process constraints

Repository stop-on-conflict rule overrides the skill's autonomous-ruling guidance.
Tool model-selection restrictions override the skill's explicit-model instruction.
No nested subagents. Task 1 is driver setup; subsequent product tasks use implementer subagents.
No implementation begins until baseline and Task 1 review pass.

## Task 1 review

Boyle: spec pass, quality approved, no blocking findings. Minor stale status corrected above.
Controller verified ancestry, unchanged source checkout status, document carry and AGENTS hashes.
Operational evidence is in controller tool results: database absence check, explicit process URLs,
serial tests/evals and successful exits. Missing .env is expected: both database URLs were set
in the process, and setup/evals use those before their fallback URLs. Restart test DB has 19
baseline migrations. No default database was targeted by those commands.

## Task 2 evidence and review

- RED: nine expected failures, thirteen existing passes. GREEN: focused 22/22; full 750/750,
  103 files; typecheck and lint passed. Migration 0019 adds only the two planned world fields.
- Reviewer Sartre found no Critical/Important issues and verified snapshot ancestry from 0018.
- Minor deferred: candidate selection transfers full rows/embeddings before JSON validation;
  future projection optimization may reduce transfer, without changing required prelimit filtering.
- User requested weaker subagent models as appropriate. Use sol for ordinary multi-file tasks,
  luna for mechanical fixes, astra for concurrency-heavy review and final branch review.

## Task 3 evidence and review

- Runner RED: four expected failures / eight existing passes. Focused GREEN 17/17; full 759/759,
  104 files; typecheck/lint passed. Commit b91eafc.
- Thought initial test run was an import error, not behavioral RED. A later reversible boundary
  mutation failed the named exact-0.92 assertion; restored code passed. This is a process limitation,
  not retroactively claimed test-first evidence.
- Tesla approved atomic write/trace rollback, duplicate guard and legacy runner contract.
- Minor deferred: malformed-batch test checks persisted rollback but not zero insert calls before
  validation. Current implementation validates first; final review should triage stronger coverage.
- Vitest emitted an informational isolation performance hint, not a failing warning.
- Cross-run dedupe requires the shared lock in Tasks 6–8; Task 3 alone does not acquire it.

## Task 4 evidence and review

- Initial behavioral RED 3 failures/43 passes; GREEN focused52/full768/typecheck/lint.
- Rawls (sol/high) found Important missing locked goal eligibility recheck. Fix8693965 rejects stale
  goal-bound proposals before entity/event/intention writes, logs stale_goal, preserves daily gate.
- Fix RED reproduced stale writes; full suite then caught goal-title-dependent fake text varying
  across fresh seed UUIDs. Added regression and restored stable fake event text.
- Final focused54/full770/typecheck/lint passed. Kant scoped re-review: all findings addressed,
  no new Critical/Important findings. Scratch report untracked but retained locally.
- Minor deferred: injected first event disables goals for later model events when max events >1.
  Final review must triage. v3 event-prompt reference update remains Task10.

## Task 5 pending scope clarification

- Implementer Schrodinger (sol/high), base c318b06. Product implementation and owned tests are
  uncommitted. Focused+adjacent69/69, typecheck/lint pass; full785/786, 105 files.
- Failure: `tests/mind/process/core/world-tick.test.ts`, “the kind is stored: planned stays planned,
  spontaneous is a surprise” selects all world rows and expects planned/surprise only. Approved
  fallthrough adds a resolution row during the second tick; the test is nondeterministic because
  the original event ID is random. Controller verified the assertion.
- Proposed test-only scope expansion: include this test file in Task5, restrict its kind assertion
  to root generated events (`plan_ref IS NULL`), retain resolution coverage in resolution.test.ts,
  then rerun full checks and independent review. Await Ethan under the stop-on-disagreement rule.
- No Task5 commit or independent review yet. Tasks6–10 have not begun. Original checkout untouched.

Ethan approved the proposed test-only expansion. The plan now includes world-tick.test.ts for
filtering the generated-kind assertion to root events. Resume the same implementer, rerun checks,
then independent review; no product behavior change authorized or needed.

## Task 5 evidence and review

- Commit 9bba422: focused/adjacent 69 tests, full 786 tests in 105 files, typecheck/lint passed.
- Goodall reviewed c318b06..9bba422: product spec compliance verified, quality approved with minors.
  The only Important gate was the additional shared legacy fixture adjustment. Ethan explicitly
  approved it after review: set fallthrough_probability to zero in legacy world-tick tests only.
  Dedicated resolution tests retain seeded/forced coverage and production probability stays 0.15.
- Minor deferred: add a mild landing test that clears both matching preoccupation fields.
- Minor deferred: add positive-budget exhaustion coverage across multiple resolutions and appraisals.
- Minor deferred: correct appraise.ts's obsolete "Never throws" comment; context failures propagate.
- All deferred findings must be triaged by the final branch review. No blocking product findings.
- Ethan reiterated Sonnet-like, weaker subagent routing: sol for implementation and reviews,
  luna for mechanical work. This user preference supersedes the strongest-model final-review default;
  request approval before escalating beyond sol.

## Task 6 evidence, review and scope gate

- Pauli (sol/high) committed 81c8aac: anticipation, prompt/config/fake and eight focused tests.
  Focused8/typecheck/lint passed; initial full793 passed before last fake change, final full793/794
  failed the existing side-channel comparison. Do not claim a green full suite at this commit.
- The failing comparison regenerates random world IDs, while fallthrough rolls use event IDs.
  Controller and reviewer verified world-tick.ts202 and mind-split.test.ts236. Task10 explicitly
  owns fixed-ID/seed paired isolation scenarios; that exit remains required, not waived.
- Kierkegaard (sol/high) reviewed d2ee850..81c8aac: Important candidate starvation. Task6 must
  ignore malformed/missing event links, but Task2's anticipationCandidate returns a single row
  before checking the link. A broken earliest link therefore hides later valid intentions.
- Controller verified the mismatch. Proposed narrow expansion: include the core memory repo and
  repository tests in Task6; filter invalid/missing linked events before choosing the first eligible
  intention, retaining the existing signature and deterministic ordering. Await Ethan's approval
  under the repository stop-on-conflict rule. Pauli is held; Tasks7–10 have not begun.
- Minor deferred: anticipate fake's prefix/suffix can exceed a very small configured max_chars.
  Final branch review must triage this with earlier deferred findings.

Ethan approved the proposed narrow Task 6 expansion. The Task 2 repository contract keeps its
singleton signature, but eligibility now must skip missing/malformed linked world events before
selection. Pauli resumes fix round 1 with repository and test ownership. The Task 10 seeded
side-channel comparison remains required; the current full-suite failure is still open.

Task 6 fix round 1: 40e4917 added linked-world validation before singleton candidate selection.
Behavioral RED exposed the broken earliest link; focused repository + anticipation tests passed
31/31, with typecheck and lint green. Hume (sol/high) scoped rereview found the Important finding
addressed, no new blocking breakage. Full suite remains unverified at this head; the prior
793/794 side-channel failure is still open for Task10. Minor fake bound remains deferred.

## Task 7 evidence and review

- Galileo (sol/high) committed ec6a489: focused rumination tests 13/13, typecheck/lint passed.
- Full suite 807/808: only the already diagnosed paired side-channel fixture failed, with one
  telescope event happened and the other fell through due to random event IDs. The Task10 fixed
  ID/seed exit is still required; no green full-suite claim is made.
- Nietzsche (sol/high) reviewed the diff: spec compliant, quality approved, no Task7 blocking
  findings. The report carries commands/output for focused/full/typecheck/lint; no independent
  rerun was needed. Atomic thought/marker/reinforcement/mood/trace and race checks verified.

## Task 8 evidence and review

- Einstein (sol/high) committed 772a5d0: focused14, full822 across108 files, typecheck/lint passed.
- Faraday (sol/high) approved spec and quality: downtime gate, deterministic seed/chain, daily cap,
  midnight gap, overlap, applied trace and hypothetical exclusion verified from code/tests.
- Minor deferred process evidence: initial RED was a missing-module import failure with zero tests
  collected, so it does not establish a failing behavioral assertion. Final review can note this
  limitation, without mislabeling it as test-first behavior proof.
- The side-channel comparison happened to pass in this full run; Task10 still must make the
  paired fixed-ID/seed canary deterministic and pass the final exit tests.

## Task 9 pending scope decision

- Kepler (sol/high) implemented coordinator, worker and eval integration in Task9-owned files;
  no product commit yet. Focused 17/17, typecheck and lint passed per report.
- Full suite: 829/831. The known Task10 paired side-channel comparison failed again. The other
  failure is deterministic: `tests/mind/platform/job-names.test.ts` enumerates all queue string
  exports, but its expected list lacks the required new `core_mind_tick` name.
- This test is outside the approved Task9 file list. The narrow proposed expansion is to add it
  to Task9 and add `core_mind_tick` to the expected list. User approval requested under the
  project's stop-on-plan/code-disagreement rule. Kepler stopped without editing it or committing.
- Task10 remains pending; full suite is not green at this state. The original checkout is untouched.

Ethan approved adding `tests/mind/platform/job-names.test.ts` to Task9 ownership and adding the
required queue name to its expected list. The plan is amended; Kepler may finish verification,
commit and report for independent review. The Task10 side-channel fixture remains outstanding.

Task9 fix review: Kepler committed 0f02b4e with the coordinator, queue and eval integration plus
the approved job-name expectation. Focused18/typecheck/lint passed. Full829/831 failed only the
Task10 mind-split file: generated event count included resolution rows, and the paired run used
random-ID fallthrough. Kuhn (sol/high) approved product behavior but found one Important missing
fresh-queue create assertion. Kepler added it in 58c995f; a deliberately wrong create policy
failed the test, restored worker/job-name tests passed12, with typecheck/lint green. Dalton
(luna/high) scoped rereview found that finding addressed and no new blocking breakage. Task10
still must make its exit deterministic and achieve a final green full suite.
