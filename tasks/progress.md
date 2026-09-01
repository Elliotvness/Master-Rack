# Progress scoreboard — 2026-09-01 (session 3)

Derived from `tasks/todo.md`, which stays the source of truth for task detail. This file holds
only the arithmetic and the ordering. Where a figure was re-measured today it says so; where it is
the repository's own claim it says that instead.

Measured on branch `fix/catalog-release-integrity`. The session-3 measurement pass ran at
`ff63b87`; the branch was then **pushed** and its tip, **`efbafbd`**, is green in CI —
**run #10, Success** (https://github.com/Elliotvness/Master-Rack/actions/runs/33529120263).
That closes **T-00** and is the first time any commit in this repository has been verified at the
commit that actually exists. The session-2 scoreboard measured itself at `6f05043` (27 ahead, 1
unpushed) and three commits landed after it, so its own tip figures were stale before it was read —
see drift 5, and the rule that replaced the number.

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
| Plan-task completion, effort-weighted | 19 of 145 pts — **13.1%** | `tasks/todo.md` phases, sliced from **§15.3** | Bookkeeping against the plan. An upper bound — see the caveat below. |
| Plan-task completion, task count | 7 of 44 — 16% | Same, unweighted | Same |
| Pre-merge review `R-01…R-11` | 8 of 11 — 73% | **§16.1** review gates | A sub-checklist of one branch, not the project. **Same figure as this morning, different members** — see the correction below. Done: R-01…R-06, **R-08**, **R-11**. Open: R-07 (partly), R-09, R-10 (one criterion) |
| Route surface vs the blueprint | 19 of 21 MVP-1 routes declared | **§8.2** (23 rows, 2 marked phase 2) | New this session. A *registry* figure, not a served one — nothing mounts it |

These are not competing answers. **0% is the answer**; 13.1% is how much of the written plan has
been executed. A reader who quotes 13.1% without §15.2 beside it is quoting the wrong number.

**The denominator moved this session, twice, and in opposite directions.** T-00 closing took it from
12.6% to 13.3% — one point earned. Then **T-28 was added** (self-tests must not be able to strand
their own fixtures, S = 2 points), taking the denominator from 143 to 145 and the figure back to
**13.1%**. Nothing regressed: 19 done points did not move. A percentage that fell because the plan
grew is not a loss, exactly as one that rose because a task closed is barely a gain. §15.2 sat at
0 of 8 through both.

**Reconciliation with the older figures.** The Rev C audit's *68%* and `LATEST.md`'s *70%* are
blueprint-conformance measures — requirements met, and effort remaining — over the whole MVP-1
scope. This scoreboard counts tasks in the remediation plan. Different denominators, both honest,
neither comparable. The one figure all four agree on is §15.2 at 0 of 8.

---

## Method, so it can be re-run

- **Inventory.** The **44** tasks — 43 until **T-28** was added this session: the 36 `T-…` tasks and 6 `P-…` tasks in `tasks/todo.md` (T-13a–d and
  T-18a–e counted individually), plus R-08 and R-10 counted once. The ten Phase 4 bullets
  (T-16…T-21) and the five Phase 5 bullets (T-22…T-26) are inside the 35, not additions to it.
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

### Caveat that cuts against the 13.1%

The T-shirt sizes were written **before anyone attempted the server or the interface**. T-14 is
sized L = 8 points = 5.6% of the project, yet it gates **all eight** §15.2 steps: every one needs
HTTP. Phase 4 is eight M tasks, one L, and one S in a repo with zero `.tsx` files and no framework
installed.
If either is under-sized — and both probably are — the true denominator is larger and **13.1% is
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
| 2 — Kernel and workflow repairs | 26 | 0 | **0%** | T-05…T-12, T-27, **T-28** all unstarted |
| 3 — The contract, then the server | 50 | 8 | 16% | P-00 and T-13a done; T-13b…T-15, P-01…P-05, R-08, R-10 open |
| 4 — The interface | 42 | 0 | **0%** | Zero `.tsx` files exist |
| 5 — Deploy readiness | 16 | 0 | 0% | Not started |
| **Total** | **145** | **19** | **13.1%** | |

**Remaining: 126 points.** T-14 plus all of Phase 4 is 50 of those — 40% of what is left. The other
**60% is diffuse**: Phase 2 (26), the rest of Phase 3 (34), Phase 5 (16). The remaining work is
*not* concentrated in the two big items, and planning as if it were will under-book the back half.

---

### How soft is 13.1%?

The caveat above says the figure is a ceiling because T-14 and Phase 4 were sized before anyone
attempted either. Quantified — 19 done points never move, only the denominator does:

| T-14 | Phase 4 | Denominator | Completion | Scenario |
|---|---|---|---|---|
| 8 | 42 | 145 | **13.1%** | as planned — the published figure |
| 16 | 63 | 174 | 10.9% | T-14 ×2, Phase 4 ×1.5 |
| 16 | 84 | 195 | 9.7% | T-14 ×2, Phase 4 ×2 |
| 24 | 84 | 203 | 9.4% | T-14 ×3, Phase 4 ×2 |
| 24 | 126 | 245 | 7.8% | T-14 ×3, Phase 4 ×3 |

Even at triple, the figure moves about five points. **The ceiling is real but shallow**, so
13.1% is not worth re-deriving — and §15.2 stays **0 of 8** in every scenario, which is why that
is the number to quote and this one is not.

**Where the remaining 126 points sit:** Phase 3's residue 42 (33.3%) · Phase 4 42 (33.3%) ·
Phase 2 26 (20.6%) · Phase 5 16 (12.7%). The two largest blocks are equal, and neither is a
majority.

## Verified today

Re-measured by running commands against the working tree:

| | |
|---|---|
| Branch | `fix/catalog-release-integrity`. Measurement pass at `ff63b87`; **pushed**, and `origin/fix/catalog-release-integrity` @ **`efbafbd`** is green |
| **CI on the tip** | **Run #10, Success**, 1m 34s — `verify` 1m 10s, `docs` 5s. Read from the PR checks page and the job log in a signed-in browser. Step list and the two Node-20 deprecation warnings in `docs/CURRENT_STATE.md` §4 |
| The ahead/unpushed pair moves as this file is written | Each documentation commit that records this measurement adds one to both counts, so **do not quote ahead/unpushed from this document** — re-run `git rev-list --left-right --count origin/main...HEAD` and `git rev-list --count @{u}..HEAD`. Session 3 added `e488a14`, `c08cca3` and the commit carrying this row. That self-reference is exactly how drift item 5 arose, and naming it is cheaper than chasing it |
| `main` | pushed and in sync with `origin/main` @ `0f1e7ac` |
| Packages | 11 |
| Test files | 44 (`*.test.ts`) |
| Migrations | 8 (`0001`–`0008`) |
| `.tsx` / `.jsx` / `.vue` / `.svelte` / `.astro` files | **0** |
| Server entry point | **none** — no `fastify`, `express`, `koa`, `hono`, `node:http`, `.listen(` anywhere in `apps/` or `packages/` |
| Front-end dependency | **none** — no `react`, no `vite` in any `package.json` |
| Route table | **20 entries** in `apps/api/src/authz/routes.ts` (11 client, 8 internal, 1 public). Imported only by `authorize.test.ts` and the package index — **no router mounts it**. Diffed against §8.2 both ways this session: short two MVP-1 routes, carrying one phase-2 route — see drift 4 |
| Git tags · `CHANGELOG.md` · Dependabot | none · none · none. `version` is `0.0.0` |
| CI gates present | typecheck, lint, migrate, test, **11** self-tested checkers, coverage, bench, docs rebuild + `git diff --exit-code`. Two landed today: `check-content-hash` (recomputes each release's `content_sha256` by the method that manifest declares) and `check-spot-check-record` (asserts every signed spot-check covers the draw that was pinned before it) |
| CI gates absent | secret scanning, dependency audit, bundle-size ceiling, E2E |

### Not verified today — the repository's own figures

- **"1,042 tests passing" and "100% coverage on every pure package."** The suite could not be run:
  `node_modules` holds win32 native binaries and the available shell is Linux. Statically there are
  44 test files and ~875 `it(`/`test(` call sites.
- ~~**"CI green."**~~ **Now measured, not claimed** — see *Verified today*. Run #10 on `efbafbd`
  reports Success, and the `verify` log lists Postgres containers, migrations, the tenancy tests and
  the RLS coverage assertion all green, each checker behind its own self-test. What it does **not**
  settle is the "1,042 tests passing / 100% coverage" figures above: CI reports a green job, not a
  count this session read. Historical note, because it was the point of the entry: three same-day
  documents disagreed —
  `review-findings` (07:31) says CI has *never* run; `catalog-release-approved` (09:21) says green
  on the previous head; `state-of-the-build` (10:12) says PR #1 green. The latest is taken as
  current, and it is a claim, not a measurement.
- ~~**No figure describes the tip.**~~ **Resolved.** `efbafbd` is pushed and green. The bridge shell
  still holds no git credentials, so every push must run from Windows — GitHub Desktop's *Push
  origin* is the route that worked, after adding the repo to it (its existing `Master-Rack` entry
  points at a second, near-empty clone at `C:\Rack Master\Master-Rack`, not at this working tree).

### Drift found while measuring

Session 2 found four. Session 3 re-measured them, **fixed nine and reclassified one**. Four of the
nine were found only by reading R-11's own acceptance criteria rather than the scoreboard's drift
list — including one this scoreboard published about itself.

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
| 6 | *(new)* T-04's `DONE` block sat **below** the `## Phase 2` heading, and still said `interlake-2026-09` was back to DRAFT with nothing pinnable — superseded the same day by `eaeb8f0` / `a2f166e` | **Fixed** — moved under T-04, and the re-approval verified against the manifest on disk |

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

This is the **sixth** consecutive session in which drift was found by measurement — a recurring
defect, not an accident. Note what the pattern cost here: session 2's remedy for drift 4, applied as written,
would have *hidden* two missing MVP-1 routes by moving the target to meet the code. **The precedence
rule earns its keep: the blueprint wins, and the scoreboard is what gets fixed.**

---

## What to do next, in order

### Immediate — close the branch out (est. 1 session)

1. ~~**Push the tip and confirm CI green on it.**~~ **Done — T-00 closed.** `efbafbd` pushed,
   run #10 **Success**. Pushes must run from Windows; the bridge shell has no credentials.
2. ~~**R-10 — judge the commits as commits.**~~ **Substantively done.** All 36 subjects judged —
   35 clear the standard, one (`36881f3`) stops mid-clause. `7559889`'s 1,294 lines are 873 data and
   204 test, so ~217 lines of source: within guidance. `14d608f`'s 17 files are one coherent change,
   not a refactor hiding behaviour. Nothing touches the read-only reference projects. **Open:** the
   per-commit `typecheck && test`, which needs Windows — a partial substitute was run instead
   (every relative import resolves at its own commit, **0 of 36** unresolved). Includes the fair question of whether two RLS commits and a perf
   harness belonged on a branch named for catalog release integrity.
3. ~~**R-08 — the catalog data reviewed as data.**~~ **Done**, re-derived here rather than read off
   the tests: 378 → 336 rows, exactly 42 phantom rows gone, exactly 264 capacity corrections, 435
   frame cells, 43 of 43 pinned cell ids resolve, sample floors 20 and 22 reproduce. The data is in
   good order. **Four findings, all in the prose around it** — F-12 (the change log denies a
   face-height change it made to 168 rows), F-13 (the approved manifest still says it is DRAFT),
   F-14 (the draw is recorded twice), F-15 (the E/ER collision is the whole chart, not a 59E quirk,
   so the top-up is the normal case and `cells: 336` counts rows not readings).
   **F-12 and F-13 are now fixed** — prose only, no value touched, and the hash and approval gate
   confirmed unaffected before the edit. Underneath them sat **F-19**: `content_sha256` had no
   verifier at all, and its *method* differed between the two releases in the same directory with
   the definition written down nowhere. Now declared per manifest, recomputed by
   `check-content-hash` with an 11-case self-test ahead of it, and **proven to fire against the real
   release**. The 2026-09 digest also turns out to be reproducible only by Python, because
   `face_height_in: 4.0` hashes differently once any other JSON implementation renders it `4`;
   re-basing it would change an APPROVED release, so that is EL's call, recorded not taken.
   **F-16 is fixed** (the claim now says "identical after parse", and names the consequence that
   reformatting either file leaves it green — demonstrated accidentally while making the edit).
   **F-14 is withdrawn as filed**: `pending_spot_checks` and `human_spot_checks` are the question and
   the answer, kept apart deliberately so the sample can be shown to have been fixed before it was
   read, and the code says so at the point where deleting the pin would have been easiest. The real
   finding underneath survived — **nothing asserted that the signature covers the draw**, and
   `approveRelease` never compares them. `check-spot-check-record` now does, with 10 self-test cases
   and proven to fire on the real release. **F-15's counting note is in the manifest**; its code half
   changes the draw on an APPROVED release and is left to the approver.
4. **Merge PR #1 — and rename it first.** It has lived far past the 1–3 day window a short-lived
   branch is supposed to occupy, and its name stopped describing its contents around commit five.
   **L-12 answered:** the two RLS commits (`73ca8d1`, `75192d0`) did belong on their own branch, and
   splitting them out now costs more review than it buys — they have already been reviewed here
   (F-01, F-03, F-04, F-05) and CI is green on the tip. Merge as one, but retitle the PR to what it
   is: *catalog release integrity, the RLS audience boundary, the wire contract, and a measured
   scoreboard*. Then one short-lived branch per task from Phase 2, as the plan already requires.
   **Fix F-12 and F-13 before the merge** — they are wrong sentences inside an approved catalog
   release, which is the one artifact that must not carry a false record.
5. ~~**Fix the four drift items above in the same commit as the merge.**~~ **Done in session 3**:
   drift 1, 2, 3, 5 and 6 corrected, drift 4 reclassified as T-14 implementation.

   **Correction, same session.** Earlier today this step claimed *"R-11 is closed on the
   documentation, taking the review to 9 of 11."* **That was wrong, and it was published to all four
   copies before it was checked.** The scoreboard's drift list and R-11's six acceptance criteria
   are different lists; fixing the first closes none of the second. Re-reading R-11's own criteria
   found three more stale documents, now fixed — see *Drift found while measuring*. R-11 **is** now
   closed, against its own criteria, and the review is **8 of 11**, not 9: R-11 joins the done
   column and so does R-08, while R-10 does not. The lesson is the one R-11 exists to teach, landed
   on the person applying it: **a documentation fix is worth exactly the measurement behind it.**

### Then — Checkpoint A, which was skipped

`tasks/todo.md` puts Checkpoint A after T-00…T-12 and requires *"Review with EL before Phase 3"*.
Phase 3 started anyway: P-00 and T-13a are done while **T-05…T-12 and T-27 are untouched**. The
checkpoint can no longer go green in sequence. Two honest options: run Phase 2 now and hold the
checkpoint, or amend the plan on the record to say the checkpoint moved. Silently leaving it is the
third option and it is the one that produces the next audit finding.

Phase 2 in dependency order: **T-05** (contentHash ≠ manifestHash) → **T-06** (record the
acknowledgement) → **T-07/T-08** (orchestration off the client, into `packages/workflow`) →
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

- ~~**The tip is unverified.**~~ **Closed.** The gap had grown from one unpushed commit to eight
  inside two sessions before it was closed, which is the argument for pushing per task rather than
  per branch. Keep it closed: push each task's commit as it lands.
- **The runner is on borrowed time.** Run #10 carries two warnings — Node.js 20 is deprecated, so
  `actions/checkout@v4`, `actions/setup-node@v4`, `actions/setup-python@v5` and
  `pnpm/action-setup@v4` are being forced onto Node 24. Pin newer action versions before it becomes
  an error rather than a warning.
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

- **Merge the branch.** **30** commits, well past short-lived, and the name stopped describing the
  contents around commit 12. It grew by three while sitting unmerged.
- ~~**Push the tip.**~~ Done: `efbafbd`, CI green.
- From Phase 2 on, **one short-lived branch per task**, merged within a day or two. The tasks are
  already sized for it — and push each one, rather than letting eight commits accumulate again.
- **No tags, no `CHANGELOG.md`, version `0.0.0`.** Fine today — nothing consumes this yet. The
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
