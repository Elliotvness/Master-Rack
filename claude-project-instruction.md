# Rack Master Studio — Project Instructions

You are working on **Rack Master Studio**, a client-facing pallet-rack configuration and
quote-intake web app (monorepo at `C:\Rack Master\rack-master-studio`).

## Document hierarchy — never confuse these three

- **Blueprint** (`rack-master-studio-blueprint.html`) = the **objective**. The governing document.
  Wins every conflict.
- **Scoreboard** (`tasks/progress.md`) = the **measured truth**. Re-measured, never re-read.
- **`tasks/todo.md`** = the **plan**. Task detail, sizes, acceptance criteria, dependency order.

When the scoreboard contradicts the blueprint, the blueprint wins — fix the scoreboard, never the
blueprint to fit it.

## Standing rules

1. **Update the scoreboard** (`tasks/progress.md`) whenever a long task or a batch of tasks
   completes — without being asked, before the session ends.
2. **Re-measure, do not re-read.** Run the commands again against the working tree. Label every
   figure verified-today vs repository-claim.
3. **Completion is binary.** A task counts only when its stated acceptance criteria are met. No
   partial credit anywhere.
4. **§15.2 is the answer.** "0 of 8 MVP-1 steps" is how done the project is. The other percentages
   (12.6%, 14%, 73%) are plan-execution bookkeeping, not the answer.
5. **Never claim verification you did not run.**

## Definition of done (blueprint §15.2)

The eight MVP-1 steps: invitation → acceptance and sign-in → facility/unit entry → two controlled
options → plan/elevation preview → submit request for quote → immutability → internal review and
derive. MVP-1 is done when all eight run end to end for one option template and AC-01…AC-20 are
green.

## Skills to use

- **doubt-driven-development** — the project runs this discipline (AD-7); adversarial review before
  non-trivial decisions stand.
- **test-driven-development** — build controls that can go red (T-13b validator, T-13d idempotency,
  T-14 deny-by-default).
- **git-workflow-and-versioning** — one short-lived branch per task; changelog entry in the commit
  that makes the change.
- **ci-cd-and-automation** — every checker has a self-test that runs first; gaps: T-11 secret
  scanning, dependency audit, P-05 bundle ceiling, parallel verify jobs.
- **incremental-implementation** — land changes in small, reviewable steps.
- **frontend-ui-engineering** — Phase 4 only: P-05 budgets first (INP ≤ 200 ms), WCAG 2.1 AA from
  T-16, T-17 renderer-consumes-display-list rule.

## Current next work (in order)

1. **Close the branch:** push `6f05043`, R-10 commit review, R-08 catalog-as-data, merge PR #1,
   fix the four drift items in the merge commit (todo.md checkboxes, plan.md Q1/Q7, wrong branch
   name in state-of-the-build, T-14 route count 23 vs 20).
2. **Checkpoint A / Phase 2:** T-05 → T-06 → T-07/T-08 → T-27 → T-09 → T-10 → T-11 → T-12.
3. **Phase 3:** T-13b → T-13c → T-13d → T-14 → T-15, with P-01/P-02 in the same commits as the
   routes they measure.

For a full session handoff (context, figures, blueprint anchors), read
`claude-resume-prompt.md` in the repo root.