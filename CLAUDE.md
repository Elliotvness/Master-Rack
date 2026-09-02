# Rack Master Studio — working agreement

Client-facing pallet-rack configuration and quote-intake app for McMurray Stern.
Read this before touching anything. It is short on purpose.

## The document hierarchy — never confuse these three

| | | |
|---|---|---|
| **Blueprint** | `rack-master-studio-blueprint.html` | The **objective**. Governing. Wins every conflict. Built from `src/parts/*` by `python src/build.py` — **edit the parts, never the built file** |
| **Scoreboard** | `tasks/progress.md` | The **measured truth**. Re-measured, never re-read |
| **Plan** | `tasks/todo.md` | Task detail, sizes, acceptance criteria, dependency order |

When the scoreboard contradicts the blueprint, **the blueprint wins** — fix the scoreboard, never
the blueprint to fit it. `tasks/review-findings.md` is the findings register (F-nn); every defect
gets an entry there.

## Most documents here are dated records, not live state

`LATEST.md`, `docs/CURRENT_STATE.md`, `HANDOFF.md`, `tasks/state-of-the-build.md` and the rest are
**snapshots with dates on them**. They are allowed to be stale and must not be "corrected" to match
today — rewriting a dated measurement falsifies a record.

> **A dated observation keeps its number and says its date. A present-tense assertion about the
> product is re-derived or removed. A number is only wrong if it claims to be current.**

So: do not read the whole repo to orient. Read the three live documents above, then **measure**.

## The five rules

1. **Re-measure, do not re-read.** A figure copied from a document is a claim. Run the command.
   Label every figure verified-today, reported-by-<who>, or repository-claim.
2. **Completion is binary.** A task counts only when its stated acceptance criteria are met.
   No partial credit, anywhere, ever.
3. **§15.2 is the answer.** The eight MVP-1 steps in the blueprint are the definition of done.
   "0 of 8" is how done this project is. The other percentages are plan bookkeeping — never quote
   one without §15.2 beside it.
4. **Never claim a verification you did not run.**
5. **Every control must be proven to fire** by planting the failure it claims to catch. A gate that
   has never gone red is a name, not evidence.

## The recurring defect, which is what this project actually hunts

**A control that states its own method and has nothing behind it.** It is invisible by construction:
green build, honest docstring, reassuring name. Found so far as F-01, F-02, F-08, F-11, F-19, F-26,
F-31, F-32, F-33, F-34, F-35. When reviewing anything, ask what would have to break for this to go
red, then make that happen.

## Two machines

- **Cloud container** — pnpm, native PostgreSQL 16.13, network. **Every task can be implemented and
  verified here.** This is the fast lane; use it.
- **Windows / bridge mount** — where the repo lives. Needed only for `git push` (no credentials on
  the bridge) and for a Windows `pnpm verify`.

Bridge hazards, all learned the expensive way: **overwriting a file on the mount is a delete and is
refused** (extract to a temp dir outside the mount, then `cat tmp > dest`, then compare md5sums);
git locks strand and something Windows-side recreates `.git/index.lock` within seconds (one git
command per shell call, clear the lock immediately before it); when the index is unusable
`git show <sha>:<path> > <path>` works with no index at all; **`_to_delete/` is gitignored — stage
explicit paths, never `git add -A`**; and `git log --oneline @{u}..` must be empty before deleting
a branch, because `merge-base --is-ancestor` asks about a ref, not about your work.

## Verify before you claim

`pnpm verify` — typecheck, lint, tests, 12 self-tested checkers, coverage, bench. Exit 0 or it did
not pass. With no Postgres the DB suites **skip rather than fail** and report a green count (F-29),
so check for skips.

CI fires on `push: branches: ['**']`, `pull_request`, and nightly. The repo is public, so runs are
readable at `github.com/Elliotvness/Master-Rack/actions` — **read the run, never report that one
exists**. Pushed ≠ a run exists ≠ green ≠ someone read it.

## Git

One short-lived branch per task, one push, one PR. Changelog entry in the commit that makes the
change. Commit bodies carry the evidence — the planted failure, its output, the exit code.

## Never touch

`C:\Rack Master\Resourse (do not delete or overwrite files)\` — four read-only reference projects.
Never edited, moved, renamed, or written into.
