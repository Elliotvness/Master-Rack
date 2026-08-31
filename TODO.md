# TODO — Rack Master Studio

**Created 2026-08-31 from repository evidence.** Companion to `docs/CURRENT_STATE.md` (what exists)
and `rack-master-studio-blueprint.html` (what is planned). Where a task derives from a blueprint
backlog id, that id is named.

**Status values:** `Not started` · `In progress` · `Blocked` · `Needs review` · `Complete`
**Evidence values:** `Confirmed implemented` · `Implemented but unverified` · `Planned only` · `Blocked by decision/source/input`

> **Baseline, stated once so no item below has to repeat it:** there is **no production code**.
> Every P1–P3 item is `Planned only` unless its own row says otherwise. Nothing here may be marked
> `Complete` without recording the verification command and its actual result.

**Standing constraints on every item:**
- The four trees under `Resourse (do not delete or overwrite files)\` are **read-only**. Copy out; never write in.
- No output claims structural, manufacturer, PE, fire-protection, code or AHJ approval.
- No invented capacity, seismic value, code requirement or rate. Every catalog/rule output names its
  source and version, or is marked unavailable/unverified.
- Never guess. Preserve provenance. Surface uncertainty.

---

## P0 — Blocking decisions and defects

### P0-001 · Resolve the active-folder name mismatch
**Why it matters.** `READFIRST.md` names `C:\Rack Master\Master Rack Studio` as the writable
project. That folder does not exist; the deliverables are in `C:\Rack Master\rack-master-studio`.
Two names for one project is how a second, divergent copy gets created — the exact defect the
blueprint exists to prevent.
**Files.** `C:\Rack Master\READFIRST.md`; the folder name itself.
**Dependencies.** None. Needs one decision from EL: rename the folder, or correct the brief.
**Acceptance.** One canonical path exists, and every document that references it agrees.
**Verification.** `dir "C:\Rack Master"` shows exactly one project folder; `findstr /s /i "Master Rack Studio" *.md` returns only intentional hits.
**Status.** `Blocked` — owner decision. **Evidence:** `Blocked by decision`.

### P0-002 · Put the deliverables under version control
**Why it matters.** The product's whole argument is traceability, and the documents that carry it
have no history. `git status` in the active folder returns *not a repository*. A bad edit to the
blueprint is currently unrecoverable, and the built HTML cannot be proven to match its source.
**Files.** New `.gitignore` (exclude `src/__pycache__`, `*.pyc`); initial commit of all existing files.
**Dependencies.** P0-001 if the folder is renamed first (cheaper before than after).
**Acceptance.** Repository initialised, one commit containing the current tree, `__pycache__` untracked, `open-decisions.md` flagged internal-only in the README.
**Verification.** `git status --short` is clean; `git log --oneline` shows the initial commit.
**Status.** `Not started`. **Evidence:** `Confirmed implemented` (absence confirmed this pass).

### P0-003 · Run the visual verification gate once and record the result
**Why it matters.** `src/README.md` documents two pre-handoff gates. Only one has ever run. The
untested gate covers overflow at three viewports, console errors, and the `srcdoc` link-interception
behaviour that keeps the document usable inside a preview pane.
**Files.** `src/verify-visual.py`.
**Dependencies.** `pip install playwright && playwright install chromium`.
**Acceptance.** The script runs to completion and its output is recorded in `docs/CURRENT_STATE.md` §4.
**Verification.** `python src\verify-visual.py`.
**Status.** `Not started`. **Evidence:** `Implemented but unverified`.

### P0-004 · Reconcile the Carson acceptance numbers before they become a golden fixture
**Why it matters.** Three artifacts give three pallet-position counts for one job: 916 bays / 6,824
net (drawing 0005-01 R-1), 916 / 7,196 (`Q-38857-1`), 551 / 4,268 (`Q-38857-8`). The reuse register
wants 6,824 as the end-to-end acceptance value. Baking a contested number into the fixture that
gates every future engine change would encode the error permanently.
**Files.** Future `fixtures/golden/`; sources are read-only in `rack-app` / `rack-engine`.
**Dependencies.** Human reading of the three source artifacts. Cannot be resolved from code.
**Acceptance.** Either one count is established with a written reason for the other two, or all
three are recorded as an open conflict and the fixture asserts something else.
**Verification.** Manual: a written reconciliation note naming each artifact and the disposition.
**Status.** `Blocked` — human/source input. **Evidence:** `Blocked by source`.

### P0-005 · Resolve or formally park the 59E beam face height
**Why it matters.** 5.92″ across all 42 catalog rows vs 5.928″ in a documentation table. It feeds a
lookup key, and under the no-interpolation rule a wrong key silently sends every lookup off-grid.
**Files.** Read-only sources; destination is the future catalog manifest.
**Dependencies.** A person must read the published source chart.
**Acceptance.** Either figure is confirmed against the source with a page reference, or the
discrepancy is recorded in `source_anomalies[]` and neither value is treated as settled.
**Verification.** Manual: page reference recorded in the catalog manifest.
**Status.** `Blocked` — human/source input. **Evidence:** `Blocked by source`.

### P0-006 · Close the OD-06 veto window explicitly
**Why it matters.** Micrometre storage is the recommendation and is correct under every future
answer, but the window closes at `B-02`/`C-08`. Before then it is a one-file change; after, it is a
wide mechanical one. Leaving it implicitly open past that point is the risk.
**Files.** Future `packages/kernel-units/`; `open-decisions.md` decision log.
**Dependencies.** None — proceed on µm unless vetoed.
**Acceptance.** One line in the decision log: vetoed, or stands. Dated.
**Verification.** Manual: log entry exists before `B-02` starts.
**Status.** `Not started`. **Evidence:** `Blocked by decision` (non-blocking default: proceed).

---

## P1 — MVP foundation

Blueprint Group A and Group B. None of it is client-specific, so none waits on the pilot.
**Order is dependency order; do not reorder for convenience.**

### P1-001 · `A-01` Monorepo scaffold, TypeScript strict, CI
**Why it matters.** Nothing else can start. Three-way path-alias consistency (tsconfig / test runner
/ bundler) is called out because the reference monorepo got it wrong and paid for it.
**Files.** `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.github/workflows/ci.yml`, `apps/`, `packages/`, `tools/` per blueprint §6.4.
**Dependencies.** P0-002.
**Acceptance.** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` all on; an empty
workspace type-checks, lints and tests green in CI; the same import alias resolves identically in
all three tools.
**Verification.** `pnpm install && pnpm typecheck && pnpm test && pnpm lint`, and the same on CI.
**Status.** `Not started`. **Evidence:** `Planned only`. **First unblocked task.**

### P1-002 · `A-02` `kernel-units`
**Why it matters.** Every other package depends on it. Fixed-point µm and millipounds, unit + origin
on every value, allocate-never-divide, fail-closed provenance walkers bounded at depth 32, one-way
metric display formatter.
**Files.** `packages/kernel-units/`. Port mechanics from `rack-studio/packages/units` (read-only), re-base `mil` → µm. Carry `BASIS_BOUND` from `rack-engine/model/quantity.py`.
**Dependencies.** P1-001, P0-006.
**Acceptance.** 100% branch coverage; `lb/pr` refuses conversion to `lb`; adding two different-but-compatible units raises; `allocate()` sums to the original for every split; 48″ round-trips exactly.
**Verification.** `pnpm test --filter kernel-units --coverage`, coverage gate at 100% branches.
**Status.** `Not started`. **Evidence:** `Planned only`.

### P1-003 · `A-03` Boundary checker + self-test
**Why it matters.** Cheap now; it is what stops a second implementation of the domain appearing.
Three of the four reference projects have exactly that defect.
**Files.** `tools/check-boundaries.mjs`, `tools/selftest-boundaries.mjs`. Pattern exists in `rack-studio/tools` and `rack-app/tests/test_architecture.py`.
**Dependencies.** P1-001.
**Acceptance.** No kernel package may import I/O, a framework, an app, `Date.now()` or an RNG. The
self-test writes a violation and asserts it is caught. A guard rejects vacuous globbing.
**Verification.** `node tools/selftest-boundaries.mjs` exits 0; deliberately adding an import to a kernel file fails CI.
**Status.** `Not started`. **Evidence:** `Planned only`.

### P1-004 · `A-04` Postgres schema v1 + RLS
**Why it matters.** Tenant plumbing is exponentially more expensive to retrofit; it touches every
table. `migrator`/`app_user` role split is what makes RLS real rather than decorative.
**Files.** `packages/db/migrations/`, `packages/db/policies/`.
**Dependencies.** P1-001.
**Acceptance.** Every tenant table has `organization_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, and
a policy per operation including `INSERT ... WITH CHECK`. Every uniqueness constraint is composite
with `organization_id`. `app_user` owns nothing and has neither `SUPERUSER` nor `BYPASSRLS`.
**Verification.** Migrations apply to a clean Postgres 16; cross-tenant `SELECT` returns zero rows and cross-tenant `INSERT` is refused, both against a real database.
**Status.** `Not started`. **Evidence:** `Planned only`.

### P1-005 · `A-05` `withTenant()` + lint ban on raw pool checkout
**Why it matters.** `set_config(..., true)` inside an explicit transaction is the only safe shape. A
session-scoped `SET` under a transaction pooler survives the connection being handed to another
client — a cross-tenant leak waiting for a load spike.
**Files.** `packages/db/with-tenant.ts`, lint rule config.
**Dependencies.** P1-004.
**Acceptance.** One wrapper is the only database entry point; raw checkout fails lint.
**Verification.** `pnpm lint` fails on a file that checks out a connection directly; wrapper unit test asserts the GUC is set and reverted at COMMIT.
**Status.** `Not started`. **Evidence:** `Planned only`.

### P1-006 · `A-06` CI assertion that RLS is universal
**Why it matters.** The forgotten table is the realistic failure, not the wrong policy.
**Files.** `tools/check-rls.mjs`.
**Dependencies.** P1-004.
**Acceptance.** Reads `pg_class.relrowsecurity` and `pg_policy` for every table in the application
schema; adding a table without RLS fails CI. (`AC-05`.)
**Verification.** `node tools/check-rls.mjs`; add a bare table and confirm CI goes red.
**Status.** `Not started`. **Evidence:** `Planned only`.

### P1-007 · `A-07` Sessions, cookies, OIDC for staff, password + TOTP for clients
**Why it matters.** Internal accounts see every organization's data. Email magic links are not an
acceptable standing second factor.
**Files.** `apps/api/auth/`.
**Dependencies.** P1-004.
**Acceptance.** Opaque server-side tokens, `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite`, ≥128
bits entropy, never `localStorage`; regeneration on authentication and privilege change;
deactivation terminates every session and revokes pending invitations (`AC-17`).
**Verification.** Integration test: deactivate a user mid-session, assert the next request is rejected and pending invitations are revoked.
**Status.** `Not started`. **Evidence:** `Planned only`.

### P1-008 · `A-08` `authorize()` + middleware + boot-time route-coverage assertion
**Why it matters.** The one control that survives someone adding an endpoint on a Friday.
**Files.** `apps/api/authz/`, route policy registry.
**Dependencies.** P1-007.
**Acceptance.** A route without an `{ action, resourceLoader }` annotation prevents application boot
(`AC-06`). Cross-tenant denials return `404`, never `403` (`AC-03`). Every deny writes an audit event.
**Verification.** Add an unannotated route; the app must fail to start. Enumerated authorization test over every route.
**Status.** `Not started`. **Evidence:** `Planned only`.

### P1-009 · `A-09` DTO layer + forbidden-field constant + leakage contract test
**Why it matters.** Worth ten times more written against six routes than against two hundred. This
is the control for `R-02`, the risk that destroys the product's reason to exist.
**Files.** `packages/contracts/`, `apps/api/dto/`, `tools/check-leakage.mjs`.
**Dependencies.** P1-008.
**Acceptance.** One DTO per (entity × audience), constructed field by field — never `exclude([...])`.
One shared forbidden-field constant used by the test, the log redactor and the response validator.
Client routes enumerate automatically and no forbidden key appears at any nesting depth (`AC-02`).
A positive companion test asserts staff *do* see those fields.
**Verification.** `node tools/check-leakage.mjs`; add `cost` to a client DTO and confirm the test goes red.
**Status.** `Not started`. **Evidence:** `Planned only`.

### P1-010 · `A-10` `audit_event` table, append-only trigger, hash chain
**Why it matters.** A change without its audit record must be impossible, not merely unlikely.
**Files.** `packages/db/migrations/`, `apps/api/audit/`.
**Dependencies.** P1-004.
**Acceptance.** Written in the same transaction as the change it describes; `UPDATE`/`DELETE` revoked
plus a trigger that raises; `hash_n = SHA-256(prev_hash ‖ canonical(event_n))`; ordering authority is
a monotonic sequence, not a timestamp; both `occurred_at` and `recorded_at` stored (`AC-15`).
**Verification.** Chain verifies from genesis; an attempted `UPDATE` on an audit row raises; a rolled-back change leaves no audit row.
**Status.** `Not started`. **Evidence:** `Planned only`.

### P1-011 · `A-11` Transactional outbox + worker
**Why it matters.** An email must not be sent for a transaction that rolled back.
**Files.** `apps/worker/`, outbox migration.
**Dependencies.** P1-004.
**Acceptance.** No mailer import exists outside the notifier worker; enqueue and business change commit together.
**Verification.** Integration test: roll back a transaction, assert nothing is dispatched.
**Status.** `Not started`. **Evidence:** `Planned only`.

### P1-012 · `B-01`..`B-06` Catalog and rule packs
**Why it matters.** The verified catalog is the most expensive asset in all four trees and
everything downstream depends on it. It must arrive as declarative data, never executable code.
**Files.** `data/catalog/interlake-<rev>/`, `data/rules/<pack>-<rev>/`, `packages/kernel-catalog/`.
Sources are read-only: `rack-engine\catalog\interlake-2026-08\` (378 beam rows),
`rack-app\frame_capacity_published_2025\` (3 tables, 435/435 reconciled).
**Dependencies.** P1-002; P0-005 for the 59E figure.
**Acceptance.** JSON/TOML validated against a published schema. Every provenance field carried
verbatim: `load_basis`, `deflection_limit`, `code_basis`, `source_anomalies[]` (all seven),
`constraints` (reported, never enforced). Data re-enters `DRAFT` and requires approval **in the new
system**. The release gate refuses when `approved_by` is null, when `approved_by == digitised_by`,
or when there is one human signature with no recorded cross-check or two-path reconciliation
(`AC-18`). Lookup is exact-grid only: off-grid returns both brackets and no value (`AC-08`); no
nearest-match; used or generic material carries no table basis at all (`AC-09`).
**Verification.** Schema validation in CI; a release with a null approver fails the build; an off-grid lookup test asserts both brackets and no value.
**Status.** `Not started`. **Evidence:** `Planned only`. Data itself: `Confirmed implemented` in the read-only sources.

### P1-013 · `C-01` `kernel-model` — write the hash-stability test first
**Why it matters.** The blueprint and two reference projects independently give this advice. A
truncating hash is the one failure mode a hash must not have.
**Files.** `packages/kernel-model/`.
**Dependencies.** P1-002.
**Acceptance.** Canonical JSON: sorted keys, fixed number formatting, `undefined` dropped, explicit
units, bounded depth that **fails loudly**. Hash covers content only; the exclusion list
(lineage, timestamps, author, note) is held as data so a test can assert exactly what is covered.
Deep freeze on publish so mutation is a `TypeError`.
**Verification.** Hash-stability test written before the hashing code; property test asserting key-order independence; a depth-exceeding structure raises rather than truncating.
**Status.** `Not started`. **Evidence:** `Planned only`.

### P1-014 · `C-02`..`C-08` Derivation, checks, BOM, display list, fixtures
**Why it matters.** This is the trustworthy model the brief demands before any polish.
**Files.** `packages/kernel-derive/`, `kernel-geom/`, `kernel-checks/`, `kernel-bom/`, `display-list/`, `fixtures/golden/`, `tools/lint-provenance.mjs`.
**Dependencies.** P1-012, P1-013, P0-004 for the acceptance fixture.
**Acceptance.** The 12 MVP checks with the tier ceiling applied **by the framework, not the check**,
so a PASS against a secondary-sourced rule is unwritable (`AC-19`). Every BOM line carries rule text,
`confirmed`, source object ids and either `part_revision_id` or `uncatalogued_part_id` — no third
state (`AC-13`). Wire decks, row spacers, footplates and protectors emit as `UNRESOLVED` with
reasons; none of the three conflicting wire-deck formulas is adopted. Display-list text entries
carry `{text, established}`, never a bare string; an unestablished value never renders as a numeral
(`AC-07`). **Golden fixtures are wired into the test run** — the reference project's are not, and
that defect must not be inherited.
**Verification.** `pnpm test`; fixture deltas within stated tolerance; `node tools/lint-provenance.mjs` fails on a formatter applied to a raw value.
**Status.** `Not started`. **Evidence:** `Planned only`.

---

## P2 — Client self-service and quote intake

Blueprint Groups D and E. Everything here depends on P1 landing first.

### P2-001 · `D-01`/`D-02` Invitation acceptance and facility/unit entry
**Acceptance.** 256-bit CSPRNG token, `sha256` at rest, 72-hour expiry, single-use via
`UPDATE ... WHERE accepted_at IS NULL` checking the affected-row count, no auto-login. Expired,
revoked, used and nonexistent tokens render the same page with the same status and comparable
timing (`AC-01`). Every facility field is individually markable **not known**, producing a finding
rather than a zero.
**Verification.** `AC-01` test; concurrent-redemption test asserts exactly one succeeds.
**Dependencies.** P1-007, P1-009. **Status.** `Not started`. **Evidence:** `Planned only`.

### P2-002 · `D-03` Option builder over the controlled vocabulary
**Why it matters.** The first screen a client sees, and the first task where a named pilot client
would change what gets built (`OD-20b` should be named before this starts).
**Acceptance.** Choices come only from the pinned catalog release; free-text dimensional entry is not
offered; an unavailable choice **states why**; no silent nearest-match substitution. Scope is
`OD-03`: back-to-back and single row, floor level plus 2–6 beam levels, uniform bays within a run.
**Verification.** Demo beat 5 as a test: a 110″ beam is refused, the published grid brackets are shown at 108″ and 114″, and the refusal states that the engine does not interpolate.
**Dependencies.** P1-012, P1-014. **Status.** `Not started`. **Evidence:** `Planned only`.

### P2-003 · `D-04`/`D-05`/`D-06` Preview, findings panel, comparison
**Acceptance.** Every parameter change re-derives plan, elevation, counts, assumptions and findings
within one interaction; nothing displays from a stale computation. Comparison never shows cost,
price, part count or any BOM quantity. Missing input is visually distinct from engineering review.
**Verification.** p95 < 120 ms preview update on a 300-bay fixture in CI; leakage contract test covers the comparison route.
**Dependencies.** P2-002. **Status.** `Not started`. **Evidence:** `Planned only`.

### P2-004 · `D-07`/`E-06` Pre-submit confirmation and the submit transaction
**Why it matters.** The one place client data crosses into internal workflow, and it crosses once.
**Acceptance.** One transaction, in order: re-derive from scratch (never from cache) → refuse if any
blocker is open, listing **every** reason (`AC-10`) → record the assumption acknowledgement →
serialise and hash the manifest → freeze → persist derived rows keyed to the hash → create the
submission with `this_hash` → write audit events → enqueue outbox work. After submit, a direct
`UPDATE` against the revision row fails **at the database** (`AC-11`).
**Verification.** `AC-10`, `AC-11`; a failure injected at any step leaves no partial state.
**Dependencies.** P1-010, P1-014. **Status.** `Not started`. **Evidence:** `Planned only`.

### P2-005 · `E-08` Watermarked client PDF with versioned disclaimer
**Acceptance.** Rendered from the same display list as the canvas. Diagonal watermark on every page,
full disclaimer text, title-block status, `P` revision code, short-form manifest hash, and a
`…_P01_PRELIMINARY.pdf` filename. Stores its `disclaimer_version_id`. Per `OD-08`: plan, elevation,
position count, aisle clear widths, assumptions, findings — **no schedule, no part descriptions, no
capacities, no quantities**. Per `OD-16`: company and contact name only; never a licence number,
seal, stamp or engineer's name, in any phase.
**Verification.** `AC-16`; a test asserts no forbidden field appears anywhere in the generated PDF text.
**Dependencies.** P2-004. **Status.** `Not started`. **Evidence:** `Planned only`.

### P2-006 · `E-07` WORM manifest upload and daily head anchoring
**Acceptance.** Object Lock in Compliance mode plus MFA Delete; daily head hash timestamped by an
RFC 3161 authority. Customer-facing copy says *tamper-evident, externally timestamped and
independently re-verifiable* — **never** *tamper-proof*.
**Verification.** Upload then attempt overwrite as account root; must fail. `src/verify.py`'s language-discipline check already guards the wording in documents; add the equivalent for UI strings.
**Dependencies.** P2-004. **Status.** `Not started`. **Evidence:** `Planned only`.

### P2-007 · `D-08` Status view and clone-to-draft
**Acceptance.** Coarse three-state client status (`OD-12`). Clone records `derived_from_revision_id`;
the frozen original never changes. SLA targets stay hidden externally until a baseline exists over
ten live submissions (`OD-11`), and neither clock is ever labelled *engineering review*.
**Verification.** Clone leaves the source `content_hash` byte-identical.
**Dependencies.** P2-004. **Status.** `Not started`. **Evidence:** `Planned only`.

---

## P3 — Internal workflow and future enhancements

### P3-001 · `E-01`/`E-02` Organization administration and the submission queue
**Acceptance.** Queue spans all organizations with status, age against both clocks, finding counts.
**Verification.** p95 < 800 ms at 5,000 seeded submissions.
**Dependencies.** P2-004. **Status.** `Not started`. **Evidence:** `Planned only`.

### P3-002 · `E-03` Internal BOM view with the "show your work" trace
**Why it matters.** The strongest differentiator against spreadsheet estimating, and the fastest way
for estimators to find engine bugs.
**Acceptance.** Clicking a quantity opens: the formula in symbols, then with substituted values and
units, then the rule that selected the part, then the catalog release with its effective date and
page reference. Every branch is kept, **including the branch that shows no table basis at all** for
used material. Structured data plus components — not string-concatenated HTML.
**Verification.** The four traceability questions in §12.4 are answerable from stored data alone, with no recomputation.
**Dependencies.** P2-004. **Status.** `Not started`. **Evidence:** `Planned only`.

### P3-003 · `E-04`/`E-05` Derive internal revision and internal notes
**Acceptance.** Deriving leaves the source submission's `content_hash` unchanged, and the derived
revision is **absent from every client-facing response** — not shown as locked (`AC-14`). Waivers do
not carry over. Internal notes are a distinct entity from client-visible messages.
**Verification.** `AC-14`; the leakage test covers the client submission route after a derivation exists.
**Dependencies.** P2-004. **Status.** `Not started`. **Evidence:** `Planned only`.

### P3-004 · `E-09` Determinism harness in CI
**Acceptance.** Nightly re-render of historical submission manifests, asserting byte-identical
output. A failure means an unintended engine change or a leaked implicit input. BOM regenerates
byte-identically twice on two machines (`AC-12`).
**Verification.** Nightly CI job green; deliberately introducing `now()` into a quantity path turns it red.
**Dependencies.** P2-004. **Status.** `Not started`. **Evidence:** `Planned only`.

### P3-005 · `AC-20` End-to-end walkthrough of all eight MVP steps
**Acceptance.** One executable transcript ending in byte-identical BOM regeneration and a frozen,
deep-immutable submission. Model it on `rack-studio/e2e/mvp.walkthrough.test.ts` (402 lines, 9 cases,
66 assertions).
**Verification.** `pnpm test:e2e` green. **This is the gate for calling MVP-1 done.**
**Dependencies.** All of P2. **Status.** `Not started`. **Evidence:** `Planned only`.

### P3-006 · Phase 2 backlog, recorded but not started
Column and tunnel resolution (`FR-CP-10/11`), undo/redo, the RFI loop, revision diff, cross-unit
comparison, document issue register, internal takeoff export, where-used, catalog supersede impact
view, per-organization defaults (`OD-18`, defaults never restrictions), the uncatalogued-material
matcher (`OD-17` — the matcher yes, a used-material derate never).
**Status.** `Not started`. **Evidence:** `Planned only`.

### P3-007 · Accessibility and observability, not deferred to the end
**Why it matters.** Both are measured, not asserted, and both are cheaper built in than bolted on.
**Acceptance.** WCAG 2.1 AA with contrast **measured** over rendered text nodes in both themes, the
audit self-testing against known ratios before reporting. Named day-one alerts: any internal-only
field on a client-facing response (treat as an incident), repeated authorization denials, audit
chain verification failure, determinism failure, SLA breach, failed catalog release gate.
**Dependencies.** P1-009 for the field alert. **Status.** `Not started`. **Evidence:** `Planned only`.

---

## Research / human-input dependencies

None of these can be resolved by writing code. Each needs a person, a document or a phone call.

| ID | Item | Blocks | Owner |
|---|---|---|---|
| RH-01 | **Name the external pilot client** (`OD-20b`). Criteria settled; one audited account fits. Blocks no development, but `R-01` — *will a client actually do this work* — stays open until an outside organization submits unaided. Must be a new-material job, or the pilot tests the off-ramp rather than the configurator. | Nothing technical; should be named before P2-002 | EL |
| RH-02 | Reconcile the three Carson counts (P0-004) | The end-to-end acceptance fixture | EL + source artifacts |
| RH-03 | Read the source chart for 59E face height (P0-005) | Catalog ingestion confidence | EL |
| RH-04 | Confirm the Entra licence tier. OIDC works on any tier; SCIM needs P1+. Without it, offboarding is a quarterly-review checklist item, not an automated one. | Nothing in MVP-1 | IT |
| RH-05 | Confirm the nominated fallback catalog approver is positioned to catch a **capacity-table** error specifically — a different competence from design or sales review (`OD-07`). | `B-04` release gate | EL |
| RH-06 | Legal review of the standing disclaimer before any client sees it, and confirmation against PE board rules in the states sold into (`OD-16`, `R-03`). | P2-005 | Counsel |
| RH-07 | Six open source conflicts (§10.8): MH16.1 edition, NFPA section for the 18-inch rule, aisle measurement convention, max row length, dock setback, dead-load basis. Santa Fe Springs' rack handout must be obtained by phone. | No compliance claim may be made until resolved; MVP-1 makes none | EL |
| RH-08 | Re-run the performance spikes on target hardware. Existing figures were taken under software rasterization in a cloud container — a floor, not a measurement. | Confidence in the §5.4 budgets | Dev |
| RH-09 | Two never-closed validation gates from all four prior projects: **no PE has been asked whether this output is a useful input to them**, and **no drafter has confirmed which workflow step this removes**. | Product-value confidence | EL |

---

## Out of scope or explicitly deferred

Each carries the condition that would change the answer. "Not yet" is not "never" — except where it says never.

| Item | Disposition |
|---|---|
| Any claim of structural, manufacturer, PE, fire-protection, code or AHJ approval | **Never**, absent an approved workflow with a licensed professional inside it |
| Detailed customer BOM, quantities, or DWG/DXF export to a client | **Never.** This is the value the product exists to protect |
| Engineering calculations — FEA, Direct Strength Method, seismic from first principles | **Never** in this product |
| Client-configurable rule packs or catalogs | **Never.** It would hand a client control over what the tool concludes |
| Public self-signup | Not planned. The invitation model **is** the access-control model |
| Automatic pricing; cost and margin data in the system at all | Phase 3. Every available rate is uncited and never back-tested |
| Multi-manufacturer catalogs | Phase 4. The cost is verification, not code |
| Staff impersonation of client users | Phase 2 at the earliest, after audit and authz have run in production |
| Advanced canvas/CAD editing | Phase 3+. Explicitly **not** before the model, catalog, revision, validation and BOM work |
| Cloudflare or any deployment polish | Deferred. Per the brief, it does not precede a trustworthy model |
| An external policy engine (OPA / Cedar / OpenFGA) | Revisit at ~50 policy rules or when a customer demands custom roles |
| A second runtime (Python service) | Only when DXF via `ezdxf` or a stamped calc package becomes real — both phase 4 |
| Real-time collaborative editing | Single-writer with stale-base rejection is correct (`OD-19`) |

---

## The five most important next actions

1. **P0-001** — settle the folder name. One canonical path, before anything is built on the wrong one.
2. **P0-002** — `git init` and commit. Cheapest, most urgent; everything else is currently unrecoverable.
3. **P1-001** (`A-01`) — the monorepo scaffold. The first unblocked build task and the gate on all of P1.
4. **P1-002** (`A-02`) — `kernel-units` in µm. Everything depends on it; close the `OD-06` veto window as it lands.
5. **P0-004 / RH-02** — reconcile the Carson counts, in parallel. It is human work and it gates the fixture that gates the engine.

---

## File-impact plan for the first unblocked task (P1-001 · `A-01`)

Nothing below touches the blueprint, the reference trees, or any existing document.

**New files**

```
package.json                      workspace root, pnpm
pnpm-workspace.yaml               apps/*, packages/*, tools/*
tsconfig.base.json                strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
tsconfig.json                     project references
vitest.config.ts                  test runner, alias table #1
.eslintrc.cjs                     incl. the raw-pool-checkout ban placeholder for P1-005
.gitignore                        node_modules, dist, coverage, __pycache__, *.pyc
.github/workflows/ci.yml          install → typecheck → lint → test → tools/check-*
packages/kernel-units/            placeholder package.json + tsconfig only; source lands in P1-002
tools/README.md                   what each check guards, mirroring src/README.md's table
```

**Modified files**

```
README.md                         add a "Repository" section: how to install, test and run the checks
docs/CURRENT_STATE.md             record the A-01 verification result and its date
TODO.md                           set P1-001 to Complete only after the verification command passes
```

**Untouched, explicitly**

```
rack-master-studio-blueprint.html   rebuild only via src/build.py, never edited directly
src/**                              the documentation toolchain is independent of the product build
HANDOFF.md · open-decisions.md · reuse-register.md · reference-project-inventory.md
C:\Rack Master\Resourse (do not delete or overwrite files)\**   read-only, always
```

**Verification to run before marking it complete**

```
pnpm install
pnpm typecheck
pnpm lint
pnpm test
node tools/selftest-boundaries.mjs      # once P1-003 lands
python src\build.py                     # confirm the docs toolchain still passes
```

Record the actual output in `docs/CURRENT_STATE.md` §4. A task is not complete because it looks
done; it is complete when the command has been run and its result written down.
