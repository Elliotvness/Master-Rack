# Claude — Resume Rack Master Studio (paste-friendly)

You are resuming work on **Rack Master Studio**, a client-facing pallet-rack configuration and
quote-intake web app. Everything you need to orient is embedded below. You do not have the
repository; treat every figure as a claim to re-verify the moment you get repo access, and ask for
specific file contents when a task needs them.

---

## 1. The objective — the blueprint (governing document)

The blueprint is the objective. The scoreboard (section 2) is the measurement. When they disagree,
the blueprint wins.

**§15.2 — MVP-1 "done when": the eight steps, and nothing else.** MVP-1 is done only when all
eight run end to end for one option template:

1. **Invitation** — an internal user creates a client organization and project and sends an
   invitation. *Done when:* the invited address receives a link; the invitation row holds the org,
   role and a hash of the token.
2. **Acceptance and sign-in** — the client accepts, sets a credential, enrolls a second factor,
   and signs in. *Done when:* the token is single-use; a second redemption renders the same page as
   an expired one.
3. **Facility and unit entry** — the client enters basic facility and unit information. *Done
   when:* unknown fields are recorded as unknown and produce findings, not zeros.
4. **Two controlled options** — the client creates two controlled selective-pallet-rack options.
   *Done when:* choices come only from the pinned catalog release; an unavailable choice states why.
5. **Preliminary plan and elevation** — the client sees a preliminary plan and elevation, the
   assumptions, and the missing-input warnings. *Done when:* every dimension on the drawing is a
   model value; nothing unestablished is printed as a numeral.
6. **Submit a request for quote** — the client selects one option and submits. *Done when:*
   blockers refuse with all reasons; assumptions are acknowledged; a watermarked PDF is produced.
7. **Immutability** — the submitted revision becomes immutable. *Done when:* a direct `UPDATE`
   against the row fails at the database; the manifest is in WORM storage with its hash.
8. **Internal review and derive** — an internal user reviews the submission, opens the
   internal-only BOM/takeoff, then derives a working revision. *Done when:* the BOM regenerates
   byte-identically; the derived revision does not alter the submission; the client cannot see it
   exists.

**§16.2 — Acceptance criteria AC-01…AC-20** (each is a named test that must be green):
AC-01 single-use invitation token; AC-02 no forbidden field on any client route at any depth
(cost, margin, supplier, mpn, capacity, internal_note, … — one shared constant); AC-03 wrong-tenant
requests get 404 not 403; AC-04 RLS blocks cross-tenant reads/writes; AC-05 every table has RLS
enabled+forced with ≥1 policy per operation, enforced in CI; AC-06 a route without an authz policy
prevents boot; AC-07 unestablished values never rendered as numerals; AC-08 off-grid span returns
both brackets, no capacity, no interpolation; AC-09 used/generic material yields no capacity and no
table basis; AC-10 submission with an open blocker refuses listing *every* reason; AC-11 post-submit
`UPDATE` fails at the database; AC-12 BOM regenerates byte-identically twice on two machines;
AC-13 every BOM line has part_revision_id + rule text + confirmed flag + source ids, or is an
unresolved line with a reason — no third state; AC-14 derived revision leaves the submission's
content_hash unchanged and is absent from client responses; AC-15 every state change writes an
audit event in the same transaction, hash chain verifies from genesis; AC-16 client PDF has
watermark, disclaimer, `P` revision code, short-form manifest hash on every page; AC-17 deactivating
a user terminates sessions and revokes invitations; AC-18 catalog release cannot be pinned if
approved_by is null, approved_by == digitised_by, or it lacks a full cross-check with only one
signature; AC-19 a check governed by a below-PRIMARY rule returns at most that tier's ceiling;
AC-20 all eight MVP steps run as one automated walkthrough ending in byte-identical BOM
regeneration and a frozen, deep-immutable submission.

**§16.3 — Demo scenario** (one ~12-minute narrative exercising every claim): Harbor Logistics,
Units A/B/C; client ticks "not known" on unit C's clear height; configures 96" beams / 4 levels /
42" frames / 144" aisle; a 110" beam is refused with the published grid brackets (108"/114") and
the no-interpolation explanation; a blocker appears when top-of-load exceeds clear height and
clears when levels drop; comparison shows Option 1 at 1,248 positions vs Option 2 at 1,040; the
preliminary PDF carries watermark + disclaimer + `P01` + hash and **no part numbers or
quantities**; editing a submitted option is refused with a clone-to-P02 offer; the internal BOM
shows UNRESOLVED lines with reasons; "show your work" traces a frame quantity to formula → values
→ rule → catalog release page; deriving `C01.01` changes the aisle to 132" without altering the
client's `P01`; the audit trail verifies end to end.

**§15.4 — Explicitly NOT in MVP-1:** pricing/cost/margin, DXF, public self-signup, engineering
calculations, detailed customer BOM/DWG exports, multi-vendor catalogs, impersonation (Phase 2).

## 2. Where the project stands — the scoreboard (2026-09-01)

| Measure | Value |
|---|---|
| **§15.2 MVP-1 "done when"** | **0 of 8 steps — 0%** — the answer to "how done is it" |
| Plan-task completion, effort-weighted | 18 of 143 pts — 12.6% (upper bound, not the answer) |
| Plan-task completion, task count | 6 of 43 — 14% |
| Pre-merge review `R-01…R-11` | 8 of 11 — 73% (R-11 only partly closed) |

Measured on branch `fix/catalog-release-integrity` @ `6f05043` — 27 commits ahead of `main`, 1
commit unpushed, and the tip has been **tested by nothing**. The suite could not be re-run (win32
binaries vs Linux shell); "1,042 tests passing" and "CI green" are repository claims, not
measurements.

**Reconciliation:** the Rev C audit's 68% and `LATEST.md`'s 70% are blueprint-conformance measures
over all of MVP-1; the scoreboard counts tasks in the remediation plan. Different denominators,
both honest, neither comparable. All four documents agree on §15.2 = 0 of 8.

**Method (reproducible):** 43 tasks = 35 `T-…` + 6 `P-…` in `tasks/todo.md` (T-13a–d and T-18a–e
counted individually) + R-08/R-10 counted once; the ten Phase 4 bullets (T-16…T-21) and five Phase
5 bullets (T-22…T-26) are inside the 35. Weights: XS=1, S=2, M=4, L=8 (P-00 scored M; T-00 is XS).
Completion is binary — a task counts only when its stated acceptance criteria are met.

## 3. Standing rule

Update the scoreboard whenever a long task or a batch of tasks completes — without being asked,
before the session ends. Re-measure, do not re-read. Label every figure verified-today vs
repository-claim. Re-date the header; if the denominator changed, say so explicitly.

## 4. What to do next, in order

### Immediate — close the branch out (est. 1 session)
1. **Push `ff63b87`** (4 commits, from Windows — the bridge shell has no credentials) and confirm
   CI green *on the tip*.
2. **R-10 — judge the commits as commits.** 30 commits is a long chain; includes whether two RLS
   commits and a perf harness belonged on a branch named for catalog release integrity.
3. **R-08 — the catalog data reviewed as data**, independently of the test that asserts it.
4. **Merge PR #1. Delete the branch.**
5. **Drift — fixed in session 3, ahead of the merge**, because the push was blocked and the fixes
   were not. Carry them into the merge commit; **R-11 closes on the documentation → 9 of 11**:
   - ✅ `tasks/todo.md` T-01…T-04 checkboxes ticked (20 of them).
   - ✅ `tasks/plan.md` Q1, Q7 **and Q5** struck and answered — session 2's list had missed Q5.
   - ✅ `state-of-the-build-2026-09-01.md` no longer names `feat/contracts`.
   - ✅ *(new)* the scoreboard's own tip figures were stale on the day they were written.
   - ✅ *(new)* T-04's `DONE` block sat under the Phase 2 heading and still said the catalog release
     was back to DRAFT; the manifest reads `APPROVED`.
   - ⤳ **Reclassified, not a doc fix:** "T-14 says 23 §8.2 routes, the table carries 20". Both
     figures were right. §8.2 lists 23 rows, two marked phase 2, so **the MVP-1 surface is 21**; the
     registry declares 19 of them, missing `GET /api/client/v1/documents/:id` and
     `POST /api/internal/v1/revisions/:id/notes` while carrying the phase-2 audit route. That is
     unstarted **T-14** work. Do not edit 21 down to 20.

### Then — Checkpoint A (was skipped; plan requires "Review with EL before Phase 3")
Phase 2 in dependency order: **T-05** (contentHash ≠ manifestHash) → **T-06** (record the
acknowledgement) → **T-07/T-08** (orchestration off the client, into `packages/workflow`) →
**T-27** (type-check the test files) → **T-09** (`part`/`part_revision`) → **T-10** (docs +
`check-claims`) → **T-11** (secret scanning) → **T-12** (source-conflict register).

### Then — Phase 3, the server
T-13b → T-13c → T-13d → **T-14** → T-15, with P-01 and P-02 landing *in the same commits* as the
routes they measure.

## 5. Skills to use

- **doubt-driven-development** — the project runs this discipline (AD-7). Subject every non-trivial
  decision to a fresh-context adversarial review before it stands. The recurring defect shape: a
  control that states its own method and has no mechanism behind it (F-01, F-02, F-08, F-11).
- **git-workflow-and-versioning** — one short-lived branch per task, merged within a day or two;
  changelog entry in the commit that makes the change.
- **ci-cd-and-automation** — every checker has a self-test that runs first; gaps: secret scanning
  (T-11), dependency audit, bundle ceiling (P-05), parallel verify jobs.
- **test-driven-development** — completion is binary; build controls that can go red: T-13b
  outbound validator, T-13d idempotency concurrency test, T-14 deny-by-default against the real
  router.
- **incremental-implementation** — land changes in small, reviewable steps; tasks are already sized
  for it.
- **frontend-ui-engineering** — when Phase 4 starts: P-05 budgets first (INP ≤ 200 ms is the one
  that matters), WCAG 2.1 AA built in from T-16, T-17 renderer-consumes-display-list rule.

## 6. Rules of the road

- **The blueprint is the objective; the scoreboard is the measurement.** When they disagree, the
  blueprint wins — fix the scoreboard, never the blueprint to fit it.
- Never claim verification you did not run. Label every figure verified-today vs repository-claim.
- Completion is binary — no partial credit anywhere.
- Update the scoreboard before the session ends.
- If a step is blocked (e.g., Q3/Q4 open questions, credentials), say so explicitly and move to the
  next unblocked step rather than stalling.
- You do not have the repo: ask for the specific file (e.g., `tasks/todo.md` T-14 region, the route
  table, a commit list) when a task needs it, rather than guessing.