# Current State — Rack Master Studio

**Assessed 2026-08-31 by repository inspection.** Every claim below is traceable to a file that was
read or a command that was run. Where something was not verified, it says so.

Status vocabulary used here, carried from `rack-engine/CLAUDE.md`:
`CONFIRMED IMPLEMENTED` · `IMPLEMENTED BUT UNVERIFIED` · `PLANNED ONLY` · `BLOCKED`.

---

## 1. Headline

**Phase 0 Group A is complete and the kernel is under way.** The planning package is complete and
twelve foundation tasks are implemented, verified and committed: `A-01` scaffold, `A-02`
`kernel-units`, `A-03` boundary checker, `A-04` schema + RLS, `A-05` `withTenant()`, `A-06` RLS
assertion, `A-07` sessions and authentication, `A-08` `authorize()`, `A-09` the DTO leakage layer,
`A-10` the audit hash chain, `A-11` the transactional outbox, plus `C-01` `kernel-model`. Group B
has begun: the verified Interlake catalog is migrated (`B-01`/`B-02`/`B-04`/`B-06`) with a
no-interpolation lookup. The derivation kernel has two slices landed — `C-02` `kernel-derive`
(geometry and pallet-position counts) and `C-03` `kernel-geom` (obstruction faces and the clearance
index). **`C-04`..`C-08` and `B-03`/`B-05` are the next real work.**

| | |
|---|---|
| Blueprint revision | Rev C, 2026-08-31 |
| Decisions | 21 of 21 settled; one commercial item deliberately open (`OD-20b`) |
| Production source files | **50+** across five pure kernel packages, `db`, `apps/api`, `tools/` |
| Product tests | **354**, all passing across 17 files (pure + real-Postgres + real catalog data) |
| Kernel coverage | **100%** statements, branches, functions, lines on all **five** kernel packages |
| Catalog data | 378 verified Interlake beam rows, extracted verbatim, status `DRAFT` (awaiting human approval) |
| Database | Postgres 16, **19 tables**, RLS enabled + forced on every one |
| Documentation toolchain | Working, 11 checks, all passing |
| Version control | **git, 18 commits**, working tree clean |
| Last full verification | `pnpm verify` **PASS**, exit 0, 2026-08-31 |

## 2. Naming

`READFIRST.md` previously named a `Master Rack Studio` folder that never existed. That brief has
been removed at the owner's instruction and the canonical, and only, project path is:

```
C:\Rack Master\rack-master-studio
```


## 3. Inventory of the active project

```
C:\Rack Master\rack-master-studio\
├── rack-master-studio-blueprint.html   316,002 bytes · 19 sections · 7 SVG figures · GOVERNING DOC
├── README.md · HANDOFF.md · open-decisions.md
├── reference-project-inventory.md · reuse-register.md
├── TODO.md                             prioritised backlog
├── docs\CURRENT_STATE.md               this file
│
├── package.json · pnpm-workspace.yaml  pnpm workspace
├── tsconfig.base.json · tsconfig.json  TypeScript strict + project references
├── vitest.config.ts                    test runner; alias table
├── eslint.config.mjs                   incl. the Date.now / Math.random determinism bans
├── .gitignore · .gitattributes         LF everywhere, so hashes match across machines
├── .github\workflows\ci.yml            typecheck → lint → test → self-test → boundaries → coverage
│
├── packages\kernel-units\src\          A-02. Pure: no I/O, no clock, no RNG
│   ├── units.ts                        storage bases, BASIS_BOUND
│   ├── errors.ts                       every refusal names what and why
│   ├── quantity.ts                     fixed-point arithmetic, allocate-never-divide
│   ├── provenance.ts                   fail-closed walkers, depth bound 32
│   ├── display.ts                      one-way formatting; VERIFY, never a numeral
│   └── *.test.ts                       68 tests
│
├── tools\
│   ├── check-boundaries.mjs            A-03. Kernel purity scan
│   └── selftest-boundaries.mjs         proves the checker catches all 10 violation types
│
└── src\                                the blueprint's Python build toolchain (unchanged)
```


## 4. Verification log

Every row is a command that was run and its actual result. Nothing is recorded here on the strength
of looking finished.

**2026-08-31 — `P0-005` closed: the 59E face height, parked and pinned**

| Check | Command | Result |
|---|---|---|
| Rows unchanged | `pnpm test` | **PASS.** All 42 rows of 59E/59ER still read `5.92` — the value as published |
| The discrepancy cannot reach a capacity | `pnpm test` | **PASS.** Perturbing every 59E face height to 5.93 and re-running the lookup returns a byte-identical result, because the key is `family + series + span` |
| **The new gate fires** | deliberate break | **PROVEN.** Changing the pin to `5.93` turned the row test red (1 failed / 24); reverted and re-run green |
| Whole pipeline | `pnpm verify` | **PASS.** 354/354 tests (was 352); typecheck, lint, boundaries, self-test, RLS all green |
| Kernel coverage | `pnpm coverage` | **PASS.** `kernel-catalog/src` still 100% on all four measures; no threshold breached |

**EL read the source chart as 5.93.** That is a *third* distinct value, and it corroborates rather
than conflicts: 5.928 rounds to 5.93 at two decimals, whereas 5.92 is a genuinely different
printing. So the reading favours the documentation table over the transcribed rows — but it still
arrives **without a page reference**, so no figure is promoted to a fact. All three readings, the
reader and the date are recorded on the catalog manifest under `face_height_59e_status`, with
`page_ref` deliberately empty.

**The 42 rows were not "corrected".** Transcribe-as-published is what keeps the extract
reconcilable against its source; editing a row to match a better reading destroys the property that
makes the data trustworthy. The rows stay at 5.92 and the disagreement is carried as data.

**A correction to the backlog, recorded rather than quietly dropped.** `P0-005` was written claiming
face height "feeds a lookup key, and a wrong key silently sends every lookup off-grid". Reading
`kernel-catalog/src/lookup.ts` shows that is **false** — `faceHeightIn` is loaded, carried, and never
read by `lookup()`. The item was rated `P0` on a misreading of the code. It is non-blocking today,
and the second new test pins exactly that property, so if face height ever *does* become load-bearing
the test stops being true and the question returns on its own rather than being forgotten.

**2026-08-31 — state review (re-run of the whole gate, no code change)**

| Check | Command | Result |
|---|---|---|
| Whole pipeline, from a clean tree | `pnpm verify` | **PASS**, exit 0 in 16.7 s. 352/352 tests across 17 files; `tsc --build` and `eslint .` clean |
| Boundary self-test | (in `pnpm verify`) | **PASS.** All 10 violation types caught |
| Boundary scan | (in `pnpm verify`) | **PASS.** 18 files across 5 pure packages |
| RLS assertion | (in `pnpm verify`) | **PASS.** 19 tables in schema `app`, all enabled and forced |

This run confirms the committed state reproduces on a cold checkout. `TODO.md` was found stale — it
still listed `A-07`..`A-11` and the catalog work as `Not started` after they had been built and
committed, and it carried a file-impact plan for `A-07`, long since done. Corrected in the same
pass; the stale plan was replaced with one for `C-04`. Recorded because a status document that
lags the repository is the same defect class the product exists to prevent.

**2026-08-31 — `C-03` `kernel-geom` (second slice of P1-014)**

| Check | Command | Result |
|---|---|---|
| `kernel-geom` unit + agreement tests | `pnpm test` | **PASS.** 23 new tests: face validation (empty/inverted span, non-integer µm, missing id), clearance semantics (opposing normal, span overlap, facing direction, nearest-of-many), and the span-bucketed `ClearanceIndex` |
| **Index agrees with the oracle** | (in `pnpm test`) | **PASS.** On a full synthetic scene (>300 irregular faces: back-to-back rows, column guards, dock jambs, closed perimeter, a no-rack zone) the index returns byte-identical clearance to `minClearanceBrute` for **every** face — 0 mismatches |
| Whole pipeline | `pnpm verify` | **PASS.** 352/352 tests (was 329); typecheck, lint, boundary self-test + scan, RLS all green |
| Kernel coverage | `pnpm coverage` | **PASS.** `kernel-geom/src` at **100%** statements / branches / functions / lines; threshold added to `vitest.config.ts` |
| Purity | `node tools/check-boundaries.mjs` | **PASS.** now 18 files across **5** pure packages; `kernel-geom` imports only `@rms/kernel-units` |

**ADR-007's implementation is honoured, not reinterpreted.** The benchmark fixed the strategy — a
brute-force sweep is 63.79 ms p95, four times a frame budget, so the span-bucketed index is required
rather than optional. `kernel-geom` ports it faithfully: faces bucketed by (axis, normal, span
bucket) at the benchmark's 120 in width, each bucket sorted by coordinate, a query walking only the
touched buckets and scanning forward from its own coordinate. Everything is integer µm, so a
clearance is exact. The brute-force method is kept in the shipped module as the correctness oracle,
and the index is asserted to agree with it across a whole scene — a faster wrong answer is not a
result. `C-04`..`C-08` (checks, BOM, display list, provenance lint, golden fixtures) remain.



| Check | Command | Result |
|---|---|---|
| `kernel-derive` unit + property tests | `pnpm test` | **PASS.** 39 new tests: bay pitch, run length (n+1-upright property for n ∈ {1,2,5,20,82}), overhang allocation (sum-exact, odd-µm-to-front), aisle clear width (order-independent, never negative), gross positions (floor counted only when it stores), position accounting (breakdown sums to lost; net + lost = gross) |
| Whole pipeline | `pnpm verify` | **PASS.** 329/329 tests (was 290); typecheck, lint, boundary self-test + scan, RLS all green |
| Kernel coverage | `pnpm coverage` | **PASS.** `kernel-derive/src` at **100%** statements / branches / functions / lines; threshold added to `vitest.config.ts` |
| Purity | `node tools/check-boundaries.mjs` | **PASS.** now 16 files across **4** pure packages; `kernel-derive` imports only `@rms/kernel-units` |

**The discipline the slice keeps.** No catalog or rule number appears in `kernel-derive`: the clear
span, upright face, overhang and face positions are all supplied by the caller from pinned data or
client input. `UNKNOWN` inputs propagate to `UNKNOWN` results rather than being laundered, and every
returned value carries a `ProvenanceNode` tree written in the words a sheet prints. The n+1-upright
rule — the off-by-one that looks correct — is asserted as a property from both ends, not just by
example. `C-03`..`C-08` (geom, checks, BOM, display list, provenance lint, golden fixtures) remain.

**2026-08-31 — review pass**

| Check | Command | Result |
|---|---|---|
| Blueprint builds from source | `python src\build.py` | **PASS.** 14 parts → 316,002 bytes |
| All 11 structural checks | (run by `build.py`) | **PASS.** strict parse · self-contained · anchors resolve · 19 sections · 7 figures · diagrams labelled · svg markers · no client identifiers · language discipline · svg geometry in bounds · link interception present |
| Version control present | `git status` | **FAIL — not a git repository.** Fixed same day, below |
| Reference trees intact | `dir` on all four | Present and untouched |

**2026-08-31 — Phase 0 build (`A-01`, `A-02`, `A-03`)**

| Check | Command | Result |
|---|---|---|
| P0-002 repository | `git log --oneline` | **PASS.** 3 commits; `git status --short` clean |
| P1-001 install | `pnpm install` | **PASS.** 193 packages; only `esbuild` allowed a build script |
| P1-001 typecheck | `pnpm typecheck` | **PASS.** `tsc --build`, exit 0, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| P1-001 lint | `pnpm lint` | **PASS.** exit 0 |
| P1-002 tests | `pnpm test` | **PASS.** 68/68 across 3 files |
| P1-002 coverage gate | `pnpm coverage` | **PASS.** 100% statements / branches / functions / lines on `kernel-units`; threshold enforced |
| P1-003 checker self-test | `node tools/selftest-boundaries.mjs` | **PASS.** all 10 violation types caught |
| P1-003 boundary check | `node tools/check-boundaries.mjs` | **PASS.** 9 files across 1 pure package |
| Whole pipeline | `pnpm verify` | **PASS.** exit 0 |

**Two defects the gates caught during this build, recorded because a gate that never fires is
unproven:**

1. `convert()` multiplied by the source scale as well as dividing by the target scale, so the
   identity conversion of a per-pair capacity returned 5,400,000 instead of 5,400. Caught by the
   `lb/pr` identity test. Fixed.
2. A test asserted the blueprint's "18 of 21 spans" figure against a span list that was
   reconstructed rather than read from the published catalog. That is the exact failure mode the
   product exists to prevent, so the borrowed count was removed and the test now asserts only the
   property that does not depend on the real list. The exact count becomes assertable at `B-02`,
   when the real catalog arrives. Recorded in the test's own comment.

Not verified: `verify-visual.py` (needs Playwright, not installed) — `P0-003` remains open. CI has
never run on a real runner; the workflow is written but unexercised.

**2026-08-31 — Phase 0 continued (`C-01`, `A-04`, `A-05`, `A-06`)**

| Check | Command | Result |
|---|---|---|
| C-01 hash stability | `pnpm test` | **PASS.** Written before the hashing code; 38 canonical + 17 SHA-256 + 26 revision tests |
| C-01 SHA-256 vectors | (in `pnpm test`) | **PASS** against FIPS 180-4 `abc`, the two multi-block examples, the million-`a` case, five padding boundaries, and independently pinned UTF-8 digests |
| A-04 migrations | `pnpm migrate` | **PASS.** `0001_init.sql`, `0002_rls.sql` applied to Postgres 16 |
| A-06 RLS assertion | `pnpm check:rls` | **PASS.** 16 tables, all RLS enabled + forced with a policy per operation; `app_user` has no SUPERUSER or BYPASSRLS |
| A-04/A-05 tenancy | `pnpm test` | **PASS.** 27 tests against **real Postgres**, not a mock |
| Whole pipeline | `pnpm verify` | **PASS.** 176/176 tests; typecheck, lint, boundaries, self-test, RLS all green |
| Kernel coverage | `pnpm coverage` | **PASS.** 100% statements / branches / functions / lines on `kernel-units` **and** `kernel-model` |

**The gates were proven to fire, not merely observed passing.** RLS was disabled on one table in the
throwaway container: 5 tenancy tests went red and `check-rls` named `app.project` by name. Both were
restored and re-verified immediately.

**Three defects the gates caught during this build:**

1. **SHA-256 padding was wrong at the 55-byte boundary**, where the message plus its marker byte
   plus the 8 length bytes fits a block exactly. The formula appended a whole extra block and
   produced a confidently wrong digest. Caught only because the test vectors included the boundary
   lengths rather than just `abc`. This is the single strongest argument for writing the
   hash-stability test first: every hash stored by the system would have been wrong and nothing
   downstream would have noticed.
2. **The tenancy suite silently skipped all 27 tests.** The `available` flag was set in `beforeAll`,
   but Vitest evaluates `it` vs `it.skip` at collection time, so the flag was always false when the
   suite was built. It reported a green run while testing nothing — the worst possible failure mode
   for exactly these tests. Now probed at module load with top-level await.
3. **`convert()` double-counted scale** (recorded in the previous session).

Still not verified: `verify-visual.py` (`P0-003`), and CI on a real runner.

**2026-08-31 — Group A complete (`A-08`, `A-09`, `A-10`)**

| Check | Command | Result |
|---|---|---|
| A-08 authorize + route coverage | `pnpm test` | **PASS.** 23 tests: org and actor_type scoping, 404-not-403, `SERVICE_ENGINE` denied all (I-4), boot-time coverage assertion (AC-06) |
| A-09 DTO leakage | `pnpm test` | **PASS.** 13 tests: forbidden-field constant matches §9.2, recursive walk at every depth, DTOs built field by field (AC-02) |
| A-10 audit chain | `pnpm test` | **PASS.** 12 tests against real Postgres; chain verifies from genesis and **tamper detection proven** by corrupting a row (AC-15) |
| Whole pipeline | `pnpm verify` | **PASS.** 248/248 tests; lint, boundaries, self-test, RLS all green |

**A defect the gate caught:** `appendAuditEvent` first used `SELECT ... FOR UPDATE` to lock the
chain head, but that requires UPDATE privilege, which the append-only application role deliberately
lacks — `permission denied for table audit_event`. Replaced with a transaction-scoped advisory lock,
which needs no table privilege and still serializes appends so two writers cannot fork the chain.

**2026-08-31 — Group A complete + Group B started (`A-11`, `B-01`/`B-02`/`B-04`/`B-06`)**

| Check | Command | Result |
|---|---|---|
| A-11 outbox | `pnpm test` | **PASS.** 8 tests against real Postgres; a rolled-back transaction dispatches nothing, claim is exactly-once via `FOR UPDATE SKIP LOCKED`, retry backs off, exhausted attempts dead-letter |
| B-02 catalog extract | `python tools/extract-catalog.py` | **PASS.** 378 rows, 16 families, 21 spans, 7 anomalies, all verbatim; parsed via `ast`, source never executed |
| B-06 lookup | `pnpm test` | **PASS.** 29 tests against **real published data**: on-grid capacities, `AC-08` off-grid brackets, no nearest-match, per-pair basis; `AC-18` approval gate |
| **18-of-21 span claim** | `pnpm test` | **PROVEN** against the actual span grid: exactly 18 of the 21 published spans miss their key under integer mm; all 21 preserved under µm |
| Whole pipeline | `pnpm verify` | **PASS.** 290/290 tests; 100% coverage on all three kernel packages; lint, boundaries, self-test, RLS all green |

**`OD-06` veto window closed.** The blueprint's headline claim — that integer millimetres cannot
represent the published lookup grid — is now proven against the real extracted catalog rather than a
reconstruction. Micrometres stand; the one-file re-base window is closed and the base is correct.

**Group A is complete** — `A-01` through `A-11`, plus `C-01`. Group B has begun with the catalog
migration and the no-interpolation lookup. The next real work is the derivation kernel
(`C-02`..`C-08`): geometry and counts, the twelve checks, the BOM, and the golden fixtures.

Still not verified: `verify-visual.py` (`P0-003`), and CI on a real runner.

**2026-08-31 — earlier the same day (`A-07`)**

| Check | Command | Result |
|---|---|---|
| Fresh-database migrate | `pnpm migrate` from an empty schema | **PASS.** `0001`, `0002`, `0003` applied clean; 18 tables |
| A-07 crypto | `pnpm test` | **PASS.** 13 tests: token entropy, SHA-256, scrypt round-trip, malformed-hash safety, constant-time compare |
| A-07 sessions + invitations | `pnpm test` | **PASS.** 11 tests against real Postgres, incl. `AC-01` and `AC-17` |
| Whole pipeline | `pnpm verify` | **PASS.** 200/200 tests; lint, boundaries, self-test, RLS all green |

**A defect the gate caught during this build:** migration `0003` created the `session` and
`credential` tables but the `GRANT ... ON ALL TABLES` in `0002` only covers tables that existed when
it ran. The application role got `permission denied for table session` — caught by the first session
test, fixed by an explicit grant in `0003`, and proven by resetting the schema and re-migrating from
scratch.

**A second-order issue the run surfaced:** the two integration suites share one Postgres and each
truncates the tables it seeds, so running test files in parallel let one wipe the other's fixture
mid-run. Fixed with `fileParallelism: false`; the pure suites are fast enough that serial files cost
nothing noticeable.

Still not verified: `verify-visual.py` (`P0-003`), and CI on a real runner.




## 5. Canonical flow — is it confirmed?

The brief's flow is **confirmed and fully specified in the blueprint**, with two clarifications
the blueprint adds that the brief's one-line version omits:

```
Project → Draft Revision → Rack Configuration → Version-pinned Catalog + Rule Pack
        → Validation → BOM → Client Preview → Quote Submission → Internal Review
```

- The pins are **two independent artifacts on two clocks** (§10.1): a catalog release and a rule
  pack release, pinned separately, both inside the hashed revision content.
- **BOM comes after submission, not before the client preview.** The client never sees a BOM at
  all (§9.2). The internal takeoff is derived at submit time and lives in a physically separate
  table. The brief's ordering reads as if BOM feeds the client preview; it does not, deliberately.
- Internal review forks into a **separate `C` revision lineage** that cannot write back (§13.5).

## 6. Capability audit against the brief's checklist

| Capability | State | Evidence |
|---|---|---|
| **Fixed-point units with mandatory provenance** | **CONFIRMED IMPLEMENTED** | `packages/kernel-units`, 68 tests, 100% coverage. µm/millipound bases, `BASIS_BOUND`, allocate-never-divide, fail-closed walkers, `VERIFY` display rule |
| **Kernel purity enforcement** | **CONFIRMED IMPLEMENTED** | `tools/check-boundaries.mjs` + self-test proving all 10 violation types are caught |
| **Canonical serialisation and content hashing** | **CONFIRMED IMPLEMENTED** | `packages/kernel-model/canonical.ts` + `sha256.ts`. Hash-stability test written first; 55 tests |
| **Draft vs frozen revisions** | **CONFIRMED IMPLEMENTED at both layers** | `kernel-model/revision.ts` (refusals list every reason, deep freeze) **and** database triggers refusing content change or deletion |
| **Tenant isolation** | **CONFIRMED IMPLEMENTED** | 16 tables with RLS enabled + forced, `withTenant()` transaction-local context, 27 tests against real Postgres, proven to fail when RLS is removed |
| Canonical rack/configuration data model | **PARTIAL** — schema exists, the entity graph does not | `0001_init.sql` has the tables; the typed option/run/bay/level graph is `C-02` |
| Version-pinned catalogs and rule sources | **PARTIAL** — schema and approval gate exist, data not migrated | `catalog_release` with a CHECK enforcing approver ≠ digitiser and a recorded verification path. Data migration is `B-02` |
| Validation findings with source traceability | **PARTIAL** — tables exist, checks do not | `finding` + `finding_internal_detail` split; the 12 checks are `C-04` |
| BOM generation tied to selected revision | **PARTIAL** — schema enforces the hard parts | `bom_line` with `part_revision_id XOR uncatalogued_part_id` and `qty XOR unresolved_reason`. Derivation is `C-05` |
| Audit history | **PARTIAL** — table and append-only enforcement exist | `audit_event` with a trigger refusing UPDATE/DELETE, revoked privileges, and no RLS policy for either. Hash chaining is `A-10` |
| Floor-plan and elevation outputs | **PLANNED ONLY** | `FR-CP-08/09`, display-list + 3 renderers (§6.2) |
| Client options and quote-request submission | **PLANNED ONLY** | `FR-QS-01..06`, §13.1 submit transaction |
| Internal review / quote workflow | **PLANNED ONLY** (MVP-1 partial; quoting is Phase 3) | `FR-IR-01..07`, §3.4 status lifecycle |
| PE disclaimer + external-review workflow | **PLANNED ONLY — text written and version-controlled by design** | §9.3 standing disclaimer, `OD-16` (never a seal, name or licence number) |
| Testing | **CONFIRMED IMPLEMENTED for the kernel and the database layer** | 176 tests, 100% kernel coverage, real-Postgres tenancy suite |
| Build verification | **CONFIRMED IMPLEMENTED.** `pnpm verify` for the product; `src/verify.py` for the docs | Both run this pass, all green |
| Deployment readiness | **PLANNED ONLY** | `OD-01` settled: single-region managed Postgres + Object Lock storage |

Acceptance criteria now partly or fully evidenced: **`AC-04`** (cross-tenant reads empty, writes
refused), **`AC-05`** (every table RLS-enabled, forced, with policies — asserted in CI), **`AC-07`**
(unestablished values never render as numerals, at the formatter), **`AC-10`** (refusals list every
reason), **`AC-11`** (frozen revisions immutable at the database layer), **`AC-13`** (a BOM line is
a quantity or a reason, never both or neither), **`AC-18`** (the catalog approval gate). Each is
evidenced at the layer built so far, not end to end — the routes and applications they ultimately
describe do not exist yet.

## 7. Reusable assets in the four read-only reference projects

Inspected read-only; nothing edited, moved or executed. Full classification in `reuse-register.md`.
The highest-value items, confirmed present on disk this pass:

| Asset | Location | Why it matters |
|---|---|---|
| Interlake beam capacity set — 378 rows, 21 spans, full provenance | `rack-engine\catalog\interlake-2026-08\` | Cross-checked 357/357 by a named person. The most expensive asset in all four trees |
| Frame capacity tables — 3 tables, 435/435 cells reconciled | `rack-app\frame_capacity_published_2025\` | Best-provenanced data anywhere; the model for future ingestion |
| `packages/units` — fixed-point, provenance walkers, 100% branch | `rack-studio\packages\units\` | Port mechanics, re-base `mil` → µm |
| `packages/model/revision.ts` — canonical hashing, lifecycle, deep freeze | `rack-studio\packages\model\` | Refusals list every reason; a refusal is itself an audit event |
| `e2e/mvp.walkthrough.test.ts` — 402 lines, 9 cases, 66 assertions | `rack-studio\e2e\` | The whole flow as an asserted transcript |
| Golden fixtures + `build-reference.mjs` | `rack-studio\fixtures\` | 11 expected values with tolerances — **nothing consumes them today** |
| `model/quantity.py` `BASIS_BOUND`, `checks/*` refusal ordering | `rack-engine\rack_core\` | Basis before number; per-pair capacity refuses conversion |
| `CLAUDE.md` — 12 rules, priority order, status vocabulary | `rack-engine\CLAUDE.md` | Carry verbatim as product policy |

**Do not port:** all of `rack-takeoff`'s rates and `BEAM_CAP` (the file's own banner says they are
not manufacturer data); the seven `QUARANTINED` tables in `rack-app` (one overstates capacity by up
to 72%); `runpy.run_path` catalog loading; the DOM-as-model architecture.

## 8. Known-wrong, contested or unverified — carried forward, not settled

From `HANDOFF.md` §6, and all still open:

1. ~~**Carson fixture headline is contested.**~~ **Resolved 2026-08-31 by owner decision.** The two
   quotes are reference material, not acceptance sources, and are disregarded. As-built drawing
   0005-01 R-1 governs: 916 bays / 6,980 gross / 156 lost / **6,824 net** — the only one of the
   three artifacts whose own breakdown reconciles. `P0-004` closed; the `C-08` fixture will assert
   the breakdown as well as the headline.
2. **59E beam face height: parked 2026-08-31, not settled.** 5.92″ on the 42 catalog rows, 5.928″
   in a docs table, source chart read by EL as **5.93″** — corroborating 5.928 over 5.92. No page
   reference yet, so no figure is promoted; the rows stay at 5.92 as published and all three
   readings sit on the manifest. **Not blocking:** face height is not a lookup key (the key is
   `family + series + span`), so no capacity result depends on it. The original `P0-005` framing
   claimed otherwise and was wrong; see `TODO.md` for the correction.
3. **Seven quarantined capacity tables** in `rack-app` are proven wrong. Do not port.
4. **Every rate in `rack-takeoff` is uncited**, by its own admission.
5. **Performance figures came from software rasterization in a cloud container.** A floor, not a
   measurement. Re-run on target hardware.
6. **Six source conflicts stay open** (§10.8): MH16.1 edition, the NFPA section for the 18-inch
   rule, aisle measurement convention, max row length, dock setback, dead-load basis. None block
   MVP-1 because MVP-1 makes no compliance claim.

## 9. Structural gaps

Found in the review pass. Resolved items keep their entry so the record shows what was fixed.

- ~~**No version control.**~~ **Resolved.** git initialised, 3 commits, LF normalised via
  `.gitattributes` so the byte-identical rebuild guarantee survives a Windows checkout.
- ~~**No repository scaffold.**~~ **Resolved.** `A-01` landed: workspace, strict TypeScript,
  vitest, eslint, CI.
- ~~**Folder name mismatch.**~~ **Resolved.** `READFIRST.md` removed; one canonical path.
- **`verify-visual.py` has never been run** — `P0-003`, still open.
- **CI has never run on a real runner.** The workflow is written but unexercised; it will first be
  proven when this repository gets a remote.
- **The golden fixtures in `rack-studio` are still unconsumed**, exactly as the reuse register
  warns. `P1-014` requires them wired into the test run so the defect is not inherited.
- **The 18-of-21 span figure cannot yet be asserted** because the real published span list is not
  in this repository. It becomes assertable at `B-02`. Recorded in the test.

## 10. Honest assessment

The planning is unusually strong, and the foundation now matches it. The kernel is pure, fully
covered, and its purity is enforced by a checker that has been proven to fire. The two structural
decisions the blueprint singles out — BOM lines referencing a part *revision*, and fully
deterministic derivation — are respected from the first file: the eslint config bans `Date.now()`
and `Math.random()`, and the boundary checker independently bans clock, filesystem, network and
environment access inside the kernel.

Two things are worth stating plainly.

**What is built is narrow.** `kernel-units` is one package of the eight in the blueprint's kernel,
and everything with tenancy, authorization or persistence in it — the layers that carry the actual
commercial risk — is untouched. The 100% coverage figure means the units package is thoroughly
tested; it does not mean the product is 100% anything.

**The gates earn their keep.** Two real defects surfaced during this build, one an arithmetic bug in
`convert()` and one a borrowed number asserted against invented data. The second is the more
interesting: it is precisely the failure the product exists to prevent, and it appeared in the first
hour of writing code by someone who had just read the document forbidding it. That is the argument
for keeping the checks mechanical rather than relying on discipline.

