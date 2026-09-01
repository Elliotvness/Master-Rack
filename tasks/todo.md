# TODO — Audit remediation → running MVP-1

> **Status 2026-09-01, end of session 2.** T-01, T-02, T-03 and T-04 are **complete and verified**;
> T-00 is **blocked on a push from Windows** (no credentials in the Linux workspace). One task was
> added that the audit did not find (**T-27**), and one unplanned fix landed alongside T-03
> (`audit_event`, commit `73ca8d1`). Phase 2's remaining tasks — T-05, T-06, T-07, T-08 — are the
> next work and are unblocked. Full narrative in `LATEST.md`.

Companion to `tasks/plan.md`. Created 2026-09-01 from the Rev C conformance audit.
Sizes: **XS** 1 file · **S** 1–2 · **M** 3–5 · **L** 5–8 (break down) · **XL** too large.

Standing definition of done for every task is in `tasks/plan.md`. It is not repeated below.
Verification commands assume the Linux workspace; `pnpm verify` runs the full chain on Windows.

---

## Phase 0 — Make CI real

### T-00: Add a git remote and observe CI green once
**Description.** The workflow in `.github/workflows/ci.yml` is well built — real Postgres, self-test
before every checker — and has never executed. Until it does, "CI is green" is an untested claim, and
the DB-backed tests (`*.db.test.ts`, `tenancy.test.ts`, `check-rls`) have no runner at all, because
the Linux workspace has no docker.

**Acceptance criteria:**
- [ ] Remote added; `main` pushed
- [ ] The `verify` job completes green, including the 6 DB-backed test files and `check-rls`
- [ ] The `docs` job rebuilds the blueprint and `git diff --exit-code` passes

**Verification:** the CI run URL and its conclusion recorded in `docs/CURRENT_STATE.md` §4.
**Dependencies:** Q7 (where does this push?). **Files:** none. **Scope:** XS.

---

## Phase 1 — Catalog and schema integrity

**BLOCKED 2026-09-01** — remote added (`https://github.com/Elliotvness/Master-Rack.git`) but the
Linux workspace holds no credentials. Run from Windows:
`git push -u origin main && git push -u origin fix/catalog-release-integrity`.
**Partly mitigated:** the DB-backed tests no longer need CI to run at all — see `LATEST.md` §4 for
the portable-Postgres recipe. All 74 of them now pass locally, the first time they have ever run.

### T-01: Put the frame tables into the approved catalog release
**Description.** Audit **D-05**, and the first thing to fix because it silently blocks the demo.
`interlake-2026-09` is the only `APPROVED` release and it carries `beams.json` only; `frames.json`
(3 tables, 435 cells) exists solely in `interlake-2026-08`, which is `DRAFT`.
`canPinForNewRevision()` correctly refuses a DRAFT, so MVP checks 1 and 2 cannot resolve a frame
from any pinnable revision.

**Acceptance criteria:**
- [ ] `data/catalog/interlake-2026-09/frames.json` present, byte-identical to the 2026-08 tables
      unless a source re-read changes a value — and if it does, the change is recorded in
      `changes_from_2026_08` with its page reference
- [ ] The manifest's `verification_path.cells` covers beams **and** frame cells, with the note saying
      which is which
- [ ] `loadFrameTables` is exercised against the 2026-09 path in a test
- [ ] A new loader assertion: **a release with `status: APPROVED` must carry every dataset the MVP
      check set consumes.** A half-populated release cannot be approved
- [ ] The quarantined tables remain refused by name in the extractor

**Verification:** `node node_modules/vitest/vitest.mjs run packages/kernel-catalog` green; then
**prove the new gate fires** — delete `frames.json` from 2026-09, confirm approval/load is refused,
revert.
**Dependencies:** None. **Files:** `data/catalog/interlake-2026-09/{frames.json,manifest.json}`,
`packages/kernel-catalog/src/{load-frames.ts,release.ts,frames.test.ts}`. **Scope:** S.

**DONE 2026-09-01** — commit `7559889`. Also produced `load-manifest.ts`: the approval gate
had never once run against a manifest on disk, so it was guarding its own test fixtures. Verification
is now recorded per *dataset*, not per release. kernel-catalog 79 → 93 tests. Three gates proven to fire.

### T-02: Retire `interlake-2026-08` out of DRAFT
**Description.** Audit **D-06**. That release carries 264 capacities the 2026-09 re-source corrected
and 42 phantom 40E/40ER-under-F3M rows. It sits in `DRAFT` — one approval away from being pinnable.
§10.2's own lesson is "status on the data, gate on the status," and the status here is wrong.

**Acceptance criteria:**
- [ ] 2026-08 moves to a terminal state. Prefer adding `QUARANTINED` to `ReleaseStatus` over
      `RETIRED`: retired means "was good, superseded"; this was never approved and was proven wrong,
      which is a different fact and the reference projects already have a word for it
- [ ] `approveRelease` refuses a `QUARANTINED` release outright
- [ ] A new refusal: a release whose successor corrected its values cannot be approved. The
      correction is already recorded in `changes_from_2026_08`; the gate reads it
- [ ] The manifest keeps its original transcribed values — it must keep reporting what it
      transcribed, including 5.92 — and gains the reason it was quarantined

**Verification:** `vitest run packages/kernel-catalog` green; prove the gate — attempt to approve
2026-08 and confirm the refusal names both reasons.
**Dependencies:** T-01. **Files:** `packages/kernel-catalog/src/release.ts`,
`data/catalog/interlake-2026-08/manifest.json`, `release.test.ts`. **Scope:** S.

**DONE 2026-09-01** — commit `eeaafef`. `QUARANTINED` added as a fifth `ReleaseStatus`,
deliberately distinct from `SUPERSEDED`. Two latches: status, and `correctedBy` which bars approval
independently so flipping the status back does not reopen the door. Closed a type hole T-01 opened.
Three gates proven to fire.

### T-03: Put `audience` into the revision RLS policy
**Description.** Audit **D-02**, the most serious of the three structural defects. `revision.audience`
exists, is indexed, and is correctly commented — and appears **zero times** in `0002_rls.sql`. A
derived internal revision carries the client's own `organization_id`, so the tenant predicate passes
it. `AC-14` currently rests on `stripInternalRevisions()`, a `.filter()` in `apps/internal-web` —
the serializer-filtering pattern §6.3 explicitly rejects.

**Acceptance criteria:**
- [ ] New migration `0005_revision_audience_rls.sql` — never an edit to an applied migration
- [ ] `revision` is lifted out of the generic tenant loop and given
      `USING (organization_id = app.current_org() AND audience = 'client') OR app.is_staff()`,
      with the matching `WITH CHECK` so a client cannot **write** an internal revision either
- [ ] `check-rls.mjs` grows an assertion: any table carrying an `audience` or `actor_type` column
      must name that column in at least one policy. The next sensitivity axis cannot be forgotten
      silently
- [ ] `stripInternalRevisions` **stays**. Two independent controls is the design; one of them being
      the only one is not
- [ ] New tenancy tests: as a client principal, an internal revision of one's own organization is
      invisible to `SELECT` and refused on `INSERT`

**Verification:** `pnpm migrate && pnpm test && pnpm check:rls` on Windows (docker), or in CI after
T-00. Prove it fires: drop the `audience` clause, confirm the new tests go red, revert.
**Dependencies:** None (T-00 for a runner). **Files:** `packages/db/migrations/0005_*.sql`,
`tools/check-rls.mjs`, `packages/db/src/tenancy.test.ts`. **Scope:** S.

**DONE 2026-09-01** — commit `75192d0`, with `73ca8d1` alongside it. Migration `0005`; policies
REPLACED not amended (an added policy is OR-ed, which widens). `check-rls` now asserts any
sensitivity column is named in a policy — on its first run it found `audit_event`, fixed in
`73ca8d1`, a finding the audit did not have. **Proven:** reverting the old policy turns 4 tenancy
tests red — a client could read, write AND flip internal revisions on its own project.

### T-04: Make the two-person rule require a human spot-check
**Description.** Audit **D-07**. §10.2 anticipated exactly the current situation: "running an
extraction script sets the digitiser to a machine identity, which lets one person approve data they
produced themselves and satisfies the check trivially." The gate today requires only that *a*
verification path exists with `cells > 0`; the recorded path for 2026-09 is two machine extractions
reconciled by a machine. §10.2's remedy — a tool-drawn random sample of 20 cells or 5%, whichever is
greater, recorded as data, any mismatch failing the whole release — is not implemented.

**Acceptance criteria:**
- [ ] `VerificationPath` gains a `human_spot_check` variant carrying
      `{ sampledCells[], sampleSize, drawnBy: 'tool', sourceDocument, pageRef, checkedBy, checkedAt, outcome }`
- [ ] When `digitisedBy` matches a machine-identity pattern, `approvalRefusals` requires a
      `human_spot_check` **in addition to** the machine path
- [ ] `sampleSize >= max(20, ceil(0.05 * cells))`, enforced
- [ ] The **tool draws the sample**, deterministically from a recorded seed so the draw is
      reproducible and auditable — an approver-chosen sample drifts toward the easy cells
- [ ] Any mismatch fails the entire release. No partial pass, no "approve with notes"
- [ ] `interlake-2026-09` is re-approved against a real spot-check, or drops back to DRAFT until it is

**Verification:** `vitest run packages/kernel-catalog` green; prove it fires — remove the
`human_spot_check`, confirm approval is refused; set `sampleSize` to 19, confirm refusal.
**Dependencies:** T-01, T-02. **Blocked on Q5** for the actual re-approval, not for the code.
**Files:** `packages/kernel-catalog/src/release.ts`, a new sampler, `release.test.ts`,
`data/catalog/interlake-2026-09/manifest.json`. **Scope:** M.

---

## Phase 2 — Kernel and workflow repairs

**DONE 2026-09-01** — commit `52f708a`. `tools/draw-spot-check.mjs` draws and **pins** the sample
and refuses to redraw one already pinned. **Consequence: `interlake-2026-09` is back to DRAFT and no
release is currently pinnable.** 42 cells are pinned and waiting; see `LATEST.md` §3.1. An earlier
draft gated this on a machine-identity regex and was deleted before committing — it failed unsafe.

### T-05: Separate `contentHash` from `manifestHash`
**Description.** Audit **D-03**. `submit()` computes `manifestHash` at step 4 and passes it to
`freezeRevision(revisionId, contentHash, at)` at step 5. Two different hashes with two different
jobs: §7.4's content-only hash exists so identical content hashes identically; §13.2's manifest hash
deliberately covers lineage, actor, timestamp, pins, derived output and BOM. Conflating them breaks
"did this edit change anything?", the artifact cache key, and `AC-14`'s assertion. Every test passes,
because the wrong value is computed reproducibly — which is why no existing gate can see it.

**Acceptance criteria:**
- [ ] A `contentHash(revision)` effect, computed by `kernel-model`'s canonical serialiser over
      content only, using the existing documented exclusion list
- [ ] `freezeRevision` receives the **content** hash; the manifest hash is persisted on the
      `submission` row where §7.2 puts it
- [ ] Derived rows are keyed to the content hash
- [ ] **The test that would have caught this:** two revisions, identical content, different author and
      timestamp ⇒ *same* `contentHash`, *different* `manifestHash`
- [ ] The exclusion list is asserted as data, per §7.4

**Verification:** `vitest run packages/kernel-model apps/client-web` green; the new test red against
the current code first.
**Dependencies:** None. **Files:** `packages/kernel-model/src/canonical.ts` (likely unchanged),
`apps/client-web/src/lib/submit.ts`, `submit.test.ts`. **Scope:** S.

### T-06: Actually record the assumption acknowledgement
**Description.** Audit **D-04**. Step 3 `record_acknowledgement` pushes a label onto `stepsCompleted`
and performs no effect — there is no `recordAcknowledgement` in `SubmitEffects`. FR-QS-03 requires the
acknowledgement to be an audit event, and §11.6 requires the assumption register to be a record, not
a list of strings. Right now nothing is written, so "you accepted a 4-inch overhang assumption" stays
a recollection rather than becoming a fact.

**Acceptance criteria:**
- [ ] `Assumption` becomes the §11.6 record: `key`, `assumedValue {value, unit}`, `why`, `scope`,
      `acknowledgedBy`, `acknowledgedAt` — replacing `readonly string[]`
- [ ] A `recordAcknowledgement` effect is added and step 3 fails if it does not succeed
- [ ] The acknowledgement writes an audit event in the same transaction (`AC-15`)
- [ ] The register appears in the pre-submit confirmation payload and at the top of the internal
      review package
- [ ] Submitting with unacknowledged assumptions is refused, and the refusal is one of the reasons
      `submitRefusals` returns — which it already is; this task makes the recording real

**Verification:** `vitest run apps/client-web` green; prove it fires — make the effect throw, confirm
the submission does not complete.
**Dependencies:** T-05. **Files:** `apps/client-web/src/lib/submit.ts`, `preview.ts`,
`submit.test.ts`, `apps/api/src/audit/chain.ts`. **Scope:** M.

### T-07: Move the submit orchestration into a pure `packages/workflow`
**Description.** Audit **D-01**. The nine-step transaction, `AC-10`'s refusal, the freeze and the
audit write all live in `apps/client-web` — by the repository's own definition, "the bundle a client
downloads." The module itself is good: injected effects, asserted ordering, all reasons returned.
The package is wrong. OWASP's guidance on multi-step workflows is direct: if the UI is the only
thing enforcing the sequence, an attacker calling endpoints directly can skip, repeat or reach
terminal steps without the prerequisites — state lives on the server, in storage the client cannot
write to. Architecture decision **AD-1** in the plan explains why this becomes a pure package rather
than moving into `apps/api`.

**This task is a pure move. No logic changes. Its diff must read as "nothing changed except
location."** Behaviour changes belong in T-05/T-06, which land first.

**Acceptance criteria:**
- [ ] `packages/workflow` created, subject to `check-boundaries` — no I/O, no clock, no RNG
- [ ] `submit`, `submitRefusals`, `SUBMIT_STEPS`, `stepsInOrder` and their types move there verbatim
- [ ] `apps/api` supplies the effects and owns the transaction
- [ ] `apps/client-web` may import the step vocabulary and refusal types; it may not import `submit`
- [ ] `check-app-boundaries` gains a rule: `client-web` may not export a symbol named `submit`,
      `freeze`, `derive*` or `strip*`
- [ ] Coverage on the new package is 100%, matching every other pure package
- [ ] The existing 22 submit tests move unchanged and stay green

**Verification:** `pnpm verify`; `check-boundaries` reports 10 pure packages; prove the new
app-boundary rule fires — re-export `submit` from `client-web`, confirm red, revert.
**Dependencies:** T-05, T-06. **Files:** new `packages/workflow/*`, `apps/client-web/src/index.ts`,
`tools/check-app-boundaries.mjs`, `tsconfig.base.json`, `vitest.config.ts`. **Scope:** M.

### T-08: Move internal revision derivation and note handling server-side
**Description.** Audit **D-01b**. `deriveInternalRevision`, `internalNote` and
`stripInternalRevisions` live in `apps/internal-web`. Same reasoning as T-07: deriving a revision and
deciding what a client may see are server authorities. `stripInternalRevisions` remains as the second
control alongside T-03's RLS predicate — it is not deleted, it is relocated and demoted from sole
enforcement to defence in depth.

**Acceptance criteria:**
- [ ] The three functions move to `packages/workflow` (pure) with effects supplied by `apps/api`
- [ ] `internal-web` keeps the queue **view** logic — ordering, clocks, ages — and the trace panel
- [ ] `AC-14`'s test is re-pointed at the server-side path
- [ ] Waivers still do not carry over to a derived revision; the existing proof stays green

**Verification:** `vitest run apps/internal-web packages/workflow`; the two existing deliberate
breakages (waivers carried over → 1 red; internal items kept → 3 red) must still fire.
**Dependencies:** T-07. **Files:** `apps/internal-web/src/lib/queue.ts`, `packages/workflow/*`,
`queue.test.ts`. **Scope:** S.

### T-09: Give `part_revision_id` something to reference
**Description.** Audit **D-10**. §19.2 names "BOM lines reference a part revision, never a part" as
one of only two decisions that cannot be retrofitted. The type honours it; the schema does not —
`bom_line.part_revision_id` is a bare `uuid` with no `REFERENCES`, while its `uncatalogued_part_id`
sibling **is** constrained. There is no `part`, `part_revision` or `capacity_case` table at all.
Catalog-as-pinned-file is a defensible MVP-1 choice and this task does not overturn it; it adds the
registry that makes the reference resolvable, so FR-BM-05 (where-used) and FR-CT-06 (supersede
impact) stop being unanswerable.

**Acceptance criteria:**
- [ ] Migration `0009` adds `part` and `part_revision`, populated from the pinned catalog release at
      load — the files stay the source of truth, the tables are the queryable projection
- [ ] `bom_line.part_revision_id` gains its foreign key
- [ ] The projection carries the release id, so a discontinued part stays resolvable and a historical
      revision still renders (§10.2)
- [ ] RLS: staff-only, matching the other internal-only tables
- [ ] A where-used query answers "which revisions and open requests reference this part revision?"

**Verification:** `pnpm migrate && pnpm test && pnpm check:rls`; a test asserting a BOM line cannot be
inserted against a non-existent part revision.
**Dependencies:** T-03. **Files:** `packages/db/migrations/0009_*.sql`, `packages/kernel-catalog/src/`,
new tests. **Scope:** M.

### T-10: Reconcile the documentation and port `check-claims`
**Description.** Audit **D-19**. Four documents disagree: `TODO.md` RH-05 says both packs are DRAFT
while the manifest says `APPROVED`; `LATEST.md` says both "336 beam rows" and "378 verified rows
migrated" for the same release; `docs/CURRENT_STATE.md` §10 still reads "kernel-units is one package
of the eight" and "3 commits"; the blueprint says Rev C in its masthead and Rev A in its closing
line. None is a software defect. All four are the same defect in the practice — and in a product
whose argument is that its record is current, that is not cosmetic.

**Acceptance criteria:**
- [ ] All four corrected
- [ ] `tools/check-claims.mjs` ported from `rack-studio` (it is already on the reuse register):
      counts stated in markdown are derived from the code and drift fails the build
- [ ] It has a self-test, like every other checker here
- [ ] Wired into `pnpm verify` and CI

**Verification:** `node tools/selftest-claims.mjs && node tools/check-claims.mjs`; prove it fires —
change a stated count, confirm red.
**Dependencies:** None. **Files:** `tools/check-claims.mjs`, `tools/selftest-claims.mjs`,
`LATEST.md`, `TODO.md`, `docs/CURRENT_STATE.md`, `src/parts/*`, `package.json`, `ci.yml`. **Scope:** M.

### T-11: Add secret scanning to CI
**Description.** Audit **D-20**. NFR-SEC-06 asks for it explicitly and it is absent. B2 credentials
arrive at T-24, which is the wrong moment to discover this gap.

**Acceptance criteria:**
- [ ] A scanning step in `ci.yml` that fails the build on a detected secret
- [ ] Push protection enabled on the remote if the host supports it
- [ ] A deliberately planted fake credential is caught, then removed

**Verification:** the failing run recorded, then the passing one.
**Dependencies:** T-00. **Files:** `.github/workflows/ci.yml`. **Scope:** XS.

### T-27: Type-check the test files
**Description.** Found this session, not in the audit. `packages/*/tsconfig.json` carries
`"exclude": ["src/**/*.test.ts"]`, so no test file is ever type-checked. A fixture can drift from a
changed type and `tsc --build` stays green — which happened during T-04, where a required field was
added to `CatalogReleaseManifest` and every fixture silently lacked it until the tests ran.

**Acceptance criteria:**
- [ ] Test files are type-checked, via a separate `tsconfig.test.json` per package or by removing
      the exclusion and accepting the vitest globals
- [ ] Adding a required field to a shared type fails `tsc` on stale fixtures, proven by deliberate
      breakage
- [ ] `pnpm verify` still passes and does not slow materially

**Verification:** add a required field to a type, confirm `tsc --build` goes red, revert.
**Dependencies:** None. **Files:** `packages/*/tsconfig.json`, `tsconfig.base.json`. **Scope:** S.

### T-12: Update the source-conflict register
**Description.** Audit **D-21**. §10.8 records the MH16.1 edition conflict as open. Part of it is now
answerable: IBC 2024 adopted **ANSI MH16.1-2021**; IBC 2021 referenced MH16.1-2012; a 2023 edition of
the standard exists. This does not resolve which edition an AHJ enforces — that stays open — but the
register should carry what is now known. The catalog's own `code_basis` of "ANSI MH16.1-2012" is
correct and unchanged: it is the manufacturer's printed basis, transcribed.

**Acceptance criteria:**
- [ ] `data/rules/mvp-2026-08/rules.json` conflict entry updated with the IBC adoption facts and
      their source
- [ ] Still recorded as **open** — the AHJ-enforcement half is not resolved
- [ ] `code_basis` in the catalog manifest is untouched
- [ ] Blueprint §10.8 updated to match

**Verification:** `vitest run packages/kernel-rules`; `python src/build.py` clean.
**Dependencies:** None. **Files:** `data/rules/mvp-2026-08/rules.json`, `src/parts/*`. **Scope:** XS.

---

## ══ CHECKPOINT A — after T-00 … T-12 ══

- [ ] `pnpm verify` PASS, exit 0, on Windows **and** in CI
- [ ] All DB-backed tests green in CI for the first time
- [ ] The approved catalog release resolves both a beam and a frame
- [ ] A client principal cannot read or write an internal revision — proven at the database
- [ ] `contentHash` and `manifestHash` are distinct, with the discriminating test green
- [ ] No orchestration remains in either front-end package
- [ ] Coverage floors held or raised; every new gate proven to fire and reverted
- [ ] **Review with EL before Phase 3.** Q1 and Q2 must be answered here

---

### P-00: The benchmark harness and the first baseline  ✅ 2026-09-01
**Done.** §5.4 budgets 1 and 2 measured for the first time — `fixtures/perf/unit-300-bay.json`,
`tools/bench/`, `pnpm bench`, a CI step, and `PERF.md` carrying the baseline, the p50-not-p95
ratchet reasoning, and the ledger. preview p95 1.0–2.4 ms against 120 ms; fullDerivation p95
0.9–1.5 ms against 400 ms. **The kernel was never the risk.**

## Phase 3 — The contract, then the server  *(Q2 answered: Fastify)*

> **Q2 is answered: Fastify.** Recorded in the project's audit-remediation status
> ("Stack decided — Fastify, Vite + React Router v7 SPA") but never carried back into
> `tasks/plan.md`, whose open-questions table still lists it unchosen. Drift, filed under R-11.
> It gates **T-14 only** — T-13a–d never depended on it.

### T-13a: `packages/contracts` — error envelope, pagination, shared types  ✅ 2026-09-01
**Acceptance criteria:** the AD-2 error envelope as a closed code enum; AD-4 pagination envelope;
naming conventions enforced by a test over the schema; `FORBIDDEN_CLIENT_FIELDS` relocated here as
the single shared source for the test, the log redactor and the response validator.
**Verification:** `vitest run packages/contracts`. **Dependencies:** Checkpoint A. **Scope:** M.
- [x] Error envelope with the closed `ERROR_CODES` table, the 403/404 split pinned by test
- [x] Pagination envelope; bad values REFUSED rather than clamped; `totalPages` derived
- [x] `FORBIDDEN_CLIENT_FIELDS` and the depth walk moved to `@rms/contracts`; `apps/api` re-exports
- [x] 21 tests, 100% coverage, inside `check-boundaries` as the 10th pure package
- [x] `pnpm coverage` threshold added for `packages/contracts/src/**`

### T-13b: Per-audience DTOs and the outbound validator
**Acceptance criteria:** one DTO per (entity × audience), constructed field by field — never
`exclude([...])`, which is allow-by-default and leaks the next column someone adds. Client response
types declared `additionalProperties: false`. The validator fails in non-production and alerts in
production. The positive companion test asserts staff **do** see the fields.
**Verification:** add `cost` to a client DTO, confirm red, revert. **Dependencies:** T-13a. **Scope:** M.

### T-13c: Input DTOs
**Acceptance criteria:** `organization_id`, `role`, `audience`, `lifecycle_state` and every price
field are structurally unreachable from a request body. No mass assignment. A test attempts each and
is refused.
**Verification:** `vitest run packages/contracts`. **Dependencies:** T-13a. **Scope:** S.

### T-13d: Idempotency key store
**Acceptance criteria:** AD-3 in full — atomic claim via a unique constraint on
`(organization_id, key)`; `request_hash` guard returning `422` on a reused key with a different
payload; `409` for an in-flight duplicate; the intent row written **before** the effect; 30-day
retention exceeding the outbox's dead-letter replay window. A concurrency test fires two claims at
once and asserts exactly one wins.
**Verification:** DB-backed test in CI. **Dependencies:** T-13a, T-03. **Scope:** M.

### T-14: The server
**Acceptance criteria:** all 23 §8.2 routes mounted; the boot-time route-coverage assertion runs
against the **real** router so `AC-06` becomes live; deny-by-default middleware; 404-not-403;
every deny writes an audit event; scoped fetch only — `currentOrg.revisions.find(id)`, never
fetch-then-check; all database access through `withTenant`.
**Verification:** add an unannotated route, confirm the app refuses to boot. **Dependencies:**
T-13a–d, **Q2**. **Scope:** L — split at implementation into auth routes / client routes / internal routes.

### T-15: Re-assert AC-02, AC-03 and AC-06 against the running system
**Acceptance criteria:** the contract test enumerates routes from the real router, calls each as a
client principal, and asserts no forbidden key at any nesting depth. The three acceptance criteria
move from "enforced against a model" to enforced.
**Verification:** the enumeration count matches the route table; a planted forbidden field is caught.
**Dependencies:** T-14. **Scope:** S.

### P-01: Measure the submission budget in the same commit as the submit route
**Description:** §5.4 budget 3 — submission (freeze + manifest + hash + BOM persist) at p95 2 s,
measured by an end-to-end test. It ships with T-14's submit route, not after it: a budget added
later is a budget nobody has ever seen fail.
**Acceptance criteria:**
- [ ] An end-to-end test that submits the 300-bay fixture through the real route and times it
- [ ] p50/p95/p99 reported, not p95 alone — see `PERF.md` on why the spread is the signal
- [ ] Asserted against the §5.4 budget **and** a ratchet derived from the first measurement
- [ ] The measurement runs against a real Postgres in CI, not a mock. A mocked timing is a number
      about the mock
- [ ] The first measurement, and any attempt that did not survive, recorded in `PERF.md`
**Verification:** `pnpm bench` grows a submission row; CI step passes.
**Dependencies:** T-14 (submit route), T-13d. **Scope:** M.

### P-02: The queue at 5,000 — seeded load test, and the query that survives it
**Description:** §5.4 budget 4 — internal queue load at p95 800 ms with 5,000 submissions, measured
by a seeded load test. This is the budget most likely to be missed, because it is the only one whose
cost grows with the business rather than with one unit's size.
**Acceptance criteria:**
- [ ] A seed script that creates 5,000 submissions across ≥50 organizations, deterministically
- [ ] The queue query uses `LIMIT`/`OFFSET` from `@rms/contracts`' `paginate`/`offsetOf` — never a
      full fetch narrowed in the application
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` recorded in `PERF.md` for the queue query at 5,000 rows, with
      the chosen index named. An index added without the plan that justifies it is a guess
- [ ] **No N+1**: the organization name, project number and counts come back in one query. A test
      counts statements issued per queue render and asserts it is constant in the row count
- [ ] RLS is ON for the measurement. Measuring with `row_security = off` measures a query the
      product never runs
- [ ] Asserted against the budget and a ratchet
**Verification:** seeded load test in CI; statement-count test fails if a loop is introduced.
**Dependencies:** T-14 (queue route). **Scope:** M.

### P-03: PDF generation as a job, with the metric it is budgeted by
**Description:** §5.4 budget 5 — preliminary PDF at p95 6 s, asynchronous with progress, measured by
a job-queue metric. The budget already says *asynchronous with progress*, so a synchronous
implementation is not a slow version of the right thing, it is the wrong shape.
**Acceptance criteria:**
- [ ] Generation runs as an outbox/job-queue job, never in the request path
- [ ] The client is given progress, and a failed job is visible rather than silent
- [ ] Duration recorded per job as a metric; p95 computed over the recorded set, not per call
- [ ] Asserted against the budget once ≥20 jobs exist; below that the assertion is skipped **loudly**
- [ ] The 6 s budget is re-checked against a real 300-bay unit, not a one-page fixture
**Verification:** a job-queue metric exists and the p95 is queryable.
**Dependencies:** T-14, the document path. **Scope:** M.

### P-05: Front-end budgets, agreed before the first screen exists
**Description:** §5.4's five budgets are all server- or kernel-side. There is **no front-end budget
at all** for a product whose premise is a client self-service web app where the preview interaction
*is* the product. The 120 ms preview budget covers the computation; nothing covers the paint. A
bundle ceiling agreed after the bundle exists is a ceiling nobody meets.
**Acceptance criteria:**
- [ ] Budgets written into the blueprint (a §5.4 amendment) rather than invented in a task file:
      **LCP ≤ 2.5 s**, **INP ≤ 200 ms**, **CLS ≤ 0.1**, initial JS **≤ 200 KB gzipped**
- [ ] INP is the one that matters here and is called out as such: a rack configurator is an
      interaction loop, not a page view
- [ ] Bundle size asserted in CI on every build, with the number recorded in `PERF.md`
- [ ] Lighthouse or an equivalent runs against the built SPA in CI once a screen exists
- [ ] A route-level code-splitting decision recorded — before there are routes to split
**Verification:** the bundle gate fails when a large dependency is added.
**Dependencies:** Q1 (frontend framework — answered: Vite + React Router v7), before T-16.
**Scope:** S to agree, M to enforce.

### P-04: Re-derive the provisional budgets once real unit sizes are known
**Description:** §5.4 says its own numbers "are provisional and should be re-derived once a real
unit size distribution is known". The 300-bay fixture is a plausible size, not a measured one.
**Acceptance criteria:**
- [ ] Unit sizes from the first real submissions summarised — bays, runs, levels, options per unit
- [ ] The fixture regenerated at the p90 real size, and the baseline re-measured
- [ ] Budgets amended in the blueprint if the real distribution says they should be
- [ ] Old and new baselines both kept in `PERF.md`; a budget change never erases what it replaced
**Verification:** `PERF.md` carries both baselines with dates.
**Dependencies:** OD-20a/b pilot data. **Scope:** S. **Not urgent — but do not skip it.**

### R-08 / R-10 — the two review tasks that never ran
**Description:** Carried forward from `tasks/review-todo.md`. Neither blocks the merge; both are
worth doing before 24 commits become history.
- **R-08** — the catalog data reviewed as data against its source: `frames.json` byte-identity
  verified independently of the test that asserts it, the 2026-08 transcribed values confirmed
  unchanged by quarantine, every pinned cell id resolving to a real row.
- **R-10** — the commits judged as commits: each one green on its own (`git checkout <sha> && pnpm
  typecheck && pnpm test`), each first line standalone in history, and the question of whether the
  two RLS commits belonged on a branch named for catalog release integrity.
**Verification:** findings appended to `tasks/review-findings.md`. **Scope:** S each.

## ══ CHECKPOINT B ══
- [ ] MVP steps 1, 2, 6, 7 and 8 provable over HTTP
- [ ] Every §5.4 budget that the code now makes measurable HAS a runner: P-01 submission, P-02 queue
      at 5,000. A budget without a runner is not a budget (AD-7)
- [ ] `EXPLAIN (ANALYZE, BUFFERS)` for the queue query recorded in `PERF.md`, with the index named
- [ ] Statement-count test proves no N+1 in the queue render
- [ ] R-08 and R-10 closed, or explicitly waived on the record

## Phase 4 — The interface  *(Q1 answered: Vite + React Router v7 SPA)*

> Every one of §15.2's eight MVP-1 steps needs a screen, and there are currently **zero `.tsx`
> files**. This phase is where 0/8 becomes 8/8, and it is the largest remaining item in the plan.
> **P-05 lands first**: the front-end budgets are agreed before the first screen, not after.

Sliced as the eight MVP steps, in the blueprint's order, so `AC-20` is assembled rather than authored.

- **T-16** Design tokens, shared component library, a11y baseline. *M*
- **T-17** `render-svg` (elevations) and `render-canvas` (plans) from the display list — a renderer
  consumes, never recomputes. *M*
- **T-18a** Slice 1–2: invitation acceptance, first sign-in. *M*
- **T-18b** Slice 3: facility and unit entry, every field markable *not known*. *M*
- **T-18c** Slice 4: option builder over the controlled vocabulary, incl. demo beat 5 — a 110″ beam
  refused with both brackets and the no-interpolation reason. *M*
- **T-18d** Slice 5: plan and elevation preview, findings and assumptions panels. *M*
- **T-18e** Slice 6–7: pre-submit confirmation, submit, immutability refusal with clone-to-P02. *M*
- **T-19** Slice 8: internal queue, submission detail, the BOM "show your work" trace, derive. *L → split*
- **T-20** `render-pdf` + `E-08` watermarked client PDF. **Blocked on Q3.** *M*
- **T-21** Accessibility audit tool, self-tested against known ratios before reporting. *S*

## ══ CHECKPOINT C ══
- [ ] `AC-20`: all eight MVP steps as one executable walkthrough, ending in byte-identical BOM
      regeneration and a frozen, deep-immutable submission
- [ ] `AC-16` met (if Q3 answered)
- [ ] WCAG 2.1 AA measured in both themes; keyboard traversal complete
- [ ] **MVP-1 is done when this checkpoint is green**

---

## Phase 5 — Deploy readiness

- **T-22** Observability: structured logs with a correlation id, and the six NFR-OB-03 day-one
  alerts. The internal-field-on-a-client-response alert is an incident at a count of one, not a
  threshold. *M*
- **T-23** The five §5.4 performance budgets as CI benchmarks, on a fixed 300-bay fixture and a
  seeded 5,000-submission dataset. Re-run the reference spikes on real hardware (RH-08). *M*
- **T-24** The live B2 proof: upload, attempt overwrite as account root, attempt `DeleteObject`
  inside a locked prefix. Governance test bucket first — Compliance is irreversible. **Blocked on Q4.** *S*
- **T-25** Backup and restore drill producing an artifact (NFR-BK-03), with `SET row_security = off`
  on dump jobs. *M*
- **T-26** Deploy checklist and rollback triggers per `tasks/plan.md`; `CHANGELOG.md` started; first
  version tagged. *S*

---

## Not on this list, deliberately

Everything §19.2 fences: pricing, cost and margin, DXF/DWG, client BOM export, public self-signup,
impersonation, engineering calculations, multi-manufacturer catalogs, a second runtime in the request
path, real-time collaboration, client-configurable rules. Phase 2 blueprint items (column and tunnel
resolution, undo/redo, RFI loop, revision diff, cross-unit comparison, issue register, takeoff
export, where-used *view*, supersede impact view, per-org defaults, the uncatalogued matcher) stay in
`TODO.md` P3-006 and are not started.
