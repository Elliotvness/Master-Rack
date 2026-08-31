# Reference-Project Inventory

Read-only inspection of the four prior projects, 2026-08-31, for the Rack Master Studio blueprint (Rev A).

**Change-control:** every project below was read only. Nothing was edited, deleted, moved, renamed or written to. No script in any tree was executed. Counts in this document were derived by reading the trees, not by trusting the projects' own documentation — where a project's docs disagree with its code, that is noted.

Root: `C:\Rack Master\Resourse (do not delete or overwrite files)\`

---

## Summary

| Project | Language | Size | Tests | Auth / tenancy / persistence | Top-line assessment |
|---|---|---|---|---|---|
| `rack-engine` | Python ≥3.13 | 6,583 LOC / 33 files; core 1,559 LOC | 179 | **None of it, at all** | A small, unusually disciplined, single-tenant, in-memory engineering calculator with an exceptional provenance story. |
| `rack-app` | Python ≥3.11 | 16,289 LOC (core 9,273 / app 2,319 / tests 4,499) | 367 functions, 456 pass / 8 skip | **None**, by dated decision (`DECISIONS.md` C4) | A genuinely well-built headless engine with a single-tenant internal editor. The deepest of the four. |
| `rack-studio` | TypeScript | 145 files; ~5,250 LOC TS, ~2,150 LOC tooling, ~7,400 lines Markdown | 96 cases / 226 assertions | **None** — one code comment referencing an open ADR is the only hit | Heavily documented, lightly implemented. Five of eleven declared packages contain zero source files and three more have zero tests. Its own audit says so. |
| `rack-takeoff` | Vanilla ES5 in HTML | 7 files, 4,839 lines, 282 KB | 400 + 878 assertions in two Node/jsdom harnesses | **None. No storage of any kind** — state dies on reload | Three generations of a single-file takeoff and budgetary estimator. Sound structure, unsourced numbers. |

**The common finding:** all four are internal, single-tenant, single-user tools. There is no authentication, authorization, user, organization, role, session, tenancy or client-visible-vs-internal separation anywhere in any of them. Every one of those layers is greenfield for Rack Master Studio.

**The second common finding:** three of the four contain two implementations of the same domain. That is the specific defect the new architecture is designed to make impossible.

---

## 1. `rack-engine`

Python ≥3.13 (3.12 is a hard syntax floor), pydantic + pint + NiceGUI. 33 Python files, 2 HTML, 4 Markdown, 17 QA screenshots, 3 commits.

### Governing documents

- **`CLAUDE.md` (15.4 KB)** — the durable rules file, and the most valuable single document in any of the four projects.
  - Governing principle: *"Never guess. Preserve provenance. Surface uncertainty. For an engineering system an explicit `UNKNOWN`, `off_grid`, `PENDING_CHECK` or `BLOCKED` is substantially better than a plausible but unsupported number."*
  - A priority order for when rules conflict: engineering correctness > traceability > published-data integrity > deterministic calculation > auditability > conservative behaviour when data is unavailable > practical workflow > clean architecture. Explicitly: *"Aesthetics, convenience, demo pressure and completion speed rank below all eight."*
  - Twelve non-negotiable engineering rules, including: never interpolate a published capacity table; used or generic material gets no capacity, ever; provenance on every result; catalog status gates artifacts and promotion needs a second person; picking levels are not pallet positions; layout revisions are content-hashed and append-only; dead load is member-specific; frame capacity is BLOCKED and the uncertainty must stay visible; do not harden unresolved BOM observations into rules; no FEA or Direct Strength Method in any phase; values carry their unit; a bay type is a configuration and a bay is a thing in a building.
  - A mandated status vocabulary: `IMPLEMENTED · TESTED · VERIFIED · PENDING CHECK · BLOCKED · MOCKUP ONLY · SPECIFIED — NOT IMPLEMENTED`, with *"never say 'production ready' while known engineering, data or model gaps remain."*
  - A scope fence excluding FEA, seismic from first principles, 3D geometry, more than one manufacturer, anything but selective pallet rack, an AutoCAD plugin, **and multi-tenancy, roles and SSO**. The last three are deliberately reversed by Rack Master Studio; the rest stand.
- **`PHASE-2.md` (21.9 KB)** — forward spec. §2.4 (revisions and persistence) is the most directly relevant section in any project: `LayoutRevision(hash, parent_hash, version, author, created_at, note, catalog_rev, project)`, SHA-256 over content only with lineage and timestamps excluded, canonical serialisation, append-only store, and the advice to *write the hash-stability test first*. §2.6 fixes pure emitter signatures and an artifact cache key of `sha256(revision_hash + catalog_rev + engine_version)` — including the engine version deliberately, so a bug fix invalidates every cached artifact and reveals which issued drawings were affected.
- **`HANDOFF.md` (36.4 KB)** — state and a defect register of ten fixed defects with root causes. Historical.

### Code

| Module | LOC | Notes |
|---|---:|---|
| `model/quantity.py` | 193 | The best single file in any of the four trees. `Quantity{value, unit}` as plain JSON types (so content hashing hashes content, not a wrapped object). Eight industry unit symbols mapped to pint. `BASIS_BOUND = {"lb/pr"}` — a per-pair capacity refuses conversion to `lb`, because in pint that is a silent no-op that turns a per-pair capacity into a per-beam one. Addition of two *different but compatible* units raises rather than converting. |
| `model/catalog.py` | 205 | `GridHit{status, value, axis, requested, nearest_lower, nearest_upper, page_ref, catalog_rev}`. `lookup()` takes a `Quantity` so a caller cannot hand it feet and get an answer in inches. Off-grid returns both brackets and **no value**. `beam_part()` builds a part only from a published row, so a caller cannot construct a part the manufacturer never listed. |
| `model/layout.py` | 552 | `Placement / Level / BayType / Bay / BayRun / Zone / Project`, all frozen. Seven construction-time validators. `BayType` is the *configuration* (one calc page each); `Bay` is a thing in a building with an optional plan position — `None` is a real answer. Derived: `pallets_per_bay`, `hbl`, `gross_pallets`, `lost_at_columns`, `total_pallet_positions`, `total_picking_levels`. |
| `model/loadcase.py` | 76 | `NOT_RUN` is a tuple of three *named* cases (stability BLOCKED, seismic and preliminary NOT IMPLEMENTED) that exist so a package can show them as not run rather than leave a reader to assume they passed. |
| `checks/result.py` | 79 | Six-status vocabulary; provenance block mandatory on every result; a 0.90 warning band that is presentation only and never changes a verdict. |
| `checks/beam.py` | 130 | Refusal order matters and is explicit: unresolvable id → data error; not catalogued → no published capacity; **basis before number** (a point load against a UDL chart returns `outside_table_basis` before any number is looked at); then on-grid, then off-grid. `lookup_key()` was extracted specifically so the check and the trace share one expression — *"a provenance trace that disagrees with its own check is worse than no trace."* |
| `checks/affected.py` | 108 | One-hop, deliberately non-transitive propagation. *"Making it transitive would invalidate a whole run for one edit, which is how a staleness view becomes noise nobody reads."* |
| `emit/bom.py` | 112 | `BomRow(group, description, qty, rule, confirmed)` — every quantity carries the rule that produced it and whether that rule is confirmed. Six accessory rows ship with `qty=None, confirmed=False` and their unresolved rule text. |
| `emit/tabulation.py` | 32 | Totals counted from the bays that exist, never read off a field. |
| `rack_app/*` | 2,142 | NiceGUI 3.16 + Pyodide 314, hand-written HTML string concatenation. A three-layer boundary enforced by tests. The `_trace()` panel (~150 LOC) is the product's centrepiece: five sections ending in the table's own basis quoted verbatim, with a branch that shows *no table basis at all* for used material, because no table was read. |

### Catalog

`catalog/interlake-2026-08/cap_beams_published.py`, 488 lines / 74.8 KB. **378 rows exactly**, 18 (family, series) pairs × 21 spans; collapsing 9 finish variants gives **189 unique capacity points and 189 published parts**. Twenty-one spans from 48" to 168" — 110" is deliberately absent and is the off-grid demo case. Module-level provenance: `STATUS`, `CATALOG_REV`, `SOURCE_URL`, `PAGE_REF`, `DIGITISED_BY`, `DIGITISED_AT`, **`CHECKED_BY = ""`** (with the comment that it *must* be a person and not the digitiser), `UNITS`, `LOAD_BASIS` verbatim, `DEFLECTION_LIMIT`, `CODE_BASIS`, `CONSTRAINTS` (published footnotes as data, reported and never enforced), and `SOURCE_ANOMALIES` — seven manufacturer errors transcribed as published rather than silently corrected.

Loaded with `runpy.run_path`, i.e. a Python module executed as data. Defensible for one vendored file in an internal tool; unacceptable in a client-facing application.

### Tests — 179, and they are a written specification of the product's refusals

`test_validation.py` (4) pins the acceptance case. `test_provenance.py` (12) pins rule 3 end to end, including *"a refusal in the engine that leaks a number into the UI is not a refusal"* and *"the trace quotes the table's own basis, not the example manifest"*. `test_quantity.py` (11) pins the unit contract including JSON-serialisability for hashing. `test_placement.py` (11) pins `outside_table_basis` as distinct from every other refusal. `test_layout_structure.py` (14) pins 6,824 positions through the full Zone→Run→Bay hierarchy. `test_catalog_parts.py` (10) pins "no nearest match". `test_architecture.py` (15) is an AST scan asserting no core file imports a framework or a database driver.

### Verified constants safe to quote

6,824 net pallet positions on drawing 0005-01 R-1 (916 bays, 6,980 gross, 156 lost, 324 picking levels); 8,030 lb for 59E/F5M at 108" per pair; 6,125 lb for 50E/F4M at 108"; 4 anchors per upright frame (3,812 / 953 = 4.000 exactly); 21 published spans for 59E/F5M with 110" absent.

### What does not exist

No user, organization, role, session, tenant, authentication, authorization, persistence, revision store, content hash, audit trail, submission or immutability. `content_hash` appears only in four docstrings explaining *why* other design choices were made. `ui.run(host="0.0.0.0")` with no auth layer; access is at the network layer by ADR.

### Open and unresolved

`ADR-003` (interpolation) is marked *Provisional — OPEN* and its own note says *"this blocks first real use"*. 59E face height is 5.92" in the catalog data (all 42 rows) and 5.928" in a docs table — a single unresolved disagreement that needs a person to read the source chart. Frame capacity is BLOCKED because three sources at three revisions disagree. Carson bay B's picking-level elevations and the run structure are labelled DEMO VALUES in long inline comments.

**Zero `TODO`, `FIXME`, `XXX` or `HACK` markers in the entire tree.** Unfinished work is expressed through the status vocabulary and on-screen panels instead. That convention is worth preserving.

---

## 2. `rack-app`

Python ≥3.11, dataclasses + openpyxl + ezdxf + jinja2, NiceGUI as an optional extra. 48 commits, clean tree. Despite the folder name, `pyproject.toml` declares `name = "rack-engine"`.

### The data — the most valuable asset in any of the four projects

| Table | Status | Checked by |
|---|---|---|
| `cap_beams_published.py` (525 LOC, **378 rows**) | **VERIFIED** | a named person, 357/357 cross-check |
| `cap_bolted_frames_published.py` | **VERIFIED** | a named person |
| `cap_welded_frames_published.py` | **VERIFIED** | a named person |
| `cap_bolted_reinforced_frames_published.py` | **VERIFIED** | a named person |
| 7 further capacity tables | **QUARANTINED** | — |
| 3 template files | **TEMPLATE** | — |

`frame_capacity_published_2025/` holds three CSVs (15 HbL rows each, 36"→120" in 6" steps) plus three JSONs carrying full source blocks: document, catalog revision, page reference, digitiser, digitisation date, units, verbatim load basis, and independent-variable definitions.

**`FRAME_VERIFICATION_RESULT.md` records the finding that justifies the entire provenance discipline:** 435/435 cells reconcile across two independent extraction paths, and the quarantined table it replaced was indexed on *overall frame height* under a field labelled `height_hbl_in` — **overstating capacity by up to +36.9% at HbL 96" and +72.4% at HbL 120".** It looked entirely plausible. It was caught by reconciliation and a human signature, not by inspection.

`docs/SPOT_CHECK.md` is the companion cautionary artifact: the forensic case that an earlier digitisation was *synthesised, not transcribed* — wrong beam families, wrong span grid, dead load a flat 0.800 × unit load across 204 rows, corresponding to nothing published.

`catalog-export.json` (619 KB, generated) holds **997 part rows** across 17 component arrays, 378 verified beam capacities, 288 withheld ones, 90 published frame capacities and 156 withheld synthetic ones — the presentation gate is visible in the data itself.

### Code

- **`rack_core/model/`** — `quantity.py` (271, a closed hand-audited unit registry, deliberately not pint: *"a hand-audited table is more defensible for a stamped calc"*), `layout.py` (573, with omit-when-unset serialisation so pre-existing hashes stay byte-identical), **`revision.py` (189)** — `content_hash` = SHA-256 of canonical JSON of `{catalog_rev, payload}` only, with `NON_CONTENT_FIELDS` held *as data so a test can assert it*, and `from_dict` raising on hash mismatch, i.e. tamper detection; `edit.py` (565) — a pure 13-operation delta engine with `DELTA_VERSION`, structural-op classification, and `apply_delta` returning a new frozen project or nothing at all.
- **`rack_core/checks/`** — mandatory provenance on every result; exact-span beam lookup that never interpolates and returns brackets off-grid; point loads returning `not_applicable` rather than an unconservative pass; `governing_hbl` computed as the maximum gap including the floor; a validity rule set with seven checks.
- **`rack_core/emit/`** — `bom.py` (255, frames = `bay_count + 1` per contiguous SKU group, beams = 2 per level, and an explicit refusal to invent accessories because *"inventing them here would be unprovenanced"*), `calc.py` (380, with a verbatim scope disclaimer, `OK`/`NG` verdicts and a `CODE_BASIS` constant), `dxf.py` (209, with every dimension funnelled through one helper that always calls `.render()`, structurally preventing the classic invisible-dimension bug).
- **`rack_app/`** — 2,319 LOC of NiceGUI + server-side Konva. `service.py` (542) is a framework-free facade and is the reusable part; `web.py` (309) holds a module-level singleton service on one SQLite file with path-only routes, and is not retrofittable to multi-tenancy.
- **`validate_engineering.py` (552)** — a build-time data gate that exits non-zero. Exactly the right shape for a product that serves capacity numbers.

### Persistence

`rack_app.db` — five append-only SQLite tables: `revision` (hash PK, parent, version, author, created_at, note, catalog_rev, payload), `artifact`, `acceptance`, `issued`, `head_log`. **There is no `UPDATE` statement anywhere in `repo.py`.** Identical content collapses to one row by content hash. `head_log` is an append-only record of the states a project passed *through*, added because "highest version" broke when undo-by-re-editing produced a hash that already existed — subtle and correct.

The `issued` table plus a `staleness()` function is the closest existing thing to a client-visible submission: it records the deliberate act of sending a document to a named recipient and answers currency by hash comparison, naming *which bays changed*.

### Tests — 367 functions, 456 pass / 8 skip

`test_architecture.py` is the load-bearing one: parametrised over every core file, asserting none imports NiceGUI, FastAPI, Starlette, uvicorn, Flask, Django, Streamlit, SQLAlchemy, sqlite3 or psycopg — plus a guard against vacuous globbing, plus a two-sided assertion that sqlite3 *does* appear in the app layer.

`tests/test_perf_edit.py` on a 200-bay fixture: `apply_delta` 0.02 ms, incremental recheck 0.56 ms against a full recheck of 38.19 ms (68×), warm drop-to-paint 15.60 ms average against a 150 ms budget.

`validation/REGISTER.md` — 10 machine-run validation cases ranked by source kind: 3 `pe_stamped`, 7 `published_chart`, and **0 `hand_calc`**, which the register itself calls its most important gap. The three PE-stamped cases document a real +2.4–2.5% offset between the PE's numbers and the published chart, attributed to the PE applying their own reduction — *a plausible reading, not a confirmed one*.

### Decisions on record

`docs/DECISIONS.md`, dated and signed 2026-08-22. Decision **C4**: *"keep INTERNAL for now (single-tenant); multi-catalog/tenancy deferred (revisit if the sell-to-integrators path is chosen)"*, marked **"Provisional default — Elliott to confirm"**. That is the single decision Rack Master Studio reverses, and it was explicitly left open for exactly this.

### Documents worth reading before scoping

- `docs/CANVAS_PROTOCOL.md` (19.6 KB) — the 13-op versioned delta protocol with optimistic `base` (`stale_base` is rejected, never merged) and a staleness/propagation model. §1's single-tenant assumptions must be inverted; §3 and §5 transfer directly.
- `docs/CALC_PACKAGE.md` — reverse-engineered anatomy of a real stamped calc set, with the verbatim scope disclaimer and the observation that **the unit of the package is the configuration, not the bay**. Cross-validates the beam table against the PE's numbers at +0.39%, −2.44% and −2.51%.
- `docs/OUTPUT_FORMAT.md` §9 (the BOM *is* a quote, 23 lines including permitting) and **§10** — an explicit unanswered scoping question: *what share of your jobs are used or generic material with no published capacity?* That question is unanswered and could reshape the roadmap.
- `rack-review.html` (72.7 KB) — a red-team review of the strategy whose central warning is directly about this product: **the fast-follower risk is CPQ, not another rack startup.**

### Open

Gate G3 (does a day-long revision take minutes on a real job) is **unrun** — `docs/G3_RESULT.md` does not exist. CP-3 is waived, not met: no drafter has called the DXF usable and no PE has said they would sign the calc package. Zero hand-calc validation cases. `lost_positions` — the drawing's headline number — is absent from this project entirely.

---

## 3. `rack-studio`

TypeScript 7 strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), pnpm workspace, Vitest, Vite. **~5,250 LOC TypeScript against ~7,400 lines of Markdown** — heavily documented, lightly implemented, and its own audit says so. Five of the eleven declared packages contain no source at all; three more contain source but no tests.

### Packages — 11 declared, 6 implemented, 5 empty

| Package | src LOC | tests | State |
|---|---:|---:|---|
| `units` | 450 | 45 cases | Complete, 100% branch coverage enforced in CI |
| `model` | 941 | 33 cases | Complete for the vertical slice |
| `catalog` | 446 | **0** | Types complete; the only data is a labelled demo file |
| `derive` | 280 | 9 cases | Sound arithmetic, one-dimensional only |
| `checks` | 495 | **0** | 14 finding codes; roughly 4–6 of the 13 specified checks |
| `bom` | 158 | **0** | Three line categories plus an unresolved register |
| `geom`, `scene`, `render-canvas`, `sheets`, `remediate` | **0** | 0 | README + package.json + `.gitkeep` only |

**`packages/model/revision.ts` (444 LOC) is the single most valuable file for Rack Master Studio.** Deterministic canonical JSON (sorted keys, `undefined` dropped, a depth-64 bound that fails **loudly** because a truncating hash is the one failure a hash must not have); a lifecycle state machine with an orthogonal review-required flag; `TransitionRefused` that lists *every* reason; **a refusal is itself an audit event**; `publish()` deep-freezes so mutation is a `TypeError` rather than a silent write; and exported claim strings meant to be rendered wherever the state appears.

`packages/model/actor.ts` contains the pattern worth copying most: `mayWaive()` and `mayPublish()` **throw `UndecidedAuthorityError` naming the open ADR item** rather than defaulting to permissive. That is the correct behaviour for an undecided authority question, and Rack Master Studio should keep it.

`packages/units` is a complete branded fixed-point implementation: `mil()` throws on non-integers, `div()` refuses inexact division and names `allocate()` in the error, and both provenance walkers are bounded at depth 32 and **fail closed** — fixing a real defect where they previously failed open past depth 8.

### The prototype — a complete second implementation

`prototype/kernel.js` (468 lines) plus `prototype/rack-studio.html` (1,325 lines) are an independent, untyped re-implementation of units, provenance, derivation and checks. It is **ahead** of the typed packages on rules (15 vs 0) and checks (11 vs ~5) and **behind** on types, lifecycle, BOM and persistence. Neither is a superset. The two provenance walkers even have inverted polarity. There is a third partial duplicate inside `packages` itself, knowingly documented.

The 15 rules carry `standard`, `edition`, `section`, `value`, `verification` and a source note — **4 `PRIMARY`, 11 `SECONDARY`**. The 11 checks are storage height, operational aisle, fire aisle, governing aisle, pallet fit, flue, height-to-depth ratio, high-pile trigger, permit threshold, certificate of compliance and plaque.

### Data

`data/catalog/` and `data/rules/` both contain a single README saying "Empty". **Zero catalog packs, zero rule packs.** Everything that exists as data lives in code: an invented, clearly-labelled demo catalog and the prototype's 15 rules as a module constant.

### Fixtures and tests

`fixtures/projects/reference-82-bay.expected.json` holds **11 expected derived values** each with `mil`, inches, printed and reconstructed millimetres, a **`deltaMil`**, a formula and a source citation — worst delta −3 mil against a stated 10-mil tolerance. It also carries 652/488 pallet positions *with* the qualification that the figure shall not be relied upon until two open items are closed. **Nothing in the test run consumes these fixtures** — they are produced and self-checked by a script that is not in the verify pipeline.

`e2e/mvp.walkthrough.test.ts` (402 lines, 9 cases, 66 assertions) is the whole product as an executable transcript: draft → cascade filtering → derived geometry → validation → attributed BOM → documentation-ready refused with all reasons → three audited edits → mark ready → export → publish → immutability (edit throws AND direct mutation throws AND the object is frozen) → clone → **byte-identical BOM regeneration**.

`spikes/clearance-query/bench.mjs` is the only implementation anywhere of the span-bucketed obstruction index its own ADR calls mandatory: 6,304 faces, brute force **63.79 ms p95 (fail)** against **1.34 ms p95 (pass)**, 48×, with agreement verified on all 901 sampled faces *before* speed was measured.

`spikes/canvas-throughput` measured whole-building draw at 6.80 ms p95 naive against 3.30 ms batched — under software rasterization in a cloud container, so a floor rather than a measurement.

### Research

`research/RESEARCH-us-codes.md` (524 lines): **117 `VERIFIED` tags against 32 `UNVERIFIED`**, where "verified" is honestly defined as *read on the cited source*, not *read in the primary standard*, because the standards themselves are paywalled.

### ADRs — 14, of which 11 accepted

Directly informing this blueprint: 002 (screening not design — never claims compliance, never pre-fills a stamp), 003 (one renderer-neutral display list, amended so text entries carry `{text, established}` and never a bare string), 005 (fixed-point mil), 006 (one aisle datum: clear width between load faces — and it records that the *wrong* intuitive version survived into a spec, a task list and a prototype), 007 (obstruction faces; the index made mandatory by measurement), 008 (parameter tree → entity graph with stable ids), 009 (seven-state status vocabulary), 010 (propose, never apply), 014 (revision lifecycle).

**ADR-012 (deployment) has 1 of 9 items answered and ADR-013 (identity and authorization) has 1 of 8.** The two answers — a desktop application and workstation identity — are both incompatible with a client-facing product and are reversed. The remaining fifteen questions are a good questionnaire and are answered in the blueprint.

### Documentation health

`docs/06-STATUS.md` says "product code 0 lines" and "there is no `packages/`" — false on nearly every line. Assertion counts disagree across documents (59 / 68 / 69), which is why `tools/check-claims.mjs` now derives them from the code and fails the build on drift. That tool is a genuinely good idea.

**One `TODO`-class marker in the whole codebase**, and it is a typed `@ts-expect-error` guard. All stubs are deliberate and labelled.

---

## 4. `rack-takeoff`

Seven files, 4,839 lines, 282,551 bytes. Self-contained ES5 in HTML; the only external resource anywhere is a Google Fonts stylesheet.

| File | Bytes | Lines | What |
|---|---:|---:|---|
| `rack-takeoff-editor.html` | 87,784 | 1,346 | Current build. Master–detail with a configuration chip strip, a base64 logo in the print header, a four-tile summary, and the structural print rule that actually works. |
| `rack-takeoff.html` | 73,383 | 1,279 | Middle generation. Adds a title block and a tag scheme that survives past 26 configurations. **Carries a live print bug**: its print CSS hides `.header,.layout` but the page's roots are `.tb`, `.tb-bar`, `.layout`, so the title block prints into the PDF. |
| `racking-calculator-v2.html` | 64,389 | 1,055 | Earliest generation. Narrowest reference tables; the configuration tag breaks past 26. |
| `test_all.js` | 22,339 | 452 | jsdom harness, **400 assertions**, with an independent reimplementation of every formula. |
| `audit.js` | 16,172 | 360 | Fuzz and robustness audit; ~878 assertions across 10 sections. |
| `trace.js` | 8,348 | 167 | Dead-input detector — traces 70 fields and reports which outputs each one moves. |
| `HANDOFF.md` | 10,136 | 180 | Decisions, sources, caveats and open items. |

**The math is byte-identically triplicated across all three HTML files.** `compute()` and `configCost()` differ by zero lines between the editor and the card build, and by one comment line against v2. Only three small helpers differ, and two of them **conflict**: `deckPerLevel` gives 3 in the old rule and 4 in the new one for a 192" beam, and `suggestPallets` caps at 3 in the old rule and 4 in the new. That is a correction that must be made three times and was made once.

### The quantity rules — the genuine asset

```
pairs         = rowType === "b2b" ? floor(rows/2) : 0
storageLevels = levels + (floorLoad ? 1 : 0)
frames        = (bays + 1) * rows          // back-to-back rows do NOT share frames
beams         = bays * levels * 2 * rows  - tunnel losses
positions     = bays * storageLevels * palletsPerBay * rows - lostPositions - lostByCol
spacers       = pairs * (bays + 1) * spacersPerFrame(frameH)
anchorQty     = frames * 2 * anchorsPerPlate
```

with tunnels reducing beams and decks but **never** frames, spacers or anchors — deliberate, documented, and accompanied by an *unconditional* warning that frame capacity must be re-rated at the tunnel's unbraced length. Building columns carry a four-way disposition (in flue / consumes a position / consumes a bay / straddled) with distinct position-loss formulas, plus a cross-grid alignment check.

`HANDOFF.md` records the reasoning, which exists nowhere else:

- Back-to-back rows do not share frames; the doc calls the `+1` *"where estimates go wrong"*.
- Tunnels change frame **spec**, not frame **count** — *"the thing everyone misses"*.
- Install runs off the new-material basis on purpose even for used rack: *"used rack doesn't make the crew cheaper… discounting labour alongside the steel is where margin quietly disappears."*
- A 24 ft frame needs 5.8" cross-aisle separation per side; add a 10" column and you need **21.5" of flue against a 12" standard flue** — *"'Just bury it in the flue' quietly fails RMI separation on tall rack."* **This is quoted from `HANDOFF.md` with no clause cited, from the project whose other constants are uncited. Carry it as a question for the rule pack, not as a rule.**

### What must not be carried forward

- **`BEAM_CAP` is invented.** The file's own banner says so: *"plausible ballpark figures, NOT any manufacturer's published capacities."* It is the sole input to every capacity verdict in the tool, and `HANDOFF.md` calls it *"the one blocker before real use."*
- **All twelve component rates** are uncited "SoCal 2026 ballpark" figures, never back-tested against a live vendor quote despite that being an open item in the project's own handoff.
- `DEPTH_FACTOR` and `FACE_FACTOR` multipliers, the 1.20 non-stock uplift, the 1.35 structural-steel multiplier, the 0.70 used-material factor, the 1.25 load safety factor, the 0.90/0.95 shelf multipliers, the "$0.50–0.80 positions per square foot" density band, and **`FRAME_W = 3`** hardcoded for every frame, depth and steel type — all uncited.
- Add-on prices baked into HTML `<option value>` attributes.
- A row-spacer BOM line hardcoded to a `12"` spec string **while ignoring the editable flue field** — a live defect.
- DOM-as-model architecture: project identity, building area, clear height and add-ons live only in input values. Nothing is revisionable.

### Persistence and access

**None.** No `localStorage`, no `sessionStorage`, no IndexedDB, no `fetch`, no server, no serialisation. State dies on reload. Data leaves the page only by `window.print()` or a clipboard copy of a tab-separated BOM. There is no client/internal separation of any kind — every viewer sees quantities, rates, markups, install percentage and the margin note about used material.

There is also **no canvas and no SVG anywhere** in any of the seven files, verified by search. If Rack Master Studio needs a client-visible drawing, none exists here to port.

### Test quality

`test_all.js`'s 400 assertions are real and the arithmetic checks out by hand — the default configuration computes to 44 frames, 320 beams, 320 decks, 400 positions, 66 spacers, 176 anchors and $51,351, matching the asserted values exactly. But its `ref()` function is a **transcription** of the same assumptions, not an independent derivation: it proves the UI wiring, not the engineering. `audit.js` includes a specific regression guard asserting the source does *not* contain the broken print rule — a bug fixed in the editor build and still live in the middle one.

---

## Cross-project conclusions

1. **The most valuable asset across all four projects is data, not code** — 378 verified beam capacity rows and three frame tables reconciled 435/435 across two independent extraction paths with a human signature. It took three passes to get there and one of those passes produced a table that overstated capacity by 72%.
2. **The second most valuable asset is doctrine** — the twelve rules, the status vocabulary and the priority order in `rack-engine/CLAUDE.md`. It costs nothing to adopt and it is what makes the product defensible.
3. **The third is a set of assertions** — roughly 1,000 test assertions across the four projects that encode what the system must refuse to do. Porting an implementation without its assertion is porting a claim that quietly stops being checked.
4. **Nothing in any project addresses tenancy, identity, audience separation or immutable submissions.** That layer is entirely new work.
5. **Three of the four contain two implementations of the same domain**, and in every case the two are out of sync. That is the specific failure the new architecture exists to prevent.
6. **Two questions the projects raised and never answered** — what share of jobs use used or generic material with no published capacity, and whether a PE or a drafter finds this output useful — remain open and matter more to the roadmap than any technical decision.
