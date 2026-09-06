# ADR-019 — Confidence badges are display-list items, not canvas decoration

**Status:** Accepted · 2026-09-05
**Depends on:** [ADR-003](ADR-003-display-list.md), [ADR-009](ADR-009-status-vocabulary.md),
[ADR-002](ADR-002-screening-not-design.md)

## Context

The 2026-09-05 brief asks for confidence and status indicators on the plan: badges anchored to
entities, showing states from Verified through Unknown to Blocked, with an overflow count
(`× BLOCKED +2`, `! REVIEW +4`) and a click that opens the linked findings.

The tempting implementation is a canvas overlay that reads the findings array and draws chips. It
would work on screen and fail everywhere else: the badge would not exist in the SVG, the PDF or the
DXF, so a printed sheet would show a rack with no indication that three of its inputs are
unestablished. That is the same class of defect ADR-003's amendment records — a formatted string
crossing the model/renderer boundary and bypassing the check the panel layer applied — and it is
worse here, because the thing being dropped is the warning.

There is a second trap in the word "confidence." The brief's states include **Verified**. In this
product that must mean *supporting source information is recorded* and nothing else. It may never
be read as reviewed, engineered, or approved (ADR-002).

## Decision

**Badge state is derived in the display list, from findings, and drawn by every backend.**

1. **One derivation, in the display-list layer.** `buildPlan` emits badge items alongside geometry.
   Canvas, SVG and PDF consume the same items. No renderer computes a badge state.
2. **Badge state derives from ADR-009's seven statuses**, not from a parallel vocabulary. The
   brief's states map onto them; where the brief has a state ADR-009 does not (`Issued revision`),
   it is a **document-level** state and is not an entity badge.
3. **Most severe wins, with a count.** One badge per entity at overview zoom, carrying the most
   severe status and the number of further findings. The count is the length of the finding list
   for that entity, never a separate tally that can drift.
4. **Screen-space anchoring, world-space owner.** The badge item carries the entity id and its
   world anchor point; the renderer places it in screen space so it stays legible at any zoom. The
   anchor is model data; the offset is not.
5. **Never colour alone** (brief §14, and WCAG). Every badge carries a text label and a shape or
   pattern. Exports carry the same labels plus a legend and the finding ids, so a printed sheet is
   readable in monochrome.
6. **The DOM findings panel is the equal source, not a fallback.** Everything a badge conveys is
   available to a keyboard user in `apps/studio-web`'s findings panel, from the same derived data.
7. **`Verified` is defined in the legend, on every export, as "source information recorded."** The
   words *engineered*, *approved*, *certified*, *compliant* and *PE* never appear as a badge state.
   `check-language` already polices this vocabulary and gains these terms.

## Consequences

**Good.** A badge cannot exist on screen and be absent from the plot, because the plot reads the
same list. The golden display-list tests cover badges for free — they are text entries in a file
that diffs readably.

**Good.** Rule 3 means the badge and the findings panel cannot disagree about how many problems an
entity has, which is the bug this shape usually ships with.

**Bad.** The display list grows a concern that is arguably presentation, and ADR-003's schema gains
a version. A reader may reasonably say badges are not geometry. The answer is that they are
*derived assertions about geometry*, and the alternative puts them somewhere that does not print.

**Bad.** Rule 1 costs a full display-list rebuild when a finding's status changes — an override
acknowledged, a survey value entered. At 300 bays that is a measurable rebuild for a state change
that touches one chip. If profiling shows it, the fix is a narrower rebuild, not a renderer-side
badge cache.

**Bad, and worth naming.** Seven statuses plus an overflow count is a lot of vocabulary for a
sales-facing screen, and the pressure will be to collapse it to a traffic light. Collapsing
`Missing Input` into `Blocking` in particular would misreport an unsurveyed value as a layout
failure — which is exactly defect **D-F** in the as-built prototype, where an aisle was reported
Blocking by 5/16 in. against a truck width the page itself printed as VERIFY.
