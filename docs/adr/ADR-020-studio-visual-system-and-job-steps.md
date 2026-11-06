# ADR-020 — Studio visual system: the blueprint palette, and navigation by job step

**Status:** Accepted · 2026-11-06 (product owner, Elliott Villacorta)
**Depends on:** [ADR-002](ADR-002-screening-not-design.md), [ADR-016](ADR-016-studio-web-delivery-track.md),
[ADR-019](ADR-019-confidence-badges.md)
**Supersedes:** the "copied, not chosen" palette stance in `apps/studio-web/src/theme/tokens.css`,
and the tab order pinned in `apps/studio-web/src/nav.ts` as "the artifact's"

## Context

`apps/studio-web` was built to reproduce the published Rack Studio artifact: its navy palette was
copied verbatim and its six tabs (Plan, Elevation, Sheets, Screening, BOM, Revisions) were pinned as
the artifact's order. Two later additions sat beside that rather than inside it:

- A second stylesheet, `industry-blueprint.css`, declared the Project Scout blueprint palette as
  `--color-*` tokens. No contrast check read it, its dark theme keyed on `html.dark` although
  `theme.ts` stamps `data-theme`, and components referenced fifteen token names that neither file
  defined (F-67). The running app on 2026-11-06 rendered in browser defaults where those names were
  used.
- The Facility and Options views (blueprint §15.2 steps 3 and 4) were routed but had no tab, so the
  first two steps of the job were reachable only by typing an address.

On 2026-11-06 the product owner reviewed three full redesign directions on a design canvas
("Rack Master Studio — Redesign Directions": MCS brand, Project Scout blueprint, CAD drafting dark)
and chose **the blueprint direction**.

## Decision

1. **One palette, the blueprint system's, in `tokens.css` only.** Steel-blue accent on neutral
   greys, Barlow / Barlow Condensed / JetBrains Mono, square corners. Every gated contrast pair
   passes in both themes; the two status chips that were below AA (INFO 2.80:1, MISSING 4.02:1) now
   pass and are enforced. One pair stays accepted and pinned: `--ink-3`, placeholder text only.
2. **No other stylesheet declares colour, and every referenced token exists.** Enforced by
   `tokens.test.ts` (F-67), proven by planting both failures.
3. **Navigation follows the job, not the artifact.** The header carries the job; a step bar beneath
   it runs Facility → Options → Layout → Takeoff → Sheets → Review & submit. Plan and Elevation are
   two views of the Layout step; Screening findings appear beside the selection and in a checks
   drawer, with the full list still at `/screening`; Revisions becomes Review & submit.
4. **The screening notice stays on every view, in full, and is not dismissible** — ADR-002 is not
   reopened. The redesign makes it compact, not optional.

## Consequences

- The "artifact is the design of record" justification no longer applies to colour or tab order.
  The artifact's element ids are kept where tests address them, so the prototype interaction checks
  still find their targets.
- The canvas pens follow the new palette through `readPens`; its fallbacks are pinned to
  `tokens.css` by `plan/use-pens.test.ts`.
- Not decided here, and not done by this redesign: the defects seen in the running app on
  2026-11-06 — a BLOCKING finding reading "126″ vs required 126″", BOM lines listed three times,
  lengths shown in micrometres, and 26 frames in the takeoff against 78 priced. Each is a separate
  finding, not a styling change.
