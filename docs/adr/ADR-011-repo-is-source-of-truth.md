# ADR-011 — The repository is the single source of truth; the v1 artifact is findings only

**Status:** Accepted · 2026-08-30
**Decides:** the divergence recorded in `docs/06-STATUS.md` §2
**Supersedes:** nothing. **Amends:** `docs/06-STATUS.md` §2 and §6.1

---

## Context

A published artifact titled **RACK STUDIO v1** existed ahead of the repository. Verified by
inspection of its rendered screen, it carried a PLAN / ELEVATION / **SHEETS** tab bar, a
project header, selectable bays and aisles, a live screening panel counting 36 bays and 576
pallet positions, and the ADR-009 status vocabulary rendered as real finding states with
SECONDARY escalation visible on the truck aisle check.

None of that existed on disk. There was no `archive/v0-foundation`, no tag, and no commit
containing an entity graph, sheets, or the 105-assertion kernel the artifact was said to
have. The v1 rework lived only inside the published artifact.

Two options were recorded:

- **(a)** Export the artifact's HTML into `prototype/` as v1, tag the current tree
  `v0-foundation`, and rewrite Task 1.3 and impact assessment §1.2 to reflect what v1
  already models.
- **(b)** Declare the artifact a throwaway exploration, keep the repo as the source of
  truth, and carry forward only the findings.

`06-STATUS.md` §2 said (a) was the honest option **if v1's kernel is tested**, and (b)
correct if it is not.

## Decision

**Option (b).** The repository is the single source of truth. The v1 artifact is a design
exploration whose *findings* are carried forward as requirements. Its code is not imported,
and its existence no longer blocks anything.

## Why

Three reasons, in order of weight.

**1. The claim that v1's kernel is tested cannot be verified, and the recovery is
unbounded.** Three routes to recover the HTML were tried and all failed: the artifact-read
tool is blocked by this environment's network allowlist; the frame origin serves only a 7 KB
loader shell without the session's auth; the device artifact store does not hold it. The
"105 assertions" figure comes from a description of the artifact, not from running anything.
The condition §2 set for choosing (a) — *if v1's kernel is tested* — is therefore not
merely unmet, it is unmeasurable from here.

**2. A screen cannot distinguish a sound provenance model from a leaking one. This is now
demonstrated, not asserted.** The independent review in `docs/07-REVIEW.md` found that the
repo prototype printed `MAX PERMISSIBLE TOP OF STORAGE 25'-2"` on its elevation while the
panel beside it printed `VERIFY` for the same quantity, derived from an unsurveyed deflector
elevation. Every check, badge, citation and counter on that screen was correct. The kernel
was correct at every step. The renderer bypassed it.

A second defect (§2.4 of the same review) had `isUnknown` returning `false` — meaning
*established* — for any chain deeper than eight derivations, so an unsurveyed datum nine
levels down would print as a number.

**The entire body of evidence for v1 is a description of its screen**: tab bars, headers,
counters, badges, escalation states. That is precisely the class of evidence that both of
these defects passed cleanly. Adopting v1 on the strength of it would mean importing an
untested kernel on the recommendation of the one signal proven unable to detect the failure
mode this product exists to prevent.

**3. The rebuild cost is bounded and already specified; the recovery cost is not.** What v1
appeared to model is written down independently of it — the entity graph in ADR-008 and Task
1.3, the sheet set in Phase 8, selection in Phase 3, the status vocabulary in ADR-009. None
of that is lost by discarding the artifact, because none of it originated there. What would
be lost is an implementation nobody can run, review, or test.

## What is carried forward

The artifact's findings become requirements against the existing plan. They are its real
contribution and they survive intact.

| Finding from v1 | Where it lands |
|---|---|
| A third **SHEETS** tab alongside PLAN and ELEVATION | Phase 8 (sheet set); the repo prototype's Sheet tab already prototypes the title block |
| Project header — job number, client, site | Task 1.3 `Project` entity; already in the prototype's title block |
| Selectable bays and aisles | Phase 3 (selection and hit-testing) |
| A live screening panel with counts by status | Task 1.8, extended in Phase 6 |
| `NOT QUOTE-READY` badge — a project-level gate derived from findings | **New requirement.** Recorded below as R-v1-1 |
| Counters split into *failing* / *awaiting input* / *awaiting source* | **New requirement.** Recorded below as R-v1-2 |
| SECONDARY escalation visible on the finding itself | Already implemented in the repo prototype and tested |

Two of these are genuinely new and are the reason this ADR is worth writing rather than
simply deleting the artifact:

**R-v1-1 — a project-level readiness gate.** Findings today are reported individually. v1
aggregated them into a single publishable state (`NOT QUOTE-READY`). That is the correct
shape for the Phase 11 publish gate, which must refuse to publish over a Blocking finding.
Lands in Phase 11, and the badge lands in Task 1.8.

**R-v1-2 — separate "awaiting input" from "awaiting source".** v1 showed *5 failing · 7
awaiting input · 17 awaiting source*. The repo prototype collapses the latter two into
`VERIFY`. ADR-009 already distinguishes `Missing Input` from `Engineering Review Required`,
and impact assessment §7 item 2 already flags the conflation as a defect to fix: *"separating
'an input is missing' from 'a citation is unverified' — currently both collapse to VERIFY"*.
v1's counters make the case numerically: the authority data, not the geometry, is the work.
Lands with ADR-009 adoption in Phase 6, and `docs/07-REVIEW.md` §4.2 item 2 makes it the
second-highest UI priority.

## Consequences

**Good.** `tasks/todo.md` becomes a truthful description of what remains — §2 correctly
noted it was not. No session will re-do work believing it exists, nor skip work believing it
is done. Nothing is blocked on a network allowlist change. Every claim about what the system
does is now backed by something runnable: 69 assertions, a provenance lint, and a
self-testing UI audit.

**Bad.** If v1's kernel really did contain 105 sound assertions and a working entity graph,
that work is discarded. This is accepted knowingly. The specification survives; only an
unverifiable implementation is lost, and Task 1.3 was always going to write it.

**Neutral.** The current tree is tagged `v0-foundation` so the pre-Phase-1 state stays
addressable — the one part of option (a) worth keeping regardless of which option is chosen.

## Rejected alternatives

**Option (a) — import the artifact as v1.** Rejected: its central precondition ("if v1's
kernel is tested") cannot be established, the HTML cannot be recovered without an
environment change, and the only available evidence is the screen-level description that
§2.1 and §2.4 of the review proved insufficient.

**Wait for the allowlist change, then decide.** Rejected: it blocks Phase 1 on an
environment setting for an artifact that would still need a full review after arriving.
Q2 and Q5 outreach is the real critical path, not this.

**Keep both, reconcile later.** Rejected: two sources of truth is the condition that made
`tasks/todo.md` untruthful. Deferring the decision preserves the exact harm the decision
removes.
