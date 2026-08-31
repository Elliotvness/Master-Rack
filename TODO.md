# TODO — Rack Master Studio

**Created 2026-08-31 from repository evidence.** Companion to `docs/CURRENT_STATE.md` (what exists)
and `rack-master-studio-blueprint.html` (what is planned). Where a task derives from a blueprint
backlog id, that id is named.

**Status values:** `Not started` · `In progress` · `Blocked` · `Needs review` · `Complete`
**Evidence values:** `Confirmed implemented` · `Implemented but unverified` · `Planned only` · `Blocked by decision/source/input`

> **Baseline, stated once so no item below has to repeat it:** Phase 0 is substantially built.
> **Complete and verified:** `P0-001`, `P0-002`, `P0-006`, `P1-001` (`A-01`), `P1-002` (`A-02`),
> `P1-003` (`A-03`), `P1-004` (`A-04`), `P1-005` (`A-05`), `P1-006` (`A-06`), `P1-007` (`A-07`),
> `P1-008` (`A-08`), `P1-009` (`A-09`), `P1-010` (`A-10`), `P1-011` (`A-11`), `P1-013` (`C-01`).
> **`P1-012` is COMPLETE** (`B-01`..`B-06`). Beams, frames and rule packs all migrated. And
> **`P1-014` is COMPLETE** (`C-02`..`C-08`). The whole derivation kernel, with every gate proven
> to fire by deliberate breakage.
> **Also closed:** `P0-004` (Carson count established) and `P0-005` (59E face height parked).
> **Last full run, 2026-08-31: `pnpm verify` PASS** — **684/684** tests across 28 files, boundary
> self-test + scan (33 files, **9** pure packages), provenance self-test + lint (64 files),
> `check-rls` 19 tables, exit 0. Coverage measures `apps/` too, with ratcheted floors.
>
> **P1 is complete, and Group D has begun.** `D-01` (invitation acceptance) and `D-02` (facility
> entry) and `D-03` (the option builder, carrying demo beat 5) are built and verified in
> `apps/client-web`, along with `D-04`/`D-05` (the preview and the findings panel) and `D-06`
> (comparison). A new **app-boundary gate** enforces that the client bundle cannot import internal
> code. **`D-07`/`E-06` — the submit transaction — is next.**
> Everything else is `Planned only` unless its own row says otherwise. Nothing here may be marked
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
**Why it mattered.** `READFIRST.md` named `C:\Rack Master\Master Rack Studio` as the writable
project; that folder never existed. Two names for one project is how a second, divergent copy gets
created — the exact defect the blueprint exists to prevent.
**Resolution.** EL instructed that `READFIRST.md` be disregarded and deleted. The canonical, and
only, project path is `C:\Rack Master\rack-master-studio`.
**Verification.** `dir "C:\Rack Master"` → `rack-master-studio` and the read-only `Resourse` folder. **Run 2026-08-31: PASS.**
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

### P0-002 · Put the deliverables under version control
**Why it matters.** The product's whole argument is traceability, and the documents that carry it
have no history. `git status` in the active folder returns *not a repository*. A bad edit to the
blueprint is currently unrecoverable, and the built HTML cannot be proven to match its source.
**Files.** `.gitignore`, `.gitattributes`, initial commits.
**Dependencies.** P0-001.
**Acceptance.** Repository initialised, `__pycache__` and `node_modules` untracked, line endings
normalised to LF so a Windows checkout cannot break the byte-identical rebuild guarantee.
**Verification.** `git status --short` clean; `git log --oneline` shows the history. **Run 2026-08-31: PASS** — 3 commits, tree clean.
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

### P0-003 · Run the visual verification gate once and record the result
**Why it matters.** `src/README.md` documents two pre-handoff gates. Only one has ever run. The
untested gate covers overflow at three viewports, console errors, and the `srcdoc` link-interception
behaviour that keeps the document usable inside a preview pane.
**Files.** `src/verify-visual.py`.
**Dependencies.** `pip install playwright && playwright install chromium`.
**Acceptance.** The script runs to completion and its output is recorded in `docs/CURRENT_STATE.md` §4.
**Verification.** `python src\verify-visual.py`.
**Status.** `Not started`. **Evidence:** `Implemented but unverified`.

### P0-007 · Close the coverage blind spot over the application layer
**Why it mattered.** `vitest.config.ts` measured only `packages/*/src/**`, so everything under
`apps/` — authentication, authorization, the DTO leakage boundary, the audit chain — produced **no
coverage number at all**. An unmeasured directory reads as an unproblematic one, and the headline
"100% on all nine pure packages" was true while the authorization layer sat at **70.9%**. The kernel
was the best-tested code in the repository and the layer carrying the commercial risk was the least.
**Found.** By review, 2026-08-31, not by a gate — which is itself the point: a gate that does not
measure something cannot report it missing.
**Resolution.**
- Coverage now includes `apps/*/src/**`. `authorize.ts` **70.9% → 92.4%**, `policy.ts` **63.6% → 100%**.
- **114 new authorization tests**: every action × every role, enumerated rather than sampled, with
  the expected decisions written by hand so the table cannot agree with a bug.
- Application floors are **ratcheted, not 100%**, and deliberately so: a pure function's branches are
  all reachable from its arguments, but an I/O layer has branches reachable only from a driver fault,
  and chasing those produces mocks that assert the mock — a false assurance is worse than an honest gap.
**A defect the new matrix surfaced in the TEST, not the code.** The first draft asserted 404 for
every client denial on an internal resource and failed against correct code. `AC-03` covers internal
**artifacts**, where a 403 would confirm existence; a staff-only **capability** leaks nothing, and a
404 there would be dishonest in the other direction. The two groups are now listed explicitly.
**Verification.** `pnpm verify` **PASS**, 646/646. **Ratchet proven to bite:** deleting the
authorization matrix dropped authz to 85.8% and **failed the build**. Reverted and re-verified.
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

### P0-004 · Reconcile the Carson acceptance numbers before they become a golden fixture
**Why it mattered.** Three artifacts gave three pallet-position counts for one job: 916 bays / 6,824
net (drawing 0005-01 R-1), 916 / 7,196 (`Q-38857-1`), 551 / 4,268 (`Q-38857-8`). Baking a contested
number into the fixture that gates every future engine change would encode the error permanently.
**Resolution, 2026-08-31 (EL).** **The two quotes are reference material, not acceptance sources,
and are disregarded.** `Q-38857-1` and `Q-38857-8` are priced commercial documents produced at
different points in the job's life; neither is a statement of what was installed. The as-built
drawing **0005-01 R-1 is the single authority** for the acceptance fixture.
**The established value** is therefore the drawing's, and it is the only one of the three that is
internally consistent — its own breakdown reconciles exactly:

```
6,980 gross − 156 lost = 6,824 net        916 bays · 324 picking levels
```

**Files.** Future `fixtures/golden/`; sources are read-only in `rack-app` / `rack-engine`.
**Acceptance.** One count established, with a written reason for the disposition of the other two. **Met.**
**Verification.** The fixture asserts `6,824` net, and asserts the breakdown reconciles (gross −
lost = net) rather than only the headline, so a future engine that reaches the right total by the
wrong route still goes red. Written at `C-08`.
**Note carried forward.** That three artifacts for one job disagreed at all remains the clearest
single piece of evidence for why this product should exist. Keep it in the narrative; it is no
longer a blocker.
**Status.** `Complete` — resolved by owner decision. **Evidence:** `Confirmed implemented` (the
decision; the fixture itself lands with `C-08`).

### P0-005 · Resolve or formally park the 59E beam face height
**Why it mattered.** 5.92″ across all 42 catalog rows vs 5.928″ in a documentation table.

**Correction to the original framing, found 2026-08-31 by reading the code.** This item was written
claiming face height "feeds a lookup key, and a wrong key silently sends every lookup off-grid".
**That is not true.** The beam lookup key is `family + series + span` (`kernel-catalog/src/lookup.ts`);
`faceHeightIn` is loaded and carried as descriptive data and is not read by `lookup()` at all. No
capacity, span or clearance result depends on the figure today. The item was over-rated as `P0`
on a misreading, and the correction is recorded rather than quietly dropped.

**Source reading, 2026-08-31 (EL).** The source chart reads **5.93**. That is a third distinct
value, and it **corroborates rather than conflicts**: 5.928 rounds to 5.93 at two decimals, whereas
5.92 is a genuinely different printing. So the reading favours the documentation table over the
transcribed catalog rows.

**Disposition — parked, not settled.** Three readings and still no page reference, so none of the
three is promoted to a fact:
- **The 42 catalog rows are NOT edited.** They stay at 5.92 as published, because transcribe-as-published
  is what keeps the extract reconcilable against its source. Silently "fixing" a row destroys that.
- All three values, the reader, the date and the reason are recorded on the catalog manifest under
  `face_height_59e_status`, plus a `source_anomalies[]` entry, with `page_ref` deliberately left
  empty and `disposition: UNRESOLVED_NON_BLOCKING`.

**What would make it blocking again.** The first time face height is used **dimensionally** — bay
pitch measured from a beam face, or an elevation drawn to scale. At that point a page reference is
required before the number may be used. Until then it is carried, not consumed.
**Files.** `data/catalog/interlake-2026-08/manifest.json`.
**Acceptance.** Either a figure confirmed with a page reference, **or** the discrepancy recorded and
neither value treated as settled. **Met by the second branch.**
**Verification.** `python -c` over the beam data confirms all 42 rows of 59E/59ER remain at 5.92 as
published; the manifest carries all three readings. **Run 2026-08-31: PASS.**
**Status.** `Complete` — formally parked with the record intact. **Evidence:** `Confirmed implemented`.

### P0-006 · Close the OD-06 veto window explicitly
**Why it matters.** Micrometre storage is the recommendation and is correct under every future
answer, but the window closes at `B-02`/`C-08`. Before then it is a one-file change; after, it is a
wide mechanical one. Leaving it implicitly open past that point is the risk.
**Files.** Future `packages/kernel-units/`; `open-decisions.md` decision log.
**Dependencies.** None — proceed on µm unless vetoed.
**Acceptance.** One line in the decision log: vetoed, or stands. Dated.
**Verification.** Manual: log entry exists before `B-02` starts. **Closed 2026-08-31: µm STANDS.** The blueprint's claim was proven against the real extracted span grid — exactly 18 of the 21 published spans miss their lookup key under integer millimetres, all 21 preserved under micrometres (`packages/kernel-catalog/src/lookup.test.ts`). The catalog is now migrated, so the re-base window is closed and the base is confirmed correct.
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

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
**Verification.** `pnpm install && pnpm typecheck && pnpm test && pnpm lint`. **Run 2026-08-31: PASS** — install 193 packages, `tsc --build` exit 0, eslint exit 0, 68/68 tests. CI workflow written but not yet exercised on a real runner.
**Status.** `Complete` (CI unproven until a remote exists). **Evidence:** `Confirmed implemented`.

### P1-002 · `A-02` `kernel-units`
**Why it matters.** Every other package depends on it. Fixed-point µm and millipounds, unit + origin
on every value, allocate-never-divide, fail-closed provenance walkers bounded at depth 32, one-way
metric display formatter.
**Files.** `packages/kernel-units/`. Port mechanics from `rack-studio/packages/units` (read-only), re-base `mil` → µm. Carry `BASIS_BOUND` from `rack-engine/model/quantity.py`.
**Dependencies.** P1-001, P0-006.
**Acceptance.** 100% branch coverage; `lb/pr` refuses conversion to `lb`; adding two different-but-compatible units raises; `allocate()` sums to the original for every split; 48″ round-trips exactly.
**Verification.** `pnpm coverage`. **Run 2026-08-31: PASS** — 68 tests; 100% statements, branches, functions and lines on `kernel-units`, threshold enforced in `vitest.config.ts`.
**Note.** The blueprint's "18 of 21 spans" figure is **not** asserted, because the real published
span list is not in this repository yet. The test asserts the property that does not depend on it
and records why. The exact count becomes assertable at `B-02`.
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

### P1-003 · `A-03` Boundary checker + self-test
**Why it matters.** Cheap now; it is what stops a second implementation of the domain appearing.
Three of the four reference projects have exactly that defect.
**Files.** `tools/check-boundaries.mjs`, `tools/selftest-boundaries.mjs`. Pattern exists in `rack-studio/tools` and `rack-app/tests/test_architecture.py`.
**Dependencies.** P1-001.
**Acceptance.** No kernel package may import I/O, a framework, an app, `Date.now()` or an RNG. The
self-test writes a violation and asserts it is caught. A guard rejects vacuous globbing.
**Verification.** `node tools/selftest-boundaries.mjs` then `node tools/check-boundaries.mjs`. **Run 2026-08-31: PASS** — all 10 violation types caught (Node builtin, bare builtin, framework, database driver, side-effect import, `Date.now()`, `new Date()`, `Math.random()`, `process.env`, `fetch()`); checker scanned 9 files across 1 pure package, clean.
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

### P1-004 · `A-04` Postgres schema v1 + RLS
**Why it matters.** Tenant plumbing is exponentially more expensive to retrofit; it touches every
table. `migrator`/`app_user` role split is what makes RLS real rather than decorative.
**Files.** `packages/db/migrations/`, `packages/db/policies/`.
**Dependencies.** P1-001.
**Acceptance.** Every tenant table has `organization_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, and
a policy per operation including `INSERT ... WITH CHECK`. Every uniqueness constraint is composite
with `organization_id`. `app_user` owns nothing and has neither `SUPERUSER` nor `BYPASSRLS`.
**Verification.** Migrations apply to a clean Postgres 16; cross-tenant `SELECT` returns zero rows and cross-tenant `INSERT` is refused, both against a real database. **Run 2026-08-31: PASS** — `pnpm migrate` applied `0001_init.sql` and `0002_rls.sql`; 27 tenancy tests green against real Postgres. Proven to fail: disabling RLS on `app.project` turned 5 tests red.
**Also enforced at the database layer, beyond the original acceptance criteria:** frozen revisions and their derived rows refuse changes by trigger; audit events refuse UPDATE and DELETE; the catalog approval gate refuses an APPROVED release whose approver is the digitiser or which carries no recorded verification path; a BOM line must carry exactly one part reference and either a quantity or an unresolved reason.
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

### P1-005 · `A-05` `withTenant()` + lint ban on raw pool checkout
**Why it matters.** `set_config(..., true)` inside an explicit transaction is the only safe shape. A
session-scoped `SET` under a transaction pooler survives the connection being handed to another
client — a cross-tenant leak waiting for a load spike.
**Files.** `packages/db/with-tenant.ts`, lint rule config.
**Dependencies.** P1-004.
**Acceptance.** One wrapper is the only database entry point; raw checkout fails lint.
**Verification.** `pnpm lint` fails on a file that checks out a connection directly; wrapper unit test asserts the GUC is set and reverted at COMMIT. **Run 2026-08-31: PASS** — `withTenant()` uses `set_config(..., true)` inside an explicit transaction; eslint bans both raw `pg` imports and `pool.connect()` outside the wrapper.
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

### P1-006 · `A-06` CI assertion that RLS is universal
**Why it matters.** The forgotten table is the realistic failure, not the wrong policy.
**Files.** `tools/check-rls.mjs`.
**Dependencies.** P1-004.
**Acceptance.** Reads `pg_class.relrowsecurity` and `pg_policy` for every table in the application
schema; adding a table without RLS fails CI. (`AC-05`.)
**Verification.** `node tools/check-rls.mjs`; add a bare table and confirm CI goes red. **Run 2026-08-31: PASS** — 16 tables inspected, all enabled and forced with a policy per operation; `app_user` confirmed to have neither SUPERUSER nor BYPASSRLS. **Proven to fail:** disabling RLS on one table produced `app.project: row-level security is NOT ENABLED`.
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

### P1-007 · `A-07` Sessions, cookies, OIDC for staff, password + TOTP for clients
**Why it matters.** Internal accounts see every organization's data. Email magic links are not an
acceptable standing second factor.
**Files.** `apps/api/auth/`.
**Dependencies.** P1-004.
**Acceptance.** Opaque server-side tokens, `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite`, ≥128
bits entropy, never `localStorage`; regeneration on authentication and privilege change;
deactivation terminates every session and revokes pending invitations (`AC-17`).
**Verification.** Integration test: deactivate a user mid-session, assert the next request is rejected and pending invitations are revoked. **Run 2026-08-31: PASS** — 24 tests: scrypt password hashing, opaque sessions with absolute+idle expiry, token regeneration, `AC-01` single-use invitation with identical response for expired/revoked/used/absent, `AC-17` deactivation revokes all sessions + invitations.
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

### P1-008 · `A-08` `authorize()` + middleware + boot-time route-coverage assertion
**Why it matters.** The one control that survives someone adding an endpoint on a Friday.
**Files.** `apps/api/authz/`, route policy registry.
**Dependencies.** P1-007.
**Acceptance.** A route without an `{ action, resourceLoader }` annotation prevents application boot
(`AC-06`). Cross-tenant denials return `404`, never `403` (`AC-03`). Every deny writes an audit event.
**Verification.** Add an unannotated route; the app must fail to start. Enumerated authorization test over every route. **Run 2026-08-31: PASS** — 23 tests: org + actor_type scoping, 404-not-403, `SERVICE_ENGINE` denied all (I-4), `assertRouteCoverage` throws on a missing/unknown/misfiled/duplicate/empty route (`AC-06`).
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

### P1-009 · `A-09` DTO layer + forbidden-field constant + leakage contract test
**Why it matters.** Worth ten times more written against six routes than against two hundred. This
is the control for `R-02`, the risk that destroys the product's reason to exist.
**Files.** `packages/contracts/`, `apps/api/dto/`, `tools/check-leakage.mjs`.
**Dependencies.** P1-008.
**Acceptance.** One DTO per (entity × audience), constructed field by field — never `exclude([...])`.
One shared forbidden-field constant used by the test, the log redactor and the response validator.
Client routes enumerate automatically and no forbidden key appears at any nesting depth (`AC-02`).
A positive companion test asserts staff *do* see those fields.
**Verification.** `node tools/check-leakage.mjs`; add `cost` to a client DTO and confirm the test goes red. **Run 2026-08-31: PASS** — 13 tests: `FORBIDDEN_CLIENT_FIELDS` matches §9.2, `findForbiddenFields` walks every depth incl. inside `item_snapshot`, DTOs built field by field drop `organization_id`/`margin_pct`/`internal_note`, `redactForLog` shares the constant (`AC-02`).
**Status.** `Complete`. **Evidence:** `Confirmed implemented`. (Implemented as `findForbiddenFields` in the DTO package rather than a standalone `check-leakage.mjs`; the contract test consumes it.)

### P1-010 · `A-10` `audit_event` table, append-only trigger, hash chain
**Why it matters.** A change without its audit record must be impossible, not merely unlikely.
**Files.** `packages/db/migrations/`, `apps/api/audit/`.
**Dependencies.** P1-004.
**Acceptance.** Written in the same transaction as the change it describes; `UPDATE`/`DELETE` revoked
plus a trigger that raises; `hash_n = SHA-256(prev_hash ‖ canonical(event_n))`; ordering authority is
a monotonic sequence, not a timestamp; both `occurred_at` and `recorded_at` stored (`AC-15`).
**Verification.** Chain verifies from genesis; an attempted `UPDATE` on an audit row raises; a rolled-back change leaves no audit row. **Run 2026-08-31: PASS** — 12 tests against real Postgres: chain verifies from genesis, tamper detection **proven** by disabling the trigger and corrupting a row (both altered-content and deleted-row cases), I-3 enforced at two layers (`AC-15`).
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

### P1-011 · `A-11` Transactional outbox + worker
**Why it matters.** An email must not be sent for a transaction that rolled back.
**Files.** `apps/worker/`, outbox migration.
**Dependencies.** P1-004.
**Acceptance.** No mailer import exists outside the notifier worker; enqueue and business change commit together.
**Verification.** Integration test: roll back a transaction, assert nothing is dispatched. **Run 2026-08-31: PASS** — 8 tests against real Postgres: a rolled-back transaction dispatches nothing, a claim is exactly-once via `FOR UPDATE SKIP LOCKED`, a retry backs off, and exhausted attempts dead-letter.
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

### P1-012 · `B-01`..`B-06` Catalog and rule packs
**Why it matters.** The verified catalog is the most expensive asset in all four trees and
everything downstream depends on it. It must arrive as declarative data, never executable code.
**Files.** `data/catalog/interlake-<rev>/`, `data/rules/<pack>-<rev>/`, `packages/kernel-catalog/`.
Sources are read-only: `rack-engine\catalog\interlake-2026-08\` (378 beam rows),
`rack-app\frame_capacity_published_2025\` (3 tables, 435/435 reconciled).
**Dependencies.** P1-002. (`P0-005` was listed here as a blocker; it is closed — the 59E figure is
parked as a recorded anomaly and is not a lookup key, so it never blocked this item.)
**Acceptance.** JSON/TOML validated against a published schema. Every provenance field carried
verbatim: `load_basis`, `deflection_limit`, `code_basis`, `source_anomalies[]` (all seven),
`constraints` (reported, never enforced). Data re-enters `DRAFT` and requires approval **in the new
system**. The release gate refuses when `approved_by` is null, when `approved_by == digitised_by`,
or when there is one human signature with no recorded cross-check or two-path reconciliation
(`AC-18`). Lookup is exact-grid only: off-grid returns both brackets and no value (`AC-08`); no
nearest-match; used or generic material carries no table basis at all (`AC-09`).
**Verification.** Schema validation in CI; a release with a null approver fails the build; an off-grid lookup test asserts both brackets and no value. **Run 2026-08-31: PASS** — `python tools/extract-catalog.py` produced 378 verbatim beam rows, 16 families, 21 spans and 7 anomalies, parsed via `ast` with the source never executed; 34 tests in `kernel-catalog` cover on-grid capacity, `AC-08` off-grid brackets with no value, the absence of nearest-match, the per-pair basis, and the `AC-18` approval gate. The blueprint's 18-of-21 span claim is now **proven** against the real published grid rather than a reconstruction.
**Rule-pack half, added 2026-08-31.** The acceptance text above was written for the catalog. `B-05`
adds the second pinned artifact: a rule pack on its own clock, every rule carrying a verification
tier that caps what it may conclude, its own approval gate refusing the author approving their own
pack, and all six open source conflicts recorded rather than resolved. Verified separately — see
the `B-05` entry below.
**Status.** **`Complete`.** **Evidence:** `Confirmed implemented` for `B-01` through `B-06`.

**`B-03` — Complete and verified 2026-08-31.** Three frame-capacity tables, **435 cells**, extracted
verbatim and matching the source's own double-extraction reconciliation exactly.
- **Frame capacity keys on TWO independent variables**, not one: `(HbL, frame-height band)`. Models
  2.314 / 2.313 / 2.312 carry two strut patterns, so a lookup keyed on HbL alone **cannot reproduce
  the published table**. A test asserts the two bands differ (24,571 vs 25,847 lb at HbL 36), so a
  future simplification fails loudly.
- The 21 ft boundary is **inclusive at the lower band**, per the ≤ 21′ column header. Asserted at 251,
  252 and 253 in, because an off-by-one selects the more generous column.
- **The quarantined tables are refused BY NAME in the extractor**, not left to memory, and three
  tests assert the published values are returned rather than the proven-wrong ones — 7,597 not
  10,400 at HbL 96; 4,989 not 8,600 at HbL 120 (the +72.4% overstatement).
- **Governing HbL includes the floor-to-first-beam gap.** All three charts define it that way, so
  this is published basis rather than the interpretation decision `rack-app`'s review filed it as.
**Verification.** `pnpm verify` **PASS**, 684/684, `frames.ts` and `load-frames.ts` at 100%.
**Three gates proven to fire:** the extractor refused a quarantined table by name; restoring the
10,400 value turned a test red; dropping one column from a row was refused at load with
`HbL 36 has 9 values but 10 columns` — the silent left-shift that would otherwise look plausible.
- ~~**`B-05`**~~ **Complete and verified 2026-08-31.** `packages/kernel-rules` + `data/rules/mvp-2026-08/`: the five-tier ladder, the §11.2 ceiling asserted verbatim, the rule/citation loader, the pack approval gate, and twelve seed rules. **`AC-19` is proven exhaustively** over all 5 tiers × 7 severities, and the gate was **proven to fire** — adding `PASS` to the `SECONDARY` list turned 3 tests red across both files. 46 tests, 100% coverage.

### P1-013 · `C-01` `kernel-model` — write the hash-stability test first
**Why it matters.** The blueprint and two reference projects independently give this advice. A
truncating hash is the one failure mode a hash must not have.
**Files.** `packages/kernel-model/`.
**Dependencies.** P1-002.
**Acceptance.** Canonical JSON: sorted keys, fixed number formatting, `undefined` dropped, explicit
units, bounded depth that **fails loudly**. Hash covers content only; the exclusion list
(lineage, timestamps, author, note) is held as data so a test can assert exactly what is covered.
Deep freeze on publish so mutation is a `TypeError`.
**Verification.** Hash-stability test written before the hashing code; property test asserting key-order independence; a depth-exceeding structure raises rather than truncating. **Run 2026-08-31: PASS** — 81 tests across `canonical`, `sha256` and `revision`; 100% coverage. **The test earned its keep immediately:** it caught a SHA-256 padding bug at the 55-byte block boundary that would have made every stored hash wrong.
**Also delivered:** the revision lifecycle — refusals list every reason and carry their own audit event, publish deep-freezes, `cloneToDraft` leaves the source hash untouched, and `mayWaive()` throws naming `OD-09` rather than defaulting permissive.
**Status.** `Complete`. **Evidence:** `Confirmed implemented`.

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
**Status.** **`Complete`.** **Evidence:** `Confirmed implemented` for `C-02` through `C-08`.

**`C-02` (`kernel-derive`) — Complete and verified 2026-08-31.** Pure geometry and pallet-position
counts over provenanced quantities, no catalog or rule number invented in application code:
- `bayPitch` = beam clear span + one upright face.
- `runLength` = n × bay pitch + one closing upright face — the n+1-upright rule, asserted from both
  ends by a property test (`length − n × clearSpan == (n+1) × uprightFace` for n ∈ {1,2,5,20,82}).
- `allocateOverhang` splits front/rear via `allocateNamed`, never halved; the odd µm lands on the
  front (aisle) side and the two shares sum to the original exactly.
- `aisleClearWidth` measures face to face (ADR-006 datum), order-independent, never negative.
- `grossPositions` = positions/bay × bays × storage levels, floor counted only when it stores.
- `positionAccounting` reports gross, lost and net together with a per-reason breakdown; two
  invariants are asserted — the breakdown sums to lost, and net + lost = gross — and it refuses to
  lose more than exist, a negative or non-integer loss, a reason with no text, or a loss in a
  non-count unit.
- Every result carries a `ProvenanceNode` tree; an `UNKNOWN` input propagates to an `UNKNOWN`
  result rather than being laundered into an established one.
**Verification.** `pnpm verify` **PASS** — 329/329 tests (was 290; +39 in `kernel-derive`),
`kernel-derive/src` at **100%** statements/branches/functions/lines, boundary self-test + scan
(now 16 files across 4 pure packages) and RLS all green. Wired into the three-way alias table
(`tsconfig.base.json`, `vitest.config.ts`, project references) with the alias agreement intact.

**`C-03` (`kernel-geom`) — Complete and verified 2026-08-31.** Obstruction faces and the
span-bucketed clearance index (ADR-006/007), pure integer-µm geometry, no invented number:
- `face()` validates an axis-aligned face (axis, coord, span lo/hi, normal), refusing an empty or
  inverted span, a non-integer µm, or a missing id. `kind` is free-form data, not a hard-coded enum,
  so a new obstructing object type does not mean editing this module (ADR-007's note).
- `minClearanceBrute` is the obviously-correct nearest-opposing-face oracle: two faces bound each
  other only if they share an axis, oppose in normal, overlap in span, and one sits ahead of the
  other in its facing direction.
- `ClearanceIndex` is ADR-007's *required* implementation, ported from the Task 0.4 spike: faces
  bucketed by (axis, normal, span bucket) at 120 in, each bucket sorted by coordinate, a query
  binary-searching to its own coordinate and scanning only the touched buckets. `minClearance`
  returns a raw µm integer; `minClearanceQuantity` wraps it as a length with a caller-stated origin.
- **The load-bearing test** builds a full irregular scene (>300 faces: back-to-back rows, column
  guards, dock jambs, closed perimeter, no-rack zone) and asserts the index returns identical
  clearance to the oracle for **every** face. A faster wrong answer is not a result.
**Verification.** `pnpm verify` **PASS** — 352/352 tests (+23 in `kernel-geom`), `kernel-geom/src`
at **100%** coverage, boundary scan now 18 files across 5 pure packages, RLS green. Wired into the
three-way alias table and project references.

**`C-04` (`kernel-checks`) — Complete and verified 2026-08-31.** The twelve MVP checks (§11.4) and
the framework that applies the verification-tier ceiling to everything they observe:
- **The control is structural.** A `Check` returns an `Observation`; only `runChecks` produces a
  `Finding`; `applyCeiling` is called in exactly one place. A check cannot overstate its authority
  because a check cannot produce a finding at all.
- **`AC-19` proven by two deliberate breaks**, not by assertion. Rewriting the aisle check to claim
  `PASS` against its `SECONDARY` rule went red. **More importantly**, demoting a rule from `PRIMARY`
  to `SECONDARY` **in `rules.json` with no code edited** turned check 4's verdict from `BLOCKER` into
  `ENGINEERING_REVIEW_REQUIRED`. Both reverted and re-verified.
- **`AC-07` is made unrepresentable, not merely enforced.** `FindingParameter` is a discriminated
  union where `value` is `null` exactly when `established` is false.
- **`AC-08`**: an off-grid span returns both brackets and no capacity, and the reason names that the
  engine does not interpolate. **`AC-09`**: uncatalogued material carries no capacity and no table
  basis at all, its citation naming the product's scope constraint because no table was read.
- **Silence is not a pass**: `silentChecks()` names every check that reported nothing, so the screen
  can show it rather than omit it. **Missing input survives a weak tier**, so the client's actionable
  list is never buried in things they cannot act on.
- `closed_by` is mandatory and the framework refuses a finding without one.
**Verification.** `pnpm verify` **PASS**, exit 0 — 456/456 tests (+56), `kernel-checks/src` at
**100%** coverage, boundary scan now 25 files across **7** pure packages, RLS green. **A defect the
coverage gate caught:** a ternary whose branches were identical — dead logic pretending to be a
decision — deleted rather than tested.

**`C-05` (`kernel-bom`) — Complete and verified 2026-08-31.** The internal takeoff and its
unresolved register (§12):
- **`AC-13` is unrepresentable rather than refused.** `BomLine` is a discriminated union: resolved
  carries a quantity and a null reason, unresolved carries the reverse. Neither "both" nor "neither"
  can be constructed.
- **Three established rules, and nothing else.** Frames = `(bays + 1) × rows` with back-to-back rows
  **not** sharing uprights; beams = `bays × levels × 2 × rows`; anchors = `frames × 4`, verified
  against a delivered job at 3,812 / 953 = 4.000 exactly. The n+1 property is asserted from both
  ends for n ∈ {1, 2, 5, 20, 82}, not by example.
- **Wire decks, row spacers and footplates emit `UNRESOLVED`.** All three conflicting wire-deck
  formulas are **named in the reason**, so a future reader cannot restore one believing it was lost
  by accident. Every reason states what would close it.
- **An unresolved line contributes nothing to a category total — null, never 0.** A zero reads as
  "none required", which on a takeoff sheet is a purchase order.
- **`AC-12`**: `canonicalBom` regenerates byte-identically, is independent of the caller's source-id
  ordering, and is asserted non-vacuous (changing a bay count changes the bytes).
- Uncatalogued material yields a quantity but **no capacity field at all**.
**Verification.** `pnpm verify` **PASS**, exit 0 — 487/487 tests (+31), `kernel-bom/src` at **100%**
coverage on the first run, boundary scan 28 files across **8** pure packages. **Both gates proven to
fire:** adopting a wire-deck formula turned 3 tests red; letting back-to-back rows share frames
turned 5 red with exactly the off-by-one the rule prevents (`expected 21 to be 22`).

**`C-06` (`display-list`) — Complete and verified 2026-08-31.** The renderer-neutral drawing model
(ADR-003). One display list, three renderers: Canvas 2D for plans, inline SVG for elevations,
server-side PDF for documents.
- **A renderer consumes; it may not recompute a dimension** (§8). The extent is supplied rather than
  inferred from the items, and geometry is integer micrometres in **model space** — a pixel is a
  rendering decision, and baking one in is how two renderers drift apart.
- **`{text, established}` on every text entry, never a bare string.** A bare string has already lost
  the distinction between "144 inches" and "we do not know".
- **`AC-07` at the drawing layer**, asserted as *no digit anywhere* in an unestablished entry rather
  than as a string match against `VERIFY`.
- **A dimension the model cannot state still draws** its witness lines and prints `VERIFY`. Omitting
  it would read as "no dimension applies", which is a different claim from "we cannot state it".
- The elevation witnesses every level **from the floor datum**, not from the level below: a chain of
  relative dimensions accumulates the reader's error.
- The plan draws **n+1 uprights for n bays**, so `kernel-derive`'s rule is visible where a person
  can check it.
**Verification.** `pnpm verify` **PASS**, exit 0 — 513/513 tests (+26), `display-list/src` at
**100%** coverage, boundary scan 31 files across **9** pure packages. **Both gates proven to fire:**
making an unknown aisle width print `0"` turned 2 tests red (the exact `AC-07` leak), and drawing n
uprights instead of n+1 turned 2 red. **Two defects the gates caught:** an untested `?? null` branch
on the optional label, and a test asserting a fractional micrometre is refused that **failed to
fail** — the guard was unreachable, since µm has scale 1 and lengths are integers. The guard was
deleted and the test rewritten to assert a real refusal (a load where a length belongs).

**`C-07` (provenance lint) — Complete and verified 2026-08-31.** `tools/lint-provenance.mjs` plus
`tools/selftest-provenance.mjs`, both wired into `pnpm verify` and CI.
- **Enforces what `C-06` only states.** A formatter must be applied to a provenanced `Quantity`,
  never a raw number — otherwise `AC-07` is bypassed at the last inch, on the one surface the client
  reads.
- **A source scan despite the type checker**, because `as never`, `as unknown as Quantity`,
  `@ts-expect-error` and hand-built object literals all defeat types, and a cast is exactly how a raw
  number reaches a formatter. Provenance carried through a cast is fiction, so the cast is flagged.
- **Deliberately narrow.** A bare identifier is not flagged: `formatLength(x)` is correct when `x` is
  a Quantity, and deciding that needs types rather than text. Only the provably wrong is flagged —
  numeric literals, arithmetic on raw numbers, `.value` reached past the quantity, coercions, casts.
- **The self-test asserts the negatives too** — 6 legal forms that must NOT be flagged, including a
  formatter named in a comment or a string. A linter that flags correct code trains people to ignore
  it, and an ignored gate is an absent gate.
**Verification.** `pnpm lint:provenance:selftest` **PASS** — 8 violation types caught, 6 legal forms
allowed; `pnpm lint:provenance` **PASS** on 57 real files; `pnpm verify` **PASS** exit 0 with both
gates in the chain. **Three probes, all fired:** formatting a raw number in a real display builder
failed the lint; renaming the scan roots produced *"Refusing to report a pass for a scan that
checked nothing"* rather than a silent green; and **disabling the linter's own detection was caught
by its self-test** — the control on the control.

**`C-08` (golden fixtures) — Complete and verified 2026-08-31. This closes `P1-014`.**
`fixtures/golden/carson-0005-01-r1.json` plus `kernel-derive/src/golden.test.ts`, which consumes it.
- **Wired into the test run**, which is the entire point. The reference project's fixtures are read
  by nothing — a control that looks like a control and has never once failed. **Proven consumed:**
  deleting the fixture fails the build with `ENOENT`.
- **Asserts the breakdown, not the headline.** `gross − lost = net`, plus the engine's own
  invariants, against a job that was actually installed.
- **The decisive probe:** an engine inflating gross AND lost by 100 still returns **net = 6,824** —
  the right answer by the wrong route. The fixture caught it on gross (7,080) and lost (256). A
  headline-only fixture would have passed it.
- **An arithmetic finding.** `6,980 / 916 = 7.6201`, not an integer, so **no uniform level count
  reproduces the as-built gross**. Carson is a mixed configuration and the drawing does not break it
  down by run, so `beam_levels_per_bay` is recorded as `not_established` **with the reason** rather
  than inventing a configuration that multiplies out. A fixture encoding a guess is worse than no
  fixture: a wrong answer with a test defending it.
- A test asserts every `not_established` entry carries a real reason, so the section cannot decay
  into bare markers. The two rejected quotes are recorded in `source.disregarded`, so a future reader
  knows they were considered rather than missed.
**Verification.** `pnpm verify` **PASS**, exit 0 — 657/657 tests (+11); coverage green including the
new application floors.

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
**Dependencies.** P2-004, and `C-06` for the display list it renders from — the PDF and the canvas
must not be two renderers that can disagree about a number.
**Status.** `Not started`. **Evidence:** `Planned only`.

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
**Dependencies.** P2-004. **Upstream is now in place:** `C-05` gives every BOM line its `ruleText`,
`ruleId`, `confirmed` flag and `sourceObjectIds`, and `C-04` records `ceilingApplied` on every
finding — so "why is this not a pass?" and "which rule produced this quantity?" are already
answerable from stored data without recomputation. This item is the *view*, not the data.
**Status.** `Not started`. **Evidence:** `Planned only`.

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
| ~~RH-02~~ | ~~Reconcile the three Carson counts (P0-004)~~ **Closed 2026-08-31.** EL: the two quotes are reference only and are disregarded; as-built drawing 0005-01 R-1 governs. 6,824 net is established. | — | EL |
| ~~RH-03~~ | ~~Read the source chart for 59E face height (P0-005)~~ **Closed 2026-08-31.** EL read the chart as **5.93**, corroborating the 5.928 documentation table over the transcribed 5.92. Parked rather than settled: no page reference yet, rows left as published, and face height is not a lookup key so nothing depends on it. Reopens if face height is ever used dimensionally. | — | EL |
| RH-04 | Confirm the Entra licence tier. OIDC works on any tier; SCIM needs P1+. Without it, offboarding is a quarterly-review checklist item, not an automated one. | Nothing in MVP-1 | IT |
| RH-05 | **Name an approver for each pinned artifact — now the most actionable open item.** Two packs sit in `DRAFT` and neither can be pinned by a new revision until approved: the Interlake catalog (378 rows) and the MVP rule pack (12 rules). Both gates refuse self-approval and both require a recorded verification path, so a name alone is not enough. For the catalog, confirm the approver is positioned to catch a **capacity-table** error specifically — a different competence from design or sales review (`OD-07`). | `B-04` catalog release + `B-05` rule-pack release | EL |
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

Complete and verified (2026-08-31): all of Group A (`A-01` through `A-11`), `C-01`, Group B's
catalog migration and lookup (`B-01`/`B-02`/`B-04`/`B-06`), and the first two kernel slices `C-02`
(`kernel-derive`) and `C-03` (`kernel-geom`). `OD-06` veto window closed. **352 tests**, 100%
coverage on all five pure kernel packages, RLS/auth/authz/DTO/audit/outbox proven against real
Postgres, and the catalog proven against real published data. The next five are:

1. **`D-01`/`D-02` — begin the client web application.** Invitation acceptance and facility/unit
   entry. Every kernel it needs is built, tested and proven: catalog, rules, checks, BOM, display
   list, and an authorization layer with an exhaustive action × role matrix.
2. **`B-03`** — migrate the three verified frame-capacity tables (435 reconciled cells) from
   `rack-app`, the same way the beam data was extracted. `C-04`'s beam/frame compatibility check
   currently takes compatibility as an input because this data is not here yet.
3. **`D-03`** — the option builder over the controlled vocabulary. Choices come only from the
   pinned catalog release; an unavailable choice **states why**; no silent nearest-match. The
   pilot client (`OD-20b`) should be named before this starts.
4. **P0-003** — install Playwright and run `verify-visual.py` once, so both documentation gates are
   proven rather than one.
5. **The catalog and rule-pack approvers** (`RH-05`). Both packs sit in `DRAFT`, both gates refuse
   self-approval, and neither can be pinned by a new revision until approved. Needs a name and a
   recorded verification act, not code. **This is the only item on this list that development
   cannot clear by itself.**

---

## File-impact plan for the next unblocked task (P2-001 · `D-01`/`D-02`)

**P1 is complete.** The client application can begin, and every kernel it consumes is built and
proven. `D-01` is invitation acceptance; `D-02` is facility and unit entry.

**New files**

```
apps/client/                          the client-facing application (the FIRST front end)
apps/client/src/routes/invite.tsx     invitation acceptance; AC-01 already enforced server-side
apps/client/src/routes/facility.tsx   facility entry, every field individually markable NOT KNOWN
apps/client/src/lib/api.ts            typed client for /api/client/v1 ONLY
```

**Modified files**

```
pnpm-workspace.yaml                   add apps/client
tsconfig.base.json · vitest.config.ts the @rms/client alias, three-way agreement
.github/workflows/ci.yml              build the client app
docs/CURRENT_STATE.md · TODO.md       results, only after the commands pass
```

**Untouched, explicitly**

```
packages/kernel-*/**                  no kernel package learns about HTTP or rendering
apps/api/src/authz/**                 the client app authorizes through the existing layer
C:\Rack Master\Resourse (do not delete or overwrite files)\**   read-only, always
```

**The decisions already made that the app must not re-litigate.**
- **Two front ends and two API namespaces**, never one with role flags. A shared route that hides
  fields makes leakage a serialization bug — invisible in review. Two namespaces make it a routing
  bug: loud and greppable.
- **Every facility field is individually markable *not known***, producing a finding rather than a
  zero. A zero is a claim; "not known" is the truth.
- **The client never sees a BOM**, at any nesting depth. The forbidden-field constant and
  `findForbiddenFields` already enforce it; the app must consume the client DTOs, never the entities.
- An unestablished value renders `VERIFY`, never a numeral — the display list already guarantees it
  and the provenance lint fails the build if a renderer formats a raw number.

**Verification before marking complete**

```
pnpm verify
pnpm coverage
```

Then prove the gate fires: attempt to render a forbidden field on a client page and confirm the
leakage test goes red.

Record the actual output in `docs/CURRENT_STATE.md` §4. A task is not complete because it looks
done; it is complete when the command has been run and its result written down.
