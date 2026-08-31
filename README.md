# Rack Master Studio — Planning Deliverables

**Status: research and planning only. No production implementation has begun, and none should begin before the blocking decisions in `open-decisions.md` are answered.**

Rack Master Studio is a client self-service pallet-rack configuration and quote-intake web application. Clients do the early configuration work themselves inside controlled guardrails; McMurray Stern receives a structured, revision-pinned submission and keeps its catalog, BOM, pricing, estimating and engineering workflow behind a hard boundary.

Prepared 2026-08-31 for EL, McMurray Stern. Blueprint revision **Rev C**.

---

## Files in this folder

| File | What it is |
|---|---|
| `rack-master-studio-blueprint.html` | **The main deliverable.** A self-contained, offline, responsive, printable HTML blueprint — 19 sections and 7 diagrams covering vision, workflows, architecture, data model, security, validation, BOM, MVP scope, backlog, tests, risks and open decisions. |
| `README.md` | This file. |
| `reference-project-inventory.md` | What was found in each of the four prior projects, with real counts and an honest assessment of what is trustworthy in each. |
| `reuse-register.md` | Every notable asset from those projects classified **PORT / ADAPT / REFERENCE / REJECT**, with the reason, plus the conflicts between them and the migration rules. |
| `src/` | The blueprint's source: 14 section files, the build script, the checks, and the sourced external research behind the document's claims. `src/README.md` explains the workflow. |
| `HANDOFF.md` | **Read this first if you are picking the project up cold.** Current state, the rules that must not be broken, the non-obvious decisions a fresh reader would silently revert, the Phase 0 task order, and what is known to be wrong or unverified. |
| `open-decisions.md` | The 21 decisions needed before development starts, each with a recommendation — **plus the decision log**: 16 answered on 2026-08-31, with the reasoning and the two that need a second pass. |

## How to view the blueprint

Double-click `rack-master-studio-blueprint.html`, or open it in any modern browser. There is nothing to install and nothing to run.

- **Offline.** No network requests, no external stylesheets, fonts, scripts or images. It works with the machine disconnected.
- **Navigation.** A sticky sidebar lists all 19 sections and all 7 figures and highlights where you are. On a narrow screen it collapses behind a **☰ Contents** button.
- **Theme.** Follows your system light/dark setting; the **◐ Theme** button overrides it and the choice is remembered in that browser.
- **Collapsed detail.** The reuse matrix in §17 is in expandable panels. **⊞ Expand all** opens every panel at once.
- **Printing.** `Ctrl/Cmd-P` gives a clean document: the sidebar and buttons are removed, expandable panels are opened automatically, diagrams and tables are kept off page breaks, and colour is preserved if you enable background graphics. About 108 pages on US Letter.
- **Diagrams.** All seven are hand-authored inline SVG — no Mermaid, no diagram library, no runtime. They scale, print, and carry text alternatives for screen readers. There is no fallback to arrange because there is nothing that can fail to load.
- **Contents.** No credentials, no pricing, no internal part numbers, and no client names or quote numbers — findings drawn from real jobs appear in anonymised form ("one job", "two of four"). The file is safe to share internally as-is. The identifying detail behind those findings lives in `open-decisions.md`, which is **not** anonymised and should be treated as internal-only.

## Where the research conclusions appear

Everything below was researched for this blueprint; the section given is where the conclusion is stated and applied.

| Research area | Where it lands |
|---|---|
| Secure multi-tenant B2B architecture | **§6** (architecture and what it rejects), **§14.1–14.2** (threat model, shared-DB + row-level security, the RLS correctness checklist), **§5.2** (isolation requirements) |
| Client invitation, authentication, RBAC, org isolation, audit logs | **§2** (roles + full permission matrix), **§14.3** (invitation token design), **§14.4** (authentication ladder — and why emailed magic links are not a second factor), **§14.5** (authorization model, and why *not* to adopt a policy engine yet), **§13.6** (audit event schema, and audit-log vs application-log) |
| Revision-controlled configuration and immutable submitted records | **§3.3** (revision/iteration and ISO 19650 P/C prefixes), **§7** (canonical model), **§13.1–13.5** (submit transaction, manifest, the six immutability layers, derived revisions) |
| Product configuration, BOM/takeoff, quote intake, approval, document release | **§4** (functional requirements), **§3.4** (request status lifecycle and structured decline reasons), **§12** (BOM strategy, as-configured → as-quoted chain), **§9.3** (preliminary-output rule and the standing disclaimer) |
| Architecture for a responsive web app serving internal users and clients | **§6.1–6.4** (the shared derivation kernel, stack table, repository layout), **§8** (API and service boundaries) |
| Secure handling of internal pricing, BOM, part mappings vs client-visible output | **§9** (the structural rule, Figure 6, the full visibility matrix), **§14.6** (seven layers of leakage prevention), **§8.1** (two API surfaces rather than one with flags) |
| Data provenance, catalog/rule versioning, calculation traceability | **§10** (release lifecycle, two-person rule, catalog file format, lookup semantics, verification tiers, the PROV-shaped provenance model), **§11.2** (a finding's outcome is derived from its provenance, never authored), **§12.4** (the four-way trace from a BOM line) |

Two further conclusions are worth reading first if you read nothing else:

- **§19.2 "Do not build yet"** — what is excluded, why, and what would change the answer.
- **§18** — the twenty open decisions, fifteen of which block Phase 0.

## Non-negotiables recorded in the blueprint

1. Rack Master Studio is **not** an engineering-certification or code-compliance product. It never claims structural, manufacturer, PE, fire-protection, code or AHJ approval. Where a question needs an authority the product does not hold, its job is to name the gap and stop.
2. Every client-facing output carries a preliminary watermark and the standing disclaimer, physically inseparable from the artifact.
3. Client users never see internal BOM detail, manufacturer part numbers, catalog source detail, capacity tables, pricing, margins, discounts, internal notes, or procurement-ready exports — and that is enforced by physically separate tables, not by filtering fields on the way out.
4. A submitted revision is immutable for everyone, including us, enforced at the database layer.
5. Internal refinement happens in a separate revision lineage that the client cannot see and that never writes back.

## Change-control note

The four prior projects under

```
C:\Rack Master\Resourse (do not delete or overwrite files)\rack-app
C:\Rack Master\Resourse (do not delete or overwrite files)\rack-engine
C:\Rack Master\Resourse (do not delete or overwrite files)\rack-studio
C:\Rack Master\Resourse (do not delete or overwrite files)\rack-takeoff
```

were inspected **read-only**. Nothing in them was edited, deleted, moved, renamed or written to. Nothing found in them was assumed correct or final; see `reference-project-inventory.md` for what is trustworthy and `reuse-register.md` for what carries forward.

## Next step

**The decision set is closed.** All twenty-one decisions are settled and logged in `open-decisions.md`, summarised in blueprint §18.1. Phase 0 and MVP-1 are fully unblocked.

**One item is deliberately left open: the name of the external pilot client (`OD-20b`).** Its selection criteria are settled — outside the company, a new-material job, small enough to finish in one sitting, a live opportunity, a relationship that survives a rough first release — and one account from the job audit fits all five. Choosing it is a commercial judgement, not a design decision, and it gates no development work.

What it does gate is a conclusion. `R-01` — *will a commercial client actually do this configuration work themselves* — is the risk the whole business case rests on, and it is retired only when one organization outside McMurray Stern completes a submission unaided. The internal dogfood pilot (`OD-20a`) will find real defects and should happen; it measures usability, not willingness.

Development can start on Phase 0 whenever you say so.
