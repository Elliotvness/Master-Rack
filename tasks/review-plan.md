# Review Plan — `fix/catalog-release-integrity`, 7 commits, before merge to `main`

**Created 2026-09-01.** Scope: the seven commits `d82c5eb..0b9fd73`, unpushed, currently the whole
delta between `main` and this branch. Method: the five-axis review (correctness, readability,
architecture, security, performance), sized and ordered so each unit is reviewable in one sitting.

Task list: **`tasks/review-todo.md`** — R-01 … R-11, each with acceptance criteria, a verification
command, dependencies and a size. This document holds the strategy, the leads the survey already
turned up, and the questions only EL can close.

This plan does **not** supersede `tasks/plan.md`. That is the route from here to MVP-1; this is the
gate the first instalment of it has to pass before it becomes history on `main`.

---

## Why this review, now

Three facts make it worth doing before the merge rather than after.

1. **Nothing has reviewed this branch.** It was written and self-verified in one session. The commits
   include two RLS migrations and a rewritten approval gate — the two places in this repository where
   a defect is invisible rather than loud.
2. **Two of the seven commits change a security boundary**, and one of them (`73ca8d1`) is already
   flagged in `LATEST.md` §3 as possibly the wrong call. A merge would settle by default a question
   nobody has answered.
3. **It is cheap here.** 2,100 lines of source across 9 files, with no server, no routes and no UI
   built on top of any of it. Every one of these decisions gets more expensive to revisit once Phase 3
   lands.

The approval standard applies: **approve when the change definitely improves code health**, not when
it is perfect. The survey below suggests it does. The review's job is to find the places where it
does not, and to say which of those block the merge.

---

## Baseline

Established before the review starts, so a finding can be separated from a pre-existing condition.

| Check | Command | Claimed on branch |
|---|---|---|
| Tests | `pnpm test` | 961 passed / 961, 42 files |
| DB-backed subset | same, with `DATABASE_URL` set | 74 files' worth, first execution anywhere |
| Typecheck | `pnpm typecheck` | exit 0 |
| Lint | `pnpm lint` | exit 0 |
| Gates | `pnpm verify` | all 7 PASS |
| RLS | `pnpm check:rls` | PASS over 19 tables |
| Tree | `git status` | clean, 7 commits ahead of `main`, **no remote** |

Every figure in that column is the branch's own. **R-09 re-runs them** — a review that accepts the
author's verification story on the author's word has skipped a step. The DB-backed tests need a
Postgres: `pnpm db:up` on Windows, or the embedded-postgres recipe in `LATEST.md` §4 in a Linux
workspace. CI has still never run, because there is still no remote (`T-00`).

---

## What is under review

| Commit | Source under review | Lines | Axis that bites hardest |
|---|---|---|---|
| `75192d0` | `0005_revision_audience_rls.sql`, `tenancy.test.ts`, `check-rls.mjs` | 315 | Security |
| `73ca8d1` | `0006_audit_event_actor_audience.sql` | 53 | Security + a product decision |
| `52f708a` | `spot-check.ts`, `release.ts`, `draw-spot-check.mjs`, manifest | 589 | Correctness |
| `eeaafef` | `release.ts` (quarantine), manifests | 165 | Correctness |
| `7559889` | `load-manifest.ts`, `release.ts`, `frames.json` | 1,294 | Architecture + data |
| `0b9fd73`, `d82c5eb` | `LATEST.md`, `tasks/*` | 948 | Documentation accuracy |

Excluding `frames.json` (850 lines of transcribed data, reviewed as data in R-08 rather than read as
code) and the docs, the reviewable surface is roughly **1,250 lines across 9 files** — inside the
"acceptable if it's a single logical change" band, and it is not one logical change, which is itself
a finding R-10 has to weigh.

---

## Strategy: where each axis actually bites here

**Security first, and it is not close.** Two migrations replace RLS policies on the two tables that
carry the client/internal boundary. A wrong predicate here fails *silently and permissively* — the
query returns rows, no test necessarily notices, and the failure surfaces as a client reading our
margin. Everything else on this branch fails loudly. So R-01 through R-03 come first and the
checkpoint after them is a real stop.

**Correctness concentrates in the gate, not the kernel.** `approvalRefusals` is now a nine-clause
refusal list assembled from three modules. The interesting question is not whether each clause is
right — they are individually well-tested — but whether the *set* closes the loop: tool draws the
sample → approver reads those cells → gate verifies the approver read *those* cells. R-05 is the
task that asks it, and it is the highest-leverage single question on the branch.

**Architecture: watch for the third copy.** `tools/draw-spot-check.mjs` reimplements
`requiredSampleSize`, `mulberry32` and the partial Fisher-Yates from `spot-check.ts` in plain JS
because a `.mjs` tool cannot import the TS package. That is a real constraint, not laziness, and one
test does bind them — but the skill's remedy ("reuse the canonical helper instead of a bespoke
near-duplicate") is worth pricing before a second tool needs the same code. R-06.

**Readability: the file-size trajectory.** `release.ts` went 137 → 353 lines and now holds the
status enum, three record types, the manifest interface, two error classes and five functions. Not
over the ~1000-line inspection line, but the change more than doubled it in one commit, and the
skill's rule is to ask about extraction *before* piling more on. R-04 asks it now, while the answer
is a `git mv`.

**Performance is nearly a no-op** and is folded into R-01 and R-08 rather than given its own task:
one new index (`audit_event_actor_org_idx`), one added `information_schema.columns` query in a
build-time checker, and a parser that runs over two files. The only thing worth a sentence is
whether the new `revision` policy's predicate can still use the `(organization_id, audience)` index.

---

## Leads the survey turned up

These are **leads, not findings** — each is written into the task that must confirm or dismiss it.
Recorded here so the review is not re-derived from scratch, and so a lead that gets dismissed is
dismissed on the record rather than forgotten.

| # | Lead | Task | Provisional severity |
|---|---|---|---|
| L-1 | `spotCheckRefusals` never re-derives the draw. It checks the sample's *size*, uniqueness, page ref and outcome — never that `sampledCells` are the cells `drawSpotCheckSample(cellIds, seed)` actually returns. An approver may record any 20 unique ids with any seed. The pinned-draw test covers today's manifest; the *gate* does not. | R-05 | **Critical if confirmed** — it is D-07's own failure mode, one layer up |
| L-2 | `loadReleaseManifest` never reads `pending_spot_checks`, so the pinned draw the tool writes is unvalidated data as far as the parser is concerned. Same seam as L-1, from the parse side. | R-07 | Required |
| L-3 | `strOrNull` returns `null` for a non-string value (`approved_by: 42` reads as "nobody approved"). Every other field in the module throws with the field named, and the module's own docstring promises exactly that. A silent fallback on the approval field. | R-07 | Required |
| L-4 | `contentSha256` is parsed and never verified against the dataset files it names. A manifest can claim any hash. | R-07 | Consider — may be out of scope for this branch |
| L-5 | `constraints` is an unchecked `as Record<string, number>` cast with a `?? {}` fallback, in a module that validates everything else. | R-07 | Nit / Consider |
| L-6 | `approvalRefusals` takes `approvedBy` in its `Pick<>` and never reads it; the same six-member `Pick<>` is spelled out twice (`approvalRefusals`, `canApprove`). | R-04 | Nit — extract a named type |
| L-7 | Spot-checks and verification paths are demanded per `REQUIRED_DATASETS`, while the "names a dataset this release does not ship" clause reads `manifest.datasets`. A release shipping a third dataset needs no verification of it. Correct for MVP-1; confirm it is deliberate and commented. | R-04 | FYI / Consider |
| L-8 | `check-rls.mjs` gained a real assertion and **no self-test** (`tools/` has no `selftest-rls.mjs`), in a repository where every other checker has one and `pnpm verify` runs the self-test first. `SENSITIVITY_EXEMPTIONS` also has no staleness check — an exemption for a dropped column persists silently. | R-03 | Required |
| L-9 | `draw-spot-check.mjs` rewrites the whole manifest with `JSON.stringify(m, null, 1)`. **Survey checked: the manifests are indent-1, so this matches** — confirm it survives unknown keys and a future manifest written by another hand. It also calls `draw()` twice for the same output. | R-06 | Nit |
| L-10 | `73ca8d1` ships a policy change and an index with **no test in the same commit**; `tenancy.test.ts` arrives in the next one. Confirm the AC-14 audit-log assertions actually cover the 0006 predicate, including the `actor_type = 'client'` half. | R-02 | Required if uncovered |
| L-11 | `tasks/todo.md` T-09 reserves "migration `0006`" for `part`/`part_revision`. `0006` is now `audit_event_actor_audience`. The branch invalidated its own task list. | R-11 | Required — documentation drift |
| L-13 | `spot-check.ts` is a new 145-line module with **no test file of its own** — `packages/kernel-catalog/src/` has `spot-check.ts` and no `spot-check.test.ts`. Its coverage arrives indirectly through `release.test.ts`. Every other module in the package has a paired test. | R-05 | Required |
| L-12 | Seven commits, two of them security-boundary changes, and the branch is named for catalog release integrity. Two commits (`75192d0`, `73ca8d1`) are not about catalog releases at all. Consider whether they belong in their own branch/PR with their own reviewer. | R-10 | Consider |

---

## Decisions this review cannot make

Three items are EL's, and the review must surface them rather than resolve them. Recorded here so
the merge is not treated as agreement with any of them.

1. **The audit-log narrowing (`73ca8d1`).** A client admin now sees only events their own people
   generated. `LATEST.md` §3 states the tension plainly: AC-14 and "an activity feed including our
   work on their job" cannot both hold. The code picked AC-14. If the product intent was the feed,
   this commit is wrong and should be reverted before it reaches `main`. **R-02 blocks on this.**
2. **The 42-cell spot-check.** No release is pinnable until it is done — 20 beam cells and 22 frame
   cells, pinned in `interlake-2026-09/manifest.json → pending_spot_checks`, read off PSG 2025 p.88
   and the frame charts. ~1 hour. The review does not need it done, but R-05's acceptance depends on
   knowing what the gate will do when the record arrives.
3. **`git push`.** No remote credentials in a Linux workspace; from Windows,
   `git push -u origin main && git push -u origin fix/catalog-release-integrity`. Until then CI has
   never run and R-09 is the only verification this branch has.

---

## Phases and checkpoints

### Phase A — The trust boundary (R-01, R-02, R-03)
The two migrations and the checker built to police them. Fails silently; reviewed first.

**Checkpoint A**
- [ ] `pnpm check:rls` PASS re-run independently, with the output recorded
- [ ] Both migrations' predicates traced by hand against `0001_init.sql` and `0002_rls.sql`
- [ ] Every finding categorised; no **Critical:** left open
- [ ] EL has answered decision 1 (the audit-log narrowing)

### Phase B — The approval gate (R-04, R-05, R-06)
Whether the tool → approver → gate loop actually closes.

**Checkpoint B**
- [ ] L-1 confirmed or dismissed on the record
- [ ] `pnpm test --filter kernel-catalog` green, with any new regression test added by the review
- [ ] The `release.ts` extraction question answered yes or no, not deferred

### Phase C — The parse and data boundary (R-07, R-08)
Where hand-edited JSON becomes typed objects the gate trusts.

**Checkpoint C**
- [ ] Every lead L-2 … L-5 has a disposition
- [ ] `frames.json` byte-identity to the 2026-08 tables verified independently of the test that claims it

### Phase D — Verification and change hygiene (R-09, R-10, R-11)
Re-run the author's story; judge the commits as commits.

**Checkpoint D — the merge decision**
- [ ] All 961 tests re-run by the reviewer, DB-backed included, output recorded
- [ ] `pnpm verify` re-run, all 7 gates, output recorded
- [ ] Every finding is **fixed**, **filed as a task in `tasks/todo.md`**, or **explicitly waived by EL**
- [ ] Documentation drift closed (L-11)
- [ ] Merge / split / hold recorded with a reason

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The reviewer is the author's successor and inherits its framing | High — the leads above bias toward confirming | R-01/R-02/R-05 each require tracing the predicate or the loop from the source SQL/blueprint, not from the commit message |
| DB-backed tests cannot be run, so the RLS review rests on reading | High | Stand up Postgres before Phase A starts; if impossible, R-01 and R-02 stay **open** and the branch does not merge |
| Fixing findings inside the review turns it into a rewrite | Medium | Findings become commits on top of the branch, or tasks in `tasks/todo.md`. No amend, no rebase of the seven |
| A **Critical:** in the gate blocks a merge EL needs for the demo | Medium | Phase A and B are the first two days; the demo blocker (D-05, frames) is in `7559889` and reviewed early |
| Review scope creeps into the 32% not yet built | Low | Anything about routes, contracts or the server is a task in `tasks/todo.md`, never a finding here |

## Open questions

- Does the review add regression tests itself, or file them? *Proposed: a test that would have caught
  a confirmed **Critical:** is written as part of the review; everything else is filed.*
- Should `75192d0` and `73ca8d1` be split onto their own branch before push? R-10 answers.
- Is `contentSha256` verification (L-4) this branch's problem or `T-05`'s? R-07 proposes; EL decides.
