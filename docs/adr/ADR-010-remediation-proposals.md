# ADR-010 — Remediation proposes, never applies

**Status:** Accepted · 2026-08-30
**Arises from:** the straddle comment — *"adjust the floor plan accordingly if possible / provide a solution to resolve flag error"*

## Context

Findings so far carry `suggestions[]` as text: *"widen the aisle"*, *"select a larger spacer"*. The request is for the app to go further — to compute the actual fix, and where possible to apply it.

That is a real capability and worth having. A straddle that fails by 1½ inches has a determinate answer: shift the row pair, or step up one spacer size, and the tool can compute which. Making the user find that by hand is the kind of drudgery this product exists to remove.

But an engine that quietly widens an aisle to clear a straddle has auto-approved the condition the product exists to flag. ADR-002 says the tool screens and never designs; a fix engine that applies its own output is designing.

## Decision

**Remediation computes a concrete proposal and applies nothing until a person accepts it.**

A `Remediation` carries:

- the finding it resolves
- the exact change — object ids, before and after values, as `Quantity` with provenance
- **every knock-on result**, recomputed: adjacent aisles, pallet positions, BOM delta, and any finding whose status changes in either direction
- what it does *not* fix, if the proposal is partial
- a confidence basis: which rule or catalog record makes this the right size, or an explicit statement that it is geometry only

Accepting is an ordinary audited edit on the draft. It creates an audit event and a revision note naming the rule set and version that produced the proposal, per D8 in the impact assessment. Rejecting records nothing; the finding stands.

**A proposal that cannot be computed is not fabricated.** Where the governing rule or catalog data is absent, the finding stays at Missing Input or Engineering Review Required with no proposal attached. "I don't know how to fix this" is a valid and useful output.

## Consequences

**Good.** The user gets the arithmetic done for them without the tool making decisions in their name. Every applied fix is traceable to a proposal, a rule set and an acceptance. The knock-on recomputation is the valuable part and the part nobody does by hand — a spacer change that fixes a straddle and quietly breaks the aisle on the far side is exactly the failure this catches.

**Bad.** Proposals are expensive: each one is a speculative full recompute of the affected subtree, and a finding may have several. They are computed on demand — when a finding is expanded — not eagerly for every finding on every edit. Ranking competing proposals is a judgement the tool should not make; they are listed with their consequences and ordered by magnitude of change, smallest first, not by preference.

**Rejected — auto-apply reversible geometry-only fixes.** The boundary between "geometry only" and "governed by a rule" is not stable: moving a run is pure geometry until it changes an aisle, which is governed. A rule whose safe cases have to be enumerated is a rule that will eventually be wrong about one.

**Rejected — report only.** It was the smallest scope and it leaves the arithmetic to the user, which is the work the product is supposed to absorb.
