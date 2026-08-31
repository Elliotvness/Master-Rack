# Current State — Rack Master Studio

**Assessed 2026-08-31 by repository inspection.** Every claim below is traceable to a file that was
read or a command that was run. Where something was not verified, it says so.

Status vocabulary used here, carried from `rack-engine/CLAUDE.md`:
`CONFIRMED IMPLEMENTED` · `IMPLEMENTED BUT UNVERIFIED` · `PLANNED ONLY` · `BLOCKED`.

---

## 1. Headline

**The project is a complete planning package with zero production code.** There is no application,
no schema, no repository, no package manifest, no test suite for the product itself. What exists is
a 316 KB governing blueprint, four supporting documents, and a small Python toolchain that builds
and checks that blueprint.

This is not a defect. The blueprint states it plainly (`HANDOFF.md` §1: "No production code has been
written"). The task now is to convert a closed decision set into a first vertical slice.

| | |
|---|---|
| Blueprint revision | Rev C, 2026-08-31 |
| Decisions | 21 of 21 settled; one commercial item deliberately open (`OD-20b`) |
| Production source files | **0** |
| Product tests | **0** |
| Documentation toolchain | Working, 11 checks, all passing (verified — see §4) |
| Version control | **None.** `git status` in the active folder returns *not a repository* |

## 2. Folder reality vs the brief

`READFIRST.md` names the active writable project as `C:\Rack Master\Master Rack Studio`.
**That folder does not exist.** The actual deliverables are in `C:\Rack Master\rack-master-studio`,
and this document is written there. Resolving that naming mismatch is `P0-001` in `TODO.md`;
nothing was renamed, because a rename would break every relative reference in the existing docs
and is a decision for the owner, not for a review pass.

## 3. Inventory of the active project

```
C:\Rack Master\rack-master-studio\
├── rack-master-studio-blueprint.html   316,002 bytes · 19 sections · 7 SVG figures · GOVERNING DOC
├── README.md                           how to read the blueprint, where research landed
├── HANDOFF.md                          state, non-obvious decisions, Phase 0 order, known-wrong list
├── open-decisions.md                   21 decisions + the decision log (internal-only: names clients)
├── reference-project-inventory.md      what is in each prior project, with counts
├── reuse-register.md                   every asset classified PORT / ADAPT / REFERENCE / REJECT
├── docs\CURRENT_STATE.md               this file
├── TODO.md                             prioritised backlog
└── src\
    ├── build.py / build.cmd            concatenate parts/ -> the blueprint
    ├── verify.py                       11 structural checks (the gate)
    ├── verify-visual.py                optional Playwright checks
    ├── parts\                          14 section files, filename-ordered
    └── research\                       2 sourced research briefs with real URLs
```

Total: 6 Markdown documents, 1 built HTML artifact, 14 HTML source parts, 4 Python files,
2 research briefs. No `package.json`, no `pyproject.toml`, no migrations, no CI config.

## 4. What was actually verified in this pass

| Check | Command | Result |
|---|---|---|
| Blueprint builds from source | `python src\build.py` | **PASS.** 14 parts → 316,002 bytes |
| All 11 structural checks | (run by `build.py`) | **PASS.** strict parse · self-contained · anchors resolve · 19 sections · 7 figures · diagrams labelled · svg markers · no client identifiers · language discipline · svg geometry in bounds · link interception present |
| Version control present | `git status` | **FAIL — not a git repository** |
| Reference trees intact | `dir` on all four | Present and untouched; nothing written |

Not verified: `verify-visual.py` (needs Playwright, not installed). Unknown whether the visual
sweep passes.

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
| Testing | **PLANNED ONLY for the product.** The *documentation* toolchain has 11 working checks | §16.1 ten test layers, `AC-01..AC-20` |
| Build verification | **CONFIRMED IMPLEMENTED for the blueprint only** | `src/verify.py`, run this pass, all green |
| Deployment readiness | **PLANNED ONLY** | `OD-01` settled: single-region managed Postgres + Object Lock storage |

**Nothing in the product is "implemented but unverified", because nothing is implemented.** The
only thing in that category is `verify-visual.py`, which is written but has never been run here.

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

## 9. Structural gaps not covered by any existing document

Found in this pass, and now tracked in `TODO.md`:

- **No version control.** The blueprint's entire integrity argument rests on traceability, and the
  documents that carry it have no history. This is the cheapest and most urgent fix.
- **No repository scaffold.** `A-01` has no starting point: no `package.json`, no `tsconfig`, no CI.
- **Folder name mismatch** between `READFIRST.md` and the filesystem (§2 above).
- **`verify-visual.py` has never been run**, so one of the two documented pre-handoff gates is
  unproven.
- **The golden fixtures in `rack-studio` are still unconsumed**, exactly as the reuse register warns.
  If they are ported without being wired into a test run, the same defect is inherited.

## 10. Honest assessment

The planning is unusually strong: the decisions that are expensive to reverse have been identified,
argued and settled, and the reasoning is written down where a fresh reader will find it before
reverting it. The two structural decisions the blueprint singles out — BOM lines referencing a part
*revision*, and fully deterministic derivation — are correctly identified as the ones that cannot be
retrofitted.

The risk now is the opposite of the usual one. There is enough documentation that continuing to
refine it feels like progress. It is not. The next unit of real progress is `A-01` plus a git
repository, and every day the toolchain-quality bar set by `src/verify.py` is not applied to
actual product code is a day the plan drifts further from anything executable.
