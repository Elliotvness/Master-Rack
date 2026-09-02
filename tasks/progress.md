# Progress scoreboard — 2026-09-02 (session 5)

Derived from `tasks/todo.md`, which stays the source of truth for task detail. This file holds
only the arithmetic and the ordering. Where a figure was re-measured today it says so; where it is
the repository's own claim it says that instead.

Measured on branch `task/t-07-workflow-package` @ **`e88320f`**, one commit ahead of `main` @
**`98b0229`** (PR #1, #2 and #3 merged, every branch deleted). **That branch has no upstream and has
never been pushed**, so no CI run covers the code this scoreboard describes — drift 16. Session 4's
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

**Session 5 moved no task figure, and that is the finding.** No commit landed between session 4's
update and this pass: the working tree is clean and `HEAD` is the same `e88320f` that carried that
update. What the re-measurement found instead is the scoreboard's **two repo copies contradicting
each other on a published percentage while `pnpm check:scoreboard` stays green** (drift 18), and the
**two copies CI cannot reach still publishing the figures from before T-07** (drift 23). **Nine new
drift items, items 15 to 23, none of them in the code.**

**Session 4's `pnpm verify` — exit 0 against a native PostgreSQL 16.13 — is a repository claim as of
today, not a session-5 measurement.** Re-checked today: `node_modules` in this working tree holds
win32 binaries (`@esbuild+win32-x64`, `@rollup+rollup-win32-x64-gnu`, `.CMD` shims) and the bridge
shell is Linux with neither `pnpm` nor `psql` on `PATH`. The suite cannot run from here. Two pure-node
checkers **can**, and did — see *Verified today*.

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
| Plan-task completion, effort-weighted | 29 of 145 pts — **20.0%** | `tasks/todo.md` phases, sliced from **§15.3** | Bookkeeping against the plan. An upper bound — see the caveat below. |
| Plan-task completion, task count | 10 of 44 — 23% | Same, unweighted | Same |
| Pre-merge review `R-01…R-11` | 8 of 11 — 73% | **§16.1** review gates | A sub-checklist of one merged branch, not the project. Unchanged since session 3. Done: R-01…R-06, **R-08**, **R-11**. Open: R-07 (partly), R-09, R-10 (the per-commit `typecheck && test`, which needs Windows) |
| Route surface vs the blueprint | 19 of 21 MVP-1 routes declared | **§8.2** (23 rows, 2 marked phase 2) | Re-enumerated today, path by path. A *registry* figure, not a served one — nothing mounts it |

These are not competing answers. **0% is the answer**; 20.0% is how much of the written plan has
been executed. A reader who quotes 20.0% without §15.2 beside it is quoting the wrong number.

**Neither numerator nor denominator moved this session.** Session 5 landed no commit, so every
figure in the table above is session 4's, re-derived today and confirmed. What changed is the
prose around them — eight statements in these two files were wrong, and are listed under *Drift*.

**The session-4 history, kept because the denominator did move then.** Session 3 moved the denominator twice
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

- **Inventory.** The **44** tasks — 43 until **T-28** was added this session: the 36 `T-…` tasks and 6 `P-…` tasks in `tasks/todo.md` (T-13a–d and
  T-18a–e counted individually), plus R-08 and R-10 counted once. The ten Phase 4 bullets
  (T-16…T-21) and the five Phase 5 bullets (T-22…T-26) are inside the 36, not additions to it.
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

### Caveat that cuts against the 20.0%

The T-shirt sizes were written **before anyone attempted the server or the interface**. T-14 is
sized L = 8 points = 5.6% of the project, yet it gates **all eight** §15.2 steps: every one needs
HTTP. Phase 4 is eight M tasks, one L, and one S in a repo with zero `.tsx` files and no framework
installed.
If either is under-sized — and both probably are — the true denominator is larger and **20.0% is
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
| 2 — Kernel and workflow repairs | 26 | 10 | **38%** | **T-05, T-06 and T-07 done**; T-08…T-12, T-27, T-28 open |
| 3 — The contract, then the server | 50 | 8 | 16% | P-00 and T-13a done; T-13b…T-15, P-01…P-05, R-08, R-10 open |
| 4 — The interface | 42 | 0 | **0%** | Zero `.tsx` files exist |
| 5 — Deploy readiness | 16 | 0 | 0% | Not started |
| **Total** | **145** | **29** | **20.0%** | |

**Remaining: 116 points.** T-14 plus all of Phase 4 is 50 of those — 43% of what is left. The other
**57% is diffuse**: Phase 2's residue (16), the rest of Phase 3 (42), Phase 5 (16). The remaining
work is *not* concentrated in the two big items, and planning as if it were will under-book the back
half.

---

### How soft is 20.0%?

The caveat above says the figure is a ceiling because T-14 and Phase 4 were sized before anyone
attempted either. Quantified — 29 done points never move, only the denominator does:

| T-14 | Phase 4 | Denominator | Completion | Scenario |
|---|---|---|---|---|
| 8 | 42 | 145 | **20.0%** | as planned — the published figure |
| 16 | 63 | 174 | 16.7% | T-14 ×2, Phase 4 ×1.5 |
| 16 | 84 | 195 | 14.9% | T-14 ×2, Phase 4 ×2 |
| 24 | 84 | 203 | 14.3% | T-14 ×3, Phase 4 ×2 |
| 24 | 126 | 245 | 11.8% | T-14 ×3, Phase 4 ×3 |

Even at triple, the figure moves about eight points. **The ceiling is real but shallow**, so
20.0% is not worth re-deriving — and §15.2 stays **0 of 8** in every scenario, which is why that
is the number to quote and this one is not.

**Where the remaining 116 points sit:** Phase 3's residue 42 (36.2%) · Phase 4 42 (36.2%) ·
Phase 2's residue 16 (13.8%) · Phase 5 16 (13.8%). The two largest blocks are equal, and neither is
a majority.

## Verified today

Re-measured by running commands against the working tree:

| | |
|---|---|
| Branch · tip | `task/t-07-workflow-package` @ **`e88320f`**, **1 ahead of `origin/main`, 0 behind** (`git rev-list --left-right --count origin/main...HEAD` → `0 1`), working tree **clean** — measured *before* the commit carrying this update, which makes it 2. Per the standing warning in the next row, re-run the command rather than quoting either figure. One short-lived branch per task, as the plan requires from Phase 2 on |
| **CI on the tip** | **NONE — the tip has never been pushed.** `git rev-parse @{u}` returns *no upstream configured*; `refs/remotes` holds only `origin/main` and `origin/HEAD`. Run #10 covered `efbafbd`, now buried in `main`'s history — **it does not describe `HEAD`**. Session 4 published this row as "Run #10, Success"; that was true of a commit, not of the tip. Drift 16, and the CI/CD lens's "tip is unverified — closed" is **reopened** |
| Re-run from the bridge today | `node tools/check-scoreboard-sync.mjs` → **PASS**; `node tools/selftest-scoreboard-sync.mjs` → **PASS** (both pure node, no dependencies, and the self-test writes nothing into the working tree). These are the only two gates this shell can execute — and the first one passed *while the two files it compares disagreed*, which is drift 18 |
| The ahead/unpushed pair moves as this file is written | Each documentation commit that records this measurement adds one to both counts, so **do not quote ahead/unpushed from this document** — re-run `git rev-list --left-right --count origin/main...HEAD` and `git rev-list --count @{u}..HEAD`. Session 3 added `e488a14`, `c08cca3` and the commit carrying this row. That self-reference is exactly how drift item 5 arose, and naming it is cheaper than chasing it |
| `main` | in sync with `origin/main` @ `98b0229` — PR #1, #2 and #3 merged, every branch deleted |
| Packages | **12** — `packages/workflow` added by T-07 |
| Test files | **47** (`*.test.ts`) — T-06 added two, T-07 added `submit-effects.db.test.ts` |
| Migrations | **9** (`0001`–`0009`) — `0009_assumption_record.sql` applied and its constraints proven to fire |
| `.tsx` / `.jsx` / `.vue` / `.svelte` / `.astro` files | **0** |
| Server entry point | **none** — no `fastify`, `express`, `koa`, `hono`, `node:http`, `.listen(` anywhere in `apps/` or `packages/` |
| Front-end dependency | **none** — no `react`, no `vite` in any `package.json` |
| Route table | **20 entries** in `apps/api/src/authz/routes.ts` — **11 client, 8 internal, 1 public, each path enumerated and counted today**. Imported by `authorize.test.ts` (twice) and re-exported by `apps/api/src/index.ts` — **a barrel re-export is not a consumer, and no router mounts it**. Re-diffed against §8.2 today: `GET /api/client/v1/documents/:id` and `POST /api/internal/v1/revisions/:id/notes` are still absent and `GET /api/internal/v1/audit` (phase 2) is still carried. **19 of 21** — see drift 4 |
| `apps/api/src/index.ts` | Its own header calls it "The HTTP layer". It is a barrel of 8 re-export blocks and **no HTTP**. Not filed as drift — the file says "and (later) authorization and DTOs" — but it is the sentence a future reader will misread as a server |
| Git tags · `CHANGELOG.md` · Dependabot | none · none · none, all re-checked today. `version` is `0.0.0`. Expected — `CHANGELOG.md` is T-26's, unstarted — but the house rule is to write the entry **in the commit that makes the change**, and 4 commits have landed since that rule was written down |
| CI gates present | typecheck, lint, migrate, test, **11** self-tested checkers, coverage, bench, docs rebuild + `git diff --exit-code`. Two landed today: `check-content-hash` (recomputes each release's `content_sha256` by the method that manifest declares) and `check-spot-check-record` (asserts every signed spot-check covers the draw that was pinned before it) |
| CI gates absent | secret scanning, dependency audit, bundle-size ceiling, E2E |

### Not verified today — the repository's own figures

A task completed in an earlier session and not re-run today is a **repository claim**, however
confident that session was. Three figures sit here for session 5, all with the same reason.

- **"47 files, 1,126 tests, 0 skipped; `pnpm verify` exit 0."** A **session-4 measurement, a session-5
  claim.** Re-checked the *constraint* today rather than the figure: `node_modules` in this working
  tree carries `@esbuild+win32-x64`, `@rollup+rollup-win32-x64-gnu`, `@rollup+rollup-win32-x64-msvc`
  and `.CMD`/`.ps1` shims; the bridge shell is Linux with no `pnpm` and no `psql`. **The suite cannot
  run from here**, so this figure can only ever be re-measured from Windows or from CI. Historical:
  `LATEST.md`'s "1,042" was replaced in session 3 and was low.
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

**Session 5 found nine, items 15 to 23, and every one of them is inside the scoreboard itself.**
No code changed between the two passes, so this is the cleanest measurement the project has of how
fast its own documentation goes stale: **nine false statements across the four copies in under a day, with
CI green over them the whole time.** Two matter most. **Item 18** — the gate whose entire job is
keeping the two repo copies in agreement was passing while they disagreed on a published percentage.
**Item 23** — the two copies CI cannot reach were never updated when T-07 landed, so the four copies
sat in **three different states** and the only gate that runs saw none of it.

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
2. **Then widen `check-scoreboard-sync` (T-10 work).** Drift 18 is the strongest argument the project
   has produced for its own house rule. The gate compares the phase table and the §15.2 headline;
   the *measure cards* — the percentages a reader actually reads first — are outside it. Parse them
   too, and make the self-test plant a disagreeing card and watch it go red. Until then, treat a
   green `check:scoreboard` as covering two figures, not two files.

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

Phase 2 in dependency order: ~~**T-05** (contentHash ≠ manifestHash)~~ **done, merged** →
~~**T-06** (record the acknowledgement)~~ **done, merged** → ~~**T-07** (orchestration into
`packages/workflow`)~~ **done, this branch** → **T-08** (orchestration off the client, into `packages/workflow`) →
**T-27** (type-check the test files) → **T-09** (`part` / `part_revision`) → **T-10** (docs +
`check-claims`) → **T-11** (secret scanning) → **T-12** (source-conflict register).

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

- **The tip is unverified — REOPENED, one commit after it was declared closed.** `e88320f` has no
  upstream and has never been pushed. Session 4 struck this bullet through, wrote *"keep it closed:
  push each task's commit as it lands"*, and then did not push the commit it was writing about.
  The gap is one commit deep instead of eight, which is the whole improvement; the discipline that
  was supposed to prevent it did not survive its first task. **Push before the next task starts.**
- **The runner is on borrowed time.** Run #10 carries two warnings — Node.js 20 is deprecated, so
  `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5` and
  `pnpm/action-setup@v4` are being forced onto Node 24. Pin newer action versions before it becomes
  an error rather than a warning.
- **New hazard, measured today: every git command from the bridge shell strands a `.git/index.lock`
  the mount will not let git delete.** The commit carrying this update stranded `HEAD.lock`,
  `index.lock`, `objects/maintenance.lock` and five `objects/**/tmp_obj_*` files; a following
  `git status` immediately stranded another `index.lock`. They were moved to
  `_to_delete/git-locks/` — an **untracked folder at the repo root that has to be deleted from
  Windows** — and `git fsck` is clean. **A stranded `index.lock` will block GitHub Desktop**, so the
  rule is: clear it before leaving the bridge, and check for it first if a push refuses. This is
  T-28's failure mode one layer down — the same read-only mount, a different tool's fixtures.
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
