# ADR-012 — Deployment, environments and release

**Status:** **PROPOSED — item 1 decided 2026-08-30; items 2–9 still awaiting a product-owner
decision.** Not accepted.
**Tracked as:** RS-019 in `tasks/backlog.md`. Gates RS-020, RS-104, RS-112, RS-113.
**Arises from:** audit finding F-17 — nothing in the project describes how this is delivered.

> **This document is still mostly a question.** Item 1 now carries a decision; items 2–9 are
> blank on purpose. Filling one in with a plausible guess would put an invented requirement into
> a system whose first rule is never to invent one. `tools/check-coverage.mjs` asserts all nine
> questions are asked here; once this ADR is accepted, it asserts all nine are answered — so it
> cannot be accepted while eight of them are open.

## Context

The architecture rules things out without saying what replaces them. `docs/04-ARCHITECTURE.md` §11
excludes a database and a server in the interaction loop. `docs/03-SPEC.md` §0 assumption 5 says
single-tenant — McMurray Stern's own designers — and that *"multi-tenant SaaS is not designed for
in v1 but must not be architecturally precluded."* `docs/03-SPEC.md` §3 shows Rack Engine as
`uv run rack-engine serve --port 8787`, which reads like a local HTTP service, and ADR-001
forbids an HTTP call inside the interaction loop.

None of that adds up to a delivery mechanism. Phases 9–11 will build against whatever is assumed
first, which is the wrong way to decide it.

**Why this cannot be inferred.** Every candidate is defensible, and each implies a different
answer to the eight questions after it. A static internal bundle makes secrets nearly moot and
rollback trivial, but leaves Rack Engine unreachable without a server. A desktop app answers Rack
Engine cleanly with a subprocess, and makes rollback a schema problem rather than a binary one.
Choosing by convenience would settle the ADR-001 boundary by accident.

---

## The nine questions

### 1. Hosting target

Static bundle on an internal host · Electron/Tauri desktop app · internal web app · something else.

> **Answer:** **A desktop application.** Decided by the product owner, 2026-08-30.
>
> The deciding constraint is the one this ADR already identified as stronger than it first
> appears. Spec §1 names the stamping engineer as the user who decides whether this succeeds, and
> §7 requires every sheet to record which packs produced it. A desktop application is the only
> candidate that makes a designer's file a durable, nameable artifact in a folder the designer
> chose — one a PE can be handed and can open a year later. The static bundle was rejected on
> exactly that point: OPFS persistence is per-browser-profile, so "my file" would live somewhere
> the designer cannot see. The internal web app was rejected because it contradicts
> `docs/04-ARCHITECTURE.md` §11 unless the backend stays strictly at document tempo, and the
> temptation to put one HTTP call in the interaction loop is the whole reason ADR-001 exists.
>
> **Costs accepted, recorded so they are not rediscovered as surprises.** Every workstation needs
> an install and an update path; there are two further build targets; the binaries need code
> signing. Items 2, 3 and 6 are where those costs are actually paid, and all three are still open.
>
> **Electron versus Tauri is deliberately not decided here.** It is a build-and-distribution
> question that belongs with items 2 and 3, and nothing in items 4–9 turns on which one is used.

### 2. Environments

How many, and what distinguishes them. At minimum local development and whatever a designer runs.
Is there a staging tier a PE can review against before a set is issued?

> **Answer:**

### 3. CI/CD or release process

What builds a release, what gates it, who triggers it, how a version is stamped. `pnpm verify`
(RS-015) is the intended gate. Note the reproducibility interaction: spec S6 requires
byte-identical output across machines, so the build must be **pinned**, not merely repeatable.

> **Answer:**

### 4. Secrets and environment variables

Which exist at all. Candidates today are the Rack Engine endpoint and the pack source location.
**"None" is a valid and preferable answer** — record it rather than leaving it open.

> **Answer:**

### 5. Migrations

Schema migrations (RS-025) are forward-only and run on the designer's file, not a database. When
does one run — on open, or on an explicit action? What happens if it fails mid-way on a file
nobody backed up?

> **Answer:**

### 6. Rollback

What a designer does when a release is bad. For a file-based tool the hard part is not the binary:
it is a file already migrated to a schema the previous release cannot read.

> **Answer:**

### 7. Monitoring

What "it broke" looks like when there is no server. Crash reporting, an error log the designer can
send, or nothing — but decided, not defaulted.

> **Answer:**

### 8. Ownership

Who deploys, who is called when a release is bad, who decides to roll back.

> **Answer:**

### 9. The Rack Engine invocation path

How `services/rack-engine` is reached at document tempo **without an HTTP call in the interaction
loop** (ADR-001). This is the one question with an existing architectural constraint, so it is the
one most likely to be violated by a convenient answer.

> **Answer:**

**Constrained by item 1, but not answered by it.** A desktop shell makes a local subprocess
available, which is the path the table below says answers ADR-001 without argument. That is not
the same as having chosen it: `docs/03-SPEC.md` §3 still shows `uv run rack-engine serve --port
8787`, and a desktop shell can spawn that HTTP service just as easily as it can spawn a
subprocess. Whoever answers this item has to say which — and if it is the port, has to say what
keeps it out of the interaction loop. Recording the constraint here is not the same as filling in
the answer, and `check-coverage.mjs` still counts this item as blank.

---

## Alternatives, for whoever decides

Not a recommendation. Recorded so the decision starts from a map rather than a blank page, and so
the rejected options are on file in the manner the other ADRs follow.

| Option | Answers well | Costs |
|---|---|---|
| **Static bundle, internal host** | Simplest release and rollback; no install on any workstation; updates reach everyone at once | Rack Engine needs a server somewhere, or export moves client-side and ADR-004's Pyodide question becomes load-bearing. OPFS persistence is per-browser-profile, so "my file" lives somewhere a designer cannot see |
| **Desktop app (Electron/Tauri)** | Rack Engine as a subprocess answers Q9 cleanly and honours ADR-001 without argument; real files in real folders, which matches how drafters already work | Every workstation needs an install and an update path; two more build targets; code signing |
| **Internal web app with a backend** | Familiar; central packs; a natural home for multi-tenant later | Contradicts `docs/04-ARCHITECTURE.md` §11 unless the backend stays strictly at document tempo. The temptation to put one HTTP call in the interaction loop is the whole reason ADR-001 exists |

**One observation worth weighing.** Spec §1 names the stamping engineer as the user who decides
whether this succeeds, and §7 requires every sheet to record which packs produced it. Whichever
option is chosen has to make a designer's *file* a durable, nameable artifact a PE can be handed
and can open a year later. That is a stronger constraint than it first appears, and it is where
the static-bundle option is weakest.

## Consequences once decided

- RS-112 implements items 2, 3, 6, 7 and 8.
- RS-113 implements item 5, and the rollback half of item 6.
- RS-020 implements item 4.
- RS-078's Rack Engine integration is bounded by item 9.
- This ADR moves to **Accepted**, and `check-coverage.mjs` switches from asserting the questions
  are asked to asserting they are answered.

## Decision log

| Date | Item | Decision | Decided by |
|---|---|---|---|
| 2026-08-30 | 1 — hosting target | A desktop application (Electron or Tauri; framework deferred to items 2–3) | Product owner |

Items 2–9 remain open, so RS-019 stays blocked and this ADR stays **PROPOSED**. What item 1 does
change: RS-112, RS-113 and RS-020 now know what shape they are building for, and item 9's
candidate set has narrowed without being resolved.
