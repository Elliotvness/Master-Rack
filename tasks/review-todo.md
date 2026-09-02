# Review TODO — `fix/catalog-release-integrity` (d82c5eb..0b9fd73)

Companion to `tasks/review-plan.md`. Eleven review tasks, four phases, four checkpoints.
Nothing here is checked without the command and its actual output recorded, per `LATEST.md` §10.

**Finding severities** (used in every task's output): **Critical:** blocks merge · *(no prefix)*
required before merge · **Consider:** worth doing, not required · **Nit:** optional · **FYI**
informational. Order findings by leverage. One structural problem outranks ten nits.

**Where findings go.** Each task appends its findings to `tasks/review-findings.md` (created by
R-01) under its own task heading, with a severity, a file:line, and — for anything above Nit — the
*structural remedy proposed*, not just the problem. A review that says "this is complex" and stops
leaves the author guessing.

**Running the DB-backed tests.** Windows: `pnpm db:up && pnpm migrate`. Linux workspace: the
embedded-postgres recipe in `LATEST.md` §4, all in one shell invocation. Without a live Postgres,
R-01, R-02 and R-09 cannot complete and the branch does not merge.

---

## Phase A — The trust boundary

### R-01: Review `0005_revision_audience_rls.sql` and its tenancy tests

**Description:** The most serious defect the Rev C audit found, and its fix. Four generic tenant
policies on `app.revision` are dropped and replaced with four audience-aware ones. Verify the
replacement is strictly narrower than what it replaced, that `WITH CHECK` is present everywhere it
must be, and that the tests prove absence rather than filtering.

**Acceptance criteria:**
- [ ] Every policy dropped in 0005 is confirmed to exist in `0002_rls.sql` under exactly that name —
      a `DROP POLICY IF EXISTS` on a misspelt name silently leaves the old wide policy in place, and
      Postgres ORs it with the new one
- [ ] The new predicate is traced against `app.current_org()` and `app.is_staff()` as defined in
      `0003_auth.sql`, not as described in the migration's comment
- [ ] `SELECT`/`INSERT`/`UPDATE`/`DELETE` all covered; `UPDATE` carries both `USING` and `WITH CHECK`
- [ ] Confirmed that no *other* table policy reads `revision` in a subquery and re-widens the path to
      an internal revision (`bom_line`, `document`, `derived_*` — check each)
- [ ] The `(organization_id, audience)` index from `0001_init.sql` is still usable by the new
      predicate; note it if not (Performance axis)
- [ ] `tenancy.test.ts`'s D-02 block asserts an internal revision of the client's *own* org is absent
      to a client principal — not merely that a cross-org read fails
- [ ] Confirmed `stripInternalRevisions()` was **kept**, per the two-independent-controls design

**Verification:**
- [ ] `pnpm migrate && pnpm check:rls` — PASS, output recorded
- [ ] `pnpm test packages/db/src/tenancy.test.ts` — green, output recorded
- [ ] Manual: drop the `AND audience = 'client'` clause in a scratch DB and confirm the D-02 tests
      fail. A test that passes with the fix removed is not testing the fix.

**Dependencies:** None. **Size:** M (3 files). **Files:** `packages/db/migrations/0005_*.sql`,
`packages/db/src/tenancy.test.ts`, `packages/db/migrations/0002_rls.sql` (read-only reference).

---

### R-02: Review `0006_audit_event_actor_audience.sql` and settle the AC-14 question

**Description:** A one-file, no-test commit that narrows what a client admin can read from the audit
log, from "events about my organization" to "events my own people generated as client actors". It is
correct against AC-14 and possibly wrong against the product. Both halves need answering.

**Acceptance criteria:**
- [ ] `actor_organization_id` and `actor_type` confirmed **NOT NULL** in `0001_init.sql`. A nullable
      column in a `USING` clause yields NULL, not false — rows vanish for staff too, or worse
- [ ] The dropped `audit_event_select` confirmed to be the only SELECT policy on the table
- [ ] The `actor_type = 'client'` half is justified on the record: which principal types exist, and
      which of them can write an event inside a client organization (`SERVICE_ENGINE` is named in the
      migration comment — verify it against `0003_auth.sql`)
- [ ] The append-only guarantee from the earlier migration is confirmed intact after the policy swap
- [ ] A tenancy test exists that fails if the `actor_type` half is removed. If `tenancy.test.ts`'s
      AC-14 block only covers `actor_organization_id`, that test is written (L-10)
- [ ] `audit_event_actor_org_idx` does not duplicate an existing index on the same leading column
- [ ] **EL has answered:** AC-14 (absence) or the activity feed (visibility). If the feed, this
      commit is reverted and the finding is that the code chose a product direction

**Verification:**
- [ ] `pnpm check:rls` PASS
- [ ] `pnpm test packages/db/src/tenancy.test.ts` green, and green *only with the fix present*
- [ ] Manual: as a client admin principal, `SELECT` the audit log after a staff-derived revision and
      confirm zero rows

**Dependencies:** R-01 (same test file, same checker). **Size:** S (1 file + 1 test file).
**Files:** `packages/db/migrations/0006_*.sql`, `packages/db/src/tenancy.test.ts`.

---

### R-03: Review the `check-rls.mjs` sensitivity-column assertion

**Description:** The checker built for D-02 that immediately found D-06. Its value is proven; its
gaps are the missing self-test and the un-policed exemption list. Every other checker in this repo
has a self-test and `pnpm verify` runs it first.

**Acceptance criteria:**
- [ ] `SENSITIVITY_COLUMNS` justified: why `audience` and `actor_type` and nothing else. Grep the
      schema for other columns carrying a non-tenancy axis and either add them or record why not
- [ ] Both `SENSITIVITY_EXEMPTIONS` entries are re-derived from `0001_init.sql` and `0003_auth.sql`,
      not accepted from their own comment
- [ ] A stale-exemption assertion added: an exemption naming a table or column that no longer exists
      fails the checker. A silent skip is how an exemption outlives its reason
- [ ] The `\b<column>\b` regex is assessed for false *passes* — a policy mentioning another table's
      `audience` in a subquery would satisfy it. Blunt by design; confirm the design note says so
- [ ] `tools/selftest-rls.mjs` written, matching the shape of `selftest-boundaries.mjs`: a fixture
      schema with a sensitivity column in no policy must make the checker FAIL
- [ ] The self-test wired into `pnpm verify` before `check:rls`, matching every other checker (L-8)

**Verification:**
- [ ] `pnpm check:rls` PASS with output recorded
- [ ] New: `node tools/selftest-rls.mjs` exits 0, and exits non-zero when its own fixture is made
      compliant (the self-test must be able to fail)
- [ ] `pnpm verify` still green end to end

**Dependencies:** R-01. **Size:** M (2 files + `package.json`). **Files:** `tools/check-rls.mjs`,
`tools/selftest-rls.mjs` (new), `package.json`.

---

### Checkpoint A — the boundary holds
- [ ] `pnpm check:rls` and the full `packages/db` suite re-run by the reviewer, output recorded
- [ ] Both migrations traced by hand against `0001`/`0002`/`0003`, not against their comments
- [ ] Every Phase A finding categorised; **no Critical: left open**
- [ ] EL has answered the audit-log question (review-plan decision 1)
- [ ] If any RLS test could not be executed, this checkpoint **fails** and the branch does not merge

---

## Phase B — The approval gate

### R-04: Review `release.ts` — the refusal set and the file's shape

**Description:** `release.ts` went 137 → 353 lines and now carries the status enum, three record
types, the manifest interface, two error classes and five functions. Review the refusal logic as a
set, and answer the extraction question now rather than after Phase 3 adds to it.

**Acceptance criteria:**
- [ ] Every clause in `approvalRefusals` traced to a blueprint §10.2 sentence or marked as an
      addition the blueprint does not require (additions are fine; unrecorded ones are not)
- [ ] The clause ordering is confirmed deliberate: `correctedBy` first, then identity, then paths,
      then spot-checks, then completeness — and the function accumulates rather than short-circuits,
      so an approver sees every reason at once
- [ ] `REQUIRED_DATASETS` vs `manifest.datasets` asymmetry (L-7) confirmed deliberate and commented:
      a release shipping a third dataset currently needs no verification path for it
- [ ] The duplicated six-member `Pick<>` in `approvalRefusals` and `canApprove` is extracted to one
      named type; `approvedBy` is removed from it if it is genuinely unread (L-6)
- [ ] `quarantineRelease`'s refusal to quarantine an APPROVED release is confirmed against FR-CT-06,
      and confirmed to be unreachable-by-accident rather than a gap
- [ ] **The extraction question is answered on the record:** does `release.ts` split into
      `release-types.ts` + `approval.ts` + `lifecycle.ts` now, or is 353 lines still one coherent
      module? Either answer is acceptable; deferring is not
- [ ] No `any`, no non-null assertion, no silent fallback introduced by the diff

**Verification:**
- [ ] `pnpm test packages/kernel-catalog` green
- [ ] `pnpm typecheck && pnpm lint` exit 0
- [ ] `pnpm check:boundaries` PASS — the package must stay pure
- [ ] Manual: for each refusal clause, confirm a test exists that fails when that clause alone is
      deleted. Clauses without such a test are a finding.

**Dependencies:** None (parallel with Phase A). **Size:** M (1 source + 1 test file).
**Files:** `packages/kernel-catalog/src/release.ts`, `release.test.ts`.

---

### R-05: Close the loop — does the gate verify the draw it demanded? *(highest leverage)*

**Description:** D-07's whole point is that a machine checking its own work is not two people. The
fix requires the *tool* to draw the sample so the approver cannot pick easy cells. Verify that the
gate actually enforces the draw it pinned — L-1 says it may only enforce the sample's *size*.

**Acceptance criteria:**
- [ ] Traced end to end: `draw-spot-check.mjs` writes `pending_spot_checks` → the approver reads
      those cells → the record moves to `human_spot_checks` → `spotCheckRefusals` runs. Name the step
      at which the *identity* of the cells is checked, or confirm there is none
- [ ] If none: a refusal is added requiring `sampledCells` to equal `drawSpotCheckSample(cellIds,
      seed, requiredSampleSize(cells))` for the release's own dataset. This needs the cell ids, so it
      belongs where the datasets are loaded — propose the seam (`release-integrity.test.ts` proves it
      today; the *gate* is where it must live)
- [ ] `requiredSampleSize`'s `Math.min(cells, …)` branch is confirmed intentional: a 10-cell dataset
      requires 10, not 20. Confirm no dataset is small enough for that to weaken the rule materially
- [ ] The partial Fisher-Yates is confirmed unbiased over `pool.length - i`, and `mulberry32` is
      confirmed seeded deterministically with no dependence on call order elsewhere
- [ ] `outcome !== 'MATCHED'` — confirm the free-text `outcome` cannot be satisfied by a near-miss
      (`'matched'`, `' MATCHED'`). Propose a closed union if it can
- [ ] The scope note ("required of every release, not only machine-digitised ones") is confirmed to
      match §10.2 and confirmed not to be quietly bypassable by an empty `REQUIRED_DATASETS` match
- [ ] L-13: `spot-check.ts` has no `spot-check.test.ts`. Its behaviour is exercised only through
      `release.test.ts`. Either a paired test file is added (matching every other module in the
      package) or the indirect coverage is confirmed to reach every branch and recorded as deliberate

**Verification:**
- [ ] `pnpm test packages/kernel-catalog` green
- [ ] New regression test (if L-1 confirms): a `human_spot_check` with the right *count* of
      *fabricated* cell ids and a valid seed must be REFUSED. Record it failing before the fix
- [ ] `pnpm check:determinism` PASS — the draw is part of the determinism surface

**Dependencies:** R-04. **Size:** M (2 source + 2 test files). **Files:**
`packages/kernel-catalog/src/spot-check.ts`, `release.ts`, their tests, `release-integrity.test.ts`.

---

### R-06: Review `tools/draw-spot-check.mjs` — the duplicated kernel

**Description:** The tool reimplements `requiredSampleSize`, `mulberry32` and the draw in plain JS
because a `.mjs` tool cannot import the TS package. One test binds the current pinned draw to the
kernel's. Price the duplication before a second tool needs the same code, and check what the tool
does to the manifest file.

**Acceptance criteria:**
- [ ] The two `requiredSampleSize` implementations are diffed: the tool's lacks the TS version's
      integer/negative guard. Either align them or record why the tool needs no guard
- [ ] The two draws are proven equivalent for the pinned seeds, not assumed — `pool[i]` after the
      swap and the TS's `b` are the same value; confirm rather than eyeball
- [ ] A remedy is chosen and recorded: (a) build the kernel and import the compiled JS, (b) keep the
      copy and add a self-test asserting tool-draw ≡ kernel-draw over random seeds, or (c) accept the
      duplication with a comment pointing at the binding test. **(b) is the proposal** — it is the
      repo's own convention and costs an hour
- [ ] `JSON.stringify(manifest, null, 1)` — the survey confirmed the manifests are indent-1, so this
      matches today. Confirm the round trip preserves key order and unknown keys, and add a note so a
      future hand-formatted manifest does not silently get reflowed (L-9)
- [ ] Unknown keys in the manifest survive the read-modify-write round trip
- [ ] The double `draw()` call — once into `pending`, once into `console.log` — is collapsed
- [ ] The refuse-to-redraw guard is confirmed to have no `--force` escape hatch, deliberately

**Verification:**
- [ ] `node tools/draw-spot-check.mjs interlake-2026-09` refuses (a draw is already pinned), exit 1
- [ ] On a scratch copy: draw, then `git diff --stat` shows only `pending_spot_checks` added
- [ ] New self-test (if remedy (b)): `node tools/selftest-spot-check-draw.mjs` exits 0
- [ ] `pnpm test packages/kernel-catalog/src/release-integrity.test.ts` green

**Dependencies:** R-05. **Size:** S (1 tool + 1 self-test). **Files:** `tools/draw-spot-check.mjs`,
`tools/selftest-spot-check-draw.mjs` (new), `packages/kernel-catalog/src/spot-check.ts` (reference).

---

### Checkpoint B — the gate is a gate
- [ ] L-1 confirmed or dismissed **on the record**, with the code path named either way
- [ ] `pnpm test packages/kernel-catalog` green, including any regression test the review added
- [ ] The `release.ts` extraction question answered yes or no
- [ ] `pnpm check:boundaries && pnpm check:determinism` PASS

---

## Phase C — The parse and data boundary

### R-07: Review `load-manifest.ts` — where hand-edited JSON becomes trusted objects

**Description:** New module, 176 lines, and the answer to the audit's sharpest finding: the gate had
never seen a manifest from disk. Its posture is "throw with the field named" — verify that posture
holds on every field, especially the ones the gate reads.

**Run 2026-09-02 (Checkpoint A), read-only, against `main` @ `e86d2bf` — 183 lines now.** Every
"passes"/"throws" below was produced by feeding the shape through `loadReleaseManifest` in the
container, not by reading the code.

**Acceptance criteria:**
- [~] L-3 **dispositioned, not resolved** — `approved_by: 42` → passes, `approvedBy = null`.
      It is *documented as deliberate*: `load-manifest.test.ts` pins it ("a non-string in an optional
      string field reads as absent, not as a value") with the rationale that the alternative "reads a
      number as a signature". **The reviewer disagrees with the rationale:** the alternative to
      returning `null` is *throwing*, which reads nothing as a signature and is what the module's own
      docstring promises. Fails safe today (no signature is seen), silently. **Recommendation:
      fix to throw** — one line in `strOrNull`, one test flipped. **EL's call at the checkpoint;**
      the criterion's "documented as deliberate" branch is technically met, and this note is the
      dissent on the record
- [x] L-2 resolved — `pending_spot_checks` is *deliberately* outside the loader: it is a tool-side
      workflow record read by `draw-spot-check`, `record-spot-check`, `spot-check-worksheet` and
      validated by `check-spot-check-record` (self-tested, in `pnpm verify`) and by
      `release-integrity.test.ts`. The gate never reads it, so the loader has nothing to validate
      it *for*
- [~] L-5 **dispositioned, not resolved** — `constraints: {a: "x"}` → passes, `constraints = {a: "x"}`
      under a type that says `Record<string, number>`. Still the only unchecked cast. Mitigating fact,
      measured: **nothing outside the loader reads `.constraints` at runtime** (`grep` over
      `packages/` and `apps/`, excluding tests, finds no reader). A lie in a field nobody reads.
      **Recommendation:** validate as `Record<string, number>` and throw on anything else — same
      size as L-3. **EL's call**
- [x] L-4 dispositioned — `content_sha256` is **not** verified by the gate or the loader (the loader
      is pure and cannot hash files). It is verified by `tools/check-content-hash.mjs` (F-19), under
      the release's own declared `content_sha256_method`, with an 11-case self-test, in `pnpm verify`
      and CI. Disposition: verified outside the loader by a control that has been proven to fire.
      Whether the *gate* should also refuse on a hash it was not handed is a T-14 question, not a
      loader one
- [x] Every field the gate reads is validated here: `datasets` (`strArray`, throws on a non-array or
      non-string element), `verificationPaths` (kind ∈ two known values, integer `cells`, non-empty
      `dataset`/`note`), `humanSpotChecks` (integer `cells` and `seed`, string arrays, five non-empty
      strings), `correctedBy` (`strOrNull`), `status` (∈ five known values), `digitisedBy` (non-empty
      string — `digitised_by: 7` throws, measured)
- [x] Missing `datasets` → `datasets = []` → `completenessRefusals` returns **two** refusals, one per
      required dataset ("'beams' is missing", "'frames' is missing"); `datasets: ["beams"]` → one.
      It refuses. The message names the *effect* (which dataset is missing), not the *cause* (the
      field was absent) — acceptable, since the remedy is the same either way, and noted
- [x] Error messages name the release (`manifest 2026-09:`), the field and the index
      (`human_spot_checks[0]: 'seed' must be an integer — the draw must be reproducible`;
      `verification_paths[0]: 'cells' must be an integer`; `'digitised_by' must be a non-empty
      string`). They do **not** name the *file* — the loader is pure and never sees a path, and
      `release-integrity.test.ts:44` does not wrap the call with one. When `rev` itself is missing the
      message is `manifest: 'rev' must be a non-empty string`, with nothing to identify which
      manifest. Minor; recorded

**Verification:**
- [x] `release-integrity.test.ts` green — 19 tests, inside the 1,143 / 50 / 0-skipped container run
      and the Windows run at `89e55fa`
- [x] Manual, recorded: `approved_by: 42` → passes (`null`); `approved_by: ""` → passes (`null`);
      missing `datasets` → passes the loader, refused by completeness (2 reasons);
      `seed: "20260901"` → throws `ManifestError`; `constraints: {a: "x"}` → passes, value kept;
      plus `digitised_by: 7`, `status: "approved"`, `verification_paths[0].cells: "336"` → throw,
      field named
- [x] `pnpm typecheck` exit 0 — first step of the same verify runs

**Dependencies:** R-04. **Size:** M (1 source + 1 test file). **Files:**
`packages/kernel-catalog/src/load-manifest.ts`, `release-integrity.test.ts`.

---

### R-08: Review the catalog data — the two manifests and `frames.json`

**Description:** 850 lines of transcribed frame data moved into the approved release, and both
manifests rewritten. Reviewed as data, against its source, not read as code.

**Acceptance criteria:**
- [x] `frames.json` is byte-identical to the 2026-08 tables, verified by the reviewer's own
      `git show eeaafef^:data/catalog/interlake-2026-08/frames.json | diff -` — independently of the
      test that asserts it
- [x] The 2026-08 manifest's transcribed values are confirmed **unchanged** by the quarantine commit.
      Quarantine records that values were wrong; it must not correct them
- [x] `quarantine_reason` and `corrected_by` on 2026-08 are non-null and name the correcting release
- [~] `interlake-2026-09` is `DRAFT`, its `approval_held_because` is accurate, and `approved_by` /  — **criterion superseded**, not failed: `eaeb8f0`/`a2f166e` re-approved the release against a recorded human spot-check. See F-13 for the stale prose that survived
      `approved_at` are null or empty — no residue of the hand-typed APPROVED
- [x] The pinned `pending_spot_checks` cell counts (20 of 336 beams, 22 of 435 frames) are re-derived
      from `requiredSampleSize`: `max(20, ceil(0.05 × 336)) = 20` and `max(20, ceil(0.05 × 435)) = 22`
- [x] Every pinned cell id resolves to a real row in `beams.json` / `frames.json`
- [~] `source_anomalies` and `constraints` carry forward unchanged from the verified 2026-08 set  — `constraints` unchanged; `source_anomalies` **deliberately** changed (8 → 3): the 59E face-height anomaly was resolved by the re-source, five `code_18` entries consolidated, one new 65QR anomaly added and pinned
- [x] The 42 phantom 40E/40ER-F3M rows (D-08) are confirmed still absent

**Verification:**
- [x] `pnpm test packages/kernel-catalog` green  — was **NOT RUN HERE** (win32 pnpm store, no Linux rollup/esbuild), covered by CI on `efbafbd` and `a5d9c5b`. **Run 2026-09-02** inside the Checkpoint A verify runs: `kernel-catalog`'s nine test files — release 46, release-integrity 19, psg-authority 11, frames 27, lookup 24, spot-check 25, load-manifest 31, cell-ids 10, projection 7 = **200 tests** — green in the container, on Windows and in CI #48. R-08 closes on its own criteria
- [x] `pnpm lint:provenance` PASS — every value carries its citation
- [x] `node -e` script confirming every `pending_spot_checks` cell id exists in its dataset

**Dependencies:** R-05, R-07. **Size:** M (4 data files). **Files:**
`data/catalog/interlake-2026-09/{manifest,frames}.json`, `data/catalog/interlake-2026-08/manifest.json`.

---

### Checkpoint C — the data says what it did
- [x] L-2 … L-5 each have a written disposition
- [x] `frames.json` byte-identity verified independently of the test claiming it
- [x] `pnpm lint:provenance` PASS

---

## Phase D — Verification and change hygiene

### R-09: Verify the verification

**Description:** Re-run every figure the branch claims, as the reviewer, from a clean checkout. The
branch's numbers are the branch's own and CI has never executed.

**Run 2026-09-02 (Checkpoint A), from a fresh `git clone` of the public repository into the
container, `main` @ `e86d2bf`, native Postgres 16 migrated by `pnpm migrate`.** The branch-era
figures below (961 / 42, 74, "7 gates") are left as written; the measured ones sit beside them.

**Acceptance criteria:**
- [x] ~~961 tests / 42 files~~ → **1,143 tests / 50 files, 0 skipped**, `pnpm verify` exit 0 in
      84 s. The same figures on Windows at `89e55fa` (one commit further, F-36's checker change —
      no test files differ), 0 skipped, from the log in `_to_delete/verify-windows.log`
- [x] ~~74~~ → **100 DB-backed tests executed, 7 files**, none skipped, in both runs:
      `packages/db/src/tenancy.test.ts` 41 · `apps/api/src/workflow/submit-effects.db.test.ts` 12 ·
      `apps/api/src/auth/auth.db.test.ts` 12 · `apps/api/src/audit/chain.db.test.ts` 12 ·
      `packages/db/src/part-registry.db.test.ts` 8 · `apps/api/src/outbox/outbox.db.test.ts` 8 ·
      `packages/db/src/assumption.db.test.ts` 7. (The Windows run's *first* attempt skipped 92 of
      them over an unmigrated database and still ticked `pnpm test` — F-29, recorded there)
- [x] `pnpm verify` re-run — ~~7 gates~~ now typecheck, lint, test, **twelve** self-tested checkers,
      coverage: all green in the container. On Windows, everything green **except the final
      coverage step** — F-37, a gate whose verdict depends on the OS
- [x] `pnpm typecheck` and `pnpm lint` exit 0 — stronger than `pnpm clean`: a fresh clone with a
      fresh `pnpm install --frozen-lockfile`, no prior `dist/`
- [x] Three breaks planted by the reviewer, each gate red then green after restore, run as
      `node tools/<checker>.mjs` directly:
      **(1)** `apps/client-web/src/__plant__.ts` importing `@rms/kernel-bom` → `check-app-boundaries:
      FAIL … the BOM, which a client never sees at any depth`, exit 1;
      **(2)** a shipped string literal `'This ledger is tamper-proof.'` in the same app →
      `check-language: FAIL … says "This ledger is tamper-proof."`, exit 1;
      **(3)** `@rms/kernel-geom: workspace:*` added to `apps/api/package.json` with the lockfile
      untouched → `check-lockfile: FAIL … the lockfile does not record it`, exit 1.
      **Two lessons from getting it wrong first:** the reviewer's initial plants for (2) and (3)
      were *outside the gates' stated scope* — "tamper-proof" in `src/parts/*.html` (that is
      `src/verify.py`'s beat, run by CI's `docs` job, not `check:language`, which scans string
      literals in `apps/` and `packages/`) and an *external* dependency absent from the lockfile
      (`check-lockfile` is deliberately workspace-only; `--frozen-lockfile` is the authority for
      the rest). Both gates stayed green on those plants **and were right to** — each states its
      blind spot in its own header. A planted failure only proves a gate if it lands inside what the
      gate claims
- [x] Superseded by T-27 (done, PR #5): test files are type-checked by `tsc -p tsconfig.tests.json`
      as the second half of `pnpm typecheck`, in every verify run above
- [x] Coverage on `kernel-catalog` re-measured; 100% statements/branches or the real figure recorded

**Verification:**
- [x] `pnpm verify` summary recorded under **"Verify runs recorded for R-09 / Checkpoint A"** in
      `tasks/review-findings.md`; full logs kept outside the repo (container:
      `/tmp/verify-main-e86d2bf.log`; Windows: `_to_delete/verify-windows.log`, gitignored)
- [x] `pnpm coverage` output for `kernel-catalog` recorded
- [x] ~~`npx tsc --noEmit packages/kernel-catalog/src/*.test.ts`~~ — superseded: `tsconfig.tests.json`
      covers every `*.test.ts` and runs inside `pnpm typecheck`, exit 0 in every run above

**Dependencies:** Checkpoints A, B, C. **Size:** S (no source changes). **Files:** none — output only.

---

### R-10: Review the commits as commits

**Description:** Change sizing, splitting and descriptions. Seven commits on a branch named for
catalog release integrity, two of which are RLS work on a different subsystem.

**Acceptance criteria:**
- [x] Each commit's first line judged against the standard: short, imperative, standalone, and
      informative enough to find in history. Flag any that read as "Fix bug" / "Phase 1"
- [x] Each commit is confirmed to leave the tree green on its own (`git stash`-free: check out each
      SHA, run `pnpm typecheck && pnpm test`). A commit that only builds with its successor is a
      finding
- [x] `7559889` (1,294 lines) assessed against the sizing guidance: 850 of them are data, so it is
      ~440 lines of code — record the judgement rather than the raw number
- [x] L-12 answered: do `75192d0` and `73ca8d1` belong on this branch, or on their own with their own
      reviewer? Recommend, with the push command for whichever shape wins
- [x] Confirm no commit mixes a refactor with new behaviour in a way that hides either
- [x] Confirm nothing in the branch touches `C:\Rack Master\Resourse (do not delete or overwrite files)\`

**Verification:**
- [x] `git log --format='%h %s' 0f1e7ac..HEAD` reviewed line by line, judgement recorded per commit
- [x] ~~For each of the 7~~ **for each of the 39 commits in `0f1e7ac..0547c78`** (the branch grew
      after this criterion was written): `git checkout <sha>`, `pnpm install --frozen-lockfile`,
      a **fresh database migrated at that commit**, `pnpm typecheck && pnpm test` — **run 2026-09-02
      in the container**, in a detached worktree, oldest first. **36 of 39 green on their own**, 0
      skipped at every one; test count climbs 926 → 1,081 across the range (dips 1,042 → 1,041 at
      `eaeb8f0`, the re-approval commit, and stays there for three commits). **3 of 39 are not
      self-standing under CI semantics:** `e3ef4fa` (the wire contract), `48c7654` (P-00, the
      bench) and `5c3f17b` (state of the build) all fail `pnpm install --frozen-lockfile` —
      `e3ef4fa` added `@rms/contracts: workspace:*` to `apps/api/package.json` and the lockfile
      caught up only at `de399c7`, three commits later. With `--no-frozen-lockfile` all three
      typecheck and test green (1,081 / 1,081), so the *code* at each stood alone; the *commit* did
      not, and CI at any of the three would have died at install. That is precisely the defect
      `check-lockfile` (added at `6f05043`, one commit after the lockfile caught up, self-tested,
      in `pnpm verify`) now catches before a push — so it is recorded here rather than filed again.
      Summary table below; the per-commit logs stayed in the session container
- [x] Restore — the run used a separate worktree; `main` was never checked out away from

| # | sha | install (frozen) | typecheck | test | files / tests |
|---|---|---|---|---|---|
| 1 | `d82c5eb` | 0 | 0 | 0 | 39 / 926 |
| 2–9 | `7559889` … `36881f3` | 0 | 0 | 0 | 40 / 945 → 974 |
| 10–12 | `540f4cd` … `270631b` | 0 | 0 | 0 | 41 / 987 → 993 |
| 13–16 | `c6f603e` … `da10b51` | 0 | 0 | 0 | 43 / 1,042 |
| 17–20 | `eaeb8f0` … `bb9ff14` | 0 | 0 | 0 | 43 / 1,041 |
| 21–22 | `14d608f`, `a2f166e` | 0 | 0 | 0 | 43 / 1,059 |
| **23** | **`e3ef4fa`** | **1** — lockfile behind `apps/api/package.json` | (0 with `--no-frozen-lockfile`) | (0) | (44 / 1,081) |
| **24** | **`48c7654`** | **1** — same | (0) | (0) | (44 / 1,081) |
| **25** | **`5c3f17b`** | **1** — same | (0) | (0) | (44 / 1,081) |
| 26–39 | `de399c7` … `0547c78` | 0 | 0 | 0 | 44 / 1,081 |

Every row: a fresh `rms_r10` database created and migrated at that commit, 0 tests skipped.

**Dependencies:** R-09. **Size:** S (no source changes). **Files:** none — output only.

---

### R-11: Close the documentation drift this branch created

**Description:** The audit's D-19 found four documents disagreeing. This branch fixed some of that
and created new drift of its own — most concretely, it took migration number `0006`, which
`tasks/todo.md` T-09 has reserved for `part` / `part_revision`.

**Acceptance criteria:**
- [x] `tasks/todo.md` T-09 renumbered to `0007`, and T-03's reference to `0005` confirmed still right
- [x] `tasks/plan.md` checked for any other migration number, test count or file count the branch
      invalidated
- [x] `LATEST.md`'s figures reconciled with R-09's measured ones — any that differ are corrected, not
      re-asserted
- [x] `TODO.md` RH-05's DRAFT/APPROVED disagreement re-checked against the manifests as they now
      stand (2026-09 is DRAFT again, so RH-05 may now be *right* by accident — record which)
- [x] `docs/CURRENT_STATE.md` §10's stale package count and commit count updated or confirmed as
      T-10's job, not this review's
- [x] `tasks/review-findings.md` linked from `tasks/plan.md` so the next session finds it

**Verification:**
- [x] `grep -rn "0006\|0007" tasks/ docs/ TODO.md LATEST.md` — every hit is correct
- [x] `pnpm check:docs` (blueprint rebuild) then `git diff --exit-code` on the built HTML
- [x] `pnpm check:language` PASS — note it scans `apps/` and `packages/` only, so `tasks/` and  — PASS, 68 files; the review's own prose read by hand against the banned list
      `LATEST.md` prose is **not** covered; read the review's own wording against the banned-phrase
      list by hand

**Dependencies:** R-09. **Size:** S (4-5 doc files). **Files:** `tasks/todo.md`, `tasks/plan.md`,
`LATEST.md`, `TODO.md`, `docs/CURRENT_STATE.md`.

---

### Checkpoint D — the merge decision
- [ ] All tests re-run by the reviewer, DB-backed included, output in `tasks/review-findings.md`
- [ ] `pnpm verify` re-run, all 7 gates, output recorded
- [ ] Every finding is **fixed on a commit atop the branch**, **filed as a task in `tasks/todo.md`**,
      or **explicitly waived by EL** — no finding is closed by being forgotten
- [ ] No **Critical:** open
- [ ] EL's three decisions (review-plan §"Decisions this review cannot make") each have an answer
- [ ] Documentation drift closed (R-11)
- [ ] **The decision recorded, with its reason:** merge to `main` · split and merge in parts · hold
- [ ] If merge: `git push -u origin main && git push -u origin fix/catalog-release-integrity` from
      Windows, then confirm CI green **once** before the merge is treated as done (`T-00`)
