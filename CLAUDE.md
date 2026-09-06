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

**`docs/adr/` is the fourth, and it is canonical there.** ADR-001..014 were cited as governing while
existing only inside the read-only reference tree — readable, unamendable, outside the version
control holding the code they govern. They were migrated on 2026-09-05 and are edited, superseded
and added **only** in `docs/adr/`. The reference copies are historical. Start at
[`docs/adr/README.md`](docs/adr/README.md), which carries the register and says which two records
are overtaken.

**Allocating an F-number: check the remote, not just the file.** Two branches off one base each
took F-46 through F-50 for five different defects, because both read the register, both took the
highest number, and both were right when they looked (F-51). `check-findings` now refuses a
duplicate, a gap, and a follow-up naming an id that was never allocated — but it can only catch
that once both branches are in one file. Before allocating, run
`git log --oneline --all --grep='F-[0-9]'` or read the register on any live branch.

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
F-31, F-32, F-33, F-34, F-35, F-43, F-44, F-45, F-49, F-50. When reviewing anything, ask what would
have to break for this to go red, then make that happen.

**Its commonest form here is a list that is silent about what it does not list.** F-44: an app in
`apps/` with no boundary rule was scanned by nothing. F-49: `vitest.alias.ts` named
`tools/check-aliases.mjs` as the mechanism and that file did not exist. F-50: `studio-model`
shipped the sentence *"Pure: no I/O, no clock, no RNG. `check-boundaries` enforces that"* and the
scan did not include it. **Silence must not mean exempt** — that is the remedy each of those used,
and the reason for the checklist below.

**Adding a package or an app registers it in five places**, four of which now fail closed if you
forget. `pnpm verify` will tell you; knowing first saves the cycle:

| Where | Enforced by |
|---|---|
| `tsconfig.base.json` `paths` **and** `vitest.alias.ts` | `check-aliases` |
| `tsconfig.json` `references` | `pnpm typecheck` |
| `ALSO_PURE` or `KNOWN_IMPURE` in `check-boundaries.mjs` | `check-boundaries` |
| coverage `thresholds` in `vitest.config.ts` | `check-covconfig` |
| `RULES` in `check-app-boundaries.mjs` (apps only) | `check-apps`, and its self-test needs a probe dir too |

**Earn a coverage floor; never guess one and never lower one to fit.** A guessed 45% floor for
`render-canvas` would have passed at 32.94% measured, certifying a renderer whose line, dimension
and label paths had never run. A recording test double is not a mock when the assertions are about
what was *drawn* rather than about the double's own calls.

## Two machines

- **Cloud container** — pnpm, native PostgreSQL 16.13, network. **Every task can be implemented and
  verified here.** This is the fast lane; use it.
- **Windows / bridge mount** — where the repo lives. Needed for `git push` (no credentials on the
  bridge). **A Windows `pnpm verify` was impossible until 2026-09-05** and the claim that it was a
  second opinion was never true: eslint linted four gitignored files and failed the lint step
  (F-47), and `check-server-owned` did `await import('C:\…')` and threw
  `ERR_UNSUPPORTED_ESM_URL_SCHEME` before one assertion (F-48). Both are fixed. What is still
  missing on Windows is **Postgres**, so `check:rls` cannot run and the eight `.db.test.ts` suites
  skip — which means Windows can run everything *except* the DB arm, and a full green `verify`
  still comes only from the container or CI. No cross-platform CI matrix exists, so nothing tests
  the checkers themselves on Windows.

Bridge hazards, all learned the expensive way: **overwriting a file on the mount is a delete and is
refused** (extract to a temp dir outside the mount, then `cat tmp > dest`, then compare md5sums);
git locks strand and something Windows-side recreates `.git/index.lock` within seconds (one git
command per shell call, clear the lock immediately before it); when the index is unusable
`git show <sha>:<path> > <path>` works with no index at all; **`_to_delete/` is gitignored — stage
explicit paths, never `git add -A`**; and `git log --oneline @{u}..` must be empty before deleting
a branch, because `merge-base --is-ancestor` asks about a ref, not about your work.

## Verify before you claim

`pnpm verify` — typecheck, lint, tests, every checker behind its self-test, coverage, bench.
**Re-derive the checker count from `package.json`; do not copy a number from here**, which is why
this sentence no longer states one.

Exit 0 or it did not pass. **F-29 is closed**: with `RMS_REQUIRE_DB=1` — set in `ci.yml` — an
absent database is a collection-time failure rather than a green skip. Unset, on a laptop, the DB
suites still skip and still report a green count, so **check for skips whenever the variable is not
set**. The switch belongs to the environment that believes the answer.

CI fires on `push: branches: ['**']`, `pull_request`, and nightly. The repo is public, so runs are
readable at `github.com/Elliotvness/Master-Rack/actions` — **read the run, never report that one
exists**. Pushed ≠ a run exists ≠ green ≠ someone read it.

## Git

One short-lived branch per task, one push, one PR. Changelog entry in the commit that makes the
change. Commit bodies carry the evidence — the planted failure, its output, the exit code.

## Never touch

`C:\Rack Master\Resourse (do not delete or overwrite files)\` — four read-only reference projects.
Never edited, moved, renamed, or written into.
