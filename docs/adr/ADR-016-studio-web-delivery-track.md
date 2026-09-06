# ADR-016 — `apps/studio-web`: audience, boundary and delivery track

**Status:** Accepted · 2026-09-05 · records DEC-1 from `rack-studio-build-plan.md` Rev B
**Depends on:** [ADR-003](ADR-003-display-list.md), [ADR-005](ADR-005-fixed-point.md),
[ADR-008](ADR-008-entity-model.md), [ADR-015](ADR-015-hosting-and-system-of-record.md)

## Context

Two products are being asked for at once, and until now only one of them had a home.

Blueprint §15.2 defines MVP-1 as **client self-service quote intake**: eight steps from invitation
to internal review, none of which involves drawing anything. §15.4 explicitly fences interactive
canvas editing *out of the client application*. Meanwhile a working Canvas 2D layout tool exists as
a published artifact and a 2,115-line prototype, with a 105-assertion kernel in mil, and the
product owner wants it as production code.

The wrong resolutions are both easy to reach. Putting the canvas in `apps/client-web` breaches
§15.4. Building it as a standalone application over the prototype's own kernel gives the domain two
implementations in two unit bases — which is the specific defect
`reference-project-inventory.md` found in three of the four reference projects and which this
architecture exists to make impossible.

## Decision

**A third application, `apps/studio-web`, for the internal audience, consuming the existing kernel
packages.** Specifically:

1. **Audience is internal.** Staff identity (Entra ID / OIDC), internal role matrix. No external
   client ever loads it. This is what keeps §15.4 intact: the fence is around the *client* app, and
   an internal drafting tool is not on the other side of it.
2. **One kernel.** `studio-web` imports `@rms/kernel-*` and `@rms/display-list` through their
   public entry points only, as `check-app-boundaries` already enforces. It computes no geometry,
   no capacity and no finding of its own. The prototype's `kernel.js` becomes a **continuity
   fixture** and is never a second implementation.
3. **Micrometres, per ADR-005.** The prototype's mil basis does not survive the port. 1 mil =
   25.4 µm exactly, but allocation over a remainder lands differently, so mil fixtures are
   **re-derived** in µm and the continuity suite records the per-value delta rather than asserting
   equality (DEC-2).
4. **Off the MVP-1 critical path.** `studio-web` shares only T-16 (tokens, component library, a11y
   baseline) and T-17 (display-list renderers) with MVP-1. No MVP-1 task may acquire a dependency
   on a `studio-web` route, component or store.
5. **§15.2 does not move because of it.** Work landed here is not MVP-1 progress and must never be
   counted as such on the scoreboard.

## Consequences

**Good.** The heaviest technical risks in the whole programme — Canvas 2D rendering under DPR
changes, spatial hit-testing at 300+ bays, a command bus with undo, and the first real front-end
bundle — are front-loaded into a track with no external users and no compliance surface. T-16 and
T-17 are proven by a demanding consumer before the client app depends on them.

**Good.** The kernel finally gets an exacting caller. Nine packages at 100% coverage have so far
been exercised only by their own tests; a drawing surface is the first thing that will find what
the interfaces are actually missing.

**Bad, and this is the real cost.** Two front-end applications will exist, and §15.2 stays at 0 of
8 while one of them is built. Anyone reading a burn-up chart will see motion and no progress. The
scoreboard's refusal to award points for unregistered work is the control here, and it will feel
wrong for several sessions. It is not wrong.

**Bad.** An internal-only audience is a decision that will be pushed on. The first demo where a
client sees a live plan will produce a request to let them touch it, and granting it re-opens
§15.4. Say no by pointing here.

**Bad.** Boundary rules, coverage floors, the type gate and the bundle budget all now have to cover
`.tsx` in a third application. S0.0 (F-43/F-44/F-45) taught each of those gates the extension; none
of them has yet been run against a real React tree, so their reach is asserted and not yet
demonstrated at scale.

## What this ADR does not decide

Whether `studio-web` ever becomes client-visible; whether its document model converges with the
client app's; and who operates it. Those are Phase 2 questions and inventing answers now would put
requirements into the system that nobody asked for.
