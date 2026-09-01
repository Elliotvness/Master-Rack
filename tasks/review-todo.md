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

**Acceptance criteria:**
- [ ] L-3 resolved: `strOrNull` returning `null` for a non-string is either fixed to throw, or
      documented as deliberate. It currently contradicts the module's own docstring, and it does so
      on `approved_by` — the field that means "somebody signed this"
- [ ] L-2 resolved: `pending_spot_checks` is parsed and validated, or its absence from the parser is
      recorded as deliberate with the reason
- [ ] L-5 resolved: the `constraints` cast is replaced with validation, or narrowed to `unknown` with
      a checked coercion. It is the only unchecked cast in the module
- [ ] L-4 dispositioned: `contentSha256` is verified against the dataset files, or filed as a task
      against `T-05` (which already owns hashing). **EL decides scope; the review does not silently
      drop it**
- [ ] Every field the gate reads is confirmed to be validated here: `datasets`, `verificationPaths`,
      `humanSpotChecks`, `correctedBy`, `status`, `digitisedBy`
- [ ] `strArray` returning `[]` for `undefined` is checked against the gate: a manifest omitting
      `datasets` entirely gets an empty array and a completeness refusal — confirm it refuses rather
      than passing, and that the message names the real cause
- [ ] Error messages name the file, the field and the index. Spot-check three by feeding malformed
      JSON through

**Verification:**
- [ ] `pnpm test packages/kernel-catalog/src/release-integrity.test.ts` green
- [ ] Manual: feed each malformed shape (`approved_by: 42`, missing `datasets`, `seed: "20260901"`,
      `constraints: {a: "x"}`) through `loadReleaseManifest` and record what happens to each
- [ ] `pnpm typecheck` exit 0

**Dependencies:** R-04. **Size:** M (1 source + 1 test file). **Files:**
`packages/kernel-catalog/src/load-manifest.ts`, `release-integrity.test.ts`.

---

### R-08: Review the catalog data — the two manifests and `frames.json`

**Description:** 850 lines of transcribed frame data moved into the approved release, and both
manifests rewritten. Reviewed as data, against its source, not read as code.

**Acceptance criteria:**
- [ ] `frames.json` is byte-identical to the 2026-08 tables, verified by the reviewer's own
      `git show eeaafef^:data/catalog/interlake-2026-08/frames.json | diff -` — independently of the
      test that asserts it
- [ ] The 2026-08 manifest's transcribed values are confirmed **unchanged** by the quarantine commit.
      Quarantine records that values were wrong; it must not correct them
- [ ] `quarantine_reason` and `corrected_by` on 2026-08 are non-null and name the correcting release
- [ ] `interlake-2026-09` is `DRAFT`, its `approval_held_because` is accurate, and `approved_by` /
      `approved_at` are null or empty — no residue of the hand-typed APPROVED
- [ ] The pinned `pending_spot_checks` cell counts (20 of 336 beams, 22 of 435 frames) are re-derived
      from `requiredSampleSize`: `max(20, ceil(0.05 × 336)) = 20` and `max(20, ceil(0.05 × 435)) = 22`
- [ ] Every pinned cell id resolves to a real row in `beams.json` / `frames.json`
- [ ] `source_anomalies` and `constraints` carry forward unchanged from the verified 2026-08 set
- [ ] The 42 phantom 40E/40ER-F3M rows (D-08) are confirmed still absent

**Verification:**
- [ ] `pnpm test packages/kernel-catalog` green
- [ ] `pnpm lint:provenance` PASS — every value carries its citation
- [ ] `node -e` script confirming every `pending_spot_checks` cell id exists in its dataset

**Dependencies:** R-05, R-07. **Size:** M (4 data files). **Files:**
`data/catalog/interlake-2026-09/{manifest,frames}.json`, `data/catalog/interlake-2026-08/manifest.json`.

---

### Checkpoint C — the data says what it did
- [ ] L-2 … L-5 each have a written disposition
- [ ] `frames.json` byte-identity verified independently of the test claiming it
- [ ] `pnpm lint:provenance` PASS

---

## Phase D — Verification and change hygiene

### R-09: Verify the verification

**Description:** Re-run every figure the branch claims, as the reviewer, from a clean checkout. The
branch's numbers are the branch's own and CI has never executed.

**Acceptance criteria:**
- [ ] 961 tests / 42 files confirmed, or the real figure recorded
- [ ] The 74 DB-backed tests confirmed to have *executed* — not skipped. Record the file list
- [ ] `pnpm verify` re-run: all 7 gates, output recorded
- [ ] `pnpm typecheck` and `pnpm lint` at exit 0 from a clean `pnpm clean && pnpm typecheck`
- [ ] The "eleven deliberate breaks fired and were reverted" claim spot-checked on **three** of them,
      chosen by the reviewer, not by the author
- [ ] `packages/*/tsconfig.json` excluding tests from `tsc` (filed as T-27) is confirmed still true
      and confirmed not to hide a type error in any test file this branch added — run `tsc` over the
      test files once, by hand
- [ ] Coverage on `kernel-catalog` re-measured; 100% statements/branches or the real figure recorded

**Verification:**
- [ ] `pnpm verify` output pasted into `tasks/review-findings.md`
- [ ] `pnpm coverage` output for `kernel-catalog` recorded
- [ ] `npx tsc --noEmit packages/kernel-catalog/src/*.test.ts` — record what it says

**Dependencies:** Checkpoints A, B, C. **Size:** S (no source changes). **Files:** none — output only.

---

### R-10: Review the commits as commits

**Description:** Change sizing, splitting and descriptions. Seven commits on a branch named for
catalog release integrity, two of which are RLS work on a different subsystem.

**Acceptance criteria:**
- [ ] Each commit's first line judged against the standard: short, imperative, standalone, and
      informative enough to find in history. Flag any that read as "Fix bug" / "Phase 1"
- [ ] Each commit is confirmed to leave the tree green on its own (`git stash`-free: check out each
      SHA, run `pnpm typecheck && pnpm test`). A commit that only builds with its successor is a
      finding
- [ ] `7559889` (1,294 lines) assessed against the sizing guidance: 850 of them are data, so it is
      ~440 lines of code — record the judgement rather than the raw number
- [ ] L-12 answered: do `75192d0` and `73ca8d1` belong on this branch, or on their own with their own
      reviewer? Recommend, with the push command for whichever shape wins
- [ ] Confirm no commit mixes a refactor with new behaviour in a way that hides either
- [ ] Confirm nothing in the branch touches `C:\Rack Master\Resourse (do not delete or overwrite files)\`

**Verification:**
- [ ] `git log --format='%h %s' 0f1e7ac..HEAD` reviewed line by line, judgement recorded per commit
- [ ] For each of the 7: `git checkout <sha> && pnpm typecheck && pnpm test` — record pass/fail
- [ ] `git checkout fix/catalog-release-integrity` to restore

**Dependencies:** R-09. **Size:** S (no source changes). **Files:** none — output only.

---

### R-11: Close the documentation drift this branch created

**Description:** The audit's D-19 found four documents disagreeing. This branch fixed some of that
and created new drift of its own — most concretely, it took migration number `0006`, which
`tasks/todo.md` T-09 has reserved for `part` / `part_revision`.

**Acceptance criteria:**
- [ ] `tasks/todo.md` T-09 renumbered to `0007`, and T-03's reference to `0005` confirmed still right
- [ ] `tasks/plan.md` checked for any other migration number, test count or file count the branch
      invalidated
- [ ] `LATEST.md`'s figures reconciled with R-09's measured ones — any that differ are corrected, not
      re-asserted
- [ ] `TODO.md` RH-05's DRAFT/APPROVED disagreement re-checked against the manifests as they now
      stand (2026-09 is DRAFT again, so RH-05 may now be *right* by accident — record which)
- [ ] `docs/CURRENT_STATE.md` §10's stale package count and commit count updated or confirmed as
      T-10's job, not this review's
- [ ] `tasks/review-findings.md` linked from `tasks/plan.md` so the next session finds it

**Verification:**
- [ ] `grep -rn "0006\|0007" tasks/ docs/ TODO.md LATEST.md` — every hit is correct
- [ ] `pnpm check:docs` (blueprint rebuild) then `git diff --exit-code` on the built HTML
- [ ] `pnpm check:language` PASS — note it scans `apps/` and `packages/` only, so `tasks/` and
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
