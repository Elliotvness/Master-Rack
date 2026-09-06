# ADR-006 — One aisle datum: the clear width between load faces

**Status:** Accepted · 2026-08-29 · generalised by ADR-007
**Supersedes:** the "operational aisle vs fire aisle" framing in the first draft of `01-CONCEPT.md` §5.1

## Context

A rack layout has two aisle dimensions:

- **frame face to frame face** — what the designer draws and dimensions on the plan;
- **clear between load faces** — frame-to-frame less the pallet overhang on each side.

Two requirements have to be satisfied:

- **fire code** — CFC §3206.9.1, 44 in. sprinklered or 96 in. otherwise;
- **truck** — right-angle stacking width + maximum load length + 12 in. clearance.

The first draft of this design paired them off: fire against the clear width, truck against the frame-to-frame dimension, on the reasoning that the fire code is explicit about measuring from the commodity and the truck "needs the aisle." That is wrong, it survived into a spec, a task list and a working prototype, and it was caught by adversarial review rather than by anything in the design itself. It is recorded here because the wrong version is intuitive and will be re-proposed.

Two sources settle it:

- Riverside County Fire, on the fire requirement: *"Aisles are measured from the actual edge of the commodity to commodity, not rack to rack."*
- The reference drawing set, sheet R-102, on the **truck** requirement, in capitals:
  > `TRUCK Ast SHALL BE CHECKED AGAINST 2550, NOT AGAINST 2700.`

2700 is that set's frame-to-frame aisle; 2550 is the clear width after 75 of overhang comes off each side. And of course — what the truck has to pass is the pallets, not the uprights.

## Decision

**There is one datum. Every aisle requirement is checked against the clear width between load faces.**

```
clear            = frameToFrame − overhang(near) − overhang(far)
governingClear   = max(truckRequirement, fireRequirement)
frameToFrameReq  = governingClear + overhang(near) + overhang(far)
```

`frameToFrame` remains the dimension the designer sets and the plan carries; `clear` is what every requirement is compared against; and the governing requirement is converted back to a frame-to-frame figure so the layout can be dimensioned from it.

`derive` exposes `aisleDimensions() → { frameToFrame, clear }`. No function returns a single unqualified "aisle."

## Consequences

**Good.** The `max()` in the governing calculation is now meaningful, because both operands are clear-width requirements on the same ruler — taking the maximum of a clear requirement and a frame-to-frame requirement is a category error that happens to produce a number. And the failure mode this prevents is specific: with a 48 in. pallet in a 42 in. frame, checking against frame-to-frame over-reports the aisle by 6 in., which is comfortably enough to draw a rack that does not fit as one that does. The prototype's shipped fixture demonstrates it — 132 in. frame-to-frame against a 126.3 in. truck requirement looks fine and is 5/16 in. short.

**Bad.** The clear width is not a dimension anyone writes on a drawing, so it has to be surfaced deliberately in the UI or designers will keep reasoning about the frame dimension. Both figures appear on the canvas and in the derived table for that reason.

**Note on the invariant.** An earlier property, `fire aisle ≤ operational aisle`, is false and has been replaced by `clear = frameToFrame − 2 × overhang` exactly. Overhang is **signed**: a pallet shallower than its frame gives a negative overhang and `clear > frameToFrame`. That configuration is real, and it raises its own finding — a pallet that does not overhang may not bear on both beams, which is note 18 on R-000 of the reference set and needs pallet support bars.
