# ADR-003 — One display list, three renderers

**Status:** Accepted · 2026-08-29 · amended 2026-08-30 (see the amendment below)

## Context

Rack Studio must produce a screen canvas, a vector PDF sheet set, and a layered DXF. The naive arrangement writes three independent renderers straight off the derived model, which is how a preview comes to disagree with a plot and a plot comes to disagree with a DXF — the exact complaint verified against CET's DWG export (Xrefs, unexploded blocks, undocumented layer mapping).

## Decision

`sheets` produces a **renderer-neutral display list**: an array of `{ type, points[], layer, pen, text?, style? }`. Screen, PDF and DXF are three backends over that one description. Line weights are modelled as a pen table resolved per backend — device pixels, PDF points, DXF layer lineweight.

## Consequences

**Good.** Divergence between preview, plot and DXF becomes structurally impossible rather than a bug class. Golden tests become text files that diff readably in review and run in Node with no browser; pixel screenshots reduce to a thin top layer. A fourth backend (SVG viewer, plotter) is a new consumer of an existing contract. If the Canvas2D spike fails, only `render-canvas` changes.

**Bad.** An extra indirection between derived geometry and pixels, and a display-list schema to version. Backend-specific richness (DXF dimension entities, PDF form XObjects) needs modelling in the display list rather than reached for ad hoc.

**Bad, and worth being precise about.** "Divergence becomes structurally impossible" is too strong, and the correction matters because the claim is load-bearing. What the display list guarantees is that **the geometry, layers and pen assignments are the same** across all three outputs. It does not guarantee identical *rendering*: pen resolution, text metrics, font substitution and dimension drawing are three independent implementations across two languages (Canvas2D in TypeScript, `ezdxf` and ReportLab in Python). The same repository already documents base-14 font metrics differing between viewers (`00-FINDINGS` §5). The display list makes divergence **narrow, enumerable and testable** — which is the real benefit — rather than impossible. The remaining surface is exactly what the golden display-list tests and the parse-back export tests exist to cover.

## Amendment — 2026-08-30: text entries carry `established`, never a bare string

Added after `docs/07-REVIEW.md` §2.1 found the prototype's elevation printing
`MAX PERMISSIBLE TOP OF STORAGE 25'-2"` while the panel beside it printed `VERIFY` for the
same quantity — one derived from an unsurveyed sprinkler deflector elevation. The kernel was
correct at every step. The renderer called the formatter directly and bypassed the
provenance check that the panel layer applied.

**The generalisation that matters here:** that defect was possible because a *formatted
string* crossed the boundary between the model and the surface that draws it. The display
list is exactly that boundary, three times over — and two of its three backends produce
documents that get stamped by a licensed engineer.

**Decision.** A display-list text entry is **not** a string. It is:

```
{ type: 'text', text: string, established: boolean, quantityId?: EntityId, … }
```

- `established` is computed **once**, in the `sheets` stage, from the quantity's provenance.
- Each backend renders `established: false` in its own idiom — `VERIFY` on screen and in PDF,
  and on a `VERIFY` layer in DXF so it cannot be silently plotted away — but **no backend
  decides**, because a decision made three times is a decision that will eventually be made
  three different ways.
- A backend that receives `established: false` and prints the numeral is a **failing test**,
  not a style choice. One golden fixture holds an unestablished quantity for this purpose.

**Why this is recorded now rather than when the backends are written.** Today it is one
field in a schema that has no implementations. After three backends exist it is three
independent code changes, three test suites, and a period during which one of them is wrong
in the direction that puts an unsurveyed number on a permit drawing. The prototype
demonstrates the cost of getting this wrong on *one* renderer; the display list is where the
same mistake would be made in triplicate.

**Precedent for the enforcement mechanism.** `prototype/lint-provenance.mjs` guards the same
invariant in the prototype by failing the build on any `fmtFtIn(q.value)` in the UI layer.
The defect is a *bypassed abstraction*, which is visible only at the call site, so it is
caught by a grep rather than an assertion. The production equivalent is a lint that forbids
constructing a display-list text entry from anything but a `Quantity`.

**Related.** ADR-005 (fixed-point) governs the value; this governs whether the value may be
shown at all. `docs/07-REVIEW.md` §2.4 is the same failure in the model rather than the
renderer, and yields the companion rule: **every limit in a provenance walker must fail
toward `VERIFY`.**
