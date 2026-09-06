# ADR-008 — The Design Document is an entity graph, not a parameter tree

**Status:** Accepted · 2026-08-30
**Supersedes:** the flat parameter model in `prototype/kernel.js`

## Context

The prototype models a rack layout as nineteen scalars describing one implicitly-repeated configuration. `blocks: 3` means "draw three identical row blocks" — not "there are three runs, and the second one can be selected." Nothing in the model has identity: no run, bay, wall, column, brace or door is a thing that can be named, clicked, moved, deleted, locked, or referred to.

Seven of the nine requested features require object identity as their first prerequisite:

| Feature | Needs |
|---|---|
| Warehouse sketch | ordered wall segments, each editable |
| Column grid / K-brace | individual columns with per-column override; braces by grid range |
| Dock doors | per-door attributes and per-door screening results |
| Bay editing | select · delete · insert at index · split run · **lock** a resolved bay |
| Column straddle | *this* column inside *that* bay |
| Tunnel screening | recommended tunnel bay **locations** |
| BOM | every line names its source layout objects |

The lock requirement is the sharpest of these: "lock a manually resolved bay so auto-layout does not overwrite it" is meaningless without a bay that persists across a re-layout.

## Decision

The Design Document becomes an entity graph. Every layout and building object carries a stable id. Ids are generated once and never reused; they are what BOM lines, findings, audit events and revision diffs refer to.

Structure as in `docs/05-IMPACT-ASSESSMENT.md` §3.1: `Project → Revision[] → { building, equipment, layout, selections, validationRuns, bomRuns, auditEvents }`, with `building.walls[]`, `building.columns[]`, `building.kbraces[]`, `building.doors[]`, `layout.runs[]`, `layout.bays[]`, `layout.bayTypes[]`, `layout.straddles[]`.

What does **not** change:

- Every leaf dimension is still a `Quantity` with an origin. Identity is added; provenance is untouched.
- Geometry is still **derived, never stored**. A bay stores its type, index and lock flag; its coordinates are computed. This is what keeps undo safe and reproducibility free.
- Undo still restores state and recomputes geometry — but the unit becomes a named command (`Delete bay`, `Split run`) rather than a parameter patch, which extends ADR-005's mechanism rather than replacing it.

## Consequences

**Good.** Every feature in the request becomes expressible. Findings can point at objects. BOM lines can cite them. Audit events can record what changed. Diffing two revisions becomes a graph comparison rather than a scalar comparison.

The migration is free **today** — no user has a file worth keeping, because persistence does not exist yet. It would be very expensive in three months. That timing is the whole argument for doing it in Phase 1 rather than when the first feature demands it.

**Bad.** The model is substantially larger, and id lifecycle is now a real concern: ids must survive undo/redo, must not be reused after delete, and must be stable across a revision clone so a diff can pair objects. Serialisation grows. A spatial index becomes necessary rather than optional.

**Rejected — keep parameters, add an overlay of objects.** Two sources of truth for the same geometry, and the point at which they disagree is a bug nobody can reproduce.
