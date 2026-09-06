# ADR-018 — Front-end state and the command bus

**Status:** Accepted · 2026-09-05
**Depends on:** [ADR-008](ADR-008-entity-model.md), [ADR-014](ADR-014-revision-lifecycle.md),
[ADR-016](ADR-016-studio-web-delivery-track.md)

## Context

`studio-web` needs client state, and the question is not which library. It is which of the two
things called "state" each piece belongs to, because getting that wrong is how a canvas app comes
to disagree with its own document.

There are two, and they have different rules:

- **The document.** The entity graph, edited only by commands, undoable, hashable, and the thing a
  revision is made of. Its shape is `packages/studio-model` and its authority is the server.
- **The view.** Camera, selection, hover, active tool, which panel is open, whether snapping is on.
  Not undoable, not persisted to a revision, and of no interest to the kernel.

The recurring failure is one store holding both: selection ends up in the undo stack, a pan dirties
the document, autosave fires on a hover, and the content hash changes when nothing about the rack
did.

## Decision

**Zustand for view state. A command bus for the document. They are not the same store and they do
not share a reducer.**

1. **Every document mutation is a typed command** — `insertBayAfter`, `splitRun`, `setAisleAfter`,
   `setPath` and the rest — returning `{ok, label}` or `{ok: false, msg}`. A React event handler
   may *dispatch* a command; it may not compute a new document.
2. **The command is the undo unit.** One completed drag produces one `moveRun`, not one per pointer
   move. Undo replays inverses through the same bus, so nothing can be undone by a path that
   bypasses validation.
3. **Zustand holds view state only.** A field belongs there if losing it on reload costs the user
   nothing but their place. Camera, selection, hover, tool, snap flags, panel open/closed.
4. **The document store is read-only to components.** Components subscribe to derived selectors and
   dispatch commands. No component writes a document field, and no component calls a kernel
   function directly — the display list and the summary are what they read.
5. **Drag preview never touches the document.** Preview geometry is view state, lives in the
   preview index (ADR-017), and Escape discards it. The document changes once, on commit.
6. **The server is the authority on the document.** Optimistic concurrency by expected version; a
   stale base is **refused and reloaded, never merged**, per OD-19.

## Consequences

**Good.** The content hash only changes when the document changes, which is what makes ADR-014's
revision lifecycle and the audit chain mean anything. Pan and zoom cannot dirty a revision.

**Good.** Rule 1 makes the undo ledger and the audit log the same list of events at different
altitudes, and it makes commands testable with no React in the test — `fast-check` over random
command sequences, asserting the model round-trips, needs no DOM at all.

**Good.** Zustand stays small on purpose. It was chosen over Redux Toolkit because the interesting
state is not in it; a reducer framework around camera and selection is ceremony.

**Bad.** Two stores is a boundary that must be policed, and the pressure to cross it is constant —
"selection needs to survive undo", "the camera should be saved with the layout". Each of those is
reasonable and each, granted casually, puts view state into the hash. They should be granted only
by amending this ADR.

**Bad.** Rule 5 means a drag holds two representations of the same geometry, and they can disagree.
A preview that shows a clash the committed edit does not produce is worse than no preview, because
it is confidently wrong. The local clash check during drag and the full validation on commit must
be the same rule code, not two implementations that agree today.

**Bad.** Rule 4 is not mechanically enforced yet. `check-app-boundaries` stops an app importing a
kernel internal; nothing yet stops a component importing a kernel entry point and doing arithmetic
in a render. That gap needs a checker with a planted failure before this ADR can be called
enforced rather than agreed.
