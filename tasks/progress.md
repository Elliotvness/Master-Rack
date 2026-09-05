# Progress scoreboard — 2026-09-04 (session 10, T-14a counted on `main`)

Derived from `tasks/todo.md`, which stays the source of truth for task detail. This file holds
only the arithmetic and the ordering. Where a figure was re-measured today it says so; where it is
the repository's own claim it says that instead.

**Session 10 (2026-09-04) — a scheduled unattended run. It built nothing and it landed nothing,
because it can do neither: the git proxy refuses this repository, and no folder was connected. What
it could do is measure `main`, and `main` had never been measured.** `pnpm verify` at `0bb5383` —
the tip, the merge's own descendant — reached **exit 0: 59 files, 1,491 tests, 0 skipped, 15
checkers behind their self-tests**, coverage all files **99.54 / 98.90 / 99.40 / 99.54**, against
native PostgreSQL 16.13 with 13 migrations applied. *(A second exit-0 `verify`, on the tree carrying
this edition's documentation edits, read 99.51 / 98.85 / 99.40 / 99.51 — v8 coverage is not
bit-stable across worker scheduling, as sessions 7 and 8 also found. The figure published is the one
from the run at the commit being cited, not the better of the two; the per-package 100s, which are
what the thresholds gate, did not move, and no `.ts` file changed between the runs.)* Every previous verify in this file was run on a
*branch*; this is the first one that says anything about the tree `origin/main` actually holds.

**T-14a is counted here, four points later than it should have been, and on evidence re-run rather
than inherited.** Three mutations were planted against the real `apps/api/src/app.ts` and each
file restored and compared identical afterwards: the mounted-but-absent-from-`ROUTES` arm disabled
→ **2 failed**; `assertConfiguration()` dropped from `createApp` → **1 failed**; the coverage check
moved out of `onReady` into the body of `createApp` → **2 failed**. The last is the one worth
having: it is the exact hole T-14a's own commit body calls *"the whole control"*, and it is the
only one of the three a reader could not predict from the diff. **The numerator moves 62 → 66 and
the published figure 38.8% → 41.3%. The denominator did not move.** §15.2 did not move and could
not: `createApp` mounts all 22 routes, authorizes every one of them, and **all 22 handlers are
placeholders that answer 500**, declared as data in `UNIMPLEMENTED` so *"the app boots"* can never
be read as *"the app works"*.

**Session 9's edition never reached the repository, and that is this session's finding.** It made
the same measurement, found drift 39–45, wrote the fix, and delivered it as a patch file into a
session nobody was watching. `main` is still `0bb5383`; every one of those seven items was
re-confirmed present in the working tree today, one full edition later. **A correction that cannot
land is not a correction, and two unattended runs in a row have now produced one.** The delivery
mechanism, not the measurement, is what is failing — see *What to do next*.

**Session 8 (2026-09-03) — T-13d lands, and the review refused it first.** The idempotency key
store: `0011_idempotency.sql`, `apps/api/src/idempotency/`, and `canonicaliseAll` in
`@rms/kernel-model`. AD-3's claim is decided by `UNIQUE (organization_id, key)` and an
`INSERT … ON CONFLICT DO NOTHING`, not by application code, and the claim commits in its own
transaction **before** the effect so a crash leaves evidence rather than a silently retried freeze.
Measured on `task/t-13d-idempotency` in the container against native PostgreSQL 16.13: every
`pnpm verify` at **exit 0 — 59 files, 1,491 tests, 0 skipped** and **15** checkers behind their
self-tests, coverage **all files 99.60 / 99.19 / 99.59 / 99.60** with `idempotency.ts`,
`request.ts` and `canonical.ts` at 100% lines. *(A separate `pnpm coverage` on the identical tree
read 99.69 / 99.23 — v8 coverage is not bit-stable across worker scheduling, as session 7 also
found. The figure published is the one from the exit-0 `verify` being cited, not the better of the
two; the per-package 100s, which are what the thresholds gate, did not move. The only occurrence
of "skipped" anywhere in the log is a self-test case name.)* **The numerator moved 58 → 62.** The denominator then moved 148 → 160 when EL confirmed T-14a–e
later the same day, so the published figure is **38.8%** — the numerator is progress, the
denominator move is bookkeeping, and the two must not be read as one. §15.2 did not move and could not: a key store that no route yet
consults cannot get a client through a screen.

**The run before this edition did NOT end at exit 0, and that was the gate working.** It stopped
at `check-claims`, which re-derives test files and migrations from the tree and found the
scoreboard still saying 54 and 10. This edition is that fix, and the exit-0 run above is the one
taken after it.

**Fresh-context adversarial review REFUSED the task** — three blockers, three majors, all closed
and recorded as **F-39**. The one worth carrying forward: *"the intent row is written **before**
the effect"* was stated in the migration header, in the module note and in the acceptance criteria,
and **enforced by nothing**. `claimOn` takes a caller's transaction and was re-exported from the
package barrel; review claimed inside a transaction that then threw and got **two effects for one
key with zero rows left behind**, with no test, lint rule or checker going red. Closed three ways —
un-exported, a DB test in which the effect rolls back and the claim must survive, and a symbol rule
for `apps/api` in `check-app-boundaries` carrying that checker's first path **exemption**, so the
directory that defines them may name them and no other may. The second blocker is the same shape in
miniature: the retention test's own docstring said that hardcoding the attempt count "would pass
forever while someone raised `max_attempts` to 200" — and then hardcoded it. Review planted
`DEFAULT 5000` and watched all three assertions stay green.

**Ten controls were planted and proven red across the three commits**, six on the first pass and
four on the fix, including the one the review showed could not fire. Two figures in the first
commit body did not reproduce — dropping the unique constraint turns 15 of 30 red, not 8 — and are
corrected in F-39 rather than quietly restated.

**EL answered all six parked questions the same day, one of them was code, and adversarial review
refused the first implementation of it.** The lease shipped without a **fence**: a takeover reused
the row id, so the overtaken holder still settled the claim it had lost, its result was replayed to
the client, and both effects had committed — and a stale `failed` settle freed the key with no
lease expiry at all, so the stated cost was not even the guarantee. `lease_epoch` (migration 0013)
closes it. Recorded as **F-40**, together with the second blocker: four documents said a malformed
`CLAIM_LEASE_MINUTES` "throws at startup" when there is no startup, so a typo'd deploy came up
healthy and threw at the first duplicate claim.

**`prove-the-control-fires` was then run over this session's own additions, and found two more.**
`check-app-boundaries` refused a pass only when the scan matched *nothing at all*, so with three
rules a renamed `apps/api/src` left two apps checked and a green build over the rule this session
had just added; and its new `exempt` list was a silent skip that never asserted the path it names
still exists. Both fail now. **The test written for the first was itself defective** — it filtered
violations by the `api:` prefix, which the neighbouring stale-exemption violation also carries, so
neutering the guard it named left the self-test green. Recorded as **F-41**.

**EL's decision, as landed.** The stranded
claim — an `in_flight` row left by a dead process, refusing every retry of that key for thirty days
— is closed with **both** halves he asked for: a **10-minute lease** configurable through
`CLAIM_LEASE_MINUTES` (a malformed value throws at startup rather than falling back), and an
**operator release** at `INTERNAL_ADMIN` writing an audit event in the same transaction as the
release, setting the row to a fourth outcome, `abandoned`. Migration `0012`, six more controls
planted and proven red. The cost is stated rather than discovered later: a lease turns *one effect
per key, ever* into *one effect per key per lease window*.

**Now merged and pushed.** `task/t-13d-idempotency` was merged into `main` as a merge commit
(`42c8211`, `--no-ff`) on 2026-09-03, landing all 18 commits — T-13c, T-13d, T-14a, and the §8.2
amendment — and pushed to `origin/main` (`d61082e..42c8211`). Verified: `origin/main` is level with
local `main`, and **0 commits** remain behind on either `task/t-13d-idempotency` or
`task/t-13c-input-dtos`. The merge was clean (no conflicts; confirmed with `git merge-tree` before
executing). Pushes need Windows; the push was done from this machine, bypassing the container's
broken proxy. The delivery bundle (tip `005fa87`) is **not present** in this repo and remains the
one unlanded increment.

**Session 7 (2026-09-03) — T-13c lands, and the review round that mattered was the third one.**
`@rms/contracts` gains the input half of the audience boundary: a request body cannot declare a
server-assigned field at any depth, `parseBody` binds only a schema the module built, and a handler
receives a narrowed null-prototype object rebuilt from a snapshot taken once. Measured on
`task/t-13c-input-dtos` @ **`3f3afc3`** in the container against native PostgreSQL 16.13:
`pnpm verify` **exit 0 — 54 files, 1,385 tests, 0 skipped**, coverage all files
**99.65 / 99.22 / 99.79 / 99.65**, `packages/contracts/src` and `request.ts` at
**100 / 100 / 100 / 100**, **14** checkers green behind their self-tests. *(Two exit-0 runs of
the identical tree read 99.68 / 99.26 and 99.65 / 99.22 — v8 coverage is not bit-stable across
worker scheduling. The figure published is the run being cited, not the better of the two; the
per-package 100s did not move, which is what the thresholds actually gate.)* **The numerator moved
56 → 58 at a fixed denominator: 37.8% → 39.2%.** §15.2 did not move, and could not: a body
validator that no route yet feeds cannot get a client through a screen.

**Three fresh-context adversarial reviews ran; the first two refused the task and the third refused
the fix.** Round 1 and 2 found five blockers, of which the sharpest was that `parseBody` bound any
named object schema — `RequestSchema` and `ResponseSchema` are structurally identical, so
`parseBody(Revision, body)` against the *shipped* internal DTO compiled at `tsc` exit 0 and bound
`organization_id`, `audience` and `lifecycle_state`; deleting the guard left 43/43 green, so it had
never been proven to fire. Round 3 found that the **fix had reintroduced this project's own defect
shape one level up**: the new `check-server-owned` checker's self-test asserted floors rather than
the signalled set, so a parser regression losing half the migrations passed both the self-test and
the checker while `outcome`, `severity` and `request_status` became bindable. The set is now pinned
name by name, and both regressions are red. Full record under T-13c in `tasks/todo.md`.

**Pushed and judged.** EL published `task/t-13c-input-dtos` after clearing the stranded
`.git/index.lock` by hand; `origin/task/t-13c-input-dtos` is `08153e2` with tree `4fcd903`,
identical to the container's. **CI #80, event `push`, Success in 1m 32s** (`verify` 1m 28s, `docs`
6s) — and the vitest summary was **read from the raw log**, not inferred: `Test Files 54 passed
(54)`, `Tests 1385 passed (1385)`, **no `skipped` line in either the test or the coverage step**,
`All files 99.65 / 99.22 / 99.79 / 99.65`. That last figure settles the two-run coverage
disagreement recorded above in favour of 99.65, on a third machine.

**And reading that log found a defect this edition had already published.** The 14th checker,
`check-server-owned`, was wired into `pnpm verify` and **not into `.github/workflows/ci.yml`**,
which enumerates every checker as its own step and never runs `verify`. So CI #80 was green over
T-13c **without ever executing it**, while both scoreboard copies said "14 self-tested checkers in
CI". A checker that runs only on the author's machine is the exact shape this repository exists to
catch, committed by the change that added the checker and caught only because the run was read
rather than ticked. Both steps are now in `ci.yml`, self-test first — and **CI #81 on `f8efadf` (Success, 1m 20s)
proves they execute rather than merely exist**: `##[group]Run pnpm check:serverowned:selftest` and
`##[group]Run pnpm check:serverowned` both appear in its raw log, with
`selftest-server-owned PASS — 43 case(s); real tree pinned at 15 signalled column(s).` and
`check-server-owned: PASS — 15 server-assigned column(s), every one refused on a client body;
9 enum type(s) classified.` **The count is 14 in CI, measured on #81, not on the file.** Drift 38.

**Session 6, third edition (2026-09-02, evening UTC) — Checkpoint A closed on EL's word, and the
first Phase 3 task after it landed.** EL's *"lets proceed"* closed the eighth criterion; the
checkpoint record in `tasks/todo.md` is ticked with the word and the date, and the T-14 breakdown
the checkpoint owed is written under T-14 as **T-14a–e, five M sub-tasks, proposed and not yet
confirmed** — so the denominator here is still 148 and T-14 is still L = 8 (PR #18, `584bb6a`).
Then **T-13b** — per-audience DTOs and the outbound validator — was built test-first in the
container, put through two rounds of fresh-context adversarial review (both found a BLOCKER, both
fixed and planted), published from Windows with the container commit's tree and message compared
byte for byte, and merged as PR #19 (`d6b423d`). Measured on `main` @ **`162d26e`**: `pnpm verify`
**exit 0 in 74 s — 53 files, 1,238 tests, 0 skipped**, `@rms/contracts` and `apps/api/src/dto` at
100 / 100 / 100 / 100; **CI #72** on the branch push read from the raw job log — `Test Files 53
passed (53)`, `Tests 1238 passed (1238)`, no skip line — and #74 / the two PR runs green on their
PR pages. **The numerator moved 52 → 56 at a fixed denominator: 35.1% → 37.8%.** §15.2 did not
move — a validator that no route yet feeds cannot get a client through a screen. Three things
this edition leaves with EL: the guard's both-modes refusal (a recorded deviation from a literal
§8.3), the T-14a–e sizes, and OD-12's WITHDRAWN / EXPIRED → *complete*; and **F-38** is filed —
the two front-ends invented a six-state status vocabulary that appears nowhere in §3.4 or the
database. Drift 36 and 37 below.

**Session 6 (2026-09-02, later the same day) held Checkpoint A.** Measured on `main` @ `e86d2bf`
(PR #10, #11 and #12 merged this session — the F-32 recovery and Phase 2 close, the F-35 fix, and the
working agreement) and on `89e55fa` (F-36, PR #13 open, CI #49 green). Three verify runs are the
evidence: a **fresh clone in the container** (exit 0, 84 s, 1,143 / 50 / 0 skipped), **CI #48**
(job log read in the browser, all seven DB suites `✓` at database durations), and — for the first
time in this repository's history — **Windows** (`_to_delete/verify-windows.log`: every step green
through `check:claims`, `selftest-spot-check-draw: PASS` so **F-35 is proven where it matters**, and
then the final coverage step **exit 1** on two types-only files that Windows counts and Linux does
not — **F-37**). R-08, R-09 and R-10 closed on their own criteria, R-07 dispositioned with a dissent
on the record. **Checkpoint A is held and not green**: one criterion red (Windows verify, F-37), one
waiting on EL. §15.2 did not move.

**Session 6, close-out (2026-09-02, afternoon UTC) — Checkpoint A is now green on everything that
can be measured.** Measured on `main` @ `b8d2087`: PR #13 (F-36), #14 (the checkpoint record), #15
(F-37's remedy) and #16 (R-07 fixed to throw) merged, each on a green run read on its PR page; CI
**#64** on the merge commit read step by step (`verify` 1m28s, the two new types-only steps present
and green ahead of the coverage gate). **F-37 was raised, remedied and closed in one day**: the two
types-only modules leave the coverage gate through a single list that a thirteenth self-tested
checker, `check-types-only`, re-proves on every run, and the Windows verify script then reached
**exit 0 at `0df4af5`** — the first complete `pnpm verify` on Windows in this repository's history.
**R-07 closed** by the recommended fix: `approved_by: 42` and `constraints: {a: "x"}` now throw with
the field named, test-first (two red, then green), and the review count is **11 of 11**. Container
verify on `b8d2087`: exit 0, 76 s, **50 files, 1,144 tests, 0 skipped**. Of the checkpoint's eight
criteria, **seven are ticked on evidence; the eighth is EL's word and the T-14 breakdown**, which
nothing in this session can supply. §15.2 did not move.

**Two things this session should be read for.** First, a second session was found working the same
tree at 09:23 UTC (`fix/f-36-internal-web-symbol-rule`, the earlier session still alive) — two
writers in one working tree, resolved by EL stopping it; the branch was pushed, reviewed as a diff,
and is PR #13. Second, the numerator moved by **four points with no task landing**: R-08 and R-10
were review items whose last verification lines said *needs Windows* or *not run here*, and this
session ran them. Bookkeeping that was owed, not progress.

The session-5 lineage follows unchanged.

Measured on branch **`task/t-10a-reconcile-documents`**, off `main` @ `3f1ef3b` (level with
`origin/main`; PR #1–#6 merged). The branch is now **pushed with its upstream set, and PR #7 is open
over it** — carrying T-08, F-27, T-09, T-10a and T-10b.

**PR #7's run is green, and it is the first CI coverage any of this work has ever had — because a
branch push creates no run at all.** `ci.yml` fires on `push: branches: [main]`, on `pull_request`
and on a nightly schedule; a task-branch push matches none of them. EL established this three ways
(`gh run list` by commit and by branch, both empty; the API's `check-runs` returning `total: 0`) and
it is re-derived from the workflow file here. **That is F-32, and it invalidates a sentence this
file has carried for three sessions** — see drift 28.

**This header names no sha and no ahead-count on purpose, and that is the remedy for drift 26**
rather than a gap. Every commit that edits this file changes both, so a sha written here is stale
before it is read — the same self-reference the *Verified today* table already warns about for the
ahead/unpushed pair. **Re-run `git rev-parse --short HEAD` and
`git rev-list --left-right --count origin/main...HEAD`**; a number quoted from this paragraph would
be a fifth instance of the file describing itself wrongly, not a measurement.

**This header was itself stale until this session and is drift item 26:** it named
`task/t-07-workflow-package` @ `e88320f` and `main` @ `98b0229` while its own *Verified today* table,
four screens below, named a different branch and a `main` three merges newer. Session 4's
header named `task/t-06-acknowledgement` off `e08a3ac` while its own *Verified today* table, four
screens below, named the branch and commit above: two statements written at different moments, only
one of them re-run. That is drift 15, and the **third** time this file has described itself wrongly
(items 5, 11, 15).

Earlier lineage, kept because it is what the standing rule is made of: session 3 measured at
`ff63b87` and its tip `efbafbd` was green in CI — **run #10, Success**
(https://github.com/Elliotvness/Master-Rack/actions/runs/33529120263) — which closed **T-00**, the
first commit in this repository ever verified at the commit that actually exists. The session-2
scoreboard measured itself at `6f05043` (27 ahead, 1 unpushed) and three commits landed after it, so
its own tip figures were stale before it was read — drift 5.

**Session 5 ran in two passes, and the first one moved nothing.** Pass one was a re-measurement at
`e88320f` that landed no code and found **nine false statements across the four copies of this
scoreboard** — the two repo copies contradicting each other on a published percentage while
`pnpm check:scoreboard` stayed green (drift 18), and the two copies CI cannot reach still publishing
the figures from before T-07 (drift 23). Items 15 to 23, none of them in the code.

**Pass two amended the plan and completed T-27.** EL approved splitting T-10 and re-ordering the rest
of Phase 2 to `T-27 → T-28 → T-08 → T-09 → T-10a → T-10b → T-12`; T-27 landed on
`task/t-27-typecheck-tests`. See *Verified today*.

**The suite ran, and this time it is a measurement.** `node_modules` in EL's working tree holds win32
binaries (`@esbuild+win32-x64`, `@rollup+rollup-win32-x64-gnu`, `.CMD` shims) against a Linux bridge
shell with neither `pnpm` nor `psql`, so nothing can run *there* — re-confirmed today. What changed is
that the repository was rebuilt in a Linux container with a **native PostgreSQL 16.13**, which is how
every figure below marked verified-today was produced. That path needs no push and no Windows, so it
is available to every remaining Phase 2 task.

---

## Update cadence — the standing rule

**This file is updated whenever a long task completes, or a batch of several tasks completes** —
without being asked, and before the session ends. A scoreboard that is only refreshed on request
becomes another stale document, which is the defect this project keeps finding in itself.

The procedure, so it is reproducible:

1. **Re-measure, do not re-read.** Run the commands again against the working tree — branch and
   commit, `git ls-files` for UI files, the server/framework greps, route-table count, tags,
   changelog, CI steps. Figures copied from the previous scoreboard are claims, not measurements.
2. **Recompute** done-points over the **148**-point denominator using the plan's own T-shirt sizes — 143 until T-28 was added in session 3, 145 until T-10 was split, 147 until T-11 grew for F-32; read the current figure off the phase table, never off this line.
   Completion stays **binary**: a task counts only when its stated acceptance criteria are met.
3. **Re-check §15.2** — 8 steps — because that is the headline and it does not move until HTTP and
   a screen exist.
4. **Label every figure** as verified-today or repository-claim. Anything that could not be re-run
   goes in the claims list with the reason.
5. **Record new drift** found while measuring, with the owning task (R-11 / T-10).
6. **Update every copy.** There are four, and **two are not on disk** — a filesystem search
   will not find them:
   - `tasks/progress.md` — this file: the arithmetic and the ordering **(repo)**
   - `tasks/progress.html` — the source of the published page **(repo)**. Edit it in the same
     change as this file; `pnpm check:scoreboard` fails the build if the two disagree
   - the **published artifact** — republish `tasks/progress.html` to the *same* URL, never a new one
   - `claude/progress-scoreboard-<date>.md` — **a Claude Project doc, not a repo file.** Read and
     write it with the Projects tool; it exists under no path on disk

   There is deliberately **no stored copy of the review prompt**.
   `tools/cross-model-review.cmd` builds it from this file into `%TEMP%` at run time, so the
   reviewer always sees the current scoreboard and no stored copy can drift.
7. **Verify the two copies CI cannot see.** `pnpm check:scoreboard` compares
   `tasks/progress.md` against `tasks/progress.html` and nothing else — **it covers two of the
   four copies.** A green build says *nothing* about whether the published page or the project
   doc match; CI has no access to either. Those two are checked by hand at update time:
   - **the published artifact** — re-read it with the Artifact tool and compare its
     `class="pct">done / points<` values against the phase table. Do not assume a republish
     succeeded because it returned a URL
   - **the measure cards in `progress.html`** — the four `<div class="m">` percentages at the top of
     the page. **CI does not compare these** and in session 5 one of them had been wrong for a full
     session while the build stayed green (drift 18). Read them against the headline table by eye
     until `check-scoreboard-sync` is widened to parse them
   - **the project doc** — re-read it with the Projects tool and compare the headline table

   And the gate compares **figures, not prose**: the phase numbers, their sum, and the §15.2
   headline. The two repo files can describe the same numbers in different words and still pass,
   so read the wording as well.
8. **Re-date the header.** If the denominator changed because a task was added, split or re-sized,
   say so explicitly — a percentage that moved because the denominator moved is not progress.

---

## The headline

| Measure | Value | Blueprint anchor | What it measures |
|---|---|---|---|
| **§15.2 MVP-1 "done when"** | **0 of 8 steps — 0%** | **§15.2** — the eight steps, verbatim | **The blueprint's own definition of done. This is the answer to "how done is it".** |
| Plan-task completion, effort-weighted | 66 of 160 pts — **41.3%** | `tasks/todo.md` phases, sliced from **§15.3** | Bookkeeping against the plan. An upper bound — see the caveat below. |
| Plan-task completion, task count | 24 of 49 — 49% | Same, unweighted | Same |
| Pre-merge review `R-01…R-11` | **11 of 11 — 100%** | **§16.1** review gates | A sub-checklist of one merged branch, not the project. All eleven closed on their own criteria. R-09 and R-10 closed at Checkpoint A in the container; **R-07 closed last**, by fixing L-3 and L-5 to throw (`6696f5f`, PR #16) rather than leaving them dispositioned — the dissent on the record won |
| Route surface vs the blueprint | 22 of 22 MVP-1 routes declared, mounted, **and checked** | **§8.2** (24 rows, 2 marked phase 2) | **Drift 4 is closed, and it now has a mechanism.** T-14a added the two missing routes; EL amended §8.2 to carry the operator release; and `check-route-surface` — the 15th self-tested checker — parses §8.2 out of the built blueprint and diffs it against the registry in both directions on every run. Drift 4 lived five sessions because every session that found it found it by hand. A Fastify router mounts all 22 rows; every handler is still a declared placeholder. Since T-13b every entry also names the response schema it answers with, and `assertRouteCoverage` refuses one that does not |

These are not competing answers. **0% is the answer**; 41.3% is how much of the written plan has
been executed. A reader who quotes 41.3% without §15.2 beside it is quoting the wrong number.

**Phase 2 is complete** — the first phase to close since Phase 1. **§15.2 did not move by one step
while it happened**, and that is not a paradox: Phase 2 was repairs and controls, and the definition
of done is a client getting through eight screens. **Phase 3 has now opened past the checkpoint
with T-13b, and §15.2 still did not move** — the contract is what a route will answer with, and no
route answers yet. The first point that can move it is T-14a's.

**Checkpoint A is closed.** Seven criteria were ticked on evidence at the close-out below; the
eighth — *review with EL before Phase 3* — was closed by EL's word (*"lets proceed"*, 2026-09-02)
after the seven and the two things still his were put to him in those terms. `tasks/todo.md`
carries the tick, the word and the date; `tasks/plan.md` B3 records the checkpoint held and closed.
The T-14 breakdown the checkpoint owed is written as **T-14a–e** — the application and its gate
against the *registered* router (plus the two §8.2 routes still missing, drift 4), auth and
organizations, client reads and drafting, submit / clone / status / documents with P-01 in the same
commit, the internal surface with P-02 in the same commit — **each M, each with the failure it must
be proven to catch. **EL confirmed the breakdown at 160 points on 2026-09-03** — *"the breakdown
names its failure modes, that's the right structure; the denominator change is bookkeeping"* — so
T-14's single L = 8 is retired, the five M sub-tasks count, and this file publishes 41.3% over 160.
Nothing got worse: 62 done points did not move, only the denominator did.

**Checkpoint A was held in session 6, and by the close of the session every measurable criterion
is met.** When it was first held, seven of its eight criteria were re-measured (three runs, three
machines); five were met, one was met by mechanism only on the F-36 tree, and one was red —
*"`pnpm verify` PASS on Windows"* failed at the very last step, coverage, for a reason that was
neither the code nor the tests (F-37). By the close-out: F-36 is on `main` (PR #13), so the
mechanism criterion holds on `main` and not only on a branch; F-37's remedy landed (PR #15) and the
Windows script re-ran to **exit 0** (`0df4af5`, 1 m 34 s, coverage identical to Linux), so the red
criterion is ticked on a run and not on a promise; and R-07's two open items were fixed to throw
(PR #16), so the review that the checkpoint carries is 11 of 11. **Seven of eight ticked, each on
evidence.** The eighth — *review with EL before Phase 3* — is the word that closes the checkpoint
and the Phase 3 breakdown of T-14, and it is EL's. The checkpoint record is in `tasks/todo.md`; it
ticks nothing it did not run.

**Both moved this session, in opposite directions, and the two must not be confused.**

- **The denominator moved to 147** because **T-10 was split into T-10a (S) and T-10b (M)**, approved
  by EL and recorded in `tasks/todo.md`'s Phase 2 header. That is bookkeeping. On its own it took
  29 / 145 = 20.0% to 29 / 147 = **19.7%** — a figure that fell while nothing got worse, which is
  precisely why the standing rule makes the denominator report itself.
- **The numerator moved to 45** because **T-27, T-28, T-08 and T-10a (S = 2 each) and T-09 and
  T-10b (M = 4 each)** were completed, container-verified: `pnpm verify` exit 0 throughout against a
  native PostgreSQL 16.13, with an **83 s baseline measured immediately before the first change**, so
  "does not slow materially" is a comparison and not an assertion. **Phase 2 is now 26 of 28 — 93%,
  and everything left in it is XS.**

- **The denominator moved again to 148** at the end of the session: **T-11 went XS → S** when
  **F-32** was added to it. Bookkeeping, and it is why the published figure fell from 30.6% to 30.4%
  while nothing got worse.

Net: 20.0% → **30.4%**, of which the honest progress is the middle bullet alone.

- **Session 6: the numerator moved 48 → 52 at a fixed denominator**, and none of it is a task.
  **R-08** (S) and **R-10** (S) are counted once each in Phase 3; both had every acceptance box ticked
  in earlier sessions and one verification line left open — *"NOT RUN HERE"* for R-08's
  `pnpm test packages/kernel-catalog`, *"needs Windows"* for R-10's per-commit
  `typecheck && test`. Both lines were run this session (200 catalog tests green in three runs;
  39 commits checked out alone, 36 self-standing, 3 blocked by a lagging lockfile that
  `check-lockfile` now guards). Binary completion cuts both ways: they were not done until the last
  line ran, and once it ran they are. 32.4% → **35.1%**.

- **Session 6, third edition: the numerator moved 52 → 56 at a fixed denominator, and this time it
  is a task.** **T-13b** (M = 4) landed on its own acceptance criteria — one DTO per
  (entity × audience) built field by field, client responses closed (`additionalProperties: false`
  in the emitted JSON Schema), the validator failing in non-production and alerting in production
  for drift, and the positive companion test asserting staff *do* see the fields — with its
  verification line run as written: `cost` added to a client DTO, red at module load, reverted.
  35.1% → **37.8%**. The T-14 split (T-14a–e) is written but **not counted**: a proposed size is
  not a size until EL says so, and a denominator that moves on a proposal would be this file
  describing a decision nobody made.

Session 5 opened by landing no commit at all — its first pass was a re-measurement that found nine
false statements across the four copies and nothing wrong in the code. See *Drift*, items 15–29.

**The session-4 history, kept because the denominator moved then too.** Session 3 moved the denominator twice
in opposite directions — T-00 closing took the figure from 12.6% to 13.3%, then adding **T-28**
(S = 2 points) took the denominator from 143 to 145 and the figure back to 13.1%. Session 4 earned
**ten points** at a fixed denominator: **T-05** (S = 2), **T-06** (M = 4) and **T-07** (M = 4), taking 19 to 29 and
13.1% to **20.0%**. T-05 was merged in session 3 and the session-3 scoreboard never counted it —
Phase 2 was published as `0 / 26` with T-05 already on `main`. That is drift item 11 below, found by
re-measuring rather than re-reading, which is the whole reason the standing rule says so. §15.2 sat
at 0 of 8 through all of it.

**Reconciliation with the older figures.** The Rev C audit's *68%* and `LATEST.md`'s *70%* are
blueprint-conformance measures — requirements met, and effort remaining — over the whole MVP-1
scope. This scoreboard counts tasks in the remediation plan. Different denominators, both honest,
neither comparable. The one figure all four agree on is §15.2 at 0 of 8.

---

## Method, so it can be re-run

- **Inventory.** The **49** tasks — 43 until T-28 was added in session 3, 44 until **T-10 was split**
  into T-10a and T-10b in session 5, 45 until **T-14 was split into T-14a–e** on EL's confirmation
  2026-09-03 (one L task becoming five M ones, +4 tasks and +12 points): the 37 `T-…` tasks and 6 `P-…` tasks in `tasks/todo.md` (T-13a–d, T-10a–b and
  T-18a–e counted individually), plus R-08 and R-10 counted once. The ten Phase 4 bullets
  (T-16…T-21) and the five Phase 5 bullets (T-22…T-26) are inside the 37, not additions to it.
  `tasks/todo.md`'s 110 checkboxes are *sub-criteria inside* those tasks, not tasks; they are also
  stale (T-01…T-04 are complete with unchecked boxes), so they are not counted.
- **Weights.** The plan's own T-shirt sizes: **XS=1, S=2, M=4, L=8**. P-00 carries no size and is
  scored M; T-00 is sized XS in the plan.
- **Two size markers a regex will read wrong**, both found in session 7 by re-deriving the
  denominator from scratch and landing on **145** instead of 148. `T-11`'s reads
  `**Scope:** XS → **S** (F-32 added)` — a naive `\*\*Scope:\*\* (XS|S|M|L)` captures the **XS**,
  losing a point. `P-05`'s reads `**Scope:** S to agree, M to enforce` — it captures the **S**,
  losing two; this file scores P-05 **M**, because the task is not done until the budget is
  enforced. Together with `T-19`'s `*L → split*` that is three markers in the plan that a
  size-matching regex mis-reads, all in the same direction: **too small**.
- **Completion is binary.** A task counts only when its stated acceptance criteria are met. No
  partial credit anywhere — including T-00, which is *in progress*, not 90% done.
- **Status source.** Commit subjects in `git log main..HEAD`, the `✅` markers in `tasks/todo.md`,
  and file-existence checks — not the checkboxes.
- **R-08 and R-10 appear twice** in the plan (in `tasks/review-todo.md` and again in Phase 3). They
  are counted once, in Phase 3. The other nine R-items are outside the 43.

### Caveat that cuts against the 41.3%

The T-shirt sizes were written **before anyone attempted the server or the interface**. T-14 is
sized L = 8 points = 5.4% of the project, yet it gates **all eight** §15.2 steps: every one needs
HTTP. Phase 4 is eight M tasks, one L, and one S in a repo with zero `.tsx` files and no framework
installed.
If either is under-sized — and both probably are — the true denominator is larger and **41.3% is
an overstatement**. Treat it as a ceiling. **The first re-sizing is now on the table:** T-14a–e,
five M sub-tasks = 20 points where T-14 carried 8, proposed under T-14 in `tasks/todo.md` and
waiting on EL. *(This heading and its last sentence read "32.4%" through two editions in which the
figure was 35.1%, and "5.6%" was 8 over the 143-point denominator of three sessions ago — drift 37.)*

Also outside the denominator, because the plan does not contain them: dependency audit in CI, E2E
tests, Dependabot, preview deployments. (Secret scanning *is* T-11; bundle gate *is* P-05;
changelog and tags *are* T-26.)

---

## Your queue — EL

**Nine of the ten cleared on 2026-09-03.** Q3 (disclaimer text, contact name, `MS-GOV-YYYY-NNN`
numbering) and Q4 (B2 bucket, scoped keys) are resolved on EL's word, which unblocks T-20/AC-16 and
T-24. The **push** (item 1) and the **§8.2 amendment** (item 2) are also done — the merge landed and
pushed to `origin/main` as `42c8211`, and the operator release route is now a §8.2 row. **One item
remains** in the waiting table below.

| # | Waiting on you | Why it is yours, not code's | Gates |
|---|---|---|---|
| 1 | **Q6 answered as McMurray Stern — which answers OD-20a, not OD-20b.** Read the distinction before closing it | OD-20a is the **internal dogfood** pilot: settled, worth doing, and it measures *usability*. OD-20b is the **external** pilot, and its own recorded criterion is *"outside McMurray Stern"*. Naming McMurray Stern therefore closes the first and leaves the second open — which matters because **R-01 (will a client actually do this work) retires only when an outside organisation completes a submission unaided**, and nothing else retires it | R-01 stays live; P-04's real unit sizes still unsourced |

| Closed by you | What it settled | When |
|---|---|---|
| **Checkpoint A** | Seven criteria ticked on evidence; the eighth — *review with EL before Phase 3* — closed by your word, *"lets proceed"*. Recorded in `tasks/todo.md` and `tasks/plan.md` B3 (PR #18). **Phase 3 has been open ever since**, and T-13b, T-13c and T-13d have all landed past it | 2026-09-02 |
| **The catalog release `interlake-2026-09`** | The first APPROVED, pinnable release — 336 rows, approved after you read the tool-drawn spot-check cells off PSG 2025 p.88 (42 plus one supplementary). The gate keys on a recorded verification path, not the digitiser identity string | 2026-09-01 |
| **F-32 — the CI trigger** | You took option (a): `push: branches: ['**']` plus a `concurrency` group. The criterion was that somebody watches it fire, and somebody did. **Also yours as a find** — you spotted that all four copies asserted a CI run existed when `ci.yml` could not have produced one | 2026-09-02 |
| **All 21 open decisions** | OD-01…OD-21 settled in one pass — storage, SSO, rack topology, tenancy, units, the client PDF's contents, waiver authority, the two named clocks, retention, per-org defaults, single-writer concurrency, and MVP-1's catalog-only scope with an off-ramp | 2026-08-31 |
| **Q1, Q2, Q5, Q7** | Answered, and `tasks/plan.md` now says so for all four — it had not caught up on Q1, Q5 *or* Q7 | 2026-09-01 |
| **OD-07 / OD-15 — approver authority** | You are catalog approver and rule-pack owner; Nick Heraldez is fallback. The single-point dependency is **formally accepted for MVP-1 only** — a decision, not an oversight | 2026-08-31 |
| **R-07 — the dissent taken** | You took the dissent rather than the disposition: `approved_by: 42` now throws, and `constraints` goes through a validator that names the offending entry. Test-first, PR #16. Closed the pre-merge review at **11 of 11** | 2026-09-02 |
| **T-13d's six open questions, in one pass** | The fourth claim outcome kept and AD-3's enumeration completed rather than extended; the stranded claim closed with **both** halves (a 10-minute lease, configurable, plus an `INTERNAL_ADMIN` release writing an audit event) and landed in T-13d rather than deferred; the outbound guard's both-modes refusal kept with the deviation recorded where the guard lives; OD-12 confirmed; T-14a–e confirmed at 160 points; the `content_sha256` left alone with one sentence in `packages/kernel-catalog/README.md`. *"Don't let sizing debates stall execution."* | 2026-09-03 |
| **Q3 and Q4** | The standing disclaimer text, company and contact name, and the `MS-GOV-YYYY-NNN` document numbering; and the Backblaze B2 bucket with scoped keys, created and verified. Between them they unblock **T-20 / AC-16** (the client PDF) and **T-24** (WORM retention) — two of the three phase-blocking items on this page are gone | 2026-09-03 |
| **Push two branches** | `task/t-13d-idempotency` merged into `main` as a merge commit (`42c8211`, `--no-ff`) and pushed to `origin/main` (`d61082e..42c8211`), landing all 18 commits — T-13c, T-13d, T-14a, and the §8.2 amendment. Verified: **0 commits** remain behind on either branch; `origin/main` is level with local `main`. Done from this machine, bypassing the container's broken proxy. The delivery bundle (tip `005fa87`) is **not present** in this repo and remains the one unlanded increment | 2026-09-03 |
| **§8.2 amendment** | The operator release route is now a §8.2 row: `POST /api/internal/v1/idempotency-claims/:key/release` at `internal_admin`, writing an audit event in the same transaction as the release. The two substitutions you approved are in: the path uses `/api/internal/v1/...` (no `/admin` namespace) and "operator role" maps to `INTERNAL_ADMIN`. The route is registered in `ROUTES` (action `idempotency.release`, response `AuditEvent`); its real handler is deferred to **T-14e** | 2026-09-03 |
| **The go-ahead to implement** | Planning complete, decision set closed at Rev C, no production code written. You asked for an explicit go-ahead and gave it — which is why every task since has a settled decision behind it rather than an assumption | 2026-08-31 |

## By phase

| Phase | Points | Done | % | State |
|---|---|---|---|---|
| 0 — Make CI real | 1 | 1 | **100%** | **T-00 complete.** Tip `efbafbd` pushed; CI run #10 **Success** — the first commit in this repo ever verified |
| 1 — Catalog and schema integrity | 10 | 10 | **100%** | T-01…T-04 complete (verified at `a2f166e` — repository claim, not re-run today) |
| 2 — Kernel and workflow repairs | 29 | 29 | **100%** | **Complete.** T-05, T-06, T-07, T-27, T-28, T-08, T-09, T-10a, T-10b, **T-11**, **T-12**. Points 26 → 28 from the T-10 split, 28 → 29 when T-11 grew XS → S for F-32 |
| 3 — The contract, then the server | 62 | 26 | 42% | P-00, T-13a, T-13b, T-13c, **T-13d**, **T-14a**, R-08, R-10 done; **T-14b–e (4 × M = 16)**, T-15, P-01…P-05 open |
| 4 — The interface | 42 | 0 | **0%** | Zero `.tsx` files exist |
| 5 — Deploy readiness | 16 | 0 | 0% | Not started |
| **Total** | **160** | **66** | **41.3%** | |

**Remaining: 94 points, and Phase 2's residue is zero.** T-14b–e plus all of Phase 4 is **58 of the
94 — just under two thirds**; the other 36 is the rest of Phase 3 (20, T-14 excluded) and Phase 5
(16). The
remaining work is *not* concentrated in the two big items, and planning as if it were will under-book
the back half.

---

### How soft is 41.3%?

The caveat above says the figure is a ceiling because T-14 and Phase 4 were sized before anyone
attempted either. Quantified — 66 done points never move, only the denominator does.
**Every row here is 66 over its own denominator, and every denominator is derived from 160 rather
than carried forward** (re-derived again in session 6 when the numerator moved to 52, and again in
this edition at 66). This table has now been wrong twice in one day in two different ways: four
of five rows were still computed on session 4's numerator of 29 while the first row read 41 (item
24), and — found only when T-11 changed the base — **all four scenario denominators were built on
the pre-split base of 145 while the row above them said 147** (item 29). Re-derived, not adjusted:

| T-14 | Phase 4 | Denominator | Completion | Scenario |
|---|---|---|---|---|
| 20 | 42 | 160 | **41.3%** | **T-14a–e as confirmed by EL (five M)** — the published figure |
| 20 | 63 | 181 | 36.5% | Phase 4 ×1.5 |
| 20 | 84 | 202 | 32.7% | Phase 4 ×2 |
| 30 | 84 | 212 | 31.1% | T-14a–e ×1.5, Phase 4 ×2 |
| 40 | 84 | 222 | 29.7% | T-14a–e ×2, Phase 4 ×2 |
| 40 | 126 | 266 | 24.8% | T-14a–e ×2, Phase 4 ×3 |

Even at triple, the figure moves about sixteen points. **The ceiling is real but shallow**, so
41.3% is not worth re-deriving — and §15.2 stays **0 of 8** in every scenario, which is why that
is the number to quote and this one is not. The second row is new and is not a scenario: it is the
breakdown actually on the table, and it is what this file publishes the day EL confirms it.

**Where the remaining 98 points sit:** Phase 4 42 (42.9%) · Phase 3's residue 40 (40.8%) ·
Phase 5 16 (16.3%) · Phase 2's residue 0. Neither large block is a majority. *(This paragraph read
"116 … Phase 2's residue 16" until session 6 while the table above it said 100 — drift 30.)*

## Verified today

Re-measured by running commands against the working tree:

| | |
|---|---|
| **Session 10 · `main` itself, for the first time** | Fresh clone of `origin/main` at **`0bb5383`**, clean tree, nothing unpushed. `pnpm verify` in the container against **native PostgreSQL 16.13** on 55432 with all **13** migrations applied: **exit 0 — 59 files, 1,491 tests, 0 skipped**, **15** checkers behind their self-tests, coverage all files **99.54 / 98.90 / 99.40 / 99.54**. The exit code was captured explicitly (`echo VERIFY_EXIT=$?`), not inferred from the absence of an error. **Every earlier verify row in this table names a task branch.** This is the first measurement in this file that says anything about the tree `origin/main` actually holds — and the merge it descends from was never verified as a merge |
| **Session 10 · a transfer tool reported success for a file it did not write** | Writing the four changed files to the mount a **second** time, `device_commit_files` returned `{"written":[… all four …],"rejected":[]}` — and `tasks/progress.md` still held the **first** transfer's bytes (md5 `dced42df…`, 131,843 bytes, mtime one minute older than its three neighbours). The other three updated. **Caught by md5, not by the tool and not by a gate.** Both gates were **green on the mount over the mismatch**, correctly: `check-scoreboard-sync` compares figures, the stale copy and the fresh one carried the same figures, and everything that differed was prose. Written instead by the documented path — `device_commit_files` to a new path under the gitignored `_to_delete/`, then `cat _to_delete/progress-new-s10.md > tasks/progress.md`, truncate-and-write rather than overwrite — and re-compared: **4 of 4 md5s identical**. **New bridge hazard, and the recurring defect in a tool rather than a document: a reported success with nothing behind it.** md5 both sides after every transfer; a `written` list is a claim |
| **Session 10 · P-05's agreed half, and its control proven against the real files** | Blueprint **§5.4 amended** with four front-end budgets beside the five server-side ones — **INP ≤ 200 ms** called out as the one that matters, LCP ≤ 2.5 s, CLS ≤ 0.1, initial JS ≤ 200 KB gzipped — plus the route-level code-splitting decision, recorded before there are routes to split. `check-front-end-budgets` + self-test wired **self-test-first** into `verify` and `ci.yml`; **31 checker invocations in each and the two sets identical**, checked by difference rather than by counting to the same number twice. Planted against the **real** files, each restored and md5-compared: INP loosened 200 → 900 ms in `src/parts/05-s4.html` and the blueprint rebuilt → **exit 1**; the 200 KB ceiling removed from `PERF.md` → **exit 1**; the checker's target-comparison arm disabled → **self-test exit 1**, one case of eight red; restored → exit 0. `pnpm verify` **exit 0 — 59 files, 1,491 tests, 0 skipped** on the tree carrying all of it. **P-05 is NOT counted**: completion is binary and its "M to enforce" half is not done — see the next row |
| **Session 10 · the new checker's first draft was the defect it exists to prevent** | `check-front-end-budgets` v1 summed every `.js` under each app's `dist` and **passed**, reporting *"client-web 16 KB gz"* — it was weighing `tsc --build` output and calling it *"initial JavaScript"*. **A control whose name is wider than its mechanism, written by the task whose whole purpose is to prevent that**, and it would have read green forever while measuring the wrong thing. Found by *running* it, not by reading it. A directory now counts as an SPA build only if it holds an `index.html`, and the initial payload is the scripts that document references. **The weigh-the-bundle arm remains UNPROVEN** — there is no SPA build to weigh — and the checker says so on every run rather than passing quietly. Wiring it to a real build is **T-16's obligation**, recorded in three places |
| **Session 10 · F-29 observed live, and the thing that caught it is not the thing named for it** | The container's Postgres died between runs, and the next `pnpm verify` is the measurement: **`pnpm test` reported `52 passed | 7 skipped (59)` / `1359 passed | 132 skipped (1491)` and stayed GREEN** — F-29 exactly as written. `verify` did go red, but **three steps later and for a different reason**: `check-rls` crashed with `Error: connect ECONNREFUSED 127.0.0.1:55432`. So a full `verify` cannot be green over silently-skipped DB suites — but the backstop is **incidental**, a checker that happens to need a live database, and it reports a connection error rather than "132 tests did not run". `pnpm test` on its own is still green over the skip. **F-29's `RMS_REQUIRE_DB=1` remedy remains unowned and is still worth having**: the accidental guard names the wrong problem, and a reader who saw only the test step would have ticked it. Postgres restarted, the run re-taken: **exit 0, 59 files, 1,491 tests, 0 skipped** |
| **Session 10 · F-29's check, run rather than assumed** | The only three occurrences of "skip" in the whole run are self-test *case names* (`the literal extractor finds strings and skips comments`, `an unimplemented method fails rather than being skipped`, `a row with no code cell is skipped rather than crashing`). No vitest skip line anywhere, and the DB suites executed: the 13 migrations were applied by `pnpm migrate` before the run |
| **Session 10 · T-14a's controls, re-planted at `main`** | Three mutations against the real `apps/api/src/app.ts`, each reverted and the file `diff`-compared back to a pre-mutation copy (**identical** all three times): the **mounted-but-absent-from-`ROUTES`** arm disabled → **2 failed**; **`assertConfiguration()` dropped from `createApp`** → **1 failed**; the **coverage check moved out of `onReady` into the body of `createApp`** → **2 failed**. Baseline `apps/api`: 16 files, 396 tests, all passing. The third is the one worth running: the only mutation a reader could not predict from the diff, and the exact hole T-14a's commit body names as *"the whole control"*. **T-14a is counted on this, not on its commit message** |
| **Session 10 · §8.2 re-derived with the checker's own parser** | `blueprintRoutes()` over the built blueprint returns **24** rows, **2** flagged phase 2 → MVP-1 surface **22**; `ROUTES` holds **22**, `PHASE_2_ROUTES` **1**, `UNIMPLEMENTED` **22**. Counted by parsing the declarations, not by `grep -c '{ method:'` — that bare count returns **23** across the file's two lists and is how a route figure goes wrong. **`22 of 22`, and all 22 handlers answer 500** |
| **Session 10 · drift 38's shape checked for and absent** | `package.json`'s `verify` chain and `.github/workflows/ci.yml` each hold **29** `pnpm check:…` / `pnpm lint:provenance…` invocations, and the two *sets* are identical — nothing in one and not the other, in either direction. Re-derived by set difference, not by counting to the same number twice |
| **Session 10 · the landing path, measured twice — before and after EL opened it** | **Before:** a real `git push` to `origin` (not a dry run) returned `remote: access denied by the git proxy: Elliotvness/Master-Rack is not in this session's authorized repository set` → **403**, and `get_device_info` reported **`connectedFolders: []`**. Both halves shut. **After:** EL connected `C:\Rack Master\rack-master-studio` mid-run, and **this edition was committed on the mount** — the bridge half is open, the proxy half is not. A push still needs GitHub Desktop. **Drift 47 is half-closed, and this row records which half** |
| **Session 6, third edition · branch · tip** | **`main` @ `162d26e`**, level with `origin/main`, clean tree, no local branch left in the container. PR #18 (`6a96ccd` — `584bb6a`, Checkpoint A closed and the T-14a–e proposal) and PR #19 (`162d26e` — `d6b423d`, T-13b) merged this edition, each on **4 successful checks** read on its PR page; both remote branches deleted and `git fetch --prune` confirms only `origin/main` remains. **Both commits were made on Windows from files written over the bridge and md5-compared on both sides (2 of 2, then 16 of 16), and each published tree was compared to the container's own commit before anything was merged**: `origin/task/t-13b-outbound-validator^{tree}` = `f7494cf^{tree}` = `d81e80c`, the commit message `diff` empty, the parent `584bb6a`. After the merge, `origin/main^{tree}` is that same `d81e80c` — the container's f7494cf and GitHub's `main` are one tree. The Windows tree is on `task/t-13b-outbound-validator` @ `d6b423d` and its `main` is two merges behind; **switching and pulling it is the next bridge action** (drift 34's shape, and the standing rule below). **Re-run `git rev-parse --short HEAD` rather than quoting from this document** |
| **Session 7 · CI #81 — the fix proven to run, not merely present** | `task/t-13c-input-dtos` @ `f8efadf`, push, **Success 1m 20s** (`verify` 1m 16s, `docs` 7s). Raw log searched for the two steps drift 38 added: both `##[group]Run pnpm check:serverowned:selftest` and `##[group]Run pnpm check:serverowned` are there, and their output is `selftest-server-owned PASS — 43 case(s); real tree pinned at 15 signalled column(s).` and `check-server-owned: PASS — 15 server-assigned column(s), every one refused on a client body; 9 enum type(s) classified.` Also read: `Test Files 54 passed (54)`, `Tests 1385 passed (1385)` in both the test and coverage steps, `All files 99.65 / 99.22 / 99.79 / 99.65` — the third machine to report that same coverage figure — and the only two occurrences of "skipped" in 1,499 lines are the pnpm lockfile notice and a self-test case name. **A step added to a workflow file is a claim until a run shows it executing; this is the run** |
| **Session 7 · CI #80 read from the raw log, not the viewer** | `task/t-13c-input-dtos` @ `08153e2`, event `push`, **Success 1m 32s**; `verify` 1m 28s, `docs` 6s. The viewer truncates the test step ("This step has been truncated due to its large size"), so the **raw job log** was opened and searched: `Test Files 54 passed (54)`, `Tests 1385 passed (1385)` in both the test and the coverage step, `All files 99.65 / 99.22 / 99.79 / 99.65`, and **the only two occurrences of the word `skipped` in 1,433 lines are a pnpm lockfile notice and a self-test case name** — no vitest skip line anywhere. F-29's check, run rather than assumed. **The same read found drift 38:** `check-server-owned` occurs **zero** times in the entire log, because it was never added to `ci.yml` |
| **Session 7 · `pnpm verify` on `3f3afc3`** | Container, native PostgreSQL 16.13 on 55432, 10 migrations, on the task branch — **not** merged to `main`, so this is a branch measurement and says nothing about `main`. **Exit 0 — 54 files, 1,385 tests, 0 skipped**, every one of the **14** checkers green behind its self-test (`check-server-owned: PASS — 15 server-assigned column(s), every one refused on a client body; 9 enum type(s) classified` is the new one), coverage **all files 99.65 / 99.22 / 99.79 / 99.65**, `packages/contracts/src` and `request.ts` **100 / 100 / 100 / 100**. The one file new since the third edition's 53 is `request.test.ts`, and **all 147** of the new tests (1,238 → 1,385) are in it — the count is high for one task because two review rounds each demanded coverage the first draft did not have. **CI #80 later confirmed it on a second machine** — see the row below |
| **Session 6, third edition · `pnpm verify` on `162d26e`** | Container, native PostgreSQL 16 on 55432, 10 migrations, run *after* the merge on the fast-forwarded `main`, not carried from the branch. **Exit 0 in 74 s — 53 files, 1,238 tests, 0 skipped**, every one of the **13** checkers green behind its self-test (`check-claims: PASS — 7 declared claim(s) match the code`, `check-scoreboard-sync PASS`, `check-types-only: PASS — 2 types-only module(s)`), coverage **all files 99.64 / 99.16 / 99.78 / 99.64**, `apps/api/src/dto` and `packages/contracts/src` **100 / 100 / 100 / 100**. The three files new since the close-out's 50 are all T-13b's — `schema.test.ts`, `outbound.test.ts`, `dto/audiences.test.ts` — and of the 94 new tests (1,144 → 1,238), **88** are in those three files (30 / 42 / 16, read from the run) and the rest are in `authorize.test.ts`'s new response-declaration block and `client.test.ts` |
| **Session 6, third edition · CI #72 read from the raw log, not the viewer** | Branch push of `d6b423d`, event `push`, **Success 1m18s**; `verify` 1m14s, `docs` 8s. The viewer truncates the test step ("This step has been truncated due to its large size"), so the **raw job log** was opened and searched: `Test Files  53 passed (53)`, `Tests  1238 passed (1238)`, `Duration 15.98s`, **no `skipped` in the summary** — the first CI run in this repository whose vitest summary line was actually read rather than inferred from per-file lines. `Apply migrations` 1s and `Initialize containers` 7s ahead of it, `tenancy.test.ts (41 tests)`, `submit-effects.db.test.ts (12)`, `auth.db.test.ts (12)` in the per-file list, so the DB suites ran against the service container. All 13 checker pairs present in the step list in `ci.yml`'s order. Same Node 20 → 24 warning as every run |
| **T-13b, container-verified** | `packages/contracts` gains **`schema.ts`** — a closed JSON-Schema subset held as a value that both `validate` and `toJsonSchema` read, so the runtime check and the emitted OpenAPI cannot disagree — and **`outbound.ts`**, the guard that stands where a response leaves the process. `clientResponse()` refuses a `FORBIDDEN_CLIENT_FIELDS` name or an embedded internal schema **at declaration**, so a leak cannot even be written down. `apps/api` gains **9 client and 10 internal DTOs** (`dto/client.ts`, `dto/internal.ts`), each built field by field under its schema; every `ROUTES` entry now names its response schema and `assertRouteCoverage` refuses a missing key, `null` on a non-public route, a name on the public one, or a name the namespace's registry lacks. `apps/api/src/index.ts` is now 15 re-export blocks, still no HTTP |
| **T-13b's controls, proven to fire** | Three plants against the real files, each restored and md5-compared: **`cost: number()`** on the Project client DTO → `SchemaError: Project: 'cost' is on FORBIDDEN_CLIENT_FIELDS and cannot be declared on a client response`, **both DTO suites red at module load** (the task's own verification line, run as written); **`response: 'Comparisonn'`** in `ROUTES` → `RouteCoverageError: … response schema 'Comparisonn' is not in the client registry`; **a display item carrying `created_by`**, alert mode, through the guard → `OutboundLeakError: Preview: response to a client carries undeclared fields: views[0].items[0].created_by`. The third is the one review round two demanded — see the next row |
| **T-13b's two review rounds, both red** | Fresh-context adversarial review (AD-7) twice before the commit stood. **Round one, BLOCKER:** both status tables were keyed on **six states invented by `apps/client-web` and `apps/internal-web`** that appear nowhere in §3.4, `app.request_status` or OD-12 — every real row would have been refused by the validator it was written for. Re-keyed on the nine-state enum with an exhaustiveness test; the front-end drift is **F-38**, filed in `tasks/review-findings.md`. **Round two, BLOCKER:** an undeclared key inside a `oneOf` position (the display list, the finding parameters) was swallowed into a union summary the guard read as *drift* and **shipped in alert mode** — a leak path through the leak guard. The closest variant's problems are now hoisted with their real kinds; the `created_by` plant above is the proof. Also from review: own-key lookups and a null-prototype property map (`constructor` / `__proto__` off `JSON.parse` are strays, tested); absence-encoded unions so the contract pins what the type pins; the internal Finding a strict superset of the client one with the waiver fields; DRAFT excluded from the queue and the package; `nullable(oneOf)` refused and empty `required` omitted for OAS 3.0; `paginatedResponse()` so a list wrapper goes through `clientResponse` too |
| **T-13b's decisions, recorded and not made** | Two are EL's and sit in `tasks/todo.md` under T-13b. **(1)** The guard refuses — in **both** modes, on a **client** response only — any forbidden field and any undeclared field at any depth; only *drift* (a declared field wrong-typed or missing) follows the fail / alert mode. That is a deviation from a literal reading of §8.3 (*"alert in production"*), argued from AC-02 and R-02: a production alert that ships the cost figure it is alerting about is not a control. **(2)** OD-12's rows made in code: `WITHDRAWN` and `EXPIRED` → *complete* on the client. And three **blind spots stated in the code and owned by T-14a**: the guard judges the object graph it is handed (`toJSON` / `Map`), so T-14a hands it the parsed serialized payload; the env → mode binding does not exist yet; the two §8.2 routes still absent from `ROUTES` leave `Document` and `InternalNote` as the registry's only orphans, on an allowlist that can only shrink |
| **Session 6 close-out · branch · tip** | **`main` @ `b8d2087`**, level with `origin/main`, clean tree, no local branch left in the container — PR #13 (`3caa91d`, F-36), PR #14 (`9296ce1`, the checkpoint record and the previous edition of this file), PR #15 (`d3b2979`, F-37's remedy: `fe8a72a` + `0df4af5`) and PR #16 (`b8d2087`, R-07: `6696f5f`) merged since the row below, remote branches deleted after each tip sha was found in `main`'s log — and `origin/review/r-07-load-manifest` **re-appeared at `6696f5f` between the merge and this update** (something on the Windows side re-published it; its tip is in `main`, so it is deleted again here, and `git ls-remote --heads` is the check that would have caught it). Working branch for this update is `docs/scoreboard-checkpoint-a-close`. **The Windows tree was found on `review/r-07-load-manifest` @ `6696f5f` with its `main` at `9296ce1`** — two merges behind — and is switched and pulled as part of this update. **Re-run `git rev-parse --short HEAD` rather than quoting from this document** |
| **Session 6 close-out · `pnpm verify` on `b8d2087`** | Container, native PostgreSQL 16 on 55432, 10 migrations. **Exit 0 in 76 s — 50 files, 1,144 tests, 0 skipped**, every one of the **13** checkers green behind its self-test, `check-types-only: PASS — 2 types-only module(s) still compile to an empty module`, `load-manifest.test.ts (32 tests)` where there were 31. The one new test is R-07's; the count moved by one because one pin was replaced by two |
| **Session 6 close-out · CI #64 read, not reported** | `main` @ `b8d2087`, push, Success 1m35s; `verify` 1m28s, `docs` 6s. Job page opened in the browser and the step list read in order: *Types-only exclusion self-test* (0s) and *Coverage exclusions are still types-only* (1s) sit between *Stated figures match the repository* and *Kernel coverage gate* (19s), exactly where `ci.yml` puts them; `Unit and tenancy tests` 17s with `load-manifest.test.ts (32 tests)` and `tenancy.test.ts (41 tests)` visible in the expanded log. (The viewer still does not render vitest's summary line; the per-file lines are what was read.) The same warning as every run: Node 20 actions forced onto Node 24 |
| **Session 6 close-out · `pnpm verify` on Windows — exit 0, the first time ever** | `0df4af5`, Node v24.19.0, pnpm 11.22.0, Docker Postgres 16 healthy. `_to_delete/verify-windows.log`: **`=== pnpm verify EXIT CODE 0 at 09/02/2026 4:38:54.90`**, 1 m 34 s, 50 files, 1,143 tests, 0 skipped, coverage 99.58 / 99.03 / 99.75 / 99.58 — the same four figures Linux and CI report. **F-37 closed on the machine that raised it; F-35 proven a third time on that machine.** Checkpoint A's Windows criterion is ticked on this run |
| **Session 6 close-out · F-37 raised, remedied, closed** | Raised by the second Windows run of the day (coverage exit 1, `packages/workflow/src/**` at 67.85%), reproduced in the container under Node 22 and Node 24 at 100 — OS-specific, not Node. Remedy (option 1, the recommended one): `tools/types-only.mjs` is the single list `vitest.config.ts` excludes and `check-types-only` reads; the checker maps each source to its emitted `dist/*.js`, strips comments, and refuses anything but `export {};`. **Planted-red proof against the real file**: a runtime export added to `assumptions.ts`, built, `check-types-only` red naming the file and the statement; removed, green. `selftest-types-only: PASS — 10 cases, real list reachable`. Wired self-test-first into `verify` and `ci.yml` (the CI step committed through the web editor — the workflow file is protected on the bridge) |
| **Session 6 close-out · R-07 closed, review 11 of 11** | The dissent recorded at the checkpoint was taken: `strOrNull` throws `'<field>' must be a string or empty` for a non-string that is not absent, null or blank; `constraints` goes through a new `numberRecord` that refuses arrays, non-objects and non-finite values with the entry named. **Test-first**: the two new tests were red — *"expected function to throw an error, but it didn't"*, 2 failed, 30 passed — then green at 32. `review-todo.md` L-3 and L-5 `[x]` with lineage; PR #16 merged on a green run |
| **Session 6 · branch · tip** | **`main` @ `e86d2bf`**, level with `origin/main`, clean tree — PR #10 (`7afdffc`, F-32 recovery + Phase 2 close + F-33), PR #11 (`1f3d6d5`, F-35), PR #12 (`e86d2bf`, CLAUDE.md + the `rms-engineer` agent) merged this session, each on four green checks read on the PR page; remote and local branches deleted only after each tip sha was found in `main`'s log. `rescue/f32-record` @ `97a54d9` kept, unmerged by design. **PR #13** (`89e55fa`, F-36) open, CI #49 Success 1m27s. Working branch for this update is `review/checkpoint-a`, off `89e55fa`. **Re-run `git rev-parse --short HEAD` rather than quoting from this document** |
| **Session 6 · Checkpoint A held** | Record in `tasks/todo.md`. Of its eight criteria: five met and evidenced, one met by mechanism only on the F-36 tree, **one red** (Windows verify — F-37), one waiting on EL. Nothing ticked that was not run. *(The first draft of this row wrote the count in digits and `check-scoreboard-sync` refused it as a second §15.2 figure — the gate reading prose it was not written for, and being right.)* |
| **Session 6 · `pnpm verify` on Windows — the first time** | `89e55fa`, Node v24.19.0, pnpm 11.22.0, Docker Postgres 16 healthy, `pnpm migrate` exit 0. **50 files, 1,143 tests, 0 skipped. `selftest-spot-check-draw: PASS — 48 draws agree` — F-35 proven on the machine it was found on.** Then `pnpm coverage` **exit 1**: `packages/workflow/src/**` at 67.85% because `assumptions.ts` and `finding.ts` (types only) count as 62 + 28 uncovered lines on Windows and 0/0 on Linux. Re-run in the container under Node 22 **and** Node 24: both 100. OS-specific. **F-37.** Run 1, three minutes earlier, is F-29 live: `migrate` raced the container, 92 tests skipped, `pnpm test` ticked green, `check-rls` refused |
| **Session 6 · the suite, fresh clone** | `git clone` of the public repository into the container, `pnpm install --frozen-lockfile`, native PostgreSQL 16 on 55432, 10 migrations. **`pnpm verify` exit 0 in 84 s — 50 files, 1,143 tests, 0 skipped, coverage 99.58 / 99.03 / 99.75 / 99.58.** 100 DB-backed tests executed across 7 files |
| **Session 6 · CI #48 read, not reported** | `main` @ `e86d2bf`, push, Success 1m40s; `verify` 1m22s. Job log opened in the browser: `Unit and tenancy tests` 14 s with `tenancy.test.ts (41) 436ms`, `submit-effects.db (12) 1408ms`, `auth.db (12) 198ms`, `part-registry.db (8) 279ms`, `chain.db (12) 226ms`, `outbox.db (8) 166ms`, `assumption.db (7) 216ms` — all `✓`. **Checkpoint A's "DB-backed tests green in CI" criterion is met by a read, for the first time** |
| **Session 6 · R-10 closed** | 39 commits of `0f1e7ac..0547c78` each checked out alone in a worktree, fresh database migrated at that commit, `pnpm typecheck && pnpm test`: **36 of 39 self-standing**, 0 skipped anywhere, tests 926 → 1,081 across the range. **3 fail `pnpm install --frozen-lockfile`** (`e3ef4fa`, `48c7654`, `5c3f17b` — the lockfile lagged `@rms/contracts` until `de399c7`); with `--no-frozen-lockfile` all three green at 1,081. `check-lockfile` (`6f05043`) guards exactly this. Table in `tasks/review-todo.md` |
| **Session 6 · R-09 closed** | Figures re-measured (1,143 / 50 / 0 skipped; 100 DB tests, 7 files listed); three breaks **chosen by the reviewer** planted and each gate red then green — `check-app-boundaries`, `check-language`, `check-lockfile`. Two first attempts landed **outside** the gates' stated scope and stayed green — correctly; both gates state that blind spot in their own headers |
| **Session 6 · R-08 closed** | Its one open line, `pnpm test packages/kernel-catalog` *"NOT RUN HERE"*, ran: 9 files, 200 tests, green in three runs |
| **Session 6 · R-07 run, dispositioned** | Malformed manifests fed through `loadReleaseManifest`: `approved_by: 42` → passes as `null` (L-3, pinned as deliberate; **dissent recorded** — the alternative is throwing, not "reading a number as a signature"); `constraints: {a: "x"}` → passes through (L-5; nothing reads `constraints` at runtime, measured); missing `datasets` → refused by `completenessRefusals`, both datasets named; `seed: "…"`, `digitised_by: 7`, lowercase status → throw, field named. L-2 and L-4 dispositioned (tool-side record; `check-content-hash`). **Not closed**: two criteria are `[~]` |
| **Session 6 · two writers, one tree** | At 09:23 UTC the earlier session (`session_01V1LYgX…`) was still working `C:\Rack Master\rack-master-studio` and committed `89e55fa` on top of this session's fast-forward. Found by GitHub Desktop showing a branch this session had not made; confirmed by the commit trailer. EL stopped it. **No work lost, and the reason is only luck**: the two sessions touched disjoint files. Hazard recorded under *Standing, every session* below |
| **Session 6 · deletion enabled on the mount** | `device_request_delete_permission` granted for the repo folder, so git can clear its own `index.lock`, `packed-refs.lock` and `tmp_obj_*`. The stranded-lock hazard is closed for sessions that ask; the bridge VM then failed to start mid-session (the desktop app was restarted), and the Windows verify was launched from Explorer under computer control instead |
| Branch · tip *(session 5)* | **`main` @ `3a3c917`**, PR #7, #8 and #9 merged, every task branch deleted. **Phase 2 is closed.** Working branch for this update is `docs/recover-f32-and-close-phase-2`. **Re-run `git rev-parse --short HEAD` rather than quoting from this document** |
| **F-32 answered, and the trigger was watched firing** | EL took option **(a)**: `push: branches: ['**']` plus a `concurrency` group with `cancel-in-progress`. The acceptance criterion was that somebody sees it fire, and somebody did — a throwaway `ci/trigger-probe` push produced **run 33601314332, event `push`**, on a branch with no PR. **That is the first branch push in this repository's history to be judged by CI.** Probe branch deleted afterwards |
| **F-32's remedy proven on real work, and the run was read** | The push of `docs/recover-f32-and-close-phase-2` produced **CI #38 — event `push`, Success, 1m07s** — on a branch with **no PR open**. Not a probe this time: a commit that mattered, judged when it landed. **And this session opened the run itself** rather than reporting that one exists. Drift 28 had two halves — a push that produced nothing, and a run nobody read. **Both are closed**, and the second only because the repository is public, which is what makes its runs readable from here at all |
| **F-33 closed — the register keeps its facts and stops overstating their source** | Both copies now credit **RMI (2024-07-10)** and the **ANSI webstore's revision history**, and say plainly that the IBC's referenced-standards lists **were not read and are paywalled**. The ANSI-blog contradiction — MH16.1-2023 *"is referenced by the IBC"*, no edition named — is recorded as a **second unresolved thread** against the Fresno position rather than resolved by preferring one source. **Not one figure changed:** the facts were right, only the provenance was wrong |
| **T-11 done, and the scanner proved to fire** | gitleaks **v8.30.1**, pinned by checksum `551f6fc…70eb`. A planted credential produced **run 33600804274 — `leaks found: 1`, step red at 16s, exit 1**; removed, **run 33600982861** green. Push protection was **already enabled** on the remote (`secret_scanning_push_protection: enabled`), so criterion 2 is satisfied by a recorded observation rather than a change |
| **T-12 done — and its facts hold** | The IBC/MH16.1 adoption chain is in the rules pack, the blueprint and §10.8. **Re-verified independently today**: RMI states the 2024 IBC adopted MH16.1-2021 and the 2021 IBC referenced MH16.1-2012; the ANSI webstore's Document History for MH16.1-2023 reads `Revises: ANSI MH16.1-2021`. **The attribution does not hold** — all three copies credit *"the IBC's own referenced-standards lists"*, which nobody read and which four routes could not reach. **F-33** |
| **A commit was lost, and is recovered** | `97a54d9` — F-32, drift 28 and 29, T-11's grown scope, the denominator move to 148 — **was never pushed.** The branch was deleted after PR #7 and the commit survived only as a dangling object awaiting `gc`. For two merges the repository contained **no F-32 at all**, while T-11 was implemented against it and shipped citing it. Recovered from the reflog; nothing lost. **F-34, and it is F-32 wearing different clothes:** the deletion was guarded by *"tip is an ancestor of `main`"*, which passed — because it asked about a ref that no longer pointed at the last commit. **A verification ran and answered a question adjacent to the one that mattered** |
| **Checkpoint A's Windows half was blocked and nobody knew** | `check:draw:selftest` loaded its built modules with `await import(join(DIST, '…js'))`. A bare `C:\…` path is not a valid ESM specifier — Node reads the drive letter as a URL scheme — so **`pnpm verify` has never completed on Windows.** Every green run in this repository's history is a Linux run that passed over a step that could not execute where Checkpoint A requires it. Fix written (`pathToFileURL`, all three call sites) and **deliberately left uncommitted**: it is a code change and wants its own commit and its own proof, which is the Windows run Checkpoint A needs anyway. **F-35** |
| **T-10b, container-verified** | Three gates, not two. `check-claims` re-derives seven declared figures from the working tree; `check-scoreboard-sync` now reads the measure cards (drift 18); **F-31 closed inside `check-rls`**, which is checker work and belonged with the checker task. `pnpm verify` **exit 0 in 57 s**, 50 files, 1,143 tests. Both new gates wired self-test-first into `verify` and `ci.yml` |
| **`check-claims` found a live defect on its first run** | Before it was wired into anything: *"progress.md · test files: states 47, the code says 50."* Both copies had published **47** through T-08 and T-09 with `check-scoreboard-sync` **green over it the whole time** — because the two copies agreed *with each other*. **Sync and truth are different properties, and only one of them had a gate.** Drift item 25 |
| **A pattern that matches nothing is a FAILURE** | Not "nothing to check". Reword the sentence a claim lives in and the build goes red rather than silently dropping the claim. Zero matches, more than one match, a missing derivation, an unreadable file and a vacuous `checked === 0` pass are all refusals; `selftest-claims` plants all five plus the agreeing case, in a temp tree per T-28 |
| **Widening a checker turned its own self-test red — the ordering working** | `selftest-scoreboard-sync`'s honest-pair fixture had no measure cards, so `verify` stopped there before reaching the checker. Fixing it surfaced a second real blind spot: **§15.2 is stated three times in `progress.html` and four times in `progress.md`, and only the FIRST was compared** — three of four could be edited with nothing going red. A file must now agree with itself before the two are compared. **Drift 18's shape, one level down** |
| **F-31, proven against the live database in both directions** | `REVOKE SELECT ON app.part` → **red**, *"every policy on it is decorative"*; `GRANT UPDATE ON app.audit_event` → **red**, *"EXEMPTIONS says this table deliberately does not allow it"*; restored → **green**, 82 grants = 21 tables × 4 − the audit table's 2. One exemption table governs both axes, because two lists can disagree. **And the self-test proven against a broken checker**: neutering the missing-privilege branch turned `selftest-rls` red on 2 of 13, naming both |
| **T-10a, container-verified** | The four documents reconciled — and the task turned out to be **one editorial rule** rather than four corrections: *a dated observation keeps its number and says its date; a present-tense assertion about the product is re-derived or removed.* Rewriting a dated measurement to match today falsifies the record. Two of the four were **already correct** (`TODO.md` RH-05, verified figure by figure against the manifests; `LATEST.md`'s 336-vs-378, fixed in session 3), and `TODO.md` needed no banner because every figure in it is already dated inline |
| **The blueprint disagreed with itself** | Its footer read **Rev A** while the masthead and §1 read **Rev C**, *and* it said *"no production implementation has begun and none should begin before the blocking decisions in §18 are answered"* — which **§18 contradicts four screens above**, recording the decision set as closed, and which 10 migrations contradict outright. **A governing document that disagrees with itself cannot govern.** Corrected to the masthead and §18, with the correction stated rather than made silently; `python src/build.py` and `src/verify.py` clean, 11 structural checks passing |
| **T-09, container-verified** | Migration **0010**: `part` / `part_revision`, the `bom_line` foreign key, staff-only RLS. **The identity is `code_18`, not `part_number`, and it was measured before anything was written** — `part_number` is not unique in either release (`UM005516` on two rows, `UM005517` on two more, in both 2026-08 and 2026-09), so a registry keyed on it would have refused to load the approved catalog. **Two tables, evidenced:** all 336 codes in 2026-09 exist in 2026-08 and **288 of them changed value between the releases** — one part, two revisions, which is why a BOM line references the revision (§10.2) |
| **T-09's controls, proven to fire** | FK dropped → **1 red**; RLS SELECT widened to `true` → **2 red**; restored → 8 pass. The FK re-add then **failed**, because the breakage had left an orphan `bom_line` — exactly what 0010's header predicts and refuses to paper over with `NOT VALID`. **The FK also turned four EXISTING tests red on landing:** `tenancy.test.ts` was inserting `part_revision_id` values from `gen_random_uuid()`, references to nothing. That is the evidence for D-10, not a nuisance; the fixtures were repointed and the constraint was not relaxed |
| **T-08, container-verified** | The three server authorities moved to `packages/workflow`, **byte-identical: 4,252 bytes on both sides**, compared programmatically. Both deliberate breakages still fire at the new location — waivers carried over **1 red**, internal items kept **3 red**, reverted 12 pass. Criterion 1's *"effects supplied by `apps/api`"* is recorded rather than faked: **there are none**, because all three are pure constructors, and a `DeriveEffects` with nothing behind it is the exact defect shape this project hunts |
| **F-27 closed, and T-27's gate is what caught it** | Written test-first: two cases using the bare shapes went in **before** the fix — `tsc -p tsconfig.tests.json` **exit 2**, four errors; after, **exit 0**. The remedy was *not* the `boolean \| undefined` first proposed, which fixes one shape and not the other; a constraint with every property optional stays a **weak type**. It is `T extends object` with an `in` narrowing. **Re-proven against the rewritten implementation** — internal-items-kept now goes **4 red**, up from 3: the control got stronger |
| **CI on the tip — the honest state** | Both pushes were single-shot: no re-pushes, no batching, and the *"push each task's commit as it lands"* remedy applied for the first time. T-07 and T-27 are now on `main` and CI-covered. **T-28 is one commit, unpushed** — which is the rule working, not failing: the gap is one task deep by design, where it once reached eight commits |
| **The suite, run today** | **`pnpm verify` exit 0 in 57 s** — **50 test files, 1,143 tests, 0 skipped**, coverage **99.58%** — against a **native PostgreSQL 16.13** with all 10 migrations applied, in a Linux container rebuilt from this working tree. A **baseline was measured first, before any change: 83 s, exit 0**, so T-27's 82 s is a comparison and not an assertion. This upgrades session 4's headline figure from a repository claim to a **session-5 measurement** |
| **T-27, container-verified** | `tsconfig.tests.json` type-checks all 47 test files; `"typecheck"` is now `tsc --build && tsc -p tsconfig.tests.json`, so CI picks it up with no `ci.yml` change. **Proven to fire against the real T-04 shape** — required field added *and* the source updated, leaving the fixture the only stale thing: `tsc --build` **exit 0**, `tsc -p tsconfig.tests.json` **exit 2** at `release.test.ts(77,3)`. Reverted, both green |
| **T-28, and criterion 3 proven on the real thing** | The four checkers take an optional `root`; the four self-tests build their probes with `mkdtempSync` under `os.tmpdir()`. **Run from the bridge mount, where `rm` is genuinely refused** (`Operation not permitted`, confirmed first): all four self-tests **pass twice in succession with no cleanup between**, the four checkers pass immediately after, and `find . -name '*probe*'` returns nothing. Also run twice in the container with a before/after `md5sum` over `packages apps tools fixtures` — **identical** |
| **T-28's blind spot, closed in the same change** | A temp-tree self-test can no longer notice a checker that has lost its grip on the real repository — rename `packages/` and every probe still passes while the real scan matches nothing. Three of the four now assert, read-only, that the checker still finds a non-empty scan in the actual tree. The fourth needed no addition: `selftest-language`'s baseline already runs against the real tree |
| **What T-27 found** | 14 errors in 47 files never type-checked before. One was real: **F-26** — the determinism corpus digested the literal string `undefined\|undefined\|3812\|2451100\|3175`, because `convert()` returns a `number` and the case read `.value` off it. **Confirmed at runtime before anything was changed.** `check:determinism` would not have gone red if `convert()` had started returning a different number. Fixed; the `units` pin re-based with `--update`, and only that line moved |
| **CI on the tip — the sentence this file had wrong for three sessions** | **There was no run to read.** Every previous version of this row said *"pushed, result not yet read — and those are different things"*, which is true but describes the wrong gap: `ci.yml` fires on `push: branches: [main]`, `pull_request` and a nightly schedule, so **pushing a task branch creates nothing for CI to judge**. `be78f19` has zero check-runs, established by EL three independent ways and re-derived from the workflow file here. Session 4's remedy *"push each task's commit as it lands"* has been applied, recorded and measured across three sessions while buying **no coverage at all** — **F-32**, and the same shape as F-01/F-02/F-08/F-11/F-19/F-26/F-31, one layer up in the practice rather than the code |
| **What did cover the work: PR #7, and it is green** | Head `b5850fb`, all 12 commits — `verify` **1m30s** (typecheck, lint, migrations, unit and tenancy tests, every checker with its self-test, the kernel coverage gate, the performance budgets) plus `docs` **7s**, with only the known Node 20 deprecation annotations. **Reported by EL from the run itself; this session did not open it**, which is a stronger source than a repository claim and still not a measurement taken here. **This satisfies the CI half of Checkpoint A** for T-08, T-09, T-10a and T-10b; the Windows half is untouched |
| Re-run from the bridge today | `node tools/check-scoreboard-sync.mjs` → **PASS**; `node tools/selftest-scoreboard-sync.mjs` → **PASS** (both pure node, no dependencies, and the self-test writes nothing into the working tree). These are the only two gates this shell can execute — and the first one passed *while the two files it compares disagreed*, which is drift 18 |
| The ahead/unpushed pair moves as this file is written | Each documentation commit that records this measurement adds one to both counts, so **do not quote ahead/unpushed from this document** — re-run `git rev-list --left-right --count origin/main...HEAD` and `git rev-list --count @{u}..HEAD`. Session 3 added `e488a14`, `c08cca3` and the commit carrying this row. That self-reference is exactly how drift item 5 arose, and naming it is cheaper than chasing it |
| `main` | in sync with `origin/main` @ **`0bb5383`** — re-derived today in a fresh clone, clean tree, `git log --oneline @{u}..` empty. `origin/task/t-13c-input-dtos` and `origin/task/t-13d-idempotency` still exist and are both **0 ahead** of `main`; they are merged and can be deleted. *(This row read `162d26e` / "PR #1 … #19" through two merges and two pushes — drift 42.)* Earlier state kept for the lineage: PR #1 … #19 merged, every task branch deleted, `git branch -r` listed `origin/main` alone *(this row read `e86d2bf` / "PR #13 open" through the close-out edition while the tip row above it said `b8d2087` — drift 36's shape, fixed here)* |
| Packages | **12** — `packages/workflow` added by T-07 |
| Test files | **59** (`*.test.ts`) — T-13c added `request.test.ts`; T-13d added `idempotency.test.ts` and `idempotency.db.test.ts`; **T-14a added `app.test.ts`, `app.db.test.ts` and `server.db.test.ts`**. Re-derived by `check:claims`, not typed |
| Phase-2 routes | **1** — `GET /api/internal/v1/audit`, held in `PHASE_2_ROUTES`. §8.2's other phase-2 row, `POST /api/internal/v1/submissions/:id/status`, has no `Action` yet and arrives with the status vocabulary F-38 is about. A third §8.2 row *mentions* phase 2 and stays MVP-1 — `GET /api/client/v1/submissions/:id` defers the RFI **thread**, not the route — which is now declared data in `SUB_FEATURE_PHASE_2` with a stale-entry check, instead of an interpretation living in three documents and enforced by none |
| Migrations | **13** (`0001`–`0013`) — `0013_idempotency_lease_epoch.sql` adds the fence token without which the lease let two effects settle one key (F-40); `0012` added the `abandoned` outcome and the lease index; `0011_idempotency.sql` added `app.idempotency_key`: `UNIQUE (organization_id, key)`, a 64-hex `request_hash` CHECK, three states in `app.idempotency_outcome`, five consistency CHECKs, tenant RLS and the F-31 explicit GRANT. `check-rls` inspected **22** tables and **86** grants today and passed |
| `.tsx` / `.jsx` / `.vue` / `.svelte` / `.astro` files | **0** |
| Server entry point | **exists, as of T-14a** — `apps/api/src/app.ts` builds a **Fastify** instance (`createApp`) and `apps/api/src/server.ts` calls `app.listen({ port, host: '127.0.0.1' })`. Re-derived today by the same grep that returned nothing for five sessions. **This row read "none" for a full edition after T-14a landed — drift 41.** What has *not* changed: all 22 handlers are placeholders that answer 500, declared as data in `UNIMPLEMENTED`, so the row below about §15.2 is unaffected |
| Front-end dependency | **none** — no `react`, no `vite` in any `package.json` |
| Route table | **22 entries** in `apps/api/src/authz/routes.ts` — **12 client, 9 internal, 1 public.** All 22 are §8.2 MVP-1 rows: the two T-14a added, plus EL's operator release, which §8.2 now carries after his amendment. `PENDING_AMENDMENT` is **empty**, which is the healthy state. Re-derived today with the checker's own parser, not by eye: `blueprintRoutes()` finds **24** rows in §8.2, **2** of them flagged phase 2 (`POST /api/internal/v1/submissions/:id/status`, `GET /api/internal/v1/audit`), leaving an MVP-1 surface of **22** — and `ROUTES` declares exactly those 22. **22 of 22.** `createApp` mounts all 22 and `routerCoverageProblems` refuses to boot on any disagreement in either direction, so the registry now has a consumer that is not a barrel re-export. **This cell simultaneously said "22 of 22" and "19 of 21", and its last three sentences described the pre-T-14a world — drift 40** |
| `apps/api/src/index.ts` | Its own header calls it "The HTTP layer". It is a barrel of **15** re-export blocks (8 until T-13b) and **no HTTP**. Not filed as drift — the file says "and (later) authorization and DTOs" — but it is the sentence a future reader will misread as a server |
| Git tags · `CHANGELOG.md` · Dependabot | none · none · none, all re-checked today. `version` is `0.0.0`. Expected — `CHANGELOG.md` is T-26's, unstarted — but the house rule is to write the entry **in the commit that makes the change**, and 4 commits have landed since that rule was written down |
| CI gates present | typecheck, lint, migrate, test, **16** self-tested checkers — re-derived today, and by set difference against `verify` rather than by counting twice (the fourteenth, `check-server-owned`, landed with F-32's remedy; the fifteenth, `check-route-surface`, with the §8.2 amendment; the **sixteenth, `check-front-end-budgets`, with P-05's agreed budgets**; the thirteenth, `check-types-only`, with F-37) — coverage, bench, docs rebuild + `git diff --exit-code`. **Secret scanning (gitleaks, checksum-pinned) is present too and this row omitted it.** Two landed today: `check-content-hash` (recomputes each release's `content_sha256` by the method that manifest declares) and `check-spot-check-record` (asserts every signed spot-check covers the draw that was pinned before it) |
| CI gates absent | dependency audit, bundle-size ceiling, E2E. **Secret scanning is present and this row said it was absent — drift 46.** `ci.yml` has run a checksum-pinned `gitleaks v8.30.1` over the working tree since T-11 (D-20 / NFR-SEC-06), verified today by reading the workflow file; the row has understated the build's own gates for five sessions and no gate could catch it, because `check-claims` reads seven figures from this file and none of them is a list |

### Not verified today — the repository's own figures

A task completed in an earlier session and not re-run today is a **repository claim**, however
confident that session was. Three figures sit here for session 5, all with the same reason.

- ~~**"47 files, 1,126 tests, 0 skipped; `pnpm verify` exit 0."**~~ **Measured this session — moved to
  *Verified today*.** It was session 4's claim until the repository was rebuilt in a Linux container
  with a native PostgreSQL 16.13. The constraint that made it a claim is unchanged and still true of
  EL's own tree: win32 binaries against a Linux bridge shell with no `pnpm` and no `psql`. What
  changed is that the container is a third place to run it, needing neither Windows nor a push.
  Historical: `LATEST.md`'s "1,042" was replaced in session 3 and was low.
- ~~**Windows.** Nothing here has been run on Windows this session.~~ **Run in session 6 — moved to
  *Verified today*.** `pnpm verify` executed on Windows for the first time: green through
  `check:claims`, red at coverage (F-37). Checkpoint A's Windows criterion was therefore measured and
  **not met**, which is a different state from unmeasured — and then, after F-37's remedy, **run
  again at `0df4af5` to exit 0**, so the criterion is met on a run. The CI half is met by a read of
  CI #48's job log, and again by CI #64's.
- **"CI green."** True of `efbafbd`, false of `HEAD` — see drift 16. Run #10's `verify` log lists
  Postgres containers, migrations, the tenancy tests and the RLS coverage assertion all green, each
  checker behind its own self-test; it reports a green *job*, not a count this session read, and it
  reports it about a commit that is no longer the tip. Historical note, because it was the point of
  the entry: three same-day documents once disagreed — `review-findings` (07:31) said CI had *never*
  run; `catalog-release-approved` (09:21) said green on the previous head; `state-of-the-build`
  (10:12) said PR #1 green.
- **T-01…T-04 complete (Phase 1, 10 points).** Verified at `a2f166e` in an earlier session and not
  re-run since. Counted, and labelled.
- **Pushing still requires Windows.** The bridge shell holds no git credentials — re-confirmed today
  by `git remote -v` resolving while no push path exists. GitHub Desktop's *Push origin* is the route
  that works, after adding `C:\Rack Master\rack-master-studio` to it (its existing `Master-Rack`
  entry points at a second, near-empty clone at `C:\Rack Master\Master-Rack`, not at this tree).

### Drift found while measuring

Session 2 found four. Session 3 re-measured them, **fixed nine and reclassified one**. Four of the
nine were found only by reading R-11's own acceptance criteria rather than the scoreboard's drift
list — including one this scoreboard published about itself. **Session 4 found four more, items 11
to 14**; item 11 is again this file describing itself wrongly, and 13 and 14 are stale figures inside
a task's own verification line — found only because the line was actually re-run.

**Session 5 found fifteen, items 15 to 29, and every one of them is inside the scoreboard itself
or in the practice that maintains it.** Session 6 found eight, items 30 to 37 — two stale
figures inside this file, one honest sentence that reads as more than it is, at the close-out a
stale branch name in the plan, a Windows tree two merges behind, and **the published page carrying
drift 30 a full edition after this file fixed it** (item 35); and at the third edition a test count
in T-13b's own DONE block that the commit carrying it contradicts (item 36) and a caveat heading
still quoting a percentage two editions old (item 37). This is the cleanest measurement the project has of how fast
its own documentation goes stale: **fifteen false statements across the four copies in under a day.**

Three matter most, and they are three different failures of the same kind. **Item 18** — the gate
whose entire job is keeping the two repo copies in agreement was passing while they disagreed on a
published percentage. **Item 23** — the two copies CI cannot reach were never updated when T-07
landed, so the four copies sat in **three different states** and the only gate that runs saw none of
it. And **item 28**, which is the largest thing this project has found about itself: the sentence
*"CI green over them the whole time"*, written in this very paragraph in earlier versions, **was
describing runs that did not exist**. A branch push triggers nothing. Every session that recorded a
push as a verification event was recording nothing at all.

**Note what caught each.** Items 15–23 were caught by re-measuring. Items 24–27 were caught by
machinery built in T-10b. Item 28 was caught by **EL asking for the run and finding no run** — the
one question none of the automation asks, and none of it could have. Item 29 was caught by the
denominator moving, which is the only reason anyone looked at that table twice.

| # | Item | Status |
|---|---|---|
| 1 | `tasks/todo.md` checkboxes for T-01…T-04 unchecked though the file's own header says those tasks are complete | **Fixed** — 20 boxes ticked |
| 2 | `tasks/plan.md` lists **Q1** (frontend framework) as open; AD-6 closed it — Vite + React Router v7. **Q7** (git remote) likewise | **Fixed** — and session 2's list was itself incomplete: **Q5** (who performs the catalog spot-check) was also still listed as open, and is answered. Three struck, not two |
| 3 | Project doc `state-of-the-build-2026-09-01.md` names the branch **`feat/contracts`**; no such branch exists | **Fixed** in the project doc |
| 4 | `tasks/todo.md` T-14 says **23 §8.2 routes**; the route table carries **20** | **Reclassified — see below** |
| 5 | *(new)* This scoreboard's own tip figures — `6f05043`, 27 ahead, 1 unpushed — were stale on the day they were written | **Fixed** — `ff63b87`, 30 ahead, 4 unpushed |
| 7 | *(new, R-11)* `tasks/plan.md`'s verification table — 855 tests / 33 files, `check-boundaries` 33 files / 9 packages, `lint-provenance` 89 files, `check-language` 60 files, "42 commits, `main`, no remote" | **Fixed** — re-measured to 44 test files, 41/10, 102, 68, and the branch with a live remote. Both "not run" rows now run in CI |
| 8 | *(new, R-11)* `LATEST.md`'s **70% blueprint conformance** stood beside the scoreboard's percentage with nothing saying they are different denominators | **Fixed** — reconciliation note added in `LATEST.md` itself, where the figure is read |
| 9 | *(new, R-11)* `TODO.md` RH-05 — "two packs sit in DRAFT … the Interlake catalog (378 rows)" | **Fixed** — the catalog is `APPROVED`, **336** rows; the rule pack `mvp-2026-08` is the half still `DRAFT`, with an empty `approved_by` and six recorded open conflicts |
| 10 | *(new, self-inflicted)* This scoreboard claimed **"R-11 is closed, review 9 of 11"** before R-11's criteria had been read | **Fixed** — corrected in all four copies. The claim was published to every copy before it was checked, which is the defect R-11 exists to catch, committed while closing R-11 |
| 11 | *(new, session 4)* This scoreboard published **Phase 2 as `0 / 26`** with **T-05 already merged into `main`** — a completed task the arithmetic never counted | **Fixed** — Phase 2 is 6 of 26, the total 25 of 145. Found by re-measuring, not by re-reading: the sentence saying T-05 was done and the table saying Phase 2 was zero sat four screens apart in the same file |
| 12 | *(new, session 4)* `tasks/todo.md` T-09 reserved migration **`0009`**; T-06 needed a migration first and took that number | **Fixed** — T-09's acceptance criterion and Files line now say `0010`. Migrations apply in filename order, and T-09 comes after T-06 in the dependency order the plan itself sets |
| 13 | *(new, session 4)* T-07's verification line says `check-boundaries` should report **10 pure packages** | **Corrected** — it reports **11**. The line was written before `packages/contracts` existed; 10 was the pre-task figure, re-measured at `HEAD` to confirm, and a correct T-07 necessarily produces 11 |
| 14 | *(new, session 4)* T-07's acceptance criterion says **"the existing 22 submit tests"** | **Corrected** — the file holds **37**. T-05 and T-06 grew it and the figure was never updated. The substance of the criterion — moved unchanged, still green — is met: the test file is byte-identical to its previous location |
| 6 | *(new)* T-04's `DONE` block sat **below** the `## Phase 2` heading, and still said `interlake-2026-09` was back to DRAFT with nothing pinnable — superseded the same day by `eaeb8f0` / `a2f166e` | **Fixed** — moved under T-04, and the re-approval verified against the manifest on disk |

| 15 | *(new, session 5)* This scoreboard's header said it was measured on `task/t-06-acknowledgement` off `main` @ `e08a3ac`, while its own *Verified today* table said `task/t-07-workflow-package` off `98b0229` | **Fixed** — header re-derived from `git rev-parse`. **Third occurrence** of this file describing itself wrongly (5, 11, 15). The two statements were written at different moments and only one was re-run; the header is now written *from* the measurement rather than beside it |
| 16 | *(new, session 5)* Both copies assert **CI covers the tip** — `progress.md` "CI on the tip: Run #10, Success", `progress.html` masthead "tip `efbafbd` · pushed · CI run #10 green" | **Fixed, and the gap is reopened.** `HEAD` is `e88320f` with **no upstream**, never pushed; run #10 covered `efbafbd`. The CI/CD lens had already declared "the tip is unverified" **closed** and written the remedy — *"push each task's commit as it lands"* — in the same bullet. It reopened on the very next commit. A remedy written down is not a remedy applied |
| 17 | *(new, session 5)* `progress.md`: "Session 4 earned **six points**… T-05 (S = 2), T-06 (M = 4) and T-07 (M = 4), taking 19 to 29" | **Fixed — ten.** The sentence contradicted both its own list (2 + 4 + 4) and its own arithmetic (29 − 19) in the same line. `progress.html` said *ten* and was right; nothing compared the two |
| 18 | *(new, session 5)* **`progress.html` published "Plan executed · task count **14%** — 7 of 44"; `progress.md` published "10 of 44 — 23%". `pnpm check:scoreboard` was green.** And 14% is not even 7/44 (16%) — it is 6/43, a figure two generations old | **Fixed — 23%, 10 of 44, in both.** The gate parses `class="pct">done / points<` and the "N of 8" headline **and nothing else**; the measure cards are outside its reach. Its docstring says so honestly, which is why this is a **scope** finding, not a lie: the checker's name is wider than its mechanism. **This is F-08's shape at the documentation layer** — the control existed, ran, and passed over the thing it is named for. Widening it is `T-10` work: parse the measure cards too |
| 19 | *(new, session 5)* `progress.md` heading "Caveat that cuts against the **13.1%**" and its closing line "**13.1%** is an overstatement" | **Fixed — 20.0%.** Session 4 updated the number everywhere it was computed and nowhere it was discussed |
| 20 | *(new, session 5)* Both copies' Method paragraph: "the **36** `T-…` tasks … are inside **the 35**, not additions to it" | **Fixed — 36.** Counted today: T-00…T-12 (13) + T-13a–d (4) + T-14/T-15 (2) + T-16/T-17 (2) + T-18a–e (5) + T-19…T-28 (10) |
| 21 | *(new, session 5)* Both copies' git lens still instruct "**Merge the branch** — 30 commits, well past short-lived" | **Fixed** — PR #1 merged at `dab5a8e` in session 3, PR #2 and #3 since. The instruction outlived the branch it was about |
| 22 | *(new, session 5)* `progress.html` masthead dated "2026-09-01 · **session 3**"; its own footer dated the same page "2026-09-01 (**session 4**)" | **Fixed** — one page, two dates, neither re-derived |

| 23 | *(new, session 5)* **The published artifact and the Claude Project doc both still read `17.2%` — 25 of 145, 9 of 44, Phase 2 at `6 / 26`** | **Fixed — both republished.** Neither was updated when T-07 landed; the repo files moved to 29/145 in `e88320f` and the two copies CI cannot reach did not. Cadence steps 6 and 7 exist precisely because CI cannot catch this, and they were not executed. **Four copies were in three different states**, and the only gate that runs saw none of it |
| 24 | *(new, session 5)* The **sensitivity table's own rows disagreed about how much was done** — row 1 computed on the numerator 41, rows 2–5 still on session 4's 29 | **Fixed — all five rows are now 45 over their own denominator.** The table exists to show that a *done* figure is stable while the denominator is not, and four of its five rows were quietly asserting a different done figure. Found by re-deriving each cell rather than reading the column |
| 25 | *(new, session 5)* Both copies published **`47 test files`** while the tree held **50** | **Fixed — 50, and now gated.** Stale through T-08 and T-09 with `check-scoreboard-sync` **green over it the whole time**, because the two copies agreed *with each other*. Found by `check-claims` on its first run, before it was wired into anything. **Sync and truth are different properties and only one had a gate** — see T-10b |
| 26 | *(new, session 5)* **This file's own header** named `task/t-07-workflow-package` @ `e88320f` and `main` @ `98b0229`, while its *Verified today* table four screens below named a different branch and a `main` three merges newer | **Fixed — re-derived from the working tree.** The **fourth** time this file has described itself wrongly (items 5, 11, 15, 26), and the second time in one session. `check-scoreboard-sync` cannot catch it: both copies carry the same wrong header, and agreeing is all that gate asks of them |
| 27 | *(new, session 5)* `progress.md`'s Method said **37** `T-…` tasks in one sentence and *"inside the **36**"* in the next; the Claude Project doc said both, and also *"Counted today: 13 + 4 + 2 + 2 + 5 + 10 = 36"* | **Fixed — 37 throughout**, and the arithmetic re-derived: T-00…T-12 is **14** once T-10 is two tasks, so 14 + 4 + 2 + 2 + 5 + 10 = **37**. Drift 20 fixed this same sentence to 36 in this session; the T-10 split moved it again the same day and only one of the two halves was updated. **`progress.html` was already correct**, which is the point of item 27: `check-scoreboard-sync` compares numbers, not prose, and says so |
| 28 | *(new, session 5 — **found by EL, and the most consequential of the twenty-nine**)* All four copies said of a pushed branch *"pushed, result not yet read"* / *"pushed is not green"*, which asserts a run exists | **Fixed — no run existed.** `ci.yml` fires on `push: branches: [main]`, `pull_request` and a nightly schedule; a task-branch push matches none. `be78f19` has **zero** check-runs. **Session 4's remedy — *push each task's commit as it lands* — has been applied, recorded and measured for three sessions while buying no coverage at all.** Filed as **F-32**, owner T-11. The wording is corrected in all four copies; the workflow is not changed here, because that is a deliberate CI decision and EL's |
| 30 | *(new, session 6)* The *"Where the remaining points sit"* paragraph said **116** remaining with **Phase 2's residue 16** while the phase table three screens above said **100** and Phase 2 complete | **Fixed — 96, Phase 2's residue 0, re-derived.** Two figures in one file for the same quantity, one updated per session and one not. `check-scoreboard-sync` compares the phase bars and the measure cards, not this paragraph |
| 31 | *(new, session 6)* The headline's review row counted **R-08 as done** ("Done: R-01…R-06, R-08, R-11") while the phase table's Phase 3 row listed **R-08 as open** and excluded its 2 points | **Fixed — both say done, and it is:** R-08's one unticked line (`pnpm test packages/kernel-catalog`, "NOT RUN HERE") was run this session. Until then the review row was overstating and the phase row was right; binary completion means the file should have said *open* in both places |
| 32 | *(new, session 6)* Every DONE block, this file's header and the session-5 rows say **"`pnpm verify` … 0 skipped"** as if the count were a property of the code | **Not a false statement, and recorded so it stops being read as one.** The Windows run showed the same commit report **1,051 passed, 92 skipped** with a green `pnpm test` when the database was not yet up. A skip count is a property of the *run*, and F-29's `RMS_REQUIRE_DB=1` remedy is still unowned |
| 33 | *(new, session 6 close-out)* `tasks/todo.md`'s Checkpoint A review line said R-07's fix was *"on `review/r-07-load-manifest`"* — a branch that no longer existed once PR #16 merged and its remote was deleted — and this file's review row still read **10 of 11** while `tasks/review-todo.md` had said **11 of 11** since the same merge | **Fixed — "PR #16, merged" in the plan, 11 of 11 here.** The same shape as items 5, 11, 15 and 26: a present-tense sentence written at the moment of the commit, true for the twenty minutes until the branch was merged, and nothing to re-derive it. `check-claims` counts figures it was told to; a review count and a branch name are not among them |
| 34 | *(new, session 6 close-out)* The Windows working tree sat on `review/r-07-load-manifest` @ `6696f5f` with its local `main` at `9296ce1`, two merges behind `origin/main`, while this file's tip row described the container's `main` | **Fixed — switched to `main` and pulled to `b8d2087` as part of this update.** Not a false statement in the file, since the row names the container; recorded because two trees of the same repository at different commits is how a second writer (the *two writers, one tree* row above) goes unnoticed, and because the next Windows verify would have run on the wrong tree |
| 35 | *(new, session 6 close-out)* `progress.html` still read **"48 done points"** in its sensitivity header, **"100 points remain … Phase 3 (34)"** under the phase table, **"remaining 116 … Phase 2's residue 16"** under the sensitivity table, and its drift table ended at item 29 — three different remainders on one page | **Fixed — 52, 96, 96, rows 30–35 added.** Drift 30 was fixed in this file at the checkpoint edition and the page was republished without it; `check-scoreboard-sync` was green over the whole thing because the header and the paragraph are prose outside the figures it compares. **The fifth time a fix landed in one copy of two** (items 19, 23, 27, 30, and this). The check that would catch it is the cadence's step 7 — read the page, not the gate — and it was not executed |
| 36 | *(new, session 6, third edition)* `tasks/todo.md`'s T-13b DONE block said **"53 files, 1,232 tests, 0 skipped"** while the commit that carries it (`d6b423d`) says **1,238** in its own body, and today's run says 1,238 | **Fixed — 1,238 in the plan.** The block was written after the second review round and before the last coverage-driven tests went in, and nothing re-derived it: `check-claims` reads seven figures from `progress.md` and none from `todo.md`. Items 13 and 14's shape — a stale figure inside a task's own verification line — a third time. Also fixed in the same commit: this file's `main` row, which read `e86d2bf` / "PR #13 open" two editions after the tip row above it moved |
| 37 | *(new, session 6, third edition)* The *Caveat that cuts against …* heading and its closing sentence read **32.4%** through the checkpoint and close-out editions in which the published figure was **35.1%**, and its "T-14 … 5.6% of the project" was 8 over the **143**-point denominator of session 3. **`progress.html` was staler still**: its same paragraph read *"Why **20.0%** is an overstatement … larger than **143**"* — a figure three sessions old | **Fixed — 37.8% and 5.4% over 148, in both copies.** Drift 19 fixed this exact heading once (13.1% → 20.0%) and it went stale again the next session, because it is prose: two editions rewrote the figure everywhere the sync gate looks and nowhere it does not. Item 30's shape, one section up. `check-scoreboard-sync` compares the phase bars, the measure cards and the §15.2 statements — a percentage quoted inside a heading is outside its reach, and it was green over both copies the whole time. Same fix, same commit: the *Update cadence* step 2 said "over the **143**-point denominator" here and "**145**" on the page — the instruction for re-deriving the figure was itself carrying two stale ones |
| 38 | *(new, session 7 — mine)* Both copies published **"14 self-tested checkers in CI"** the moment `check-server-owned` landed | It was added to `package.json`'s `verify` chain and **not** to `.github/workflows/ci.yml`, which lists every checker as its own step and never runs `verify`. **CI #80 was green over T-13c without executing the checker once** — `check-server-owned` occurs zero times in the 1,433-line raw log. The change that added a control to catch controls-with-no-mechanism shipped exactly that, and nothing in the repository could have caught it: `check-claims` reads seven figures from `progress.md` and none from `ci.yml`, and a checker absent from CI cannot fail there. Found only by reading the run instead of ticking it | **Fixed and proven — CI #81 shows both steps executing and passing; the count is 14 in CI, measured** |
| 39 | *(session 9, and **still present today** — this is the item's second life)* **T-14a landed at `466c9b2` and no copy of the scoreboard counted it.** Four points low for a full edition **while both gates stayed green** | **Fixed here — 62 → 66, 38.8% → 41.3%.** `check-claims` re-derives files, migrations, packages and route counts, all of which T-14a updated correctly; `check-scoreboard-sync` compares the two copies, which agreed. **A done-task count has no mechanism behind it** — that is the gap, and it is unowned. Session 9 wrote this fix and it never reached the repository; measured again today at `0bb5383` and still four points low |
| 40 | *(session 9, still present today)* The Route-surface cell asserted **"22 of 22"** and **"19 of 21"** in the same cell, and its closing sentences described the pre-T-14a registry in the present tense | **Fixed here**, in both copies, and re-derived with `blueprintRoutes()` rather than by eye: §8.2 **24** rows, **2** phase-2, surface **22**, registry **22** |
| 41 | *(session 9, still present today)* *"Server entry point: **none** — no `fastify` … `.listen(` anywhere"*, published after T-14a added exactly those | **Fixed here. The most load-bearing false row this file has carried**: *"there is still no server"* was the project's honest one-line summary for five sessions, and it went on being published for two more after it stopped being true |
| 42 | *(session 9, still present today)* The `main` row described a remote two merges and two pushes old (`162d26e`, "PR #1 … #19") | **Fixed here — `0bb5383`, re-derived in a fresh clone.** Items 5, 11, 15, 26, 36's shape a sixth time: a present-tense sentence about a moving ref, written once |
| 43 | *(session 9, still present today)* `tasks/todo.md` records neither **T-13d** nor **T-14a** as complete, and has **no landing block at all** for T-14a | **Fixed here.** *A task can be complete in the code, counted on the scoreboard, and open in the plan at the same time* — and nothing in `verify` compares the plan to either |
| 44 | *(session 9, still present today)* `progress.html`'s route card said §8.2 lists **23** rows; `progress.md` said **24** | **Fixed here — 24, derived.** `check-scoreboard-sync` compares the phase bars, the measure cards and the §15.2 statements; a count inside card prose is outside its reach |
| 45 | *(session 9, still present today)* `claude-resume-prompt.md` still published **session 3's** figures (19 of 143, 7 of 43, review 8 of 11, route surface 19 of 21, tip `efbafbd`) and a *"what to do next"* opening with *push the tip, R-10, R-08, merge PR #1* — all finished 2026-09-01 | **Fixed here.** **The first drift item with a measured consequence, and it has now been measured twice**: it is the file the project instructions tell a cold session to read first, and it made session 9 *and* session 10 open by proposing six-session-old work. **There are five copies of the scoreboard, not four**, the fifth is the entry point, and it is the only one nothing gates |
| 46 | *(new, session 10 — mine)* *"CI gates absent: **secret scanning**, dependency audit, bundle-size ceiling, E2E"* | **Fixed — secret scanning is present and has been since T-11.** `ci.yml` runs a checksum-pinned `gitleaks v8.30.1` over the working tree as its first step, proven red in T-11 by a planted credential. The row **understated** the build, which is the rarer direction and no less wrong: a control listed as missing is a control nobody will look for, and T-11's own acceptance criterion is recorded as met three screens away in this same file |
| 47 | *(new, session 10 — mine, and it is about this document's channel rather than its contents)* **Session 9 measured all of 39–45, wrote the fix, and none of it reached the repository.** Every one was re-confirmed present in the working tree today, one full edition later | **Half-closed, inside the run that raised it.** The diagnosis held: a scheduled run had no push — a **real** `git push`, not a dry run, returned **403** from the git proxy — and no connected folder, so its only output was a patch delivered into a session nobody was watching. **Two unattended runs in a row produced a correction that could not land.** The same shape as the rest of this document, one level out: the measurement sound, self-tested and green, and the thing it feeds with no mechanism. **EL then connected `C:\Rack Master\rack-master-studio` mid-run, and this edition was committed on the mount** — the bridge half is open and an unattended run can now land work. **The proxy half is still shut:** no scheduled run can push, so every landing still ends at GitHub Desktop and at EL. That remainder is the open part |
| 48 | *(new, session 10 — mine, found while landing this very edition)* `device_commit_files` reported **`"written"`** for all four files and left `tasks/progress.md` holding the previous transfer's bytes | **Worked around, and the workaround is the one this repository already had written down.** The stale copy would have been committed with the other three, and **both gates would have passed over it** — they compare figures, and the two copies' figures agreed; only prose differed. Found by md5-ing both sides, which is a step in the transfer rule precisely because the tool's own report is not evidence. **This is F-01's shape in the transport layer**: an honest-looking success with nothing behind it. Fixed by `cat` from a staged file under the gitignored `_to_delete/` — truncate-and-write is permitted where overwrite is refused |
| 29 | *(new, session 5 — **mine, found while re-deriving for item 28's commit**)* The sensitivity table's four scenario **denominators** were built on the pre-split base of **145** while its own first row read **147** | **Fixed — all five re-derived from 148.** Item 24 fixed that table's *numerators* earlier the same day and I did not check its denominators, so a table about how the denominator moves was itself carrying a stale one. Two defects in one table in one day, both invisible to `check-scoreboard-sync`, which compares the phase bars and not this |

**Drift 4 was not drift.** Both figures were accurate; the *classification* was wrong. Filed beside
three doc-vs-reality typos and closed with "all four are R-11 / T-10 work", it read as documentation
clean-up — which invited the fix of editing 23 down to 20. Re-derived from the blueprint this
session and put through a fresh-context adversarial review (AD-7):

- **§8.2 listed 23 rows when this was written on 2026-09-02**, and lists **24** today — EL's
  amendment added the operator release. Two are marked phase 2 by the blueprint itself
  (`POST /api/internal/v1/submissions/:id/status`, `GET /api/internal/v1/audit`). A third row is
  MVP-1 with only a *sub-feature* deferred (`GET /api/client/v1/submissions/:id`, "RFI thread is
  phase 2") and stays in. **The MVP-1 surface was 21 then — neither 23 nor 20 — and is 22 now**,
  re-derived today with `blueprintRoutes()` rather than by eye.
- The registry carried 20 then, and the diff runs **both** ways: it omitted
  `GET /api/client/v1/documents/:id` (the signed watermarked-PDF URL that §15.2 step 6, `E-08` and
  `AC-16` depend on) and `POST /api/internal/v1/revisions/:id/notes` (`E-05`), and it *carried* the
  phase-2 audit route. Neither missing route had an `Action` in `authorize.ts`. Coverage then:
  **19 of 21**. **T-14a added both routes with their Actions and `check-route-surface` now diffs
  §8.2 against the registry on every run: 22 of 22, measured today.** The three sentences above
  stayed in the present tense for a full edition after that — drift 40's other half.
- The arithmetic coincidence that makes "20" look right — 23 minus the three rows containing the
  string "phase 2" — selects a *different* twenty than the code has. It does not survive naming the
  members.
- **Consequence nobody had recorded:** because the documents route is absent from `ROUTES`, `AC-02`'s
  leakage walk never enumerates the one client route that hands out a document URL. It is outside the
  contract test **even at model level**.
- This is unstarted T-14 implementation, not a doc to edit. Recorded in `todo.md` under T-14, and the
  false "MVP-1 surface from blueprint §8.2" comment at `routes.ts` was corrected to say what the
  table actually is.

This is the **eighth** consecutive session in which drift was found by measurement — a recurring
defect, not an accident. Note what the pattern cost here: session 2's remedy for drift 4, applied as written,
would have *hidden* two missing MVP-1 routes by moving the target to meet the code. **The precedence
rule earns its keep: the blueprint wins, and the scoreboard is what gets fixed.**

---

## What to do next, in order

*(Rewritten at the session-10 edition. The session-6 list — five decisions and one push — is spent:
EL answered all of it on 2026-09-03 and merged the stack. That list lives in git history at
`0bb5383`; the session-6 third edition's at `0b0e97b`; the checkpoint list at `9296ce1`.)*

### 0. The landing path — half open as of this run

**EL connected `C:\Rack Master\rack-master-studio` mid-session, and this edition was committed on
the mount rather than delivered as a patch.** That is the first time an unattended run has landed
its own work here, and it closes half of drift 47.

**The half still shut:** a scheduled run cannot `git push` — the git proxy refuses this repository
(`not in this session's authorized repository set`, **403**, measured with a real push, not a dry
run). So a run can now commit, but the push still ends at GitHub Desktop and at EL. **Adding
`Elliotvness/Master-Rack` to the scheduled session's authorized repository set closes the
remainder**, and is worth doing for one specific reason rather than convenience: it makes **CI** the
judge of an unattended run's work instead of the run's own say-so, which is the standard everything
else in this repository is held to.

**What EL does with this commit:** it is on `docs/session-10-scoreboard` on the mount. GitHub
Desktop → **Publish branch** → PR → merge. Nothing else is pending.

### 1. EL — apply this edition, and discard session 9's

Session 9's patch (`13ddd82`, on `0bb5383`) and this one make **the same corrections**; this one is
newer, adds drift 46 and 47, and carries the first `pnpm verify` ever run on `main`. **Apply this
one and drop the other** — applying both will conflict, and the conflict would be over identical
intent, which is the worst kind to resolve by hand.

### 2. Delete two merged remote branches

`origin/task/t-13c-input-dtos` and `origin/task/t-13d-idempotency` are both **0 ahead** of `main`,
measured today. `git ls-remote --heads` is the check that catches a branch that re-appears, which
one already has once.

### 3. Then — Phase 3, the server, in the container

**T-14b — auth and organizations** → **T-14c** → **T-14d + P-01** → **T-14e + P-02** → **T-15**,
with P-01 and P-02 landing in the same commits as the routes they measure.

**T-14b is the first point that can move §15.2.** T-14a mounted 22 routes and proved the router and
the registry cannot disagree; every one of those 22 handlers answers 500. Step 1 of §15.2
(invitation) and step 2 (acceptance and sign-in) are what T-14b turns from a placeholder into a
response, and they are the first two of the eight.

**Carried into T-14e, recorded not forgotten:** the operator release route has a policy row, an
authz rule, a §8.2 row and a mounted placeholder but **no handler and no caller**; `purgeExpiredOn`
still has no caller either.

### 4. The gap nothing owns — a done-count with no mechanism

Drift 39 happened because `check-claims` derives *files, migrations, packages and route counts* and
**no derivation exists for "is this task done"**. Both gates were green over a scoreboard four
points low, for two editions. A checker that read each task's DONE block out of `tasks/todo.md` and
compared the resulting point sum to this file's total would have caught it, and would also have
caught drift 43 in the same pass — the two are one defect seen from two ends. It is not written
anywhere as a task. **It belongs under T-10b's lineage and should be sized before Phase 4**, because
Phase 4 is 42 points of tasks whose completion nothing will check.

### Standing, every session

- Re-run the Windows verify script whenever a gate changes; read the skip count before the tick.
  It reaches exit 0 (F-37), so *"green until coverage"* is no longer an acceptable reading.
- **One writer per working tree.** Before touching the bridge repo, `git log --oneline -3` and
  `git branch -vv`: a branch this session did not make means another session is alive.
- **Two trees, one `main`.** The Windows tree and the container clone drift apart by one merge
  every time a PR lands from the container side (drift 34). Before a Windows verify or a commit on
  the mount, read `.git/HEAD` and `.git/refs/heads/main` there and compare to `origin/main`.
- **Read the run, never report that one exists.** The repo is public; its Actions runs are readable
  with a plain fetch.

## The four lenses

### CI/CD and automation

What exists is above ordinary practice in one specific way worth protecting: **every checker has a
self-test and the self-test runs first**. A checker that silently stopped working would otherwise
report a clean pass forever — the exact failure mode that produced F-06 and F-08.

Gaps, in priority order:

- **The tip — reopened, then closed properly, and this is what the rule looks like working.**
  Session 4 struck this bullet through, wrote *"push each task's commit as it lands"*, and then did
  not push the commit it was writing about. Session 5 applied it: T-07 and T-27 pushed and merged as
  **PR #4 and #5, both single-shot — no re-pushes, no batching** — and `main` is at `0cc97d1`. T-28
  now sits one commit unpushed, which is the gap **one task deep by design** rather than the eight
  commits it once reached. The measure of this control is not that the number is zero; it is that it
  never grows.
- **The runner is on borrowed time.** Run #10 carries two warnings — Node.js 20 is deprecated, so
  `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5` and
  `pnpm/action-setup@v4` are being forced onto Node 24. Pin newer action versions before it becomes
  an error rather than a warning.
- **New hazard, measured today: every git command from the bridge shell strands a `.git/index.lock`
  the mount will not let git delete.** The commit carrying this update stranded `HEAD.lock`,
  `index.lock`, `objects/maintenance.lock` and five `objects/**/tmp_obj_*` files; a following
  `git status` immediately stranded another `index.lock`. They were moved to
  `_to_delete/git-locks/` — an **untracked folder at the repo root that has to be deleted from
  Windows** — and `git fsck` is clean. **It now also holds ten transfer archives** (`simpl.tgz`,
  `sync2.tgz`, `t08-f27.tgz`, `t08-move.tgz`, `t09.tgz`, `t10a.tgz`, `t10b.tgz`, `t10b2.tgz`,
  `t10b3.tgz`, `t10b4.tgz`), counted by EL on the device — **not the four this session's own note
  claimed**, which counted only the ones it had created itself and is a small instance of the same
  habit this whole document is about. **A stranded `index.lock` will block GitHub Desktop**, so the
  rule is: clear it before leaving the bridge, and check for it first if a push refuses.
  **Measured further in session 5:** it is not only `index.lock`. `HEAD.lock`,
  `objects/maintenance.lock`, **`packed-refs.lock`** and **`refs/heads/<branch>.lock`** all strand,
  and a single git invocation can fail against **its own** lock — `git branch -D` creates
  `packed-refs.lock`, cannot remove it, and then refuses. The workable pattern is one git command
  per shell call with `find .git -name '*.lock'` cleared **before** the git command as well as after,
  and **fast-forwarding an existing branch instead of deleting and recreating it.** Two further
  traps, both of which cost time in session 5: a lock cannot be moved **out** of the mount at all
  (that is a delete on the source side and is refused) — it has to be renamed **within** it; and the
  destination name must be **unique**, because overwriting an existing file is itself a delete, so a
  cleanup helper whose `$RANDOM` silently expands to nothing inside `sh -c` collides after its first
  run and quietly stops working. This is T-28's failure mode one layer down: the
  same read-only mount, a different tool's fixtures — and unlike T-28's, it is not ours to fix.
- **A new gate, and a fixture lesson worth retrofitting.** `check-content-hash` writes its
  self-test fixtures to the OS temp directory. The other checkers write probe files into the working
  tree and delete them at the end — which on a mount that forbids deletion strands them and makes
  `check-boundaries` report a **false FAIL against its own leftover fixture**. That happened today.
- **`verify` can fail without the code being wrong.** Run #11's first attempt died in **12 s** with
  `Docker start fail with exit code 1` — the Postgres service container never came up, on a
  docs-only commit. A re-run was green in 1m 12s. In the checks UI a flake and a regression look
  identical, so **read the duration first**: a genuine failure gets past *Initialize containers* and
  dies tens of seconds in; a 12-second failure never reached the code.
- **Secret scanning (T-11)** and a **dependency audit** are absent. Both are one CI step each.
- **No bundle ceiling (P-05).** Agree it *before* the first screen; a ceiling set after the bundle
  exists is one nobody meets.
- **One serial `verify` job.** `pnpm test` and `pnpm coverage` both run the suite — the suite runs
  twice. Split lint / typecheck / test into parallel jobs before the server lands, while the
  pipeline is still short enough that nobody is tempted to skip it.
- **No rollback path and no release mechanics** (T-26).

### Doubt-driven development

The project already runs this discipline and it is the reason today's numbers are trustworthy.
Five defects landed in one day and **four were found by building the control that was supposed to
already exist**, not by reading code. AD-7 codifies it.

The pattern has a name worth keeping in front of the next three tasks: **a control that states its
own method and has no mechanism behind it.** F-01, F-02, F-08, F-11 and all five §5.4 budgets were
that shape. So are the next three:

- ~~**T-13b, the outbound validator** — a validator that is never fed a forbidden field passes
  forever. The acceptance test must plant one and watch it go red.~~ **Done, and the pattern
  showed up inside it twice**: review round two found the guard *shipping* an undeclared key in
  alert mode because a union summary had swallowed it — a leak guard with a leak path — and round
  one found both status tables keyed on states that do not exist, which would have refused every
  real row while every test passed. Both were found by adversarial review, not by the suite.
- **T-13c, input DTOs** — the same shape inbound: a body schema that is never fed an extra key
  never refuses one.
- **T-13d, idempotency** — a uniqueness constraint nothing races is untested. The concurrency test
  is the control; the constraint alone is not.
- **T-14a, deny-by-default** — a boot-time route-coverage assertion run against a fixture instead of
  the real router is F-02 again, one layer up. T-13b's `assertRouteCoverage` still runs against
  `ROUTES`, the model; T-14a is what turns it on the router.

And the standing one: **AC-06 is still enforced against a model.** The 20-entry route table is
asserted against no router because no router exists. T-15 is what converts it — and session 3 found
the model itself is short: the table covers **19 of §8.2's 21 MVP-1 routes**, so `AC-02`'s leakage
walk does not enumerate `GET /api/client/v1/documents/:id` at all. A control asserted against an
incomplete model is the same defect shape one layer further back.

### Frontend UI engineering

Zero `.tsx` files, so every decision here is still free.

- **P-05 first.** LCP ≤ 2.5 s, CLS ≤ 0.1, initial JS ≤ 200 KB gzipped — and **INP ≤ 200 ms is the
  one that matters**: a rack configurator is an interaction loop, not a page view. The 120 ms
  preview budget covers the computation and nothing covers the paint.
- **T-17 is the architectural load-bearing rule**: the renderer *consumes* the display list and
  never recomputes. Screen and output diverging as separate code paths is what fragmented all four
  prior projects.
- **T-16 design tokens before components.** This is a client-facing product whose purpose is
  protecting a commercial position — a generic template look undercuts that. Spacing scale, type
  hierarchy, semantic color tokens, and no reliance on color alone for state.
- **WCAG 2.1 AA is a Checkpoint C gate, not a polish pass.** Build keyboard traversal and focus
  management into T-16, and give every screen its empty, loading and error states from the start.
- **T-21 audits the audit tool** — self-tested against known contrast ratios before it is trusted
  to report. Same discipline as every other checker here.
- State: server state through a query cache, filters in the URL, no global store yet.

### Git workflow and versioning

- ~~**Merge the branch.**~~ Done — PR #1 merged at `dab5a8e` (retitled first), PR #2 and #3 since.
  `main` @ `98b0229`, every merged branch deleted. The one-branch-per-task rule is holding: T-05,
  T-06 and T-07 each got their own.
- **Push the tip — the rule's other half is not holding.** `task/t-07-workflow-package` @ `e88320f`
  is unpushed with no upstream. A branch per task only shortens the unverified window if each one is
  pushed as it lands; otherwise it just relabels the same gap.
- From Phase 2 on, **one short-lived branch per task**, merged within a day or two. The tasks are
  already sized for it — and push each one, rather than letting eight commits accumulate again.
- **No tags, no `CHANGELOG.md`, version `0.0.0`** — re-checked today. Fine today — nothing consumes this yet. The
  moment the pilot organization touches a deployed build, that stops being true, and a changelog
  reconstructed later is a changelog with half the entries missing. T-26 should land with the first
  deploy, not after it.
- Write the changelog entry **in the commit that makes the change**.

---

## Open questions still gating work

| | | Gates |
|---|---|---|
| ~~**Q3**~~ | **Answered 2026-09-03** — disclaimer text, company/contact name, `MS-GOV-YYYY-NNN` numbering | T-20, AC-16 **unblocked** |
| ~~**Q4**~~ | **Answered 2026-09-03** — B2 bucket created, keys scoped and verified | T-24 **unblocked** |
| **Q6 / OD-20b** | **Still open.** McMurray Stern answers **OD-20a**, the internal dogfood pilot; OD-20b's own criterion is *outside* McMurray Stern | No code. **R-01 stays live** — it retires only when an outside organisation completes a submission unaided |

Q1, Q2, Q5 and Q7 are answered, and as of session 3 `tasks/plan.md` says so for all four — it had
not caught up on Q1, Q5 **or** Q7 (session 2's drift list missed Q5).
