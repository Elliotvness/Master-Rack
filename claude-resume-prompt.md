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
   for where the project stands and what to do next. **Read it rather than this file for any
   figure** — this file has published stale ones for six sessions (drift 45) and is the only copy
   of the scoreboard that nothing gates.
3. **`HANDOFF.md`** — the handoff note and standing rule.
4. **`tasks/todo.md`** — the plan; source of truth for task detail (sizes, acceptance criteria,
   phases, dependency order).
5. **`tasks/plan.md`**, **`tasks/review-todo.md`**, **`tasks/review-findings.md`** — as needed for
   the task you pick up.
6. **Git state** — run `git status`, `git log --oneline -15`, `git branch -vv` and confirm the
   current branch and tip before touching anything.

## Step 2 — Where the project stands (scoreboard, 2026-09-05, session 13)

Every figure below is measured against the blueprint. The scoreboard's own rule: **0% is the
answer**; the other percentages are how much of the written plan has been executed. **Re-measure
before you quote any of these** — this section was six sessions stale until 2026-09-04.

| Measure | Value | Blueprint anchor |
|---|---|---|
| **§15.2 MVP-1 "done when"** | **0 of 8 steps — 0%** | Blueprint §15.2 — the definition of done. This is the answer to "how done is it". |
| Plan-task completion, effort-weighted | 66 of 160 pts — 41.3% (an upper bound, not the answer) | `tasks/todo.md` phases, sliced from blueprint §15.3 |
| Plan-task completion, task count | 24 of 49 — 49% | Same, unweighted |
| Pre-merge review `R-01…R-11` | **11 of 11 — 100%** | Blueprint §16.1 review gates — one merged branch's checklist, not the project |
| Route surface vs the blueprint | **22 of 22** MVP-1 routes declared, mounted and checked | Blueprint §8.2 — 24 rows, 2 marked phase 2 |
| **Routes §8.2 needs and does not have** | **8 proposed, 0 amended** — tabulated in `tasks/todo.md` under T-14b, which is the canonical list | **F-46.** §8.2 cannot authenticate anybody, so Phase 3's server work cannot start |

**No sha is quoted here, deliberately.** `main` moves every time a PR lands, and a sha written into
this file went stale inside a day twice (drift 45, drift 49). `git ls-remote --heads origin` answers
it, and `git rev-list --left-right --count origin/main...HEAD` answers the ahead/unpushed pair —
every documentation commit moves that one too. Phases 0, 1 and 2 are complete.

**`origin` carries three branches besides `main`, and ZERO open pull requests.** Measured
2026-09-05, not reported — `git ls-remote --heads origin` and `GET /pulls?state=open`:
`task/gate-the-fifth-copy` @ `ebdbf58` (CI #107 success, **no PR**), `task/s-0-0-studio-gates` @
`e8e0b8a` (CI #106 success, **no PR**), and `docs/session-11-prose-gate` @ `78c29ef`, which is
**already merged into `main` and was never deleted** — so the scoreboard section claiming that
cleanup is done is one branch short (drift 52). **Session 13's branch is local only** and reaches
EL through the mount, because a scheduled run still cannot push. Merging session 12's edition and
session 13's conflicts on exactly one line — this file's and `tasks/progress.md`'s header date. Take
session 13's header and keep both bodies.

**A scheduled run in this environment cannot read the Actions API either.** The container's GitHub
access is not enabled for the repository and there is no tool in the session to enable it; the runs
above were read through the connected Windows device, which can. Anyone quoting a CI result from a
cloud session should say which side read it.

**Verified 2026-09-05 in the container against native PostgreSQL 16.13 — five `pnpm verify` runs,
every one exit 0: on clean `main`, on `main` plus the new checker axis, on the session-13 tree, and
twice more after review:**
`pnpm verify` **exit 0 — 59 files, 1,491 tests, 0 skipped**,
**17 self-test invocations covering 16 checkers**, coverage all files
99.51 / 98.85 / 99.40 / 99.51, 13 migrations, 13 declared claims. Both
occurrences of "skipped" in the log are self-test case names — read, not
assumed (F-29). Four of the five runs read that coverage figure and one
read 99.54 / 98.90 / 99.40 / 99.54 on identical `.ts` sources; v8 is not
bit-stable across worker scheduling, and the figure published is the one
from the run at the tree being cited, never the best of them.

*Do not copy the checker count out of this paragraph into a new document.* It is derived from
`package.json` by `check-claims`, which now gates it **in this file** — the fifth scoreboard copy,
and until 2026-09-05 the only one nothing checked.

**Why §15.2 is still 0 of 8, and it is no longer a formality.** T-14a built the server:
`apps/api/src/app.ts` builds a Fastify instance, `createApp` mounts all 22 §8.2 MVP-1 routes and
authorizes every one of them, and the router refuses to boot if it and the policy registry disagree
in either direction. **All 22 handlers are placeholders that answer 500**, declared as data in
`UNIMPLEMENTED` so "the app boots" can never be read as "the app works". **T-14b is the first point
that can move the gauge.**

**Reconciliation with the older figures.** The Rev C audit's *68%* and `LATEST.md`'s *70%* are
blueprint-conformance measures — requirements met, and effort remaining — over the whole MVP-1
scope. The scoreboard counts tasks in the remediation plan. Different denominators, both honest,
neither comparable. The one figure all of them agree on is §15.2 at 0 of 8.

## Step 3 — Standing rule (from the scoreboard)

**Update `tasks/progress.md` whenever a long task or a batch of tasks completes** — without being
asked, before the session ends. Re-measure, do not re-read: run the commands again against the
working tree. Label every figure as verified-today or repository-claim. Re-date the header; if the
denominator changed, say so explicitly. Republish to `claude/progress-scoreboard-<date>.md`.

**There are five copies of the scoreboard, and this file is the fifth.** `tasks/progress.md` and
`tasks/progress.html` are gated by `check:scoreboard` and `check:claims`; the published artifact and
the Claude Project doc are hand-verified at update time; **this file is gated by nothing and is read
first**. Update it in the same commit as the other four, or it will misdirect the next cold session
the way it misdirected sessions 9 and 10.

## Step 4 — What to do next, in order

### 0. The landing path — half open, and know which half

A scheduled session can now **commit** here: `C:\Rack Master\rack-master-studio` is connected, and
the session-10 edition was committed on the mount rather than delivered as a patch. It still cannot
**push**: `git push` returns **403** from the git proxy (`Master-Rack is not in this session's
authorized repository set`), measured with a real push rather than a dry run. So an unattended run
lands work on the mount and the push ends at GitHub Desktop and at EL.

**Adding the repository to the scheduled session's authorized set closes the remainder**, and the
reason is not convenience: it makes **CI** the judge of an unattended run's work instead of the
run's own say-so — the standard everything else in this repository is held to.

### 1. Phase 3 is BLOCKED at its first task. Read F-46 before you pick anything up.

**Do not start T-14b.** It was refused on 2026-09-05 by the pre-implementation review, and T-14c,
T-14d, T-14e and T-15 are blocked behind it. All five serve routes to an authenticated principal,
and **the blueprint declares no route that can produce one** — the whole document has exactly one
`/api/auth/*` route (`POST /api/auth/invite/accept`), no sign-in, no second-factor enrollment and no
OIDC callback, while §14.4 makes Entra ID SSO mandatory for staff. So no client principal reaches
§15.2 steps 3–7 and **no staff principal can exist at all**, which is what steps 1 and 8 are made
of. `tasks/review-findings.md` F-46 has the evidence and the narrowings a fresh-context review
insisted on.

**The unblocking move is EL's, not yours: a second §8.2 amendment.** The canonical list is the
**eight-row table in `tasks/todo.md` under T-14b** — do not restate it anywhere else; three
documents each naming a different set is how the first draft of this proposal failed review. `check-route-surface` diffs §8.2 against `ROUTES` in both directions
and `createApp` refuses to boot on a route the registry does not hold, so **the routes cannot be
added in code first, and must not be.** That control is what stops the target being moved to meet
the code, which is the failure drift 4 was closed to prevent. When the amendment lands, T-14b is
re-scoped in the same pass: its current wording says *"single-use token → credential → session"*,
and §14.3 forbids that auto-login in terms.

**T-14b's second blocker, F-47, is EL's too but smaller.** Nothing can resolve an anonymous bearer
to its tenant: `withTenant` demands an organization before any statement runs, and §14.3 forbids the
organization travelling in the token or the URL. The **session-cookie half is settled and needs no
decision** — a second server-issued `__Host-` cookie carrying the organization, verified rather than
trusted, fail-closed. The **invitation half** needs a `SECURITY DEFINER` tenant resolver
(recommended; its audit checker landed 2026-09-05 as F-48, closed for schema `app` with three limits stated) or a token-hash policy predicate. Running
the anonymous path under a `staff` context is rejected, and F-47 says why in one paragraph worth
reading before anyone proposes it again.

**What IS landable in the container with no decision from anyone:** F-47's session-cookie half; the
one-test gap F-47 names, where *"an unset tenant context sees nothing"* is asserted by argument and
never by a query with no context; and the done-count checker in item 2 below.

**Carried into T-14e, recorded not forgotten:** the operator release route has a policy row, an
authz rule, a §8.2 row and a mounted placeholder but no handler and no caller; `purgeExpiredOn`
still has no caller either.

### 2. The gap nothing owns

`check-claims` derives files, migrations, packages and route counts. **No derivation exists for
"is this task done"** — which is why T-14a sat uncounted for two editions with both gates green
(drift 39), and why `tasks/todo.md` recorded neither T-13d nor T-14a as complete (drift 43). A
checker that read each task's DONE block out of `tasks/todo.md` and compared the point sum to
`tasks/progress.md`'s total would catch both. It is not written down as a task anywhere. **Size it
before Phase 4**, which is 42 points of work whose completion nothing will check.

### Historical — how the branch was closed

Kept because the lineage matters and the instructions above replaced it. PR #1 merged in session 3;
R-08 and R-10 closed in session 6 at Checkpoint A; Checkpoint A closed on EL's word; T-13b, T-13c,
T-13d and T-14a landed in sessions 6 to 8 and merged as `42c8211` on 2026-09-03. Drift 4 —
"T-14 says 23 §8.2 routes, the table carries 20" — was reclassified rather than doc-fixed, and
T-14a plus EL's §8.2 amendment closed it: 22 of 22, with `check-route-surface` diffing the built
blueprint against the registry in both directions on every run. **Session 2's proposed remedy, to
edit 23 down to 20, would have hidden two missing MVP-1 routes by moving the target to meet the
code. That is why the blueprint wins and the scoreboard is what gets fixed.**

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