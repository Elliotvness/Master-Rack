# ADR-005 — Fixed-point integers, thousandths of an inch

**Status:** Accepted · 2026-08-29 · reaffirmed 2026-08-30 by FINDING 0.3-A

## Context

A rack permit set is a contract document. Two runs of the same project must produce identical output, and a project reopened in three years must reproduce. Floating-point accumulation across a derivation chain — overhang subtracted from a frame-to-frame span, halved, added to a run origin — will not reliably do that across machines and browsers, and it will break golden-image tests in ways that look like flake.

## Decision

All stored engineering dimensions are **integers in thousandths of an inch (`Mil`)**, as a branded TypeScript type. Floats appear only at the render boundary — PDF points, DXF reals, screen pixels — and never round-trip back into the model.

## Consequences

**Good.** Bit-exact and reproducible across machines, browsers and operating systems. No dependency, no allocation per operation, full speed inside the frame budget. Range is not a concern: a 300 ft warehouse is 3.6 × 10⁶ mil against an exact-integer ceiling of 2⁵³. Branded types make unit mixing a compile error, which is the actual source of engineering-software bugs.

**Bad.** Every conversion in and out must be explicit, and feet-inch-fraction parsing and formatting is real work in `units`. Fractions that are not exact in thousandths (a third of an inch) round at entry, and the rounding must be visible rather than silent.

**Two rules that follow, and that a first implementation will get wrong.**

1. **Distributed quantities are allocated, not divided.** Three gaps across a 96 in. beam holding two 40 in. pallets is 16,000 mil over 3, which does not divide. Dividing and rounding gives three 5,333-mil gaps that sum to 95.999 in. — and printed as feet-inch-sixteenths, three gaps of `5 5/16"` plus two 40 in. pallets read as **95 15/16 in. on a 96 in. beam**. Dimension strings that do not add up to the overall are the first thing a drafter or a plan checker looks for. So the remainder is *spread*, one mil at a time, and the parts sum exactly to the whole. The prototype does this and asserts it.
2. **Rounding is toward zero, not toward positive infinity.** `Math.round(-2500.5)` is `-2500` while `Math.round(2500.5)` is `2501`, so a positive and a negative overhang of equal magnitude would round differently. Overhang is genuinely signed — a pallet shallower than its frame gives a negative overhang, and is a real configuration that raises its own finding — so `Math.trunc` is used and the residual is retained.

**Rejected — Decimal.js:** arbitrary precision solves a problem this system does not have (it needs reproducibility, not unbounded precision) and costs an object allocation per arithmetic operation, which shows up during a drag. **Rejected — rationals:** correct but denominators grow without bound under repeated operations.
