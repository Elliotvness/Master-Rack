# Progress scoreboard — 2026-09-02 (session 5)

Derived from `tasks/todo.md`, which stays the source of truth for task detail. This file holds
only the arithmetic and the ordering. Where a figure was re-measured today it says so; where it is
the repository's own claim it says that instead.

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
2. **Recompute** done-points over the 143-point denominator using the plan's own T-shirt sizes.
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
| Plan-task completion, effort-weighted | 48 of 148 pts — **32.4%** | `tasks/todo.md` phases, sliced from **§15.3** | Bookkeeping against the plan. An upper bound — see the caveat below. |
| Plan-task completion, task count | 18 of 45 — 40% | Same, unweighted | Same |
| Pre-merge review `R-01…R-11` | 8 of 11 — 73% | **§16.1** review gates | A sub-checklist of one merged branch, not the project. Unchanged since session 3. Done: R-01…R-06, **R-08**, **R-11**. Open: R-07 (partly), R-09, R-10 (the per-commit `typecheck && test`, which needs Windows) |
| Route surface vs the blueprint | 19 of 21 MVP-1 routes declared | **§8.2** (23 rows, 2 marked phase 2) | Re-enumerated today, path by path. A *registry* figure, not a served one — nothing mounts it |

These are not competing answers. **0% is the answer**; 32.4% is how much of the written plan has
been executed. A reader who quotes 32.4% without §15.2 beside it is quoting the wrong number.

**Phase 2 is complete** — the first phase to close since Phase 1. **§15.2 did not move by one step
while it happened**, and that is not a paradox: Phase 2 was repairs and controls, and the definition
of done is a client getting through eight screens. **The next point earned is the first one that can
move it.**

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

- **Inventory.** The **45** tasks — 43 until T-28 was added in session 3, 44 until **T-10 was split**
  into T-10a and T-10b in session 5: the 37 `T-…` tasks and 6 `P-…` tasks in `tasks/todo.md` (T-13a–d, T-10a–b and
  T-18a–e counted individually), plus R-08 and R-10 counted once. The ten Phase 4 bullets
  (T-16…T-21) and the five Phase 5 bullets (T-22…T-26) are inside the 37, not additions to it.
  `tasks/todo.md`'s 110 checkboxes are *sub-criteria inside* those tasks, not tasks; they are also
  stale (T-01…T-04 are complete with unchecked boxes), so they are not counted.
- **Weights.** The plan's own T-shirt sizes: **XS=1, S=2, M=4, L=8**. P-00 carries no size and is
  scored M; T-00 is sized XS in the plan.
- **Completion is binary.** A task counts only when its stated acceptance criteria are met. No
  partial credit anywhere — including T-00, which is *in progress*, not 90% done.
- **Status source.** Commit subjects in `git log main..HEAD`, the `✅` markers in `tasks/todo.md`,
  and file-existence checks — not the checkboxes.
- **R-08 and R-10 appear twice** in the plan (in `tasks/review-todo.md` and again in Phase 3). They
  are counted once, in Phase 3. The other nine R-items are outside the 43.

### Caveat that cuts against the 32.4%

The T-shirt sizes were written **before anyone attempted the server or the interface**. T-14 is
sized L = 8 points = 5.6% of the project, yet it gates **all eight** §15.2 steps: every one needs
HTTP. Phase 4 is eight M tasks, one L, and one S in a repo with zero `.tsx` files and no framework
installed.
If either is under-sized — and both probably are — the true denominator is larger and **32.4% is
an overstatement**. Treat it as a ceiling.

Also outside the denominator, because the plan does not contain them: dependency audit in CI, E2E
tests, Dependabot, preview deployments. (Secret scanning *is* T-11; bundle gate *is* P-05;
changelog and tags *are* T-26.)

---

## By phase

| Phase | Points | Done | % | State |
|---|---|---|---|---|
| 0 — Make CI real | 1 | 1 | **100%** | **T-00 complete.** Tip `efbafbd` pushed; CI run #10 **Success** — the first commit in this repo ever verified |
| 1 — Catalog and schema integrity | 10 | 10 | **100%** | T-01…T-04 complete (verified at `a2f166e` — repository claim, not re-run today) |
| 2 — Kernel and workflow repairs | 29 | 29 | **100%** | **Complete.** T-05, T-06, T-07, T-27, T-28, T-08, T-09, T-10a, T-10b, **T-11**, **T-12**. Points 26 → 28 from the T-10 split, 28 → 29 when T-11 grew XS → S for F-32 |
| 3 — The contract, then the server | 50 | 8 | 16% | P-00 and T-13a done; T-13b…T-15, P-01…P-05, R-08, R-10 open |
| 4 — The interface | 42 | 0 | **0%** | Zero `.tsx` files exist |
| 5 — Deploy readiness | 16 | 0 | 0% | Not started |
| **Total** | **148** | **48** | **32.4%** | |

**Remaining: 100 points, and Phase 2's residue is now zero.** T-14 plus all of Phase 4 is **exactly
half** of what is left; the other half is the rest of Phase 3 (34) and Phase 5 (16). The remaining
work is *not* concentrated in the two big items, and planning as if it were will under-book the back
half.

---

### How soft is 32.4%?

The caveat above says the figure is a ceiling because T-14 and Phase 4 were sized before anyone
attempted either. Quantified — 48 done points never move, only the denominator does.
**Every row here is 45 over its own denominator, and every denominator is derived from 148 rather
than carried forward.** This table has now been wrong twice in one day in two different ways: four
of five rows were still computed on session 4's numerator of 29 while the first row read 41 (item
24), and — found only when T-11 changed the base — **all four scenario denominators were built on
the pre-split base of 145 while the row above them said 147** (item 29). Re-derived, not adjusted:

| T-14 | Phase 4 | Denominator | Completion | Scenario |
|---|---|---|---|---|
| 8 | 42 | 148 | **32.4%** | as planned — the published figure |
| 16 | 63 | 177 | 27.1% | T-14 ×2, Phase 4 ×1.5 |
| 16 | 84 | 198 | 24.2% | T-14 ×2, Phase 4 ×2 |
| 24 | 84 | 206 | 23.3% | T-14 ×3, Phase 4 ×2 |
| 24 | 126 | 248 | 19.4% | T-14 ×3, Phase 4 ×3 |

Even at triple, the figure moves about eight points. **The ceiling is real but shallow**, so
32.4% is not worth re-deriving — and §15.2 stays **0 of 8** in every scenario, which is why that
is the number to quote and this one is not.

**Where the remaining 116 points sit:** Phase 3's residue 42 (36.2%) · Phase 4 42 (36.2%) ·
Phase 2's residue 16 (13.8%) · Phase 5 16 (13.8%). The two largest blocks are equal, and neither is
a majority.

## Verified today

Re-measured by running commands against the working tree:

| | |
|---|---|
| Branch · tip | **`main` @ `3a3c917`**, PR #7, #8 and #9 merged, every task branch deleted. **Phase 2 is closed.** Working branch for this update is `docs/recover-f32-and-close-phase-2`. **Re-run `git rev-parse --short HEAD` rather than quoting from this document** |
| **F-32 answered, and the trigger was watched firing** | EL took option **(a)**: `push: branches: ['**']` plus a `concurrency` group with `cancel-in-progress`. The acceptance criterion was that somebody sees it fire, and somebody did — a throwaway `ci/trigger-probe` push produced **run 33601314332, event `push`**, on a branch with no PR. **That is the first branch push in this repository's history to be judged by CI.** Probe branch deleted afterwards |
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
| `main` | in sync with `origin/main` @ `98b0229` — PR #1, #2 and #3 merged, every branch deleted |
| Packages | **12** — `packages/workflow` added by T-07 |
| Test files | **50** (`*.test.ts`) — T-08 added `internal.test.ts`, T-09 added `projection.test.ts` and `part-registry.db.test.ts`. Re-derived by `check:claims`, not typed |
| Migrations | **10** (`0001`–`0010`) — `0010_part_registry.sql` adds `part` / `part_revision`, the `bom_line` foreign key, staff-only RLS and the GRANT. **F-31 is closed**: `check-rls` now asserts the privilege half in both directions (T-10b) |
| `.tsx` / `.jsx` / `.vue` / `.svelte` / `.astro` files | **0** |
| Server entry point | **none** — no `fastify`, `express`, `koa`, `hono`, `node:http`, `.listen(` anywhere in `apps/` or `packages/` |
| Front-end dependency | **none** — no `react`, no `vite` in any `package.json` |
| Route table | **20 entries** in `apps/api/src/authz/routes.ts` — **11 client, 8 internal, 1 public, each path enumerated and counted today**. Imported by `authorize.test.ts` (twice) and re-exported by `apps/api/src/index.ts` — **a barrel re-export is not a consumer, and no router mounts it**. Re-diffed against §8.2 today: `GET /api/client/v1/documents/:id` and `POST /api/internal/v1/revisions/:id/notes` are still absent and `GET /api/internal/v1/audit` (phase 2) is still carried. **19 of 21** — see drift 4 |
| `apps/api/src/index.ts` | Its own header calls it "The HTTP layer". It is a barrel of 8 re-export blocks and **no HTTP**. Not filed as drift — the file says "and (later) authorization and DTOs" — but it is the sentence a future reader will misread as a server |
| Git tags · `CHANGELOG.md` · Dependabot | none · none · none, all re-checked today. `version` is `0.0.0`. Expected — `CHANGELOG.md` is T-26's, unstarted — but the house rule is to write the entry **in the commit that makes the change**, and 4 commits have landed since that rule was written down |
| CI gates present | typecheck, lint, migrate, test, **12** self-tested checkers, coverage, bench, docs rebuild + `git diff --exit-code`. Two landed today: `check-content-hash` (recomputes each release's `content_sha256` by the method that manifest declares) and `check-spot-check-record` (asserts every signed spot-check covers the draw that was pinned before it) |
| CI gates absent | secret scanning, dependency audit, bundle-size ceiling, E2E |

### Not verified today — the repository's own figures

A task completed in an earlier session and not re-run today is a **repository claim**, however
confident that session was. Three figures sit here for session 5, all with the same reason.

- ~~**"47 files, 1,126 tests, 0 skipped; `pnpm verify` exit 0."**~~ **Measured this session — moved to
  *Verified today*.** It was session 4's claim until the repository was rebuilt in a Linux container
  with a native PostgreSQL 16.13. The constraint that made it a claim is unchanged and still true of
  EL's own tree: win32 binaries against a Linux bridge shell with no `pnpm` and no `psql`. What
  changed is that the container is a third place to run it, needing neither Windows nor a push.
  Historical: `LATEST.md`'s "1,042" was replaced in session 3 and was low.
- **Windows.** Nothing here has been run on Windows this session. Checkpoint A requires `pnpm verify`
  PASS **on Windows** and DB-backed tests green **in CI**; a container run satisfies neither, and
  every DONE block from session 5 says *container-verified* rather than *verified* for that reason.
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
or in the practice that maintains it.** This is the cleanest measurement the project has of how fast
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
| 29 | *(new, session 5 — **mine, found while re-deriving for item 28's commit**)* The sensitivity table's four scenario **denominators** were built on the pre-split base of **145** while its own first row read **147** | **Fixed — all five re-derived from 148.** Item 24 fixed that table's *numerators* earlier the same day and I did not check its denominators, so a table about how the denominator moves was itself carrying a stale one. Two defects in one table in one day, both invisible to `check-scoreboard-sync`, which compares the phase bars and not this |

**Drift 4 was not drift.** Both figures were accurate; the *classification* was wrong. Filed beside
three doc-vs-reality typos and closed with "all four are R-11 / T-10 work", it read as documentation
clean-up — which invited the fix of editing 23 down to 20. Re-derived from the blueprint this
session and put through a fresh-context adversarial review (AD-7):

- **§8.2 lists 23 rows.** Two are marked phase 2 by the blueprint itself
  (`POST /api/internal/v1/submissions/:id/status`, `GET /api/internal/v1/audit`). A third row is
  MVP-1 with only a *sub-feature* deferred (`GET /api/client/v1/submissions/:id`, "RFI thread is
  phase 2") and stays in. **The MVP-1 surface is 21 — neither 23 nor 20.**
- The registry carries 20, and the diff runs **both** ways: it omits `GET /api/client/v1/documents/:id`
  (the signed watermarked-PDF URL that §15.2 step 6, `E-08` and `AC-16` depend on) and
  `POST /api/internal/v1/revisions/:id/notes` (`E-05`), and it *carries* the phase-2 audit route.
  Neither missing route has an `Action` in `authorize.ts`. Coverage: **19 of 21**.
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

### Immediate — the tip, before anything else (est. 15 minutes)

1. **Push `task/t-07-workflow-package` and confirm CI green on `e88320f`.** It is one commit, it has
   no upstream, and it carries T-07 — the largest single change since the merge, including three
   silent-write defects closed and a rewritten step-8 reconciliation. **No CI run has ever seen it.**
   Pushes must run from Windows; the bridge shell holds no git credentials. GitHub Desktop →
   *Push origin*, after adding `C:\Rack Master\rack-master-studio` to it — its pre-existing
   `Master-Rack` entry points at a second, near-empty clone at `C:\Rack Master\Master-Rack`.
   Then open and merge the PR, and delete the branch.
   **`task/t-27-typecheck-tests` now sits on top of it**, carrying the plan amendment and T-27, so
   push and merge that too. Two branches, three tasks' worth of work, and no CI run has seen any of
   it.
2. ~~**Then widen `check-scoreboard-sync`.**~~ **Scheduled as T-10b**, which is where drift 18's
   remedy now lives with acceptance criteria of its own — including the one that matters: the
   self-test must plant a disagreeing measure card and watch it go red. Until it lands, treat a green
   `check:scoreboard` as covering **two figures, not two files**.
3. **Then the rest of Phase 2, in the amended order:** ~~**T-28**~~ **done** → ~~**T-08**~~ **done**
   → ~~**T-09**~~ **done** → ~~**T-10a**~~ **done** → **T-10b** (which now owns three things:
   `check-claims`, drift 18's measure-card widening, and **F-31**'s grant checker)
   → **T-12**, with **T-11** done alongside a
   push rather than in sequence, because "a planted fake credential is caught" and "push protection
   enabled on the remote" both need the remote. Every one of them can be implemented and
   container-verified without EL; only the push cannot.

**Closed in earlier sessions, kept only as lineage:** T-00 (tip pushed, run #10 Success);
R-08 (catalog reviewed as data — 378 → 336 rows, 42 phantom rows gone, 264 capacity corrections,
43 of 43 pinned cell ids resolve; findings F-12…F-16 and F-19 raised, F-12/F-13/F-16 fixed, F-14
withdrawn as filed, F-15 recorded, F-19 given `check-content-hash` with an 11-case self-test);
R-10 (all 36 commit subjects judged, 35 clear the standard, `36881f3` stops mid-clause — **open:**
the per-commit `typecheck && test`, which needs Windows); PR #1 merged at `dab5a8e` and retitled;
drift 1, 2, 3, 5 and 6 fixed, drift 4 reclassified as T-14 implementation. The one open F-item for
EL, not for code: whether to re-base the 2026-09 `content_sha256`, reproducible only by Python
because `face_height_in: 4.0` hashes differently once any other JSON implementation renders it `4`.
Re-basing changes an APPROVED release, so it is recorded, not taken.


### Then — Checkpoint A, which was skipped

`tasks/todo.md` puts Checkpoint A after T-00…T-12 and requires *"Review with EL before Phase 3"*.
Phase 3 started anyway: P-00 and T-13a are done while **T-05…T-12 and T-27 are untouched**. The
checkpoint can no longer go green in sequence. Two honest options: run Phase 2 now and hold the
checkpoint, or amend the plan on the record to say the checkpoint moved. Silently leaving it is the
third option and it is the one that produces the next audit finding.

Phase 2 in the amended dependency order — **the order changed in session 5, with EL's approval and
on the record in `tasks/todo.md`'s Phase 2 header**: ~~**T-05**~~ **done, merged** → ~~**T-06**~~
**done, merged** → ~~**T-07**~~ **done, unpushed** → ~~**T-27** (type-check the test files)~~
**done, merged (PR #5)** → ~~**T-28** (self-test fixtures)~~ **done, unpushed** →
~~**T-08** (orchestration off the client)~~ **done, unpushed** →
~~**T-09** (`part` / `part_revision`, migration `0010`)~~ **done, pushed** →
~~**T-10a** (reconcile the four documents)~~ **done** → **T-10a** (reconcile the four documents) →
**T-10b** (`check-claims` + widen `check-scoreboard-sync`) → **T-12** (source-conflict register),
with **T-11** alongside a push.

Two dependencies the original plan did not record and this order does: **T-27 went first** because
every task after it writes tests, and **T-28 precedes T-10b** because T-10b adds a checker and a
self-test, which written in the current style would become the fifth offender of the thing T-28
exists to remove.

### Then — Phase 3, the server

T-13b → T-13c → T-13d → **T-14** → T-15, with P-01 and P-02 landing *in the same commits* as the
routes they measure.

---

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

- **T-13b, the outbound validator** — a validator that is never fed a forbidden field passes
  forever. The acceptance test must plant one and watch it go red.
- **T-13d, idempotency** — a uniqueness constraint nothing races is untested. The concurrency test
  is the control; the constraint alone is not.
- **T-14, deny-by-default** — a boot-time route-coverage assertion run against a fixture instead of
  the real router is F-02 again, one layer up.

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
| **Q3** | Standing disclaimer text, company/contact name, document number format | T-20, AC-16 |
| **Q4** | Backblaze B2 credentials + permission for the Governance-bucket proof | T-24 |
| **Q6 / OD-20b** | External pilot client name | No code. Retires R-01, and P-04's real unit sizes |

Q1, Q2, Q5 and Q7 are answered, and as of session 3 `tasks/plan.md` says so for all four — it had
not caught up on Q1, Q5 **or** Q7 (session 2's drift list missed Q5).
