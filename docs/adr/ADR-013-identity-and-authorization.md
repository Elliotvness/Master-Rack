# ADR-013 — The audit actor and authorization model

**Status:** **PROPOSED — item 1 decided 2026-08-30; items 2–8 still awaiting a product-owner
decision** and, for items 5–7, the stamping engineer. Not accepted.
**Tracked as:** RS-111 in `tasks/backlog.md`. Gates RS-114, RS-115.
**Arises from:** audit finding F-17 and Open Question 12 — *"the largest genuine gap the audit
found in the requirements themselves, as distinct from the implementation."*

> **This document is still mostly a question.** Item 1 now carries a decision; items 2–8 are
> blank on purpose. `tools/check-coverage.mjs` asserts all eight questions are asked here; once
> this ADR is accepted, it asserts none of them is still blank — so it cannot be accepted while
> seven of them are open.

## Context

Three features already depend on an answer no note contains.

- **ADR-009** defines `Waived with approval` — the one status that does not block Valid for
  Quote. It implies an approver.
- **`docs/05-IMPACT-ASSESSMENT.md` §3.1** specifies an audit event as `{ at, actor, kind, before,
  after }`. It implies an actor.
- **RS-072**, the Documentation Ready gate, implies someone authorised to publish.

Meanwhile `docs/03-SPEC.md` §0 assumption 5 says single-tenant, McMurray Stern's own designers,
with no login anywhere in the architecture. So `actor` currently has no definition at all, and
whoever implements RS-070 first will define it by accident — probably as a string, probably
whatever was convenient.

**Why this matters more than it looks.** This project's discipline is that a number carries its
origin. An audit event is the same claim about an *action*: it asserts who did something. If the
identity behind it is self-asserted and the trail does not say so, the system is making a
stronger claim than it can support — which is the failure mode ADR-002 and the provenance model
exist to prevent, appearing in a place nobody has checked.

**A self-asserted name is a legitimate answer for a single-tenant tool.** It is not a legitimate
*accident*.

---

## The eight questions

### 1. Users

Where does identity come from with no server and no login? OS user · a name typed once into
project settings · workstation identity · a real directory.

> **Answer:** **Workstation identity.** Decided by the product owner, 2026-08-30. The `actor` on
> an audit event is the identity of the machine the action was recorded on, supplied by the
> desktop application ADR-012 item 1 selects.
>
> One cost this option carried has just been spent rather than left latent. The alternatives table
> below lists *"couples the model to the deployment target ADR-012 has not chosen"* against this
> option; ADR-012 item 1 has now chosen a desktop application, which is a target that has a
> workstation to be identified by. The coupling is real, and it is now a coupling to a decision
> that exists.
>
> **What this does not do, stated plainly because the rest of the system states it about
> numbers.** Workstation identity is not authentication and it does not name a person. It records
> which machine an action was recorded on. On a shared workstation — the case this ADR's own
> alternatives table names as defeating it — it cannot tell two designers apart, and no later
> processing recovers what was never captured.
>
> **This makes item 6 harder, not easier, and item 6 is still open.** Waiver authority is the
> mechanism by which a known-unresolved item reaches a stamped document. Whoever answers item 6
> has to answer it knowing the trail underneath will name a machine, not a person — so *"only the
> stamping PE may waive"* would be a rule this identity model cannot itself enforce or evidence.
> That is a question for the PE conversation (RS-005, RS-013), not one to settle here.

### 2. Service accounts

Whether any machine identity holds credentials of its own — a build agent stamping a release, a
scheduled job, an installer. Distinct from item 3: this is an identity *something could
authenticate as*. **"None in v1" is a good answer** if true; it keeps the model small.

> **Answer:**

### 3. Automated processes

RS-107 requires every engine-initiated change to record its cause. Is the engine an `actor`
alongside people, or a separate field? A rule set that inserts a tunnel is not a user, and
conflating the two makes the trail unreadable at the moment someone asks who put that tunnel
there.

> **Answer:**

### 4. API clients

Whether any exist in v1. If Rack Engine is a subprocess rather than an HTTP service (ADR-012
item 9), the answer may be *none* — record it either way.

> **Answer:**

### 5. Approvals

What an approval *is*: a name · a name and a date · a signature · a countersigned record. Q6
(RS-005) asks the same question from the drawing's side — whether it must appear on the sheet
set.

> **Answer:**

### 6. Waiver authority

Who may waive an `Engineering Review Required` finding. **The highest-consequence question here.**
A waiver is the mechanism by which a known-unresolved item reaches a stamped document. *"Anyone
using the tool"* is an answer with real consequences, and needs to be chosen rather than defaulted
into.

> **Answer:**

### 7. Publish-gate authorization

Whether Documentation Ready requires a role distinct from the designer's, and whether a designer may
publish their own work.

> **Answer:**

### 8. Multi-tenancy compatibility

Spec §0 requires v1 not to *preclude* multi-tenant. The identity model is the single design most
likely to preclude it. What would it cost to change later?

> **Answer:**

---

## The sentence this ADR must contain

Whatever is decided, the ADR is not finished until it states, in one sentence a PE would accept:

> **What an audit trail from this system does and does not prove.**

For a self-asserted identity the honest answer is narrow — it records what the software was told,
not who was at the keyboard. Writing that down is what stops a reader over-reading it later, and
it is the same discipline the rest of the system applies to a number whose origin is `UNKNOWN`.

**Half of that sentence is now writable, and it is narrow as predicted.** Given item 1: *an audit
trail from this system proves which workstation a change was recorded on, and when. It does not
prove who was at the keyboard.* The sentence is not finished — items 5, 6 and 7 decide what an
approval is, who may waive, and who may publish, and each of those adds a clause. It is recorded
in this half-written state on purpose, so that nobody implementing RS-070 in the meantime reads
`actor` as a person.

## Alternatives, for whoever decides

| Option | Answers well | Costs |
|---|---|---|
| **Self-asserted name in project settings** | Zero infrastructure; matches single-tenant reality; honest if labelled | Proves nothing about who acted. Every waiver and publish inherits that weakness, so the UI has to say so at the point of waiving |
| **OS / workstation identity** | Free, harder to mistype, plausible in a managed environment | Still not authentication; a shared workstation defeats it; couples the model to the deployment target ADR-012 has not chosen |
| **A real directory (SSO/LDAP)** | Actually proves identity; makes roles and waiver authority enforceable rather than advisory | Needs a server, which `docs/04-ARCHITECTURE.md` §11 excludes from v1; disproportionate for one team |

**A note on sequencing.** Items 2 and 4 depend on ADR-012 item 9 — if Rack Engine is a subprocess,
both may be *none*. Deciding ADR-012 first makes this ADR shorter, but the two are not blocked on
each other and item 6 does not wait for anything.

## Consequences once decided

- RS-114 implements the `Actor` type across items 1–4, and enforces items 6 and 7 at the single
  point each is decided.
- RS-115 renders items 5 and 6 on the sheet set, closing Q6 on the drawing.
- RS-070, RS-072 and RS-107 stop assuming an undefined `actor`.
- This ADR moves to **Accepted**, and `check-coverage.mjs` begins asserting no answer is blank.

## Decision log

| Date | Item | Decision | Decided by |
|---|---|---|---|
| 2026-08-30 | 1 — users | Workstation identity, supplied by the desktop application (ADR-012 item 1) | Product owner |

Items 2–8 remain open, so RS-111 stays blocked and this ADR stays **PROPOSED**. Items 5, 6 and 7
still need the stamping PE — the same conversation as RS-005 and RS-013 — and item 6 is the one
this decision has made more consequential rather than less.
