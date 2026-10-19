---
name: spica-intake
description: Use at the start of any Spica task that changes behaviour (a slice, feature, fix or prompt change), before reading code broadly or designing. Turns Ethan's ask into a checked intent, routes to the right spec section and code, and separates verified facts from assumptions so nothing is built on a guess.
---

# Spica intake

Depth scales with the task: a one-file fix takes three lines; a slice takes a design doc.

1. **The ask in one line**, in Ethan's words where possible. If it has two readings that lead to
   different code, it goes to step 5.
2. **Route.** Find the area in the `CLAUDE.md` router. Read only the spec section it names
   (`grep -n '^##' spica-design-spec-v3.md`, then that range), the folder's `CLAUDE.md`, and the
   code it points to. Check memory for settled lines on the area (`phase-*-settled`, `guard-line`,
   `tuning-process`).
3. **Status of every rule you rely on:** DECIDED (build it), LEANING (default behind a config
   flag), PROPOSED (build in its phase and flag it), OPEN (don't decide; ask). If the work belongs
   to a phase other than the current one, stop and say so.
4. **Facts vs assumptions.** List what the work depends on, each marked:
   - **verified**: code (`file:line`), spec (§), memory, or a test you ran;
   - **assumed**: anything else.

   Verify cheaply first (grep, read, a targeted test). A surviving assumption is either low-stakes
   (state it in one line, take the simplest option that respects the scope rules, add a
   `DECISIONS.md` row) or changes something Ethan would notice (ask).
5. **Ask once, batched.** AskUserQuestion with only the questions that change what gets built,
   recommended option first with its reason. Never ask what the code, spec or memory answers.
   Tuning items: settle each item's line with Ethan before any design.
6. **Hand off by size.**
   - **Fix or small change:** intent and assumptions in at most three lines, then build, test
     first for logic (superpowers:test-driven-development). No brainstorming, no design doc.
   - **Slice or new module:** a design doc at `docs/YYYY-MM-DD-<slice>-design.md` (template
     below), settled with Ethan, then superpowers:writing-plans into `docs/superpowers/plans/`.
     Use superpowers:brainstorming only for design questions this intake left open.

## Design doc template

```markdown
# <Slice>: <what it builds or tunes>

Design doc, <date>. Status: draft | settled with Ethan.

## Intent

Ethan's ask, in his words where possible.

## Spec and settled lines

§ references and memory; each rule marked DECIDED / LEANING / PROPOSED / OPEN.

## Assumptions

Each one verified (with its source) or listed for Ethan.

## Design

Per item: behaviour, where it lives (which mind, which module), config keys, prompt versions,
schema changes.

## Scope and leak check

Which mind each change lives in; what the leak canary and side-channel test cover.

## Exit test and review run

Deterministic exit test (which calls are real, agreed with Ethan); any paid review run, its cost
and where its outputs land.

## Out of scope

What goes to the §25 backlog, with a target.
```
