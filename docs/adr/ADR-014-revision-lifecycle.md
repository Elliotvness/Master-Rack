# ADR-014 — The revision lifecycle, and what each state claims

**Status:** Accepted · 2026-08-31 · decided by the product owner
**Supersedes in part:** [ADR-009](ADR-009-status-vocabulary.md) — the *Blocks Valid for Quote*
column, and the sentence naming `Waived with approval` as the only status that does not block.
**Tracked as:** RS-072. Bears directly on [ADR-013](ADR-013-identity-and-authorization.md) items
5, 6 and 7.

## Context

A revision had two states in the implementation — `DRAFT` and `PUBLISHED` — and one gate,
**Valid for Quote**, whose conditions came from the product specification. Both were wrong in the
same way, and the way is this project's recurring failure mode: **they claimed more than the
software can support.**

*Valid for Quote* asserts fitness to quote. Rack Studio cannot assess that. It can assess whether
its own inputs are present and its own checks have run. Everything else — whether a beam is
adequate, whether a flue satisfies the AHJ, whether a stamp will be given — is somebody else's
judgement, and naming the state after the outcome invites a reader to think the software reached
it.

*Published* was worse, because the word is doing work in every reader's head before they get to
the definition. A published revision is frozen. It is not approved, not checked by a PE, not
accepted by an AHJ. Nothing in the old model said so.

There was also a live deadlock. The publish gate blocked on `ENGINEERING_REVIEW_REQUIRED`, because
publishing implied soundness and nobody had decided who may waive one (ADR-013 item 6). But an
`ENGINEERING_REVIEW_REQUIRED` finding is by definition resolved *outside* this system — and the
revision could not be frozen and sent out for the very review that would resolve it. The gate
prevented the thing that closes it.

## Decision

**A lifecycle state, plus an orthogonal review flag.**

| State | What it claims — and only this |
|---|---|
| **Draft** | An editable working configuration. |
| **Documentation Ready** | Required Rack Studio inputs and internal checks are complete; documents may be generated. |
| **Exported for External Review** | A dated, revision-pinned package was generated for outside review. |
| **Published Revision** | The configuration and documents are frozen. **Not** externally approved. |

**Review Required** is a *flag*, not a state: one or more findings require external manufacturer,
PE, fire-protection, AHJ or customer review. It is derived from the validation run and is
orthogonal to the lifecycle, because a revision can perfectly well have complete internal inputs
*and* carry a finding only an engineer can close. Forcing those into one status would hide
whichever fact lost.

**External Approval Recorded** is optional metadata that an external approval, stamp or document
was received. **Rack Studio does not independently validate it.** It attaches to a revision as a
separate record rather than mutating one, because a published revision is immutable and recording
someone else's approval must not be the exception that breaks that.

### Which findings block which thing

This is the whole of the change, and it follows from the state definitions rather than from
judgement:

| Severity | Blocks Documentation Ready | Why |
|---|---|---|
| Pass · Information · Warning | no | |
| **Blocking** | **yes** | An internal check *failed*. "Internal checks complete" is not true. |
| **Missing Input** | **yes** | A required input is absent. "Required inputs complete" is not true. |
| **Engineering Review Required** | **no — raises Review Required** | It is by definition *external* review. Rack Studio's own inputs and checks can be complete while it stands. |
| **Waived with approval** | no | Unchanged. |

A planning-default forklift value still blocks, because it is an input-completeness problem: no
manufacturer AST is established, and a planning value must never be treated as one.

### Transitions

```
Draft ──markDocumentationReady──► Documentation Ready ──export──► Exported for External Review
  ▲                                      │                                 │
  │                                      └──────────publish────────────────┤
  └──── any edit resets to Draft ◄───────────────────────────────┐         ▼
                                                                 │   Published Revision
       Published ──cloneToDraft──► Draft (revision n+1)  ─────────┘         │
                                                                            ▼
                                                          External Approval Recorded (metadata)
```

**Any edit returns a revision to Draft** and discards an export record. The validation and BOM runs
were for a different document the moment the document changed, and a state that outlived its
evidence is the thing the revision hash exists to prevent.

## Consequences

**It dissolves the ADR-013 item 6 deadlock without answering item 6.** Under the old model a
waiver was the only route past an `ENGINEERING_REVIEW_REQUIRED` finding to a stamped drawing, so
waiver authority gated real use of the product. It no longer does: an engineering-review finding
travels *with* the frozen package, printed on it, to the person who resolves it. `Waived with
approval` stops being a key that unlocks a gate and becomes what its name always said — a record
that an external disposition came back. Item 6 still needs the PE, and is now a smaller question.

**It makes the export state necessary rather than decorative.** A dated, revision-pinned package
is the artifact the whole lifecycle points at, and Rack Studio does not produce one yet. That is
new scope, adjacent to the sheet set (RS-074, RS-075) and the Takeoff adapter (RS-069, gated on
MS-13).

**It costs a word everyone already understood.** *Valid for Quote* was immediately legible;
*Documentation Ready* needs a sentence of explanation. That is the trade being made deliberately:
the legible name was legible because it was making a claim the software cannot support.

**`Published` will still be over-read.** The definition is one line in an ADR and the word carries
decades of other meaning. Every surface that shows the state must show what it claims — the same
treatment `TRAIL_CLAIM` gets for the audit trail. A state whose meaning lives only here is a state
that will be misread on a drawing.

## The term this replaces

`Valid for Quote` → **`Documentation Ready`**, everywhere it names a live gate.

Two documents keep the old term on purpose: `docs/05-IMPACT-ASSESSMENT.md` is a dated rev-3
analysis, and rewriting an analysis to match a later decision destroys the record of what was
known when. Where the old term appears there, it means Documentation Ready.

## Alternatives rejected

| Option | Why not |
|---|---|
| **Keep `Valid for Quote`** | It asserts fitness the software cannot assess. Every other honesty mechanism in this project — `UNKNOWN` origins, `TRAIL_CLAIM`, `MISSING_INPUT` — exists to stop exactly this. |
| **Six linear states, one at a time** | Forces a choice when inputs are complete *and* external review is needed. Whichever wins, the other fact stops being visible, and both matter to a different reader. |
| **Linear, with Review Required outranking Documentation Ready** | Errs cautiously, but hides that the inputs are in fact complete — which is the one thing a designer needs to know to hand the package on. |
| **Keep blocking publication on Engineering Review Required** | Safest-sounding and actively harmful: it prevents freezing and exporting the package whose review resolves the finding. The gate would forbid its own resolution. |
