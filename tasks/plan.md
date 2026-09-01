# Implementation Plan — Audit Remediation → Running MVP-1

**Created 2026-09-01** from the Rev C blueprint conformance audit
(`../rack-master-studio-conformance-audit.html`). Supersedes nothing; `TODO.md` remains the
per-deliverable status record and this document is the ordered route from here to a running product.

Task list: **`tasks/todo.md`**. Every task there carries acceptance criteria, a verification command,
its dependencies and a size. Nothing in this plan is marked done without the command and its actual
output recorded, per the standing rule in `LATEST.md` §10.

Pre-merge review of the first instalment (the seven commits on `fix/catalog-release-integrity`) is
planned separately in **`tasks/review-plan.md`**, with its own task list in
**`tasks/review-todo.md`** (R-01 … R-11) and its findings in `tasks/review-findings.md`. That review
gates the merge to `main`; this plan resumes at T-05 once it closes.

**Where this plan stands, 2026-09-01.** Phases 1 and 2 landed, the review of them closed its first
two phases, the catalog has its first approved release, and CI ran green for the first time. The
measured state of the whole build — what exists, what does not, and which recorded figures are now
stale — is in **`tasks/state-of-the-build.md`**. Read that before this document: it says what is
true; this one says what to do about it.

---

## Baseline, measured 2026-09-01

Established before any change, so every later claim has something to be a delta against.

| Check | Command | Result |
|---|---|---|
| Tests, non-DB | `vitest run` (excl. `*.db.test.ts`, `tenancy.test.ts`) | **855 passed / 855**, 33 files |
| Tests, DB-backed | — | **not run** — no docker or psql in the Linux workspace |
| Typecheck | `tsc --build` | exit 0 |
| Lint | `eslint .` | exit 0 |
| `check-boundaries` (+ self-test) | `node tools/…` | PASS — 33 files, 9 pure packages |
| `check-app-boundaries` (+ self-test) | `node tools/…` | PASS |
| `lint-provenance` (+ self-test) | `node tools/…` | PASS — 89 files |
| `check-language` (+ self-test) | `node tools/…` | PASS — 60 files |
| `check-determinism` (+ self-test) | `node tools/…` | PASS — 4 cases, 2 hostile environments, matches pin |
| `check-rls` | — | **not run** — needs Postgres |
| Repository | `git` | 42 commits, `main`, clean tree, **no remote** |

855 non-DB + 71 DB-backed = the 926 recorded in `LATEST.md`. That figure is confirmed.

**Two environment facts that shape the plan.** `node_modules` is a Windows install, so the Linux
workspace needed `@esbuild/linux-x64` and `@rollup/rollup-linux-x64-gnu` dropped into
`node_modules/.pnpm/` to run vitest; nothing else was modified and neither `package.json` nor the
lockfile was touched. And the repository still has **no git remote**, so CI has never executed. Task
`T-00` fixes the second, because until then every "CI is green" claim in this repository is unproven.

---

## What this plan is for

The audit found the build follows the blueprint closely — 68% of MVP-1 scope, ~94% fidelity where
something exists — with **three structural defects, one demo-blocking data gap, and one weak gate**,
all fixable in days. It also found the remaining 32% is a single missing layer: there is no server
and no interface.

So the route has three movements, and they must happen in this order:

1. **Fix what is wrong** (Phases 1–2). Small, cheap now, expensive after the UI is built on top.
2. **Build the contract, then the server** (Phase 3). The blueprint's own argument applies: the
   leakage contract is "worth ten times more written against six routes than against two hundred."
   There are currently zero routes. This is the cheapest this will ever be.
3. **Build the interface** (Phase 4), then prove it end to end (`AC-20`) and make it deployable
   (Phase 5).

---

## Architecture decisions taken in this plan

### AD-1 — The submit workflow moves to a pure `packages/workflow`, not into `apps/api`

The audit's D-01 says the orchestration is on the wrong side of the trust boundary. The obvious fix
is to move it into `apps/api`. The better fix is a new **pure** package that both apps may *read*
(for step names, refusal shapes and ordering assertions) but only the API may *execute*, because the
client legitimately needs to render "what will happen when I submit" without owning the decision.

- `packages/workflow` is subject to `check-boundaries` — no I/O, no clock, no RNG. It stays pure.
- `apps/api` supplies the effects and owns the transaction.
- `apps/client-web` may import the *types and step vocabulary*, never `submit()` itself.
- `check-app-boundaries` grows a rule: `client-web` may not export any symbol named
  `submit`, `freeze`, `derive*` or `strip*`.

This keeps the property that makes the current module good — injected effects, asserted ordering —
while moving the authority to the server.

### AD-2 — Error envelope, fixed once, before any route exists

One shape everywhere. Mixing "throws here, null there, `{error}` elsewhere" is how consumers stop
being able to predict behaviour.

```jsonc
{
  "error": {
    "code": "VALIDATION_ERROR",     // machine-readable, closed enum
    "message": "Clear height is required",
    "details": { }                  // optional, structured
  }
}
```

| Status | Meaning here |
|---|---|
| `400` | Malformed request |
| `401` | Not authenticated |
| `403` | Authenticated, denied a **capability** (staff-only action) |
| `404` | Not found **or** cross-tenant / cross-audience object — never `403` (AC-03) |
| `409` | Conflict: stale base (OD-19), or an idempotency key still in flight |
| `422` | Semantically invalid, including an idempotency key reused with a different payload |
| `500` | Server error, no internal detail in the body, ever |

The 403/404 split is the one the existing authorization matrix already got right and a test already
defends: a staff-only **artifact** is `404` because a `403` confirms it exists; a staff-only
**capability** is `403` because refusing to admit the verb exists is dishonest in the other direction.

### AD-3 — Idempotency is implemented, not merely accepted

§8.3 requires idempotency keys on `submit`, `derive`, `clone` and `invite`. Accepting the header and
handling it carelessly is worse than not offering it, because the client then believes retrying is
safe. The contract:

- **Key origin.** Client-generated, once per intent, reused across retries. Never derived from a
  UUID minted per attempt or from a timestamp.
- **Atomic claim.** `INSERT … ON CONFLICT` against a unique constraint on `(organization_id, key)`.
  A `SELECT` then `INSERT` is a race, not a guard — and under a retry storm the race is exactly when
  it fires.
- **Payload guard.** Store `request_hash`. Same key, different body ⇒ `422`, loudly. Never replay the
  first response to a second, different request.
- **In-flight duplicate ⇒ `409`.** Deliberately chosen over waiting: submit is not long-running
  enough to need `202`, and letting the second caller through because the first "seems stuck" is
  precisely when duplication costs most.
- **Three outcomes, not two.** The intent row is written *before* the effect, so a crash between the
  call and the response leaves evidence rather than a silently retried freeze.
- **Retention outlives the longest retry path** — the outbox's dead-letter replay window, not disk
  cost. Set to 30 days, which is longer than any current re-delivery path.

### AD-4 — Pagination on every list endpoint from the first one

`GET /api/internal/v1/queue` is the endpoint §5.4 budgets at 5,000 submissions. It ships paginated or
it ships broken.

```jsonc
{ "data": [ … ],
  "pagination": { "page": 1, "pageSize": 20, "totalItems": 142, "totalPages": 8 } }
```

Query params camelCase (`?page=&pageSize=&sortBy=&sortOrder=`), response fields camelCase, enum
values `UPPER_SNAKE`, booleans prefixed `is`/`has`/`can`.

### AD-5 — Additive-only interface evolution

New fields are optional. No field changes type or disappears once a consumer exists. Hyrum's Law
applies with unusual force here: this product's whole argument is that a two-year-old submission
still renders, which means every observable of a pinned revision is a commitment. Deprecations get a
window and a changelog entry, never a silent removal.

### AD-6 — Frontend and API framework: **ANSWERED 2026-09-01**

**Fastify** for the API, **Vite + React Router v7 SPA** for the front end. Recorded in the project
status doc before this plan was written, and never carried back here — the kind of drift D-19 was
about, so it is fixed rather than noted.

Phases 1–2 never depended on either. **T-13a–d never depended on the API framework either**, which
is why the contract package landed before the question was formally closed: the error envelope,
the pagination envelope and the forbidden-field list are the same whatever serves them. T-14 is the
first task that needs Fastify specifically.

### AD-7 — Performance is measured, not asserted *(added 2026-09-01)*

§5.4 sets five budgets and states, for each, how it is measured. Nothing performed any of them: no
harness, no fixture, and the only quoted figures are rack-studio spikes the blueprint itself calls
"a floor rather than a measurement". That is the same defect as an unenforced coverage threshold —
a control that names its own method and has no mechanism behind it.

Three rules from here:

1. **A budget without a runner is not a budget.** Every §5.4 row gets a task that builds the
   measurement §5.4 already specifies for it. Budgets 1 and 2 are done (`pnpm bench`, CI step);
   3–5 land with the code they measure, in the same commit, not after it.
2. **Guard with a ratchet, not only the contract number.** The measured paths sit ~100× inside
   their budgets, so the §5.4 gate alone catches a catastrophe and nothing smaller. A ratchet just
   above the measured value is what makes it a regression test. Same principle as the coverage
   floors, and raised only when the measurement drops.
3. **No optimisation without a measurement that justifies it,** and every attempt goes in `PERF.md`
   — kept and reverted alike — so a dead idea is not re-run next quarter.

**The gap §5.4 does not cover.** All five budgets are server- or kernel-side. There is **no
front-end budget at all** — no LCP, no INP, no CLS, no bundle ceiling — for a product whose entire
premise is a client self-service web app where the preview interaction *is* the product. The 120 ms
preview budget covers the computation; nothing covers the paint. `P-05` fixes that before the first
screen is built, because a bundle ceiling agreed after the bundle exists is a ceiling nobody meets.

---

## Dependency graph

```
T-00 remote + CI green
  │
  ├── Phase 1 · data & schema (independent of everything else)
  │     T-01 frames into the approved release ──┐
  │     T-02 retire 2026-08                     ├── T-04 human spot-check gate
  │     T-03 audience RLS + check-rls extension ─┘
  │
  ├── Phase 2 · kernel & workflow
  │     T-05 contentHash ≠ manifestHash ──┐
  │     T-06 record the acknowledgement ──┼── T-07 move submit to packages/workflow
  │     T-09 part_revision registry ──────┘        │
  │     T-08 move internal ops server-side ────────┤
  │     T-10 doc reconciliation + check-claims     │
  │     T-11 secret scanning   T-12 conflict register
  │                                                │
  │  ══ CHECKPOINT A ══════════════════════════════╪══════════════
  │                                                │
  ├── Phase 3 · contract & server  [needs API framework]
  │     T-13a error envelope + pagination + shared types
  │     T-13b client DTOs → contracts + outbound validator
  │     T-13c input DTOs (mass-assignment-proof)
  │     T-13d idempotency store + atomic claim
  │           └── T-14 the server (authz middleware, boot assertion, deny audit)
  │                 └── T-15 client routes wired; AC-02/03/06 re-asserted LIVE
  │
  │  ══ CHECKPOINT B ═══════════════════════════════════════════
  │
  ├── Phase 4 · interface  [needs frontend framework]
  │     T-16 design tokens + shared component library + a11y baseline
  │     T-17 render-svg (elevation) · render-canvas (plan)
  │           └── T-18 client slices D-01…D-08
  │           └── T-19 internal console E-01…E-05
  │     T-20 render-pdf + E-08              [blocked: disclaimer text]
  │     T-21 a11y audit tool, self-tested against known ratios
  │
  │  ══ CHECKPOINT C · AC-20 walkthrough ═══════════════════════
  │
  └── Phase 5 · deploy readiness
        T-22 observability + the six day-one alerts
        T-23 performance budgets in CI
        T-24 B2 live WORM proof            [blocked: credentials]
        T-25 backup + restore drill
        T-26 deploy checklist, rollback triggers, changelog
```

---

## Vertical slicing, and where it does not apply

Phases 3–4 are sliced vertically: each client task is *schema → API → screen* for one capability, so
every task ends with something a person can do. Phases 1–2 are deliberately **not** sliced that way —
they are repairs to existing horizontal layers, and pretending otherwise would inflate them.

The eight MVP steps become the eight Phase-4 slices, in the blueprint's own order, so `AC-20` is
assembled incrementally rather than written at the end against a system nobody walked through.

---

## Git strategy

Trunk-based, short-lived branches, merged within 1–3 days. `main` stays green.

| Branch | Tasks | Concern |
|---|---|---|
| `chore/ci-remote` | T-00 | Push, watch CI go green once |
| `fix/catalog-release-integrity` | T-01, T-02, T-04 | Catalog data and its approval gate |
| `fix/audience-rls` | T-03 | One migration, one policy, one checker extension |
| `fix/hash-separation` | T-05 | The content/manifest hash split |
| `feat/acknowledgement-record` | T-06 | FR-QS-03 |
| `refactor/workflow-boundary` | T-07, T-08 | Moving orchestration server-side |
| `feat/part-revision-registry` | T-09 | Schema addition |
| `chore/doc-reconciliation` | T-10, T-12 | Docs and the claims checker |
| `chore/secret-scanning` | T-11 | CI |
| `feat/contracts` | T-13a–d | The API contract package |
| `feat/api-server` | T-14, T-15 | The server |
| … | | Phase 4+ branches named per slice |

**Commit discipline.** One logical change per commit; `<type>: <subject>` with a body explaining
*why*. Refactors never ride along with behaviour changes — T-07 is a pure move and must contain no
logic edit, so its diff is reviewable as "nothing changed except location."

**Every task's commit body carries the verification command and its actual output.** That is this
repository's existing standard and the audit found it honoured; it should survive this plan.

**Change summary on every task**, in the `git-workflow` skill's shape: what changed, what was
deliberately *not* touched, and any concern. The "didn't touch" section matters most here — this
codebase is full of adjacent things that look fixable and are out of scope.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The T-07 move silently changes submit behaviour while looking like a move | High | Pure move first, zero logic edits, tests unchanged and still green; behaviour changes land in a *separate* commit afterwards |
| Re-approving the catalog (T-04) becomes a rubber stamp | High | The sampler draws the cells; the approver cannot choose them. Any mismatch fails the whole release — no partial pass |
| The audience RLS predicate breaks staff queries | Medium | `is_staff()` short-circuit preserved; the existing 27 tenancy tests must stay green, plus a new pair asserting a client cannot read *or write* an internal revision |
| Phase 3 stalls on the framework decision | Medium | Phases 1–2 are ~2 weeks of work and need no decision. Decide before T-13a |
| Postgres is unavailable in the workspace, so DB tests never run locally | Medium | T-00 makes CI the authority for DB-backed tests; locally, run them on Windows where docker is |
| The UI is built before the contract, and leakage returns as a serialization bug | High | Phase 4 is hard-gated behind Checkpoint B. No screen is built against an unvalidated response shape |
| `AC-20` gets written to pass rather than to walk | High | It is assembled slice by slice in Phase 4, not authored at the end |
| Scope creep into pricing / DXF / CAD | High | §19.2 stands unchanged. Nothing on this plan touches it |

---

## Open questions — needed before the phase they gate

| # | Question | Gates | Owner |
|---|---|---|---|
| **Q1** | **Frontend framework.** Blueprint §6.2 says "React with a file-based router (Next.js or Remix/React Router)" and leaves it open. A framework with a server per app reintroduces the leak the two-bundle rule exists to prevent; a pure SPA has no server-render path to police. | Phase 4 (T-16) | EL |
| ~~**Q2**~~ | **API server framework. ANSWERED: Fastify** (recorded in the project status doc before 2026-09-01; this table never caught up — R-11). Originally: Needs first-class schema validation so §8.3's outbound `additionalProperties:false` is the core model rather than a bolt-on. | Phase 3 (T-14) | EL |
| **Q3** | **Standing disclaimer text, verbatim**, plus the company/contact name for the title block (`OD-16`) and the document number format. | T-20 / `E-08` / `AC-16` | EL + counsel (RH-06) |
| **Q4** | **Backblaze B2 credentials**, and permission to run the upload-then-overwrite proof on a Governance test bucket first. | T-24 / `E-07` | EL |
| **Q5** | **Who performs the catalog spot-check**, and are they positioned to catch a *capacity-table* error specifically (RH-05, `OD-07`)? A name alone does not satisfy the gate this plan builds. | T-04 | EL |
| **Q6** | **External pilot client** (`OD-20b`). Gates no code. Gates the meaning of all of it — R-01 stays open until one outside organization submits unaided. | Nothing technical | EL |
| **Q7** | **Git remote** — where does this push? CI has never run. | T-00 | EL |

---

## Preparation for `/engineering:deploy-checklist`

The deploy checklist cannot be filled in yet, and the reason is worth stating rather than deferring:
**five of its lines have no possible value today.** Phase 5 exists to create them.

| Checklist line | Blocked on | Task |
|---|---|---|
| "All tests passing in CI" | No remote; CI has never executed | T-00 |
| "Database migrations tested" | Migrations run locally; no staging | T-03, Phase 5 |
| "Rollback plan documented" | Nothing deployed to roll back | T-26 |
| "Deploy to staging and verify" | No environment | Phase 5 |
| "Monitor error rates and latency" | NFR-OB-01…04 at 0% | T-22 |
| "Rollback triggers: error rate / p50 latency" | No baseline; §5.4 budgets never measured | T-23 |

**Rollback triggers to define at T-26**, drawn from §5.4 and NFR-OB-03 rather than invented:

- Any internal-only field on a client-facing response — **not a threshold, an incident**. Roll back
  immediately, at a count of one.
- Audit hash-chain verification failure.
- Determinism harness failure.
- Preview update p95 > 120 ms on the 300-bay fixture; full derivation p95 > 400 ms; submit p95 > 2 s;
  queue p95 > 800 ms at 5,000 rows.
- Failed catalog release gate.
- Authorization denial rate for one principal above baseline.

The first is the one that makes this product's checklist different from a normal one: for R-02 there
is no acceptable non-zero rate, so it belongs above the latency thresholds, not among them.

---

## Preparation for `/frontend-ui-engineering`

Phase 4 is the largest movement and the one most likely to produce work that looks finished and is
not. Constraints fixed **now**, before Q1 is answered, so the framework choice does not drag them:

**The product's own rules, which are stricter than the usual UI defaults**

- **An unestablished value never renders as a numeral.** The display list already guarantees it and
  `lint-provenance` fails the build on a formatter applied to a raw number. No component may
  reintroduce this by formatting a value itself — `VERIFY`, never `0"`.
- **Status is never colour alone** (NFR-A11Y-03). Every one of the seven severities carries a word.
  This is also why the severity vocabulary is exact: a status meaning something slightly different on
  two screens is worse than no status.
- **Missing input must be visually distinct from engineering review.** Collapsing them is the
  specific defect the `rack-studio` prototype has, and it buries the client's actionable list inside
  things they cannot act on.
- **Every number in a drawing is also available in a table** (NFR-A11Y-02). A plan view is never the
  only route to a value.
- **A renderer consumes a display list and may not recompute a dimension.** One display list, three
  renderers. A drawing that prints differently from the screen is a liability, not a bug.

**Standard engineering constraints**

- Mobile-first; verified at 320 / 768 / 1024 / 1440.
- Every interactive element keyboard-operable and reachable by Tab; focus moved deliberately on
  dialogs; focus trapped in modals.
- Loading, empty and error states designed for every view — skeletons for content, not spinners.
- Semantic colour tokens, one spacing scale, no arbitrary pixel values, no component over ~200 lines.
- Contrast **measured** over rendered text nodes in both themes, with the audit self-testing against
  known ratios first, so a broken audit cannot pass silently (§16.1's pattern, and the reason
  `rack-studio/prototype/audit-ui.mjs` is on the reuse list).
- **No AI aesthetic.** No purple/indigo default palette, no gradient washes, no uniformly rounded
  everything, no stock card grid, no oversized padding. This is an engineering instrument read by
  estimators; it should look like one.

**Server state via a query library, URL state for filters and pagination.** Option comparison,
queue filters and pagination are shareable UI state and belong in `searchParams`, not component
state — an estimator sending a colleague "look at this queue view" is a real workflow.

---

## Definition of done, standing

No task counts as complete until all of these hold, on top of its own acceptance criteria:

- [ ] `pnpm verify` passes, exit 0, and the actual output is recorded in the commit body
- [ ] Any new gate has been **proven to fire** by deliberate breakage, then reverted
- [ ] Coverage floors hold; new pure code is at 100% or the floor is raised, never lowered
- [ ] No new string overclaims (`check-language`)
- [ ] The change summary names what was deliberately not touched
- [ ] `docs/CURRENT_STATE.md` §4 carries the command and its output
