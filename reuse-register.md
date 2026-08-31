# Reuse Register

Every notable asset from the four reference projects, classified for Rack Master Studio. Companion to `reference-project-inventory.md` (what each project *is*) and §17 of `rack-master-studio-blueprint.html`.

**Verdicts**

| | Meaning |
|---|---|
| **PORT** | Take largely as-is. Copy into the new repository, re-test there under the new boundary rules, do not rewrite. |
| **ADAPT** | The shape is right; rework for tenancy, audience, scale or language. |
| **REFERENCE** | Read for the idea, then write it fresh. Do not import. |
| **REJECT** | Carry nothing forward, including the idea. |

**Triage questions**, applied per asset rather than per project — all four projects contribute to PORT and all four contribute to REJECT:

1. Is it correct?
2. Is it sourced, by a named second person who is not the digitiser?
3. Does it survive multi-tenancy and a client audience?

---

## PORT

### Data — the most expensive asset

| Asset | From | Destination | Why |
|---|---|---|---|
| `cap_beams_published` — 378 rows, 189 unique capacity points, 21 spans, 9 base family/series pairs, every provenance field | `rack-engine`, `rack-app` | `data/catalog/interlake-<rev>/` | Verified against the published chart with a 357/357 cross-check by a named person. Port every row and every provenance field verbatim; change only the container (out of executable Python). |
| `frame_capacity_published_2025/` — 3 tables, 435/435 cells reconciled across two independent extraction paths, human-signed | `rack-app` | `data/catalog/interlake-<rev>/` | The best-provenanced asset anywhere in the four trees, and the model for how any future table is ingested. |
| `CONSTRAINTS` — published footnotes as data (bracing over 126", crossbar over 90" when decked) | `rack-engine` | catalog manifest | Reported, never enforced, until a real check with a real test exists. |
| `SOURCE_ANOMALIES` — 7 manufacturer errors transcribed as published | `rack-engine` | catalog manifest | Silently "fixing" them destroys the ability to reconcile against the source. |
| Verified constants: 6,824 net positions (916 bays / 6,980 gross / 156 lost / 324 picking levels); 4 anchors per upright frame | `rack-engine` | `fixtures/golden` | The Carson case is the only end-to-end validation against a delivered job anywhere. It must go red if the new engine gets counts wrong. **Established 2026-08-31 (EL, `P0-004`):** as-built drawing 0005-01 R-1 is the sole authority; quotes `Q-38857-1` and `Q-38857-8` are reference material and are disregarded. The fixture asserts the breakdown (gross − lost = net), not only the headline. |

### Kernel code

| Asset | LOC | From | Destination | Why |
|---|---:|---|---|---|
| `packages/units/src/*` | 450 | `rack-studio` | `kernel-units` | Branded fixed-point mil, mandatory origin, allocate-never-divide, fail-closed provenance walkers bounded at depth 32, 100% branch coverage enforced. A solved problem that should not be re-solved. |
| `packages/model/revision.ts` | 444 | `rack-studio` | `kernel-model` | Deterministic canonical JSON with a depth bound that fails **loudly**; lifecycle state machine; refusals that list every reason; **a refusal is itself an audit event**; deep freeze on publish so mutation is a `TypeError` not a silent write. |
| `packages/model/document.ts`, `persist.ts` | 302 | `rack-studio` | `kernel-model` | Branded ids; lookups return `undefined` rather than throwing; schema-version and hash-mismatch refusals on load. |
| `packages/catalog/src/types.ts` | 168 | `rack-studio` | `kernel-catalog` | Pinned-release schema with status, approver, source document; bidirectional compatibility checking; discontinued-but-still-renderable semantics so a historical revision still draws. |
| `packages/bom/src/index.ts` | 158 | `rack-studio` | `kernel-bom` | Frozen item snapshots, quantity calculation in words, an unresolved register, propagated disclaimer. |
| `spikes/clearance-query/bench.mjs` | 222 | `rack-studio` | `kernel-geom` | The only existing implementation of the span-bucketed obstruction index — 1.34 ms p95 against 63.79 ms brute force, with agreement verified on all 901 sampled faces before speed. |
| `model/quantity.py` — especially `BASIS_BOUND` | 193 | `rack-engine` | `kernel-units` | A per-pair capacity that refuses conversion to per-beam. The trap this closes is silent and expensive. |
| `checks/result.py` | 79 | `rack-engine` | `kernel-checks` | Six-status vocabulary plus a mandatory provenance block on every result. |
| `checks/beam.py` refusal ordering + `lookup_key` extraction | 130 | `rack-engine` | `kernel-checks` | **Basis before number.** And one expression shared by the check and the trace, because a trace that disagrees with its own check is worse than no trace. |
| `checks/affected.py` | 108 | `rack-engine` | `kernel-checks` | One-hop, deliberately non-transitive propagation — exactly what a staleness view needs before it becomes noise nobody reads. |
| `emit/bom.py` row shape `qty + rule + confirmed` | 112 | `rack-engine` | `kernel-bom` | Every quantity carries the rule that produced it and whether that rule is established. |
| `emit/tabulation.py` | 32 | `rack-engine` | `kernel-derive` | Totals counted from the objects that exist, never read off a field. |
| `model/revision.py` — `NON_CONTENT_FIELDS` held as data | 189 | `rack-app` | `kernel-model` | So a test can assert exactly what the hash covers. Lineage and timestamps excluded on purpose. |

### Tests, fixtures and tooling

| Asset | From | Destination | Why |
|---|---|---|---|
| `e2e/mvp.walkthrough.test.ts` — 402 lines, 9 cases, 66 assertions | `rack-studio` | `e2e/` | The whole flow as an asserted transcript, ending in byte-identical BOM regeneration and a deep-frozen record. |
| `fixtures/projects/*` + `build-reference.mjs` | `rack-studio` | `fixtures/golden` | 11 expected derived values with mil, inches, formula and a `deltaMil` against a 10-mil tolerance. **Wire them into the test run** — nothing consumes them today. |
| `tests/test_provenance.py` (12), `test_validation.py` (4), `test_quantity.py` (11), `test_placement.py` (11), `test_layout_structure.py` (14), `test_catalog_parts.py` (10), `test_affected.py` (10) | `rack-engine` | new test suite | Assertions, not mechanics. These encode the product's refusals — including *"a refusal in the engine that leaks a number into the UI is not a refusal."* |
| `test_architecture.py` AST purity scan | `rack-app` | `tools/check-boundaries` | Parametrised over every core file plus a guard against vacuous globbing, so a new file is covered automatically. |
| `tools/check-boundaries.mjs` + `selftest-boundaries.mjs` | `rack-studio` | `tools/` | Mutation-tested: writes a violation and asserts it is caught. |
| `prototype/lint-provenance.mjs` | `rack-studio` | `tools/` | Catches a formatter applied to a raw value rather than a provenanced quantity — a defect visible only at the call site. |
| `prototype/audit-ui.mjs` | `rack-studio` | `tools/` | WCAG contrast measured over rendered text nodes in both themes, and it self-tests against known ratios before reporting. |
| `tools/check-claims.mjs` (the mechanic, not the scale) | `rack-studio` | `tools/` | Derives counts from the code so documents cannot drift. Every project here has assertion counts that disagree across its own docs. |
| `tests/test_perf_edit.py` technique | `rack-app` | perf suite | Wall-clock assertions on a programmatic 200-bay fixture with a stated budget. |
| `validation/REGISTER.md` — source-kind ranking | `rack-app` | validation register | `pe_stamped > published_chart > hand_calc`, with tolerance stated per case, executed by the normal test run. |

### Policy and documents

| Asset | From | Why |
|---|---|---|
| `CLAUDE.md` — 12 engineering rules, priority order, status vocabulary, source-of-truth hierarchy | `rack-engine` | Carry verbatim as product policy, minus the anti-commercialisation clause. This is the product's differentiator. |
| `PHASE-2.md` §2.4, §2.6, §2.7 | `rack-engine` | Revision hashing, pure emitter signatures, and an artifact cache key that includes the engine version. |
| ADR-002, 003 (+ amendment), 005, 006, 007, 008, 009, 010, 014 | `rack-studio` | Screening not design; one display list with `{text, established}`; fixed point; one aisle datum; obstruction faces; entity model; status vocabulary; propose-never-apply; revision lifecycle. |
| `SPEC-units.md` | `rack-studio` | The only module spec written, and it is good. |
| `research/RESEARCH-us-codes.md` with its VERIFIED/UNVERIFIED tags intact | `rack-studio` | The seed for rule packs. Note its honest definition of "verified". |
| The missing-source register and the open-question register | `rack-studio` (`05-IMPACT-ASSESSMENT.md` §6.3, §8.2) | The honest scope statement: *the geometry is tractable, the authority data is the work.* |
| The three exported claim strings (audit trail / published / external approval) | `rack-studio` | A client-facing product needs these **more**, not less. |
| `docs/CALC_PACKAGE.md` verbatim disclaimer + "the unit of the package is the configuration" | `rack-app` | Already articulates the preliminary-vs-final boundary this product needs. |
| `docs/FRAME_VERIFICATION.md` | `rack-app` | The provenance and audit story that makes the data defensible, including the 72% overstatement it caught. |
| `docs/DECISIONS.md` ADR discipline | `rack-app` | Dated, signed, with risk acceptance stated as risk acceptance. |

---

## ADAPT

| Asset | From | What is right | What must change |
|---|---|---|---|
| `rack_core/model/layout.py` (573) and `rack-engine/model/layout.py` (552) | `rack-app` + `rack-engine` | Entity shapes, construction-time validators, derived counts | Add owning organization, revision envelope, audience, and real plan geometry. Adopt `rack-engine`'s `BayType` grouping (a configuration, not a bay), `connector_series`, `is_picking` and `lost_positions` — `rack-app` re-derives configurations in its calc emitter because its model lost that grouping. |
| `model/edit.py` — 13-op delta protocol with optimistic `base` (565) | `rack-app` | `stale_base` is rejected, never merged — the right concurrency behaviour | Needs an actor with an organization; needs `OD-19` answered on concurrent client editing. |
| `rack_app/store/repo.py` append-only schema + `head_log` (467) | `rack-app` | Append-only, content-addressed, no `UPDATE` statement anywhere; `head_log` records states passed *through* | SQLite → Postgres with row-level security; every actor field needs an organization. |
| `rack_app/service.py` framework-free facade (542) | `rack-app` | The shape survives multi-tenancy | `project_id` becomes `(organization_id, project_id)`; the process-global service instance does not survive. |
| `packages/derive` (280) | `rack-studio` | Bay pitch, closing upright, allocated overhang, aisle as a max of published/safety/site with the governing term named | Purely one-dimensional; needs the geometry layer before it can serve the obstruction model. Carries one flagged unverified assumption: the safety allowance as a term inside the `max()` rather than an addend, worth six inches of aisle on every run. |
| `packages/checks` (495, 14 finding codes) | `rack-studio` | Excellent finding shape: `closed_by`, source references, per-parameter `established` flags, citation with a verification tier | Roughly five of the needed checks and **zero unit tests**. The prototype's other checks must be re-implemented in TypeScript against a real rule pack. |
| `compute()` + `configCost()` quantity rules (126 lines) | `rack-takeoff` | Already a pure function of `(config, project, rates)` | Every constant inside must be re-sourced or dropped. The cost half is out of MVP-1 entirely. |
| `test_all.js` `ref()` reimplementation, 400 assertions | `rack-takeoff` | Reusable as a golden-value fixture | Note honestly what it is: a transcription of the same assumptions, so it proves the wiring, not the engineering. |
| `audit.js` edge-value matrix and `scanBadValues` zones | `rack-takeoff` | Seven edge values per numeric field; regex scan of output zones for `NaN`, `undefined`, `Infinity`, `[object` | DOM-coupled; rewrite against the new component tree. |
| `webdemo.py` form and validation logic (~300) | `rack-engine` | *Collect every error, apply nothing partially, never re-implement a rule the model already enforces, never show a traceback* — exactly right for client self-service | The Pyodide transport does not survive. |
| `ui_kit.elevation_svg` (~100) and `emit/calc.py` configuration grouping | `rack-engine` / `rack-app` | Genuinely good elevation drawing: one scale on both axes, architectural ticks, every dimension a witnessed model value, no literal colour named in the drawing code | Rebuild as a display-list renderer rather than string-concatenated SVG. |
| `docs/CANVAS_PROTOCOL.md` §3 delta protocol and §5 staleness model | `rack-app` | Transfers directly | §1's single-tenant assumptions must be inverted. |
| `tasks/backlog.md` — 116 ids | `rack-studio` | A real asset | Groups assuming a desktop single-tenant app do not survive. |
| `generate.py` presentation-path capacity gate (513) | `rack-app` | Withholds values from non-verified tables and emits a status block — this gate closed a live data leak | Becomes the audience projection layer. |
| `.github/workflows/verify.yml` + `tools/verify.mjs` | `rack-studio` | 12 steps plus a build-idempotency byte comparison | Extend to build, typecheck, lint and deploy once the deployment shape is decided. |

---

## REFERENCE

| Asset | From | What to take |
|---|---|---|
| `prototype/kernel.js` — 15 cited rules (4 PRIMARY, 11 SECONDARY), 11 checks | `rack-studio` | Harvest the rules and the checks the typed packages lack. **Do not import the code** — it is a second, untyped implementation of the same domain, and carrying it forward would reproduce the exact defect the new architecture prevents. |
| ADR-012's nine deployment questions and ADR-013's eight identity questions | `rack-studio` | A good questionnaire. The *questions*, not the answers. |
| ADR-001 (tempo split) and ADR-004 (DXF writer) | `rack-studio` | ADR-001's calculus changes entirely for a web app. ADR-004 is unresolved: no DXF writer has been validated against a real AutoCAD seat. |
| `04-ARCHITECTURE.md` §2 (display list), §4 (determinism), §6 (provenance) | `rack-studio` | Port-grade thinking. §3 (threading), §9 (OPFS) and §10 are desktop-shaped and do not transfer. |
| `panels.py` refusal copy, NOT-RUN chips, gate wording | `rack-engine` | The content decisions — what each screen refuses to show — are the reusable asset. The f-string markup is not. |
| `ui_kit.py` two-token theme discipline | `rack-engine` | Every colour declared once per theme as a custom property, with a test asserting nothing else names a colour. |
| `docs/OUTPUT_FORMAT.md` §9 and §10 | `rack-app` | §9 is the closest thing in any project to a quote-intake spec. §10 is an unanswered live product question (see `OD-17`). |
| `docs/FRAMES.md` — the dead-load trap and the do-not-merge-sources rule | `rack-app` | Permanently true regardless of what else changes. |
| `docs/SPOT_CHECK.md` | `rack-app` | Keep as the cautionary artifact — the forensic case that a plausible dataset was synthesised rather than transcribed. Do not treat its tables as current. |
| `docs/G3_PROCEDURE.md` | `rack-app` | Reuse as the validation protocol for the client pilot: the one gate a test cannot close. |
| `rack-review.html` — the red-team strategy review | `rack-app` | Read before finalising scope. Its central warning is directly about this product: **the fast-follower risk is CPQ, not another rack startup.** |
| `HANDOFF.md` decision rationale | `rack-takeoff` | Institutional knowledge that exists nowhere else: install on the new-material basis; frames not shared back-to-back. It also records an **unsourced claim to verify, not to adopt** — that a 24 ft frame plus a 10" column implies roughly 21.5" of flue against a 12" standard. Per migration rule 4 it enters the rule pack at `NOT_FOUND` tier as a question, never as a conformance verdict. |
| `spikes/canvas-throughput` | `rack-studio` | The harness is reusable; the numbers were taken under software rasterization and need re-running on target hardware. |
| `web/preflight.html` | `rack-engine` | The pattern — a standalone diagnostic that names exactly which address is blocked and renders even when everything else is broken. |
| `apps/studio/src/*` (1,171 TS) | `rack-studio` | A worked example of "everything re-derives on every keystroke, nothing is cached". Not UI code to keep. |

---

## REJECT

| Asset | From | Why |
|---|---|---|
| Every value in `BEAM_CAP` | `rack-takeoff` | The file's own banner: *"plausible ballpark figures, NOT any manufacturer's published capacities."* It is the sole input to every capacity verdict in that tool, and verified data for exactly this exists in the other two projects. |
| All twelve component rates; `DEPTH_FACTOR`; `FACE_FACTOR`; the 1.20, 1.35 and 0.70 multipliers; the 1.25 load safety factor; the 0.90/0.95 shelf multipliers; the "$0.50–0.80 positions per sq ft" band; `FRAME_W = 3`; add-on prices in HTML option values | `rack-takeoff` | Uncited. Never back-tested against a live vendor quote despite that being an open item in the project's own handoff. `FRAME_W = 3` is hardcoded for every frame, depth and steel type. |
| The 7 QUARANTINED capacity tables and 3 TEMPLATE files | `rack-app` | Proven wrong: one overstates capacity by up to 72% at HbL 120" because it was indexed on overall frame height under an HbL label. |
| `packages/catalog/src/demo.ts` values | `rack-studio` | Invented, and labelled as such. Copy the labelling pattern; the values are not data. |
| DOM-as-model architecture | `rack-takeoff` | Structurally incompatible with a canonical revision-pinned model. State that lives in input values cannot be revisioned. |
| All three `rack-takeoff` HTML files as an application | `rack-takeoff` | The math is byte-identically triplicated; two of the three carry conflicting helper rules; one carries a live print bug. |
| NiceGUI adapter, `web.py`, Konva server binding, `workspace.py` | `rack-app` | A module-level singleton service on one SQLite file with path-only routes is not a retrofit to multi-tenancy; it is a rewrite. |
| Pyodide browser build, `web/index.html` (287 KB), `tools/build_web.py` target | `rack-engine` | A generated artifact for a delivery model this product does not use. |
| `prototype/rack-studio.html` | `rack-studio` | Five-state vocabulary, no persistence, no undo, no pan/zoom, scalar overhang — and its own documentation says it is not a preview of the product. |
| `catalog/loader.py`'s `runpy.run_path` | `rack-engine` | Arbitrary code execution from a data file. Fine for one vendored file in an internal tool; not in a client-facing application. |
| `demo_data.py` as seed data | `rack-engine` | Keep the Carson case as a test fixture; the demo jobs must not become product seed data. Its picking-level elevations are labelled demo values. |
| ADR-011; ADR-012 item 1 (desktop application); ADR-013 item 1 (workstation identity) | `rack-studio` | A resolved historical dispute, and two answers incompatible with a client-facing self-service product. |
| `docs/06-STATUS.md`, `tasks/plan.md` | `rack-studio` | Contradicted by their own trees; superseded. |
| `_archive/*` — duplicate docs, 10 `.bak` cap modules, 12 orphan `.mjs`/`.sh` scripts from a monorepo that no longer exists | `rack-app` | Dead weight. |
| Empty package trees: `geom`, `scene`, `render-canvas`, `sheets`, `remediate` (five of the eleven declared packages); plus `services/rack-engine`, `data/catalog`, `data/rules`, `fixtures/golden`, `fixtures/snapshots` | `rack-studio` | Ten directories containing zero implementation. Carry the boundary READMEs as specification, not the tree. |

---

## Conflicts between the reference projects

Recorded rather than silently resolved, per migration rule 5.

| Conflict | Resolution |
|---|---|
| **Two live, incompatible domain models**: `rack-app` (frozen dataclasses, hand-audited units, geometry-first, Python 3.11) vs `rack-engine` (pydantic, pint, type-first, Python 3.13). Same ~2026-08-19 ancestor, diverged, both last committed the same day. | Neither. A new TypeScript model taking `rack-app`'s revision and edit machinery and `rack-engine`'s `BayType` grouping, `connector_series`, picking-level distinction and pallet tabulation. |
| **Prototype vs packages in `rack-studio`**: a complete second implementation in untyped JS. Prototype ahead on rules (15 vs 0) and checks (11 vs ~5); packages ahead on types, lifecycle, BOM and persistence. Neither a superset. The provenance walkers have **inverted polarity**. | Typed packages as the base; harvest the prototype's rules and checks as data and specification. Do not carry two implementations forward. |
| **Four status vocabularies**: 5 states (prototype), 6 (`rack-engine`), 7 (ADR-009), 4 (`rack-app` check status). | The seven-state vocabulary in blueprint §11.1, once, everywhere. The prototype's conflation of missing-input with engineering-review is a specific defect to avoid. |
| **Three conflicting wire-deck formulas** (`len >= 132 ? 3 : 2`; `max(2, ceil(len/60))`; a one-job observation of ≈1.14 per bay) and two conflicting `suggestPallets` rules. | All three unsourced. Emit `UNRESOLVED` until a rule is sourced. |
| **Overhang handling**: scalar `trunc((palletD − frameDepth)/2)` in the prototype vs an allocated pair in `packages/derive`. | Allocate. The odd mil goes to a named side; a rounding error must not silently appear at one face. |
| **59E face height**: 5.92" in the catalog data (all 42 rows) vs 5.928" in a docs table. | Unresolved, and it stays unresolved. A person must read the source chart. Do not carry either figure forward as settled. |
| **Dead load**: beams use their own weight, frames use 2% of product load; two published sources disagree. | Never share a constant between them. Carry the ambiguity flag in the data, as `rack-app` does. |
| **Stated `rows` vs entered runs** (37 vs 3 on the Carson job) — and the BOM's headline quantity depends on the hand-typed integer. | Surface the disagreement as a finding, as `rack-app` does. Do not reconcile silently. |
| **`derive` dependencies**: the spec and architecture appendix say "empty dependencies block, CI fails if that changes"; the package declares three workspace dependencies; the boundary checker quietly re-scoped the rule to "no third-party". | Re-decide explicitly: no third-party dependencies in kernel packages, workspace dependencies allowed within the kernel. Update the doc, do not let the checker be the record. |
| **Declared vs actual stack** in `rack-studio`: React 19, Immer, rbush, flatbush, ESLint and Playwright are specified and none is installed. | The blueprint's stack table is the record. |
| **Assertion counts disagree across documents** in nearly every project (59 / 68 / 69; 454 / 456 / 461; 322). | Derive every count from the code and fail the build on drift. |
| **Aisle datum**: the *wrong* intuitive version (frame-to-frame) survived into a spec, a task list and a prototype before being caught. | One datum, everywhere: **clear width between load faces**, never frame to frame. |

---

## Migration rules

1. **The source trees are never modified.** Ported code is copied into the new repository and re-tested there.
2. **No asset is ported without its test.** An assertion that is not carried over is a claim that quietly stops being checked.
3. **Data is ported with every provenance field intact**, and re-enters the `DRAFT`/quarantined state until a named second person approves it *in the new system*. Machine reconciliation is evidence, not a signature.
4. **Nothing invented is ported.** Every capacity, rate and multiplier without a cited source is dropped, and its absence becomes a tracked open item with a named owner.
5. **Where two projects disagree, both readings are recorded as a conflict** and neither is silently chosen.
6. **A reversed prior decision is written down as a reversal, with its reason** — not deleted.

## Order of migration

1. **Doctrine** — the twelve rules, the status vocabulary, the source hierarchy. Costs nothing, and it governs everything after it.
2. **Data** — the verified catalog. Everything else depends on it, and the two-person approval gate is a scheduling dependency on a human, not on code.
3. **Assertions** — write the test first from the reference project's assertion, then port the implementation until it passes.
4. **Implementations** — `units` → `model` → `derive` → `geom` → `checks` → `bom`.
5. **Tooling** — the boundary checker, the provenance lint, the accessibility audit, the determinism harness.
6. **Everything else is new work.** Tenancy, identity, audience separation, submission, immutability and audit exist in none of the four projects.

## Reversed decisions

| Prior decision | Where recorded | Reversal |
|---|---|---|
| "Build internal tooling first, commercialise later. Do not introduce multi-catalog abstraction, multi-tenancy, SaaS architecture or customer account isolation unless explicitly told to." | `rack-engine/CLAUDE.md`; `rack-app/docs/DECISIONS.md` C4 (marked *"provisional default — Elliott to confirm"*) | **Reversed.** Rack Master Studio is exactly that product. Multi-tenancy and account isolation are day-one requirements. Multi-catalog abstraction stays deferred to phase 4. |
| Deployment is a desktop application; identity is workstation identity; access is at the network layer via Tailscale or Cloudflare Access. | `rack-studio` ADR-012 item 1, ADR-013 item 1; `rack-engine` ADR-014 / `PHASE-2.md` §8 | **Reversed.** A client-facing web application with person-level identity, organization scoping and application-layer authorization. The fifteen questions those two ADRs leave unanswered — eight of nine on deployment, seven of eight on identity — stay open and are answered in blueprint §14 and `open-decisions.md`. |
| Scope fence: "explicitly NOT building … multi-tenancy, roles, SSO." | `rack-engine/CLAUDE.md` | **Reversed for those three items only.** Every other item on that fence — FEA, Direct Strength Method, seismic from first principles, 3D geometry, an AutoCAD plugin, anything other than selective pallet rack — **stands**. |
