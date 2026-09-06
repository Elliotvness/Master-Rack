# ADR-009 — One status vocabulary

**Status:** Accepted · 2026-08-30 · **amended 2026-08-31 by
[ADR-014](ADR-014-revision-lifecycle.md)**, which renamed the gate this table refers to and
changed one row of it. The seven statuses themselves are unchanged.

## Context

Three vocabularies are in play, and a finding's status is the single most consequential thing the product says:

| Source | Values |
|---|---|
| `docs/03-SPEC.md` §9 | PASS · INFO · WARNING · BLOCKING · MISSING_INPUT · ENGINEERING_REVIEW_REQUIRED · WAIVED_WITH_APPROVAL |
| `prototype/kernel.js` | PASS · FAIL · VERIFY · NOT_APPLICABLE · UNKNOWN |
| Feature request | Pass · Warning · Blocking · Missing Input · Engineering Review Required |

The prototype's `VERIFY` is doing two unrelated jobs: it means "an input has not been established" *and* "the rule is cited from a secondary source." Those need different actions from different people — a site survey versus opening a standard — and collapsing them makes the Screening tab unactionable.

## Decision

Adopt the request's five, plus the two the spec has that the request omits and its own text requires:

| Status | Meaning | Blocks Documentation Ready |
|---|---|---|
| **Pass** | Checked against an established rule with established inputs, and satisfied | no |
| **Information** | Reported, not judged — counts, totals, comparisons | no |
| **Warning** | Below a project target, or a condition needing attention but not resolution | no |
| **Blocking** | A requirement is not met | **yes** |
| **Missing Input** | An input required to evaluate the check is not established. Names the missing source | **yes** |
| **Engineering Review Required** | The condition is outside an approved case, or the governing rule is unavailable or unverified. Never auto-approved | **no — raises Review Required** (ADR-014) |
| **Waived with approval** | An Engineering Review item with a documented disposition: who, when, on what basis | no |

> **What ADR-014 changed here, and why.** The column was *Blocks Valid for Quote*; that gate is
> now **Documentation Ready**, which claims only that Rack Studio's own inputs and checks are
> complete. `Engineering Review Required` therefore stops blocking it: the review is by definition
> external, so it cannot make an *internal* completeness statement false. It raises the orthogonal
> **Review Required** flag instead, and travels with the exported package to whoever resolves it.
>
> This also changes what `Waived with approval` is *for*. It was the only route past an engineering
> -review finding to a stamped drawing, which made waiver authority (ADR-013 item 6) a gate on
> using the product at all. It is now what its name says: a record that an external disposition
> came back.

**`Waived with approval` is no longer the only status that does not block** — ADR-014 moved
`Engineering Review Required` alongside it. The two are not equivalent: an engineering-review
finding is *unresolved and visible*, a waived one is *resolved by someone named*.

`Information` is retained because the request's own Phase 10 defines an Information group. `Waived with approval` is retained because the request's own Phase 11 requires Engineering-Review items to have "documented disposition" — that disposition needs a state.

**Mapping from the prototype:**

| Prototype | Becomes |
|---|---|
| `PASS` | Pass |
| `FAIL` | Blocking |
| `VERIFY` caused by an unresolved input | **Missing Input** |
| `VERIFY` caused by a `SECONDARY` citation | **Engineering Review Required** |
| `NOT_APPLICABLE` | Information, with the applicability condition shown |
| `UNKNOWN` | Missing Input |

The prototype already records which cause applied — `finding.unresolved` and `finding.secondary` — so the split is mechanical, not a re-judgement.

## Consequences

**Good.** Each status maps to a distinct action by a distinct person: fix the layout · survey the site · open the standard · get an engineer's disposition. The Screening tab becomes a work list.

Two invariants carry over from the prototype and must hold: escalation never softens a Blocking, and a rule cited `SECONDARY` can never produce a clean Pass.

**Bad.** Seven statuses is more than a colour scale carries comfortably. The UI groups them three ways — Blocking · Warning · Information — with Missing Input and Engineering Review Required rendered inside Blocking until disposed, and Waived shown under Information with its approver. Seven states, three groups.

**Note.** `Waived with approval` records that a human accepted a condition. It does not convert the underlying finding to Pass, and the original status stays visible on the sheet and in the audit trail.
