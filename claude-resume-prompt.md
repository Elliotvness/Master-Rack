# Claude — Resume Rack Master Studio

You are resuming work on **Rack Master Studio**, a client-facing pallet-rack configuration and
quote-intake web app. This prompt tells you where the project stands, what to review first, and
exactly what to do next. Work in `C:\Rack Master\rack-master-studio`.

---

## Step 1 — Review the full context (do this first, in order)

**The document hierarchy, so you never confuse the three:** the **blueprint** is the objective
(what we are building and why — the governing document); the **scoreboard** is the measured truth
(how far along, re-measured, not re-read); `tasks/todo.md` is the plan (how to get there, task by
task). A figure in the scoreboard that contradicts the blueprint is a defect in the scoreboard —
the blueprint wins.

1. **`rack-master-studio-blueprint.html`** — the blueprint, the governing document and the
   objective. Open it in a browser (or read the section sources in `src/parts/`). Read at minimum:
   - **§15.2** — the eight MVP-1 "done when" steps. This is the project's definition of done.
   - **§15.3** — the full backlog the phases are sliced from.
   - **§16.2 / §16.3** — acceptance criteria `AC-01`…`AC-20` and the demo scenario that exercises
     every claim.
   - **§5.4** — the performance budgets (the numbers Phase 4's P-05 must agree before a screen).
   - **§18** — the closed decision set (21 decisions, all settled; `open-decisions.md` is the
     companion).
2. **`tasks/progress.md`** — the measured scoreboard. Read it in full. It is the source of truth
   for where the project stands and what to do next. It was adversarially reviewed (Gemini) and
   reconciled; the figures and method text are current as of 2026-09-01.
3. **`HANDOFF.md`** — the handoff note and standing rule.
4. **`tasks/todo.md`** — the plan; source of truth for task detail (sizes, acceptance criteria,
   phases, dependency order).
5. **`tasks/plan.md`**, **`tasks/review-todo.md`**, **`tasks/review-findings.md`** — as needed for
   the task you pick up.
6. **Git state** — run `git status`, `git log --oneline -15`, `git branch -vv` and confirm the
   current branch and tip before touching anything.

## Step 2 — Where the project stands (scoreboard, 2026-09-01)

Every figure below is measured against the blueprint. The scoreboard's own rule: **0% is the
answer**; the other percentages are how much of the written plan has been executed.

| Measure | Value | Blueprint anchor |
|---|---|---|
| **§15.2 MVP-1 "done when"** | **0 of 8 steps — 0%** | Blueprint §15.2 — the definition of done. This is the answer to "how done is it". |
| Plan-task completion, effort-weighted | 19 of 143 pts — 13.3% (an upper bound, not the answer) | `tasks/todo.md` phases, sliced from blueprint §15.3 |
| Plan-task completion, task count | 7 of 43 — 16% | Same, unweighted |
| Pre-merge review `R-01…R-11` | 8 of 11 — 73% (R-11's documentation remainder fixed in session 3) | Blueprint §16.1 review gates |
| Route surface vs the blueprint | **19 of 21** MVP-1 routes declared | Blueprint §8.2 — 23 rows, 2 marked phase 2. A registry figure; nothing mounts it |

Branch `fix/catalog-release-integrity`, tip **`efbafbd`**, **pushed**, **CI run #10 green**
(https://github.com/Elliotvness/Master-Rack/actions/runs/33529120263) — **T-00 is closed**, and this
is the first time any commit in the repo has been verified at the commit that exists. Do **not**
quote an ahead/unpushed pair from any document: every documentation commit moves it. Re-run
`git rev-list --left-right --count origin/main...HEAD`. (Session 2 published `6f05043`/27/1 and
three commits landed after it — its own figures were stale before they were read.)

**Reconciliation with the older figures.** The Rev C audit's *68%* and `LATEST.md`'s *70%* are
blueprint-conformance measures — requirements met, and effort remaining — over the whole MVP-1
scope. The scoreboard counts tasks in the remediation plan. Different denominators, both honest,
neither comparable. The one figure all four agree on is §15.2 at 0 of 8.

## Step 3 — Standing rule (from the scoreboard)

**Update `tasks/progress.md` whenever a long task or a batch of tasks completes** — without being
asked, before the session ends. Re-measure, do not re-read: run the commands again against the
working tree. Label every figure as verified-today or repository-claim. Re-date the header; if the
denominator changed, say so explicitly. Republish to `claude/progress-scoreboard-<date>.md`.

## Step 4 — What to do next, in order

### Immediate — close the branch out (est. 1 session)

1. ~~**Push the tip and confirm CI green on it.**~~ **Done 2026-09-01 (session 3) — T-00 closed.**
   Every push must run from **Windows**: the Linux bridge shell holds no credentials
   (`could not read Username for 'https://github.com'`), and the Terminal app can only be granted in
   click-only mode. The route that worked is **GitHub Desktop → Push origin**, after adding
   `C:\Rack Master\rack-master-studio` to it — its pre-existing `Master-Rack` entry points at a
   second, near-empty clone at `C:\Rack Master\Master-Rack`.
2. **R-10 — judge the commits as commits.** **34+** commits is a long chain to review retrospectively.
   Includes the fair question of whether two RLS commits and a perf harness belonged on a branch
   named for catalog release integrity.
3. **R-08 — the catalog data reviewed as data**, independently of the test that asserts it.
4. **Merge PR #1. Delete the branch.** It has lived far past the 1–3 day window a short-lived
   branch is supposed to occupy.
5. **Drift — fixed in session 3, ahead of the merge**, because the push was blocked and the fixes
   were not. Carry them into the merge commit; **R-11 closes on the documentation → 9 of 11**:
   - ✅ `tasks/todo.md` T-01…T-04 checkboxes ticked (20 of them).
   - ✅ `tasks/plan.md` Q1, Q7 **and Q5** struck and answered — session 2's list had missed Q5.
   - ✅ `state-of-the-build-2026-09-01.md` no longer names `feat/contracts`.
   - ✅ *(new)* the scoreboard's own tip figures were stale on the day they were written.
   - ✅ *(new)* T-04's `DONE` block sat under the Phase 2 heading and still said the catalog release
     was back to DRAFT; the manifest reads `APPROVED`.
   - ⤳ **Reclassified, not a doc fix:** "T-14 says 23 §8.2 routes, the table carries 20". Both
     figures were right. §8.2 lists 23 rows, two marked phase 2, so **the MVP-1 surface is 21**; the
     registry declares 19 of them, missing `GET /api/client/v1/documents/:id` and
     `POST /api/internal/v1/revisions/:id/notes` while carrying the phase-2 audit route. That is
     unstarted **T-14** work. Do not edit 21 down to 20.

### Then — Checkpoint A, which was skipped

`tasks/todo.md` puts Checkpoint A after T-00…T-12 and requires *"Review with EL before Phase 3"*.
Phase 3 started anyway (P-00 and T-13a done) while T-05…T-12 and T-27 are untouched. Two honest
options: run Phase 2 now and hold the checkpoint, or amend the plan on the record to say the
checkpoint moved. Silently leaving it produces the next audit finding.

Phase 2 in dependency order: **T-05** (contentHash ≠ manifestHash) → **T-06** (record the
acknowledgement) → **T-07/T-08** (orchestration off the client, into `packages/workflow`) →
**T-27** (type-check the test files) → **T-09** (`part`/`part_revision`) → **T-10** (docs +
`check-claims`) → **T-11** (secret scanning) → **T-12** (source-conflict register).

### Then — Phase 3, the server

T-13b → T-13c → T-13d → **T-14** → T-15, with P-01 and P-02 landing *in the same commits* as the
routes they measure.

## Step 5 — Skills to use

- **doubt-driven-development** — the project runs this discipline (AD-7). Subject every non-trivial
  decision to a fresh-context adversarial review before it stands. A control that states its own
  method and has no mechanism behind it is the recurring defect shape (F-01, F-02, F-08, F-11).
- **git-workflow-and-versioning** — one short-lived branch per task, merged within a day or two;
  changelog entry in the commit that makes the change; no tags/CHANGELOG yet is fine until the
  first deploy.
- **ci-cd-and-automation** — every checker has a self-test that runs first; gaps to close: secret
  scanning (T-11), dependency audit, bundle ceiling (P-05), parallel verify jobs.
- **test-driven-development** — completion is binary: a task counts only when its stated acceptance
  criteria are met. Build controls that can go red: T-13b outbound validator, T-13d idempotency
  concurrency test, T-14 deny-by-default against the real router.
- **incremental-implementation** — land changes in small, reviewable steps; the tasks are already
  sized for it.
- **frontend-ui-engineering** — when Phase 4 starts: P-05 budgets first (INP ≤ 200 ms is the one
  that matters), WCAG 2.1 AA built in from T-16, T-17 renderer-consumes-display-list rule.

## Step 6 — Rules of the road

- **The blueprint is the objective; the scoreboard is the measurement.** When they disagree, the
  blueprint wins and the scoreboard is wrong — fix the scoreboard, never the blueprint to fit the
  scoreboard. If you change the blueprint, rebuild it (`pnpm check:docs`) and record the change.
- Never claim verification you did not run. Label every figure verified-today vs repository-claim.
- Completion is binary — no partial credit anywhere.
- Update the scoreboard before the session ends.
- If a step is blocked (e.g., Q3/Q4 open questions, credentials), say so explicitly and move to the
  next unblocked step rather than stalling.