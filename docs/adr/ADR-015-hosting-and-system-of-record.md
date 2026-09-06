# ADR-015 — Hosting and the system of record

**Status:** Accepted · 2026-09-05 · decided by the product owner (EL)
**Supersedes:** [ADR-012](ADR-012-deployment.md) item 1 (hosting target) and
[ADR-013](ADR-013-identity-and-authorization.md) item 1 (workstation identity). Items 2–9 of
ADR-012 and 2–8 of ADR-013 stay open and are **not** answered here.
**Confirms:** OD-01 (2026-08-31), which chose single-region managed Postgres with Object
Lock-capable storage.

## Context

A specification brief delivered on 2026-09-05 proposed rebuilding the backend on Cloudflare
Workers, D1 and R2, with Durable Objects for coordinated writes. It is a reasonable stack and the
question deserves a record rather than a shrug, because the answer is not "we already started."

What is already built is the reason. Tenant isolation in this repository is not application
discipline; it is **row-level security, enabled and FORCED on every one of the 19 application
tables**, with `tools/check-rls.mjs` asserting in CI that each has RLS enabled, forced, and at
least one policy per operation. Above it sit `withTenant()`, an eslint rule banning a raw pool
checkout, the DTO leakage layer, the audit hash chain and the transactional outbox — tasks A-04
through A-11.

**Cloudflare D1 has no row-level security.** There is no engine-level construct to move that
guarantee onto. Migrating would mean deleting `check-rls`, deleting the RLS policies, and
re-expressing tenant isolation as `WHERE organization_id = ?` in application code.

That trade is worse than it looks, and the reason is specific to this failure mode: **RLS fails
silently.** A policy that does not match returns an empty result set rather than raising. The
comment above the CI Postgres service says exactly this — *"a mock that returns what the test
expects proves nothing at all."* An application-code `WHERE` clause fails the same silent way, but
with no independent authority to check it against. The database would stop being a second opinion
and become an echo of the code.

The blueprint's own §15.1 anticipated this: tenant plumbing and the audit chain *"get exponentially
more expensive to retrofit — they touch every route and every table."*

## Decision

**PostgreSQL 16, managed, single-region, is the system of record.** Node services in front of it.
Every tenant boundary, audit hash chain, outbox event and RLS policy lives inside Postgres and
nowhere else.

**Cloudflare is an edge tier, not a database.** Pages/Workers may serve static assets and do
lightweight edge routing for `apps/studio-web` and `apps/client-web`. D1 is not used for
transactional state, in any phase. R2 is not adopted in place of the Object Lock-capable store
OD-01 already chose; the WORM manifest requirement in §15.2 step 7 is what governs that choice, and
it is not revisited here.

**The test that makes this real:** `pnpm check:rls` stays in `pnpm verify` and in CI, and its
self-test stays with it. If a future change makes that check unrunnable, this ADR is being reversed
whether or not anyone says so.

## Consequences

**Good.** The strongest control in the repository keeps its enforcement point. Nineteen tables, the
`check-rls` gate, `withTenant()`, the DTO layer and the audit chain need no change. The decision
costs nothing to implement, because it is a decision not to spend.

**Good, and easy to overlook.** Postgres gives the `.db.test.ts` suites something real to run
against. Those suites are the only evidence tenant isolation works — `tenancy.test.ts` says so in
its own skip message. On D1 the equivalent tests would be asserting the application's `WHERE`
clause against itself.

**Bad.** A managed Postgres is a running cost and an operational surface — connection limits,
failover, backup verification, a region to be in — where Workers+D1 would have been close to
zero-ops. Someone owns that, and this ADR does not say who; ADR-012 items 2–9 are where it belongs.

**Bad.** Single-region means latency for a client outside it, and a regional outage is an outage.
OD-01's phrasing — tenant plumbing designed so database-per-tenant is a config change — leaves the
door open, but nothing has been built or tested against a second region, and no such claim should
be made.

**Bad, and stated because it is the real cost of this decision.** Edge-rendered, globally
distributed delivery is now foreclosed for anything that touches tenant data. The static tier can
sit at the edge; the data cannot. If the product later needs sub-50 ms reads worldwide, this ADR is
the thing in the way, and it should be reopened honestly rather than worked around with a cache
that quietly copies tenant rows past the RLS boundary.

## What would change this decision

A row-level-security mechanism at the storage engine, enforced by the engine and independently
assertable in CI — not a library, not a query builder, not a convention. Absent that, a proposal to
move must say which control replaces `check-rls` and how it is proven to fire.
