# ADR-002 — Rack Studio performs screening, never structural design

**Status:** Accepted · 2026-08-29 · reaffirmed 2026-08-30

## Context

ANSI MH16.1-2021/2023 replaced the Effective Length Method with the **Direct Analysis Method** — notional loads for fabrication and installation imperfections, and reduced member stiffnesses for yielding, in place of an effective-length factor. DAM effectively requires second-order analysis, and frame capacity tables alone are no longer sufficient. This much is established from RMI's own published account of the change.

Two things are *not* established and are stated here as open, because this ADR is the document that gets quoted:

- **Which edition applies where.** IBC 2024 is reported to adopt MH16.1-2021, but the City of Fresno's 2026 submittal sheet instructs designers to use MH16.1:2023 and MH16.3:2025, and which edition the 2025 CBC Chapter 35 adopts could not be verified. This is exactly why the edition is a rule-pack field (concept §5.4).
- **The specific K values.** A change from K = 1.7 to K = 1.0 down-aisle appears in secondary accounts; the only K this project's research could source to a document is LADBS requiring K = 1.7 under the 2012 numbering. The DAM change stands; the K substitution is not cited here.

Meanwhile every California AHJ reviewed requires a California-licensed engineer's stamp on every sheet of both the drawings and the calculations.

There is commercial pressure to claim more: OneRack advertises "ANSI MH16.1 built in, FEA runs automatically."

## Decision

Rack Studio performs **screening only**:

- geometry and clearance arithmetic
- code-required plan content assembly
- published-capacity table lookups
- ratio and threshold flags (H/D, permit height, high-piled trigger)
- plaque values and anchor schedules

It never claims MH16.1 compliance, never emits anything shaped like a stamped calculation, and never pre-fills a stamp block. Every sheet carries a delegated-design note in the manner of the reference PDF's R-001.

## Consequences

**Good.** The output is something a PE will accept as an input rather than reject as a usurpation. It avoids the fastest known route to a plan-check rejection traced to the tool, which would be terminal for adoption. It keeps the product honest about a boundary it genuinely cannot cross in a browser.

**Bad.** It cedes the "we do the engineering" claim to OneRack, which has PEs on staff. The counter-position is that Rack Studio makes the packet the PE receives so complete that the review is fast — which is a different and more defensible sale.

**Open.** §11 open question 5 — ask a stamping PE whether a screening report is useful input before building the report format. If the answer is "I redo it anyway", the effort belongs in sheet assembly instead.
