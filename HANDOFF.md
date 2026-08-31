# Rack Master Studio — Handoff

**Written 2026-08-31. Read this first if you are picking the project up cold.**

This is state, not plan. The plan is `rack-master-studio-blueprint.html`.

---

## 1. Where the project stands

Planning is complete, the decision set is closed, and **Phase 0 has started**. Three foundation
tasks are built, verified and committed: `A-01` (monorepo scaffold), `A-02` (`kernel-units`) and
`A-03` (boundary checker with its self-test). `A-04` — Postgres schema and row-level security — is
the next task.

| | |
|---|---|
| Blueprint revision | **Rev C**, 2026-08-31 |
| Decisions | **21 of 21 settled.** One item deliberately open — see §7 |
| Code written | **`kernel-units` + the boundary checker.** 68 tests, 100% kernel coverage |
| Verification | `pnpm verify` green; results recorded in `docs/CURRENT_STATE.md` §4 |
| Next | `A-04`, then `A-05`/`A-06`. Full order in §5 |

**Start with `README.md` for how to run the checks, `TODO.md` for what is next, and
`docs/CURRENT_STATE.md` for what has actually been run rather than what is planned.**

## 2. Where everything is

```
C:\Rack Master\
├── Resourse (do not delete or overwrite files)\    ← READ-ONLY. See §3.
│   ├── rack-app\        Python. Deepest lineage. The verified catalog data lives here.
│   ├── rack-engine\     Python. The doctrine and the provenance trace.
│   ├── rack-studio\     TypeScript. The revision model and the units package.
│   └── rack-takeoff\    Single-file HTML. Quantity rules + the reasoning behind them.
└── rack-master-studio\                             ← the deliverables
    ├── rack-master-studio-blueprint.html   19 sections, 7 diagrams. The governing document.
    ├── README.md                           how to read the blueprint, where research landed
    ├── reference-project-inventory.md      what is in each prior project, with real counts
    ├── reuse-register.md                   every asset: PORT / ADAPT / REFERENCE / REJECT
    ├── open-decisions.md                   all 21 decisions, the reasoning, the log
    ├── HANDOFF.md                          this file
    └── src\                                the blueprint's source and toolchain
        ├── README.md                       how to edit and rebuild
        ├── build.py / build.cmd            parts -> the single HTML
        ├── verify.py                       structural checks (the gate)
        ├── verify-visual.py                optional browser checks
        ├── parts\                          14 section files
        └── research\                       sourced external research, with URLs
```

The blueprint is self-contained, offline, and prints to about 108 pages. Open it by double-clicking.

**Sensitivity:** the blueprint carries no client names, quote numbers or pricing — findings from real jobs appear anonymised. `open-decisions.md` is **not** anonymised; it names clients and quote references and is internal-only.

## 3. Rules that must not be broken

**The four reference projects are read-only.** Never edit, delete, move, rename or write into them. Copy out; never modify in place. Nothing found in them is assumed correct or final — the blueprint is the governing direction.

> A note from experience: read-only `git status` in those trees can leave a `.git/index.lock` behind, because the mount blocks deletion. If you run git commands there, check for and clean up lock files afterwards.

**The scope fence.** In no phase does this product claim structural, manufacturer, PE, fire-protection, code or AHJ approval. No FEA, no Direct Strength Method, no seismic from first principles, no 3D, no AutoCAD plugin, selective pallet rack only. Where a question needs an authority the product does not hold, the job is to **name the gap and stop**.

**The product constitution**, carried verbatim from `rack-engine/CLAUDE.md`:

> Never guess. Preserve provenance. Surface uncertainty. An explicit `UNKNOWN`, `OFF_GRID`, `MISSING INPUT` or `BLOCKED` is substantially better than a plausible but unsupported number.

## 4. The decisions a fresh reader will silently revert

Every one of these looks like a mistake until you know why. This list is the most valuable part of this document.

| Looks wrong | Is deliberate because |
|---|---|
| Lengths stored in **micrometres**, not millimetres | 48″ is 1219.2 mm. Stored as integer mm it becomes 1219, reads back 47.9921″, and **no longer matches its own capacity-table lookup key**. 18 of the 21 published spans fail that way. µm holds every published inch value *and* every whole millimetre exactly. Millimetres are what users see; µm is only how it is stored. |
| `bom_line.part_revision_id` is **nullable** | Half of all jobs contain material with no published capacity. The reference is `part_revision_id` **XOR** `uncatalogued_part_id`. A NOT NULL FK to a catalog part cannot represent half the work. |
| `uncatalogued_part` has **no capacity column at all** | Absent by schema, not blank by convention, so no future code path can populate it under deadline pressure. |
| No used-material derate anywhere | A derate has no published basis, so it caps at `SECONDARY` tier, which the ceiling limits to *engineering review required* regardless. A "PE clicks to accept" button therefore cannot work. Geometry does not determine the capacity of used material. |
| **Two** front-end apps and **two** API namespaces, not one with role flags | A shared route that hides fields makes leakage a serialization bug — invisible in review. Two namespaces make it a routing bug: loud and greppable. |
| Cross-tenant denials return **404**, never 403 | A 403 confirms the object exists. |
| Tenant context uses `SET LOCAL` **inside an explicit transaction** | A session-scoped `SET` under a transaction pooler survives the connection being handed to another client. That is a cross-tenant leak waiting for a load spike. |
| Every uniqueness constraint is **composite with `organization_id`** | FK and unique checks bypass RLS. A global unique index leaks another tenant's row existence through constraint-violation errors. |
| The capacity engine **never interpolates** | Off-grid returns both brackets and no value. This is the single most important behaviour in the product. |
| `mayWaive()` **throws** instead of returning false | Waiver authority is undecided (OD-09). Throwing names the open decision; returning false silently defaults to a policy nobody chose. |
| The catalog approval gate keys on the **verification act**, not the digitiser's identity | "Refuse when approver == digitiser" is trivially bypassed: run an extraction script, the digitiser becomes a machine identity, and one person approves their own work. A machine is a tool, not an independent party. |
| SLA clocks are named **acknowledgement** and **quote delivery** | Never *prelim turnaround* or *engineering review*. The latter implies an authority this product does not hold, and that wording escapes into UI strings and client emails. |

## 5. What to build first

Phase 0 in dependency order. None of it is client-specific, so it does not wait on the pilot.

| # | Task | Why it is first |
|---|---|---|
| `A-01` | Monorepo, TypeScript strict, three-way path-alias consistency, CI | — |
| `A-02` | `kernel-units`: fixed-point µm + millipounds, unit + origin on every value, allocate-never-divide, fail-closed provenance walkers, one-way metric display formatter | Everything else depends on it. Port the mechanics from `rack-studio/packages/units` and re-base from mil to µm. |
| `A-03` | Boundary checker (AST) + its self-test | Cheap now, and it is what stops a second implementation appearing. |
| `A-04` | Postgres schema v1, `migrator`/`app_user` role split, RLS on every tenant table | — |
| `A-05` | `withTenant()` transaction wrapper; lint rule banning raw pool checkout | The only correct path to the database. |
| `A-06` | CI assertion: every table has RLS enabled, forced, ≥1 policy per operation | The forgotten table is the realistic failure, not the wrong policy. |
| `A-07` | Sessions, cookie hardening, Entra ID OIDC for staff, password + TOTP for clients | — |
| `A-08` | `authorize()` + middleware + **boot-time route-coverage assertion** | The one control that survives someone adding an endpoint on a Friday. |
| `A-09` | DTO layer per (entity × audience); forbidden-field constant; leakage contract test | Worth ten times more written against six routes than two hundred. |
| `A-10` | `audit_event` table, append-only trigger, hash chain, transactional write helper | — |
| `A-11` | Transactional outbox + worker | — |

**Write the hash-stability test before the hashing code.** That advice is in the reference projects and it is right.

Then Group B (catalog and rules), Group C (kernel), D (client app), E (internal app). Full backlog in blueprint §15.3.

## 6. Things known to be wrong or unverified

Do not treat these as settled just because they appear in an inherited artifact.

- **The Carson acceptance fixture's headline number is contested.** Drawing 0005-01 R-1 says 916 bays / 6,824 net positions. Quote `Q-38857-1` says 916 bays / **7,196**. Quote `Q-38857-8` says 551 bays / **4,268**. Three artifacts, three counts, nothing linking them. Reconcile before trusting 6,824 as a golden value — and note this is itself the clearest evidence for why the product should exist.
- **59E beam face height:** 5.92″ in the catalog data (all 42 rows) vs 5.928″ in a documentation table. Unresolved. A person must read the source chart. Do not carry either forward as settled.
- **Seven quarantined capacity tables** in `rack-app` are proven wrong — one overstates capacity by up to 72% at HbL 120″ because it was indexed on overall frame height under an HbL label. Do not port them.
- **Every rate and multiplier in `rack-takeoff` is uncited**, including all of `BEAM_CAP`. The file's own banner says the capacities are "plausible ballpark figures, NOT any manufacturer's published capacities". Drop them; verified data for the same thing exists in the other two projects.
- **Performance figures from the spikes were measured under software rasterization** in a cloud container. They are a floor, not a measurement on target hardware. Re-run in Phase 0.
- **Source conflicts left deliberately open**, listed in blueprint §10.8: which MH16.1 edition applies, the NFPA section for the 18-inch rule, the load-face aisle measurement convention, dead-load basis. None block MVP-1, because MVP-1 makes no compliance claim.

## 7. What is open

**One item: the name of the external pilot client (`OD-20b`).**

The selection criteria are settled — outside McMurray Stern, a new-material job, small enough to finish in one sitting, a live opportunity rather than a favour, and a relationship that survives a rough first release. One account from the job audit fits all five. Choosing it is a commercial judgement and is recorded as EL's.

It gates no development work. It gates a **conclusion**: risk `R-01` — *will a commercial client actually do this configuration work themselves* — is the premise the business case rests on, and it is retired only when one organization outside McMurray Stern completes a submission unaided. The internal dogfood pilot (`OD-20a`) is settled and worth doing, but it measures usability, not willingness: internal users are paid to use the tool, already know rack, and cannot fall back to a phone call.

Two small follow-ups, neither blocking:

- Confirm the Entra licence tier. OIDC works on any tier; SCIM needs P1+. Without it, offboarding becomes a named step in the quarterly access review rather than an automated one.
- Confirm the nominated fallback catalog approver is positioned to catch a *capacity-table* error specifically — a different competence from design or sales review.

## 8. How to know you have not broken anything

These are the invariants. If any fails, stop.

1. No response to a client principal contains a cost, price, margin, discount, manufacturer part number, catalog page reference, supplier, BOM line, or internal note — at any nesting depth.
2. No principal, of any role, can mutate a submitted revision. Enforced in the database, not in application code.
3. No principal can delete an audit event.
4. An unestablished value is never rendered as a numeral — in the UI, the display list, or a PDF.
5. An off-grid span returns both brackets and no capacity value.
6. Used or generic material yields no capacity, and its trace carries **no table basis at all**, because no table was read.
7. A BOM for a submitted revision regenerates byte-identically from the revision alone.
8. Every check whose governing rule is below `PRIMARY` tier returns at most the ceiling for that tier.

Full acceptance criteria `AC-01`–`AC-20` in blueprint §16.2. The demo scenario in §16.3 exercises every claim in the document and is worth building the seed data for in Phase 0.

## 9. If you change something in the blueprint

**Edit the section files in `src/parts/`, then rebuild — do not edit the built HTML directly.**

```
python src/build.py        # or double-click src\build.cmd on Windows
```

That concatenates the 14 sections into `rack-master-studio-blueprint.html` and runs eleven structural checks. The build is a plain concatenation with no templating, and a clean-room rebuild from `src/` alone reproduces the artifact byte for byte — so if the output ever differs from what you wrote, that is a bug in the build rather than a feature of it.

`src/README.md` has the section-to-file map and explains the two things in the document that look odd and are not: the JavaScript link interception, and why the diagrams are hand-written SVG.

The checks cover: strict parse, self-containment, anchor resolution, section and figure counts, diagram labelling, SVG marker references, SVG geometry inside its viewBox, **no client identifiers**, **language discipline** (no "tamper-proof", "stamped engineering review" or "prelim turnaround"), and that the link interception is still present.

`python src/verify-visual.py` adds browser checks if Playwright is installed — overflow at desktop, mobile and dark theme, console errors, and proof that in-document links still scroll rather than navigate when the file is embedded in a preview pane.
