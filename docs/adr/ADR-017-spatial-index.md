# ADR-017 — Spatial lookup behind an interface

**Status:** Accepted · 2026-09-05
**Depends on:** [ADR-007](ADR-007-obstruction-faces.md), [ADR-005](ADR-005-fixed-point.md)
**Serves:** build plan S4.1; blueprint §10

## Context

`studio-web` must answer three questions on every pointer move, at 300+ bays, inside one animation
frame: what is under the cursor, what is in the viewport, and what could this dragged thing be
colliding with. A linear scan over every entity answers all three and is the reason the naive
version stops being usable at scale.

`kernel-geom` already provides `ClearanceIndex` and `minClearanceBrute` for ADR-007's obstruction
faces. That is a clearance question — *how far to the nearest face* — and it is not the same
question as *what is at this point*. Conflating them would put viewport culling and pick targets
inside a package whose job is engineering clearance.

The 2026-09-05 brief proposed an explicit `SpatialIndex` interface with `bulkLoad`, `insert`,
`remove`, `search`, `searchPoint`, `getEntityItems` and `replaceEntity`, backed by RBush. The
interface is well-shaped and is adopted. The question this ADR settles is what it may and may not
be coupled to.

## Decision

**A `SpatialIndex` interface, owned by the scene layer, with RBush as the first implementation and
no domain code depending on RBush.**

1. The interface is defined in the scene package. `rbush` is imported in exactly one file — the
   adapter — and appears in no other import statement in the repository. A checker asserts that.
2. **Bounds are integer micrometres** (ADR-005). RBush stores numbers; µm counts are integers well
   inside the safe range for any building, so no float enters the index. Screen-space tolerance
   (~5 px for a pick) is converted to µm at the call site using the current camera scale, never
   stored.
3. **`replaceEntity` is the only mutation used during editing.** A rack run's replacement covers
   its run, frames, bays, pallet envelopes, flues, snap guides and hit regions as one unit, so the
   index cannot hold half of an edited entity.
4. **Drag uses two indexes.** A committed index and a temporary preview overlay. The preview is
   queried first and the dragged owner is suppressed in the committed index. The preview index is
   discarded on Escape and never merged.
5. **The index is derived state.** It is rebuilt from the display list, is never consulted to
   answer a domain question, and is never an input to a check, a BOM line or an export. Nothing may
   be true only because the index says so.

## Consequences

**Good.** RBush is replaceable — a grid, a quadtree, or a different R-tree — without touching a
caller. The interface is testable against a brute-force oracle, which is how `minClearanceBrute`
already earns its keep in `kernel-geom`: the slow correct implementation stays as the test's second
opinion.

**Good.** Rule 5 keeps a performance structure out of the correctness path. An index bug becomes a
missed click, never a wrong quantity on a drawing.

**Bad.** Two indexes during a drag is real complexity, and the suppression rule in point 4 is the
kind of thing that is correct in the common case and subtly wrong at the boundary — a run dragged
onto itself, a multi-select where one member moves. Those cases need tests written before the
feature feels finished.

**Bad.** `ClearanceIndex` and `SpatialIndex` will look like duplicates to anyone reading quickly,
and someone will eventually propose merging them. They answer different questions and have
different consumers; the day they merge, viewport culling gains a vote in an engineering clearance
result.

**Bad, and unmeasured.** The 1 ms hit-test target on the 300-bay fixture is an assertion, not an
observation. `pnpm bench:hittest` does not exist yet. Until it runs, this ADR's performance claim
is a plan.
