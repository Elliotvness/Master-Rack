# ADR-001 — Split Rack Engine and Rack Studio by tempo, not by tier

**Status:** Accepted · 2026-08-29 · reaffirmed 2026-08-30
**Deciders:** EL
**Supersedes:** nothing

## Context

Rack Studio can be built as a front end on the existing Python Rack Engine (`C:\Users\ellio\code\rack-engine`), or it can absorb Rack Engine and port everything to TypeScript. Both were evaluated in `01-CONCEPT.md` §6.

Rack Engine holds validated pallet tabulations and beam capacity checks against published Interlake Mecalux data, plus git history. It also has `ezdxf` and ReportLab — the two libraries that best serve the two hardest deliverables.

Rack Studio needs a canvas that responds inside a 16 ms drag frame.

## Decision

Keep Rack Engine, but draw the boundary at **tempo** rather than at "front end / back end".

- **Interactive tempo** (< 16 ms, every frame): geometry, clearances, positions, screening checks, canvas — TypeScript, in the browser.
- **Document tempo** (seconds, on explicit Export): DXF, PDF, calc assembly — Python, in Rack Engine.
- **Authority tempo** (changes with a standard or a price list): catalog and rule packs — versioned JSON, consumed identically by both.

The contract between the halves is a versioned JSON Design Document plus the pack references.

The geometry and derivation layer **migrates out of Rack Engine into TypeScript**, because it must run at interactive tempo. Python keeps what only Python does well.

## Consequences

**Good.** The validated tabulations are not re-derived, so the numbers carrying the product's credibility are never put at risk. `ezdxf` writes real dimension graphics blocks and layer lineweights; the JS alternatives do not. ReportLab already demonstrably produced the reference set. No HTTP call sits inside the interaction loop.

**Bad.** Two languages and two test suites for one maintainer. An export service must be deployed, or the Pyodide fallback must work (ADR-004). The migrated derivation layer must be re-verified against Rack Engine's Python output during the transition — a one-off cost, and an explicit parity check in the task plan.

**Bad, and not resolved by this decision.** The claim that "the validated tabulations are never re-derived" is narrower than it first reads. Published **capacity tables** live in `catalog`, `derive` depends on `catalog`, and beam-deflection screening (spec §9 check 11) runs at interactive tempo — so capacity data does cross into the browser. What stays in Python is the *tabulation and capacity-check logic*, not the data it reads. The reconciliation is that the browser does table **lookup and screening**, Python does **computation**, and the two must agree on the same catalog pack. If that distinction ever blurs, this ADR needs revisiting.

**Rejected — absorb into TypeScript.** The port lands on exactly the validated logic that is the product's only credibility asset, for no user-visible gain; it trades `ezdxf` for a writer with zero lineweight support; and it does not eliminate the second language, only defers it to the day a real calc package is needed.

**A note on one argument that does *not* support this decision.** "No HTTP call in the interaction loop" is a property of the tempo split, and it is worth stating — but an all-TypeScript build would have that property too. It discriminates against the *naive* form of Option 1 ("Python back end, JS front end"), not against Option 3. The real case against Option 3 is the port risk and the two export libraries; the interaction-loop argument is about how Option 1 must be drawn, not about why it wins.

**Numbering.** The options are labelled 1 and 3 to match the question as it was asked. There is no Option 2 in this document.
