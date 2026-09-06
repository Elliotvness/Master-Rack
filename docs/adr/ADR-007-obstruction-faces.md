# ADR-007 — Obstruction faces generalize the aisle datum

**Status:** Accepted · 2026-08-30 · implementation strategy fixed by the Task 0.4 benchmark
**Amends:** ADR-006 (one aisle datum). Does not reverse it.

## Context

ADR-006 established that every aisle requirement is checked against the clear width between load faces, never frame-to-frame, and that the truck's requirement is checked the same way as the fire code's — the reference set says so on R-102: *"TRUCK Ast SHALL BE CHECKED AGAINST 2550, NOT AGAINST 2700."*

It was written when the model contained exactly two things that could bound an aisle: two opposing pallet faces. `derive` computes `clear = frameToFrame − overhang − overhang` and that is the whole story.

The nine-feature request introduces walls, building columns, column guards, K-brace exclusion zones, dock barriers, rack-end protectors, fixed equipment and user-defined no-rack zones. Any of these can be the nearest thing bounding an aisle, and several are routinely nearer than the pallet face — a column guard projecting into an aisle is the classic case, and it is exactly the condition that gets missed.

## Decision

Generalize the datum. An aisle's actual clear width is the distance between the **nearest two operational obstruction faces**, where an obstruction face is any of:

- rack upright face
- pallet / load overhang face
- rack-end protector
- column guard envelope
- K-brace clearance envelope
- wall face
- dock barrier
- fixed equipment
- defined no-rack or clearance zone boundary

`derive` gains an obstruction-face registry. `clear = frameToFrame − 2 × overhang` becomes one case of `minClearance(from, among)` — the case where the two nearest faces happen to be opposing pallet overhangs.

The requirement side is unchanged:

```
required_clear_aisle = max( forklift_manufacturer_AST,
                            project_site_minimum,
                            applicable_AHJ_or_fire_constraint,
                            project_safety_allowance )
```

All four operands are clear-width requirements, so `max()` remains meaningful — which was ADR-006's actual point, and it survives intact.

Every aisle reports: aisle id · selected forklift · required · actual · variance · governing requirement · status.

## Consequences

**Good.** The principle ADR-006 established — measure between the physical things, never between the drawn centrelines — now applies to every obstruction rather than only to pallets. The failure mode it prevents gets larger, not smaller: a guard or brace projecting into an aisle is invisible to a frame-to-frame calculation and invisible to a pallet-face calculation too.

The existing 44 kernel assertions stay valid. They exercise the two-pallet case, which is still a case.

**Bad.** `clear` stops being a cheap subtraction and becomes a spatial query, which is why `geom` becomes its own module and why Phase 0 gains a clearance-query benchmark. Obstruction faces must be registered by every object type that can produce one, and forgetting to register one produces a silently optimistic aisle — so face registration is a property of the object type, asserted in tests, not something a developer remembers to call.

**Note.** The obstruction list is data, not a hard-coded enum in the checker. Adding a new obstructing object type must not require editing the aisle check.

## Implementation decision — added 2026-08-30, from the Task 0.4 benchmark

The "spatial query" above is now measured, and the measurement settles how it must be built.

On a 6,304-face scene (2,000 bays, 60 columns with guards, 12 doors, closed perimeter, 4 no-rack zones):

| | p95 |
|---|---:|
| full-scene sweep, brute force | 63.79 ms |
| full-scene sweep, span-bucketed index | 1.34 ms |
| index rebuild, full | 1.87 ms |

**Decision: the precomputed candidate-set index is required, not optional.** Faces are bucketed by (axis, normal, span bucket) with each bucket sorted by coordinate; a query walks only the buckets its span touches and binary-searches forward from its own coordinate.

The reason to write this down as a requirement rather than leave it as an optimization: a single-aisle query is cheap either way (0.21 ms brute force), so a naive implementation passes the Phase 1 vertical slice and the Phase 3 canvas work without complaint. It fails only when the Screening tab sweeps every aisle, door, dock and turning zone on an edit — Task 6.1's input-set-hashed re-run — by which point the stall looks like a rendering problem and is expensive to trace back to here.

Rebuild is cheap enough (1.87 ms) that incremental invalidation is **not** built for v1. Sweep plus full rebuild is 3.2 ms against a 16.7 ms frame.

Evidence: `spikes/clearance-query/bench.mjs`, findings in the same directory.
