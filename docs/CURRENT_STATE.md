# Current State — Rack Master Studio

**Assessed 2026-08-31 by repository inspection.** Every claim below is traceable to a file that was
read or a command that was run. Where something was not verified, it says so.

Status vocabulary used here, carried from `rack-engine/CLAUDE.md`:
`CONFIRMED IMPLEMENTED` · `IMPLEMENTED BUT UNVERIFIED` · `PLANNED ONLY` · `BLOCKED`.

---

## 1. Headline

**Phase 0 has started.** The planning package is complete and the first three foundation tasks
(`A-01` scaffold, `A-02` `kernel-units`, `A-03` boundary checker) are implemented, verified and
committed. Everything above the kernel — schema, tenancy, auth, apps — is still planning only.

| | |
|---|---|
| Blueprint revision | Rev C, 2026-08-31 |
| Decisions | 21 of 21 settled; one commercial item deliberately open (`OD-20b`) |
| Production source files | **9** (`packages/kernel-units/src`, `tools/`) |
| Product tests | **68**, all passing |
| Kernel coverage | **100%** statements, branches, functions, lines (gate enforced in CI) |
| Documentation toolchain | Working, 11 checks, all passing |
| Version control | **git, 3 commits**, working tree clean |

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
| Canonical rack/configuration data model | **PLANNED ONLY** — fully specified | §7.2 entity reference, 22 entities, Figures 4–5 |
| Draft vs published/locked revisions | **PLANNED ONLY** — specified to database level | §3.3, §13.3 six immutability layers, `FR-RV-01..05` |
| Version-pinned catalogs and rule sources | **PLANNED ONLY** — specified; source data exists in reference trees | §10, `FR-CT-01..06`. Data at `rack-engine/catalog/interlake-2026-08` and `rack-app/frame_capacity_published_2025` (read-only) |
| Validation findings with source traceability | **PLANNED ONLY** — specified, incl. the tier ceiling | §11.1–11.4, 12-check MVP set, `outcome = min(result, ceiling(tier))` |
| BOM generation tied to selected revision | **PLANNED ONLY** — specified with the one irreversible schema decision | §12.2 `part_revision_id XOR uncatalogued_part_id` |
| Floor-plan and elevation outputs | **PLANNED ONLY** | `FR-CP-08/09`, display-list + 3 renderers (§6.2) |
| Client options and quote-request submission | **PLANNED ONLY** | `FR-QS-01..06`, §13.1 submit transaction |
| Internal review / quote workflow | **PLANNED ONLY** (MVP-1 partial; quoting is Phase 3) | `FR-IR-01..07`, §3.4 status lifecycle |
| Audit history | **PLANNED ONLY** — schema, hash chain and append-only trigger specified | §13.6, `NFR-AUD-01..06` |
| PE disclaimer + external-review workflow | **PLANNED ONLY — text written and version-controlled by design** | §9.3 standing disclaimer, `OD-16` (never a seal, name or licence number) |
| Testing | **CONFIRMED IMPLEMENTED for the kernel** (68 tests, 100% coverage gate). Planned only above it | §16.1 ten test layers, `AC-01..AC-20` |
| Build verification | **CONFIRMED IMPLEMENTED.** `pnpm verify` for the product; `src/verify.py` for the docs | Both run this pass, all green |
| Deployment readiness | **PLANNED ONLY** | `OD-01` settled: single-region managed Postgres + Object Lock storage |

Of the twenty acceptance criteria, one is now partly evidenced: **`AC-07`** (an unestablished value
never renders as a numeral) is enforced and tested at the formatter level. It is not fully met until
the UI and PDF renderers exist and are covered by the same rule.

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

1. **Carson fixture headline is contested.** Drawing says 916 bays / 6,824 net; quote `Q-38857-1`
   says 916 / 7,196; `Q-38857-8` says 551 / 4,268. Three artifacts, three counts. Must be
   reconciled before 6,824 is trusted as a golden value.
2. **59E beam face height:** 5.92″ in the catalog data (42 rows) vs 5.928″ in a docs table.
   A person must read the source chart. Neither figure carries forward as settled.
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

