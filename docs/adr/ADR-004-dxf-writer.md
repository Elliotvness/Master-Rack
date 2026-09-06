# ADR-004 — DXF writer: ezdxf primary, spike Pyodide, JS writer as fallback

**Status:** Proposed, pending spike · 2026-08-29
**Deferred 2026-08-30 by EL** — the AutoCAD LT fidelity spike (Task 0.2) moves to the end of the programme. It gates only Phase 10 export; nothing in Phases 1–8 depends on it, and it needs a licensed AutoCAD LT 2025 seat and a named human sign-off that cannot be automated. This ADR stays **Proposed** until then, and no code may assume a writer.
**Blocks:** success criterion S3

## Context

Verified by downloading and inspecting the published tarballs:

- **`@tarikjabiri/dxf` 2.8.9** (last release Jul 2023; the v3 rewrite stalled at alpha Aug 2024). Emits AC1021 / R2007, not configurable. Entity support is broad — LWPOLYLINE, MTEXT, BLOCK/INSERT, HATCH with boundary paths, and an unusually complete DIMENSION set. **But `grep -ci lineweight` on its type definitions returns 0** — no group code 370 on layers or entities. And while `Dimension` has a `blockName?` field, the library does not appear to generate the anonymous `*D<n>` graphics block, so dimensions may not render outside applications that regenerate them.
- **`ezdxf` 1.4.4** ships a genuine pure-Python wheel (`py3-none-any`, 1.33 MB). Dependencies are `pyparsing`, `numpy`, `fontTools`, `typing_extensions` — NumPy is in Pyodide (2.4.6) and the rest are pure-Python wheels micropip can fetch. It supports R12→R2018, writes proper dimension blocks through its rendering layer, and handles paper-space layouts and viewports properly.

**No published example of ezdxf running under Pyodide was found.** Structurally it should work; empirically it is unverified.

AutoCAD LT 2025 opens every DXF version from R12 to R2018, so there is no compatibility reason to target R2018. R2007 is a good default: UTF-8 native, true colour and lineweights, old enough for every downstream tool in a fitout supply chain.

## Decision

1. **Primary: `ezdxf` in Rack Engine**, targeting R2007 (AC1021).
2. **Week-one spike: ezdxf under Pyodide** (~1 hour). If it works, export can be fully client-side and offline. If not, export runs server-side; either way the Python is the same.
3. **Fallback: `@tarikjabiri/dxf`, vendored**, behind a thin swappable writer interface. Assume ownership — it is MIT and feature-frozen. Patch lineweight in by post-processing group code 370 into the LAYER table; DXF is plain text and this is roughly thirty lines.
4. **Test protocol, non-negotiable.** Every exported file opens in genuine AutoCAD LT 2025 — not a viewer, not a converter — before each release. Check: layers with correct colours and lineweights; closed LWPOLYLINE geometry; MTEXT not mojibake; INSERT scaling; **dimensions displaying and re-measuring correctly after `REGEN`**; bounded hatches; paper-space layout at the correct sheet size. Automated in CI as far as it goes: parse back with the `dxf` package for structural assertions, plus `ezdxf.readfile().audit()` as a second opinion.

## Consequences

**Good.** The highest-risk output gets the most rigorous available implementation, and the risk is discovered in week one rather than at the first permit submittal.

**Bad.** Either a deployed service or a multi-megabyte Pyodide runtime with a multi-second cold start on first export. The writer interface adds an abstraction whose only justification is that the primary choice might be unavailable.

**Note.** `export-dxf` is scheduled *before* `export-pdf` in the build order, against instinct, precisely because it carries this risk and is the higher-frequency daily deliverable.
